# Módulo cadastros (T-0007)

Fatia vertical: `contracts` (Zod, eventos), `domain` (regras puras), `api` (plugin `/v1/cadastros`) e `web` (páginas do BKO como dados). Rotas e permissões: `docs/desenho/T-0002.md`, seção 4.

## Regras e onde moram
| Regra | Função (domain) | Teste |
|---|---|---|
| RN-CAD-01 CNPJ/CPF | `validarDocumentoCliente` (usa `cnpjValido`/`cpfValido` do SDK) | `documento.test.ts` |
| RN-CAD-02 IE | `validarIe` (AM e SP com dígito; demais UFs só formato), `validarIndIeDest`, `sugerirIndIeDest` | `ie.test.ts` |
| RN-CAD-03 município | `validarMunicipio` (IBGE de 7 dígitos, DV e UF) | `municipio.test.ts` |
| RN-CAD-04 NCM/CEST | `validarFiscalProduto` (a API apura vigência nas tabelas oficiais) | `produto.test.ts` |
| RN-CAD-05 consulta externa | `paraCacheCnpj`, `removerCpf`, cache de 24 h | `consulta.test.ts`, `api/consultas.test.ts` |
| RN-CAD-06 preço | `precoVigente`, `validarLotePreco` (até 5.000 itens) | `preco.test.ts` |
| RN-CAD-07 estoque | `aplicarMovimento` | `estoque.test.ts` |
| RN-CAD-08 inativação | `bloqueiosDeInativacao` + `inativar` (nunca apaga) | `filial.test.ts`, `api/rotas.test.ts` |
| D7 carteira | `escopoDaCarteira`, `planejarTransferencia` | `carteira.test.ts` |
| D8 filial | `validarFilial` (série e número inicial; a numeração é do faturamento) | `filial.test.ts` |

## Pontos de atenção
- Erro de regra = 422 com `codigo` = a RN. Decisão "D*" e referência inexistente = 400 `VALIDACAO`.
- Fontes de CNPJ: BrasilAPI, reserva CNPJ.ws; CEP: ViaCEP, reserva BrasilAPI. Timeout de 5 s. Duas fontes fora = 422 `FONTE_INDISPONIVEL`.
- O cache (`cadastros.consulta_externa`) guarda só a sugestão, sem sócios, e-mail, telefone ou CPF (razão social de MEI tem o CPF tirado).
- Consulta de IE: `POST` 202 enfileira `cadastros.consultar_ie`; o executor (`criarExecutorConsultaIe`) grava o resultado na mesma tabela e o `GET /consultas/ie/:id` lê dali. Sem A1 válido na filial: 422 `RN-CORE-06`.
- Preço: um evento `cadastros.preco.alterado@1` por item alterado (o lote devolve só o que mudou); mudar a vigência da tabela republica os itens.
- Páginas do BKO (`web/`): descrição em dados (colunas, filtros na URL, exportar CSV, permissões); o desenho com Next.js vem do shell (T-0005).

## Teste com PostgreSQL
`bash db/scripts/pg-local.sh` e depois `MACUXI_DB_MIGRACOES=<raiz>/db/migrations pnpm --filter @macuxierp/cadastros test`. Sem a variável, o `sql.db.test.ts` pula (o teste não lê fora do pacote por caminho fixo: regra R2 do grafo-turbo).

## C-10 — external_id nos eventos

C-10 (ADR 0010): `external_id` opcional em unidades, endereços e itens de preço nos eventos, e `external_id_anterior` no preço; o contrato está em `.coord/contratos/eventos.md` (Aditivo C-10). O `PUT /tabelas-preco/:id/itens` não aceita `external_id`: só a carga define a chave.

## Estoque pelas notas do faturamento (T-0021)
Decisão R-20261122-022626: o faturamento real sai pelo ERP. O consumidor `criarConsumidorEstoqueNota` (`api/consumidor-estoque-nota.ts`) consome `faturamento.nota.autorizada@1` (saída) e `faturamento.nota.cancelada@1` (entrada, devolve), e publica `cadastros.estoque.alterado@1` por movimento.
- **Quando move (RN-CAD-07, `deveMoverEstoque`):** nota de `ambiente = producao`, ou com `conta_como_real = true` (homologação que vale como faturamento real). O cadastros não lê a bandeira da filial no faturamento: usa o campo `conta_como_real` do evento. Homologação sem a bandeira não move.
- **Idempotência:** a plataforma deduplica por consumidor; além disso cada movimento tem `external_id` = UUID v5 de (id do evento, tipo, índice do item) e o consumidor confere antes de gravar. Saldo lido com `FOR UPDATE`, tudo na transação do evento. Motivo: `NF-e <número>/<série>` (cancelada: `Cancelamento da NF-e ...`), até 120 caracteres; `usuario_id` nulo.
- **Premissa do negativo (RN-CAD-07):** "a baixa pela nota sempre acontece, mesmo com saldo negativo" é PREMISSA, aceita pelo gerente e levada ao PO para o Alexandre confirmar (a nota autorizada é fato consumado). A trava de negativo continua só no pedido, na aprovação e nas rotas de movimento (`aplicarMovimento`).
- **Premissa dos campos (ainda a criar no faturamento, aditivos e opcionais):** por item `produto_id`, `filial_id` e `quantidade` (× 10^4, inteiro); no payload `conta_como_real?: boolean` (enviado pelo faturamento quando a bandeira "faturamento real com NF-e simulada" da filial está ligada; ausente = falso). Leitor tolerante com Zod local, sem importar o pacote do faturamento; payload sem esses campos é ignorado. Item sem os campos também.

## Campos fiscais e consulta para o fiscal (T-0021)
- **Filial**: `industrial_ipi` (boolean, padrão `false`) e `regime_pis_cofins` (`cumulativo` | `nao_cumulativo`, nulo por padrão). regime obrigatório no CRT 3, nulo nos demais (RN-FIS-02): sem o regime no CRT 3, ou com ele nos CRT 1, 2 ou 4, a API devolve 422 `RN-FIS-02` (violação, não normalização).
- **Produto**: `producao_propria` (boolean, padrão `false`): fabricado pelo estabelecimento (CFOP 5101/6101) × revendido (5102/6102).
- Campos aditivos nos contratos e nos eventos `cadastros.filial.alterada@1` e `cadastros.produto.alterado@1` (seguem `@1`). Colunas `regime_pis_cofins` e `producao_propria` vêm da migração 0023 do banco-dados.
- **CSV**: linha de filial com CRT diferente de 3 e célula do regime vazia grava o regime como nulo (normalização pela RN-FIS-02, não 422). Filial aceita `industrial_ipi` e `regime_pis_cofins`; produto aceita `producao_propria` (célula vazia não altera). A carga CSV recusa a linha CRT 3 sem regime (na célula e no cadastro). BKO: colunas "Industrial (IPI)", "Regime PIS/COFINS" e "Fabricado pela empresa".
- **Consulta para o fiscal** (`api/consulta-fiscal.ts`, `criarConsultaParaFiscal`): `emitente(tx, filial_id)` devolve `{ uf, crt (numérico 1..4), regime_pis_cofins?, industrial_ipi }` ou `null`; `producaoPropria(tx, produto_ids)` devolve o `Set` dos produtos fabricados. Compatível com `ConsultaEmitenteFiscal` do fiscal sem importá-lo. `FilialParaFaturamento` ganhou `industrial_ipi` e `regime_pis_cofins`.

## Carga por entidade (RF-CAD-11)
- **Modelo CSV**: `GET /v1/cadastros/cargas/modelos/:entidade` (ação `cadastros.carga.executar`) devolve só o cabeçalho, UTF-8 com BOM e `;`: obrigatórias primeiro, depois as demais usadas, sem as ignoradas. Entidade desconhecida: 404. Função pura `modeloCsv` em `domain/carga/modelo.ts`, a partir de `LAYOUT`.
- **Nenhuma carga depende de outra (decisão de 23/11, v0.3.6)**: qualquer ordem vale; o `*_external_id` que não está no banco nem no lote é erro da linha (`CARGA_DEPENDENCIA`, "Preço produto_external_id não encontrado: carregue o cadastro de produtos ou corrija a coluna produto_external_id.", sem o valor da célula) e nunca bloqueia o arquivo. Na v0.3.6 isso vale pela API: a carga grava em qualquer ordem e a referência ausente vira erro de linha. A tela do /config ainda libera o botão pelo `liberado` da situação, que vem do SDK; a liberação na tela chega na v0.3.7, quando o SDK zerar o depende_de.
- **Entidade que falta**: o `CARGA_DEPENDENCIA` leva `entidade_faltante` (`EntidadeCarga`, de `ARQUIVO_DO_ALVO` em `domain/carga/dependencias.ts`); nos demais códigos o campo fica ausente (RF-CAD-11).
- **Entidade única**: campo opcional `entidade` no `POST /v1/cadastros/cargas`; com ele o lote é exatamente `<entidade>.csv`, senão 400 "Envie só o arquivo <entidade>.csv neste botão.". Sem o campo, nada muda.
- **Perfil**: arquivo `filial` e coluna `limite_credito_cents` recusados trazem o motivo fixo "Só o administrador carrega filial e limite de crédito." (RN-CORE-09).
- **Exceção à D9 (T-0058, decisão do PO, 23/11)**: exceção à D9 para códigos fiscais (NCM, CEST, CFOP e CST), decisão do PO de 23/11; no cadastros, só NCM e CEST aparecem nas mensagens (RN-CAD-04). RN-CAD-04 repassa a mensagem do domain; os demais campos seguem sem o valor da célula.

## Carga no /config (v0.3.5a)
T-0058, RN-CAD-10. A carga de cadastros saiu do menu do BKO (`'Carga de cadastros'` não está mais em `manifest.web.menus`) e passa a ser da aba "Cargas" da ficha da empresa no `/config`, só do superadmin. O contrato é o do SDK (`packages/platform-sdk/src/portal-cargas.ts`); o módulo só traz o serviço, em `api/carga-portal.ts`:
- `gravarCargaPortal(deps, ctx, { cadastro, modo, frase?, arquivo })` e `validarCargaPortal(...)`; o plugin de plataforma entrega o `ContextoRota` do tenant escolhido (perfil `administrador`) e o arquivo. Reaproveita o `executarCarga` do BKO.
- `adicionar`: a carga de hoje. `substituir_tudo`: a API revalida a frase com `normalizarFrase` (422 `RN-CAD-10`, `detalhes.codigo = frase_nao_confere`), grava o arquivo e, na mesma transação, inativa em lote (`deleted_at`, nunca apaga) os ativos cujo `external_id` não veio no arquivo (`planoSubstituicao`, `substituicao.inativarEmLote` do `sql.ts`) e publica `cadastros.*.alterado@1` com `inativo` (filhas republicam o pai). Em uso (`ConsultaUsoCadastros.emUso`, `api/zeragem-portas.ts`) também é inativado; só conta no aviso. Forma de pagamento e estoque não têm o que inativar.
- **Reativação (RN-CAD-08, decisão do PO de 23/11 15h49; muda a D6):** no ponto comum, `reativarPorPadrao` (`api/carga-reativar.ts`), chamado no começo do `executarCarga`, vale para TODA rota de carga (portal em `adicionar` e `substituir_tudo`, `POST /v1/cadastros/cargas` e CLI): linha sem a coluna `ativo`, ou com ela vazia, vira `ativo=sim` (o inativado que volta no arquivo é reativado, numa linha só); `ativo=nao` explícito é respeitado; layout sem `ativo` (estoque) fica como está.
- 409: `nada_a_gravar` (nenhuma linha pronta; a transação desfaz tudo). O 409 `carga_em_andamento` é do `portal_carga_iniciar` (banco-dados).
- `POST /v1/cadastros/cargas` continua, para o administrador da empresa e a CLI. `ResultadoEntidade.inativadas` é aditivo.
- `web/carga.ts` continua exportado, porque o shell (apps/web) ainda o importa.
