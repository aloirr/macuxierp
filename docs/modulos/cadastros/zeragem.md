# Zerar dados por cadastro (v0.3.5) — plano puro

Status: domain e testes (Z1 da T-0058). A RN é `RN-CAD-10` (doc 03). Código: `modules/cadastros/domain/zeragem.ts` e `zeragem.test.ts`.

## Objetivo
O superadmin zera cadastros (por exemplo, para recarregar a base na migração) sem quebrar pedido, título nem nota. O domain só **planeja**: recebe fatos e devolve o que apagar, anular e manter. O efeito roda nas funções do banco, e a rota revalida e reconfere `emUso` com FOR UPDATE.

## Entrada: lista de cadastros
`CADASTROS_ZERAR` (espelha `CADASTROS_ZERAR_PORTAL` do SDK; vira reexport quando ele sair), na ordem da carga:
filial, vendedor, forma_prazo, produto, produto_unidade, preco, estoque, cliente, cliente_endereco.

| Cadastro | Tabelas |
|---|---|
| forma_prazo | condicao_pagamento |
| preco | tabela_preco, tabela_preco_item |
| estoque | estoque_saldo, estoque_movimento |
| cliente | cliente, cliente_contato |
| demais | a tabela de mesmo nome (produto_unidade e cliente_endereco são soltas) |

Dependências automáticas: produto leva produto_unidade e estoque, e os itens de preço (`tabela_preco_item`) pela cascata de FK; o cabeçalho `tabela_preco` fica e `cliente.tabela_preco_id` não é anulado (`preco` não vira efetivo); cliente leva cliente_endereco (a carteira é `cliente.vendedor_id`, sem tabela). Filial segue a cascata por FK (vendedor, itens de preço, estoque, cliente e endereço), mas só apaga a tabela de preço (cabeçalho) se `preco` for efetivo por outro caminho. `efetivos` = escolhidos + dependências, na ordem da carga; repetidos não mudam o plano.

## Fatos e plano
`FatosZeragem` (o que `cadastros.portal_zeragem_fatos` devolve): linhas `{ id, refs, com_chave }` por tabela (`com_chave` = external_id não nulo), `usos` por cadastro e motivo, `filiaisComNota` e `integracao: { cadastro, ligada, lote_em_voo }[]`.
`PlanoZeragem`: `{ efetivos, apagar, anular, mantidos, bloqueios, sem_chave, emUso }`. `contagens(plano)` dá `{ tabela, quantidade }[]` (apagados por tabela; anulados como `cliente.coluna`).

Regras:
- Em uso (pedido, título, nota) fica mantido com os filhos; com vários motivos conta o mais forte (pedido > título > nota). Filial com nota ou com cliente/vendedor em uso fica, com tudo o que depende dela.
- Pai apagado força apagar o filho (FK). Referências opcionais do cliente (`vendedor_id`, `tabela_preco_id`, `condicao_pagamento_id`) são anuladas, não bloqueiam.
- Bloqueios: cadastro efetivo ou tocado pela cascata (ex.: `preco` quando o zerar do produto apaga itens de preço) com `ligada` dá `integracao_ligada`; com `lote_em_voo`, `lote_em_andamento`. Com qualquer bloqueio, `apagar` e `anular` vêm vazios e a rota responde 422 `zeragem_bloqueada`.
- `sem_chave`: linhas apagadas sem external_id; no FDV viram "inativar + criar", e a tela avisa.
- `emUso`: ids mantidos por tabela, para o efeito reconferir com FOR UPDATE.
- Idempotente: com os apagados fora dos fatos, o plano seguinte vem vazio.
- A frase de confirmação não é do domain: é do SDK (`normalizarFrase`/`FRASE_ZERAR_DADOS`), conferida no plugin.

## Fora desta versão
Nada fiscal (nota, XML e evento não entram no plano). Pedidos não faturados ficam fora: só pedido, título, nota e fiscal seguram o registro.

## Motivo 'fiscal' (RN-CAD-10, v0.3.6)
- Filial com certificado A1 ou ambiente fiscal configurado fica mantida com o motivo `fiscal`.
- Ele vem DENTRO do `emUso` da porta, como `{ tabela: 'filial', ids, motivo: 'fiscal' }`, que a apps/api preenche a partir de `core.portal_usos_filiais`. A porta não tem mais `filiaisFiscais`; `filiaisComNota` segue separado.
- O plugin converte (`usosDeEmUso`) para `usos.filial.fiscal`. É motivo comum e o mais fraco: pedido > título > nota > fiscal.
- A filial mantida por qualquer motivo segura os dependentes (cliente, vendedor, saldo, item de preço).
- Aguarda `MOTIVOS_USO` com 'fiscal' e `MENSAGEM_MANTIDOS_ZERAR(n)` no SDK v0.3.6 (engenheiro).

## Decisões pendentes e decididas
Decidida (antes pendente):
a) **estoque_movimento é só-inserção** (0004:257, `controle.somente_insercao`). O DELETE é feito pela função interna do banco `cadastros.zerar_estoque_movimento` (SECURITY DEFINER), só a zeragem passa por ela.

Decididas (decisões do gerente):
b) **"Em uso"** vem por portas de contrato do pedido e do faturamento (o cadastros não lê tabela de outro schema); o engenheiro liga as portas.
c) **FDV**: na mesma operação, o espelho órfão e o cursor da integração são zerados, e há o "inativar no FDV" explícito quando não houver recarga (dono: `integracao-fdv`). Evento novo só se o engenheiro achar necessário, com ADR.
d) **LGPD e prazo fiscal**: o que está ligado a nota fica mantido; há auditoria por lote (quem, quando, cadastro, contagens por tabela e por motivo), sem dado pessoal.
e) **Permissão**: só o SUPERADMIN, no `/config` (plugin de plataforma), e não o administrador da empresa (RN-CAD-10). A ação é da família `plataforma.*` (dono: engenheiro). Exige confirmação explícita (digitar o nome do cadastro e da empresa), prévia do plano (contagens) antes de executar, licença do módulo e idempotência por chave do lote.

## Rotas e funções (T-0058, migração 0043)
Plugin de plataforma `criarPluginPlataformaCadastrosZerar(deps)` (só superadmin, ação `plataforma.cadastros.zerar`); tudo na mesma transação do `comPlataforma`.

| Rota | Faz |
|---|---|
| `POST CAMINHOS_CARGAS_PLATAFORMA.previa` | simulado: fatos + usos + estado da integração → `planoZeragem`; não escreve nada |
| `POST CAMINHOS_CARGAS_PLATAFORMA.zerar` | `idempotencia: 'obrigatoria'`; com bloqueio, 422 `zeragem_bloqueada`; senão, na ordem do banco (0043 v3): `zerarEspelho` (efetivos do pedido) → `cadastros.portal_zeragem_fatos` → usos (pedido, faturamento e `core.portal_usos_filiais`, motivo `fiscal`, juntos em `emUso`) → `tirarFiliais` (só se o plano apaga filial) → `cadastros.portal_zerar`. O erro em qualquer passo desfaz os anteriores (mesma transação) |

**Funções do banco** (todas `macuxierp_config`, sessão de superadmin):
- `cadastros.portal_zeragem_fatos(uuid, text[])` devolve `{tabelas: [{tabela, linhas: [{id, refs, com_chave}]}]}`; o plugin converte para `existentes` (`existentesDoBanco`).
- `cadastros.portal_zerar(uuid, jsonb, text)` recebe `{apagar, anular, em_uso}` e devolve `{apagados: [{tabela, quantidade}], anulados: [{tabela, coluna, quantidade}]}`. Anuláveis: `cliente.vendedor_id`, `condicao_pagamento_id`, `tabela_preco_id`.

**Portas (a apps/api implementa, sem o cadastros importar outros módulos):**
- `UsosCadastroPlataforma.usos(tx, tenant, refs)`: `refs` é por TABELA e leva só as chaves `filial`, `vendedor`, `condicao_pagamento`, `tabela_preco`, `produto`, `cliente` (o `p_refs` das duas funções). Chama `pedido.portal_usos_cadastros` e `faturamento.portal_usos_cadastros` com o mesmo `refs`; devolve `{emUso, filiaisComNota}`, com `emUso` = `em_uso` das duas concatenados (`{tabela, ids, motivo}`, motivo `pedido` | `nota` | `titulo`) e `filiaisComNota` = `filiais_com_nota` do faturamento.
- `EstadoIntegracaoPlataforma.estado` chama `integracao_fdv.portal_estado_entidades(tenant, entidades)` e devolve a lista `entidades` (`{entidade, ligada, lote_em_voo}`); `zerarEspelho` chama `portal_zerar_espelho(tenant, entidades, request_id)` e devolve a lista `entidades` (`{entidade, registros}`). Só as 10 entidades da F2, sem repetição.

- `UsuariosFiliaisPlataforma.tirarFiliais(tx, tenant, ids)` chama `plataforma.portal_tirar_filiais_dos_usuarios(tenant, ids uuid[])` e devolve quantos usuários mudaram (tira os ids de `plataforma.usuario.filial_ids`, mantendo os outros). Recebe só os ids de `filial` do `plano.apagar`; sem nenhum, não é chamada, e a prévia nunca a chama. `deps` do plugin: `{ usos, integracao, usuarios }`.
- A 0043 v3 (c59a9c5) só acrescentou `core.portal_usos_filiais` e `tirar_filiais_dos_usuarios`; formatos de fatos, `portal_zerar` e erros não mudaram (novo: `check_violation` com `p_ids` nulo nas duas da filial).

**Erros** (sobem crus do plugin; o mapa é da apps/api): `MXC04` (`empresa_inativa` | `modulo_desligado`), `MXC03` (DETAIL `em_uso` | `sumiu` | `anular_fora_do_plano` | `referencia`, HINT = tabela: o estado mudou, recarregar a prévia), `MXI03` (DETAIL `entidade_ligada` | `lote_em_voo`, HINT = entidade).

**Testes:** `api/zeragem.test.ts` (unidade) e `api/zeragem.db.test.ts` (banco; sem a 0043 aplicada ele não faz nada; cobre produto com preço e estoque, em uso mantido, idempotência, MXC03 `sumiu` e `em_uso` e zerar filial tirando-a de `usuario.filial_ids`; exige a 0043 v3).
