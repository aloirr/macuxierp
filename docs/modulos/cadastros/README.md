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
- **Nenhuma carga depende de outra (decisão de 23/11, v0.3.7)**: qualquer ordem vale; o `*_external_id` que não está no banco nem no lote é erro da linha (`CARGA_DEPENDENCIA`, "Preço produto_external_id não encontrado: carregue o cadastro de produtos ou corrija a coluna produto_external_id.", sem o valor da célula) e nunca bloqueia o arquivo.
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

## Carga: 8 arquivos (T-0058, v0.3.6; decisão do Alexandre, R-20261123-160749: "nenhuma integração deve depender da outra")
Ordem: `filial`, `vendedor`, `condicao_pagamento`, `produto`, `produto_unidade`, `preco`, `estoque`, `cliente`. Saíram `forma_pagamento`, `prazo_pagamento` e `cliente_endereco`: esses três nomes de arquivo viram **ignorados com aviso**, sem erro ("Os endereços agora vêm no cliente.csv"; "A forma de pagamento agora vem no condicoes_pagamento.csv"). Para o FDV nada muda: eventos e contratos do Hub intocados (cliente e endereço seguem separados no envio).
- **cliente.csv com endereços**: uma linha por endereço, todas com o mesmo `external_id`, mais as colunas `tipo_endereco` (`principal`, `entrega`, `cobranca`; vazio = principal) e `seq` (opcional, inteiro de 1 a 999, para mais de um endereço do mesmo tipo). Colunas de endereço: `endereco.logradouro|numero|complemento|bairro|cidade|uf|cep|municipio_ibge`. Funções puras em `domain/carga/cliente-grupo.ts`.
  - Os dados do cliente valem pela 1ª linha do grupo. Outra linha com dado do cliente diferente (qualquer coluna fora as de endereço, `tipo_endereco` e `seq`) sai com erro CARGA_CONFLITO com o número da 1ª linha, sem valor de célula.
  - Sem linha principal no grupo, a 1ª linha vira o principal, com aviso. Dois principais: erro (RN-CAD-03) na segunda. Mesmo (`tipo_endereco`, `seq`) duas vezes: erro CARGA_DUPLICADO na segunda.
  - `external_id` do endereço gravado em `cadastros.cliente_endereco`: `<cliente>:<tipo>` e, com `seq`, `<cliente>:<tipo>:<seq>` (limite de 64 do D3: acima, CARGA_TAMANHO na linha). O principal do BKO sem `external_id` é adotado. Endereço inativo que o arquivo traz de novo é reativado. Sem coluna nova: o `tipo` existente do endereço guarda principal, entrega e cobrança.
  - Erro de endereço novo (campo obrigatório faltando) recusa só a linha dele; o cliente e os outros endereços gravam. A IE do cliente vale pela UF do endereço principal do grupo (RN-CAD-02). O cliente publica um `cadastros.cliente.alterado@1` só, com todos os endereços.
  - Contagem do relatório: por linha do arquivo (um cliente de 3 linhas conta 3 inseridas).
- **condicoes_pagamento.csv** (chave `condicao_pagamento`; `condicao_pagamento.csv` também é aceito, é o nome que o portal envia). Forma e prazo na mesma linha (RN-CAD-09: cada condição tem uma forma). Obrigatórias: `external_id`, `codigo`, `parcelas_dias`, `prazo_medio_dias`, `forma_codigo`, `forma_nome`. Usadas: `ativo`, `descricao`, `forma_external_id`, `forma_tpag`. Ignoradas: `alterado_em`, `percentual_ajuste`, `ordem`. T-0085: `parcelas_dias` são os dias digitados (`30/60/90`; à vista `0`), sem a notação "Nx" (`3x` dá CARGA_FORMATO); `prazo_medio_dias` (0 a 999) é obrigatório para criar o prazo e, vazio na atualização, mantém o gravado. O `cliente.csv` ganha `prazo_medio_dias` opcional (RN-CAD-16).
  - A forma é identificada por `forma_external_id` ou, sem ele, por `forma_codigo`; é criada/atualizada pela 1ª linha que a traz e as outras linhas da forma herdam os dados dela. Linha da mesma forma com nome, código ou tPag diferente sai com erro CARGA_CONFLITO com o número da 1ª linha, sem valor de célula. Funções puras em `domain/carga/condicao-forma.ts`.
  - `forma_tpag` vazio sai do dicionário do `forma_codigo` (D12); fora dele, a forma é recusada (RN-CAD-09). Com `forma_external_id`, as outras condições da forma que NÃO estão no arquivo recebem os dados novos da forma; forma recusada desativa as ativas (RN-CAD-08, aviso, auditoria e evento por condição).
- **Substituir tudo** (RN-CAD-10; `api/carga-substituir.ts`, plano puro em `domain/carga/substituicao-cliente.ts`): `planejarSubstituicao` calcula o plano UMA vez, sobre os existentes de antes da gravação, e `aplicarSubstituicao` inativa em lote (`deleted_at`, nunca apaga) e publica `cadastros.*.alterado@1` com `inativo: true`.
  - `condicao_pagamento`: as condições ausentes do arquivo são inativadas como nos outros cadastros; a forma não é entidade e não tem o que inativar.
  - `cliente`: cliente ausente do arquivo é inativado e os endereços dele acompanham (com ou sem `external_id`). Nos clientes que ficam, o endereço de carga (com `external_id`) que não veio é inativado junto. Endereço sem `external_id` de cliente que está no arquivo (criado no BKO) NÃO é inativado, só contado (`enderecos_sem_chave`), o mesmo critério do `planoSubstituicao` para registro sem chave; cliente sem `external_id` e os endereços dele também ficam. A linha recusada também protege (o `external_id` do endereço vale pelo arquivo, `externosEnderecoDoArquivo`). Cada cliente afetado republica `cadastros.cliente.alterado@1` uma vez, com todos os endereços.
  - Pendente: o enum `CADASTROS_CARGA_PORTAL` do SDK ainda tem os 10 nomes; o portal aceita os nomes antigos pelo `paraEntidadeCarga` até o SDK ir a 8.

## Prazo médio no prazo e no cliente (T-0085, lote A, v0.3.12; ADR 0020)
- **RN-CAD-15 (prazo completo)**: código, descrição, parcelas uma a uma (1 a 36, de 0 a 999 dias) e **prazo médio digitado** (0 a 999), todos obrigatórios na entrada (POST e PUT). À vista (tPag 01, 04, 17): parcelas `[0]` e prazo médio 0. O legado sem prazo médio (coluna nula, migração 0052) é **Incompleto**: o PATCH que não manda o campo mantém o valor e quem manda o completa. Regra em `domain/condicao.ts` (`validarCondicaoPagamento`), a API devolve 422 com o campo (`prazo_medio_dias`, `prazos_dias` ou `descricao`). `prazoCompleto(c)` é exportada pelos contracts, porque o `pedido` e o `integracao-fdv` importam.
- **RN-CAD-16 (prazo permitido ao cliente)**: o cliente tem `prazo_medio_dias` opcional (0 a 999, nulo = sem restrição). `prazoPermitidoAoCliente(prazo, cliente)` (contracts): prazo completo e cliente sem prazo médio ou com prazo médio >= o do prazo. Não há lista de prazos liberados por cliente.
- **Emenda da RN-CAD-09**: o cartão (tPag 03) passa a ter os dias digitados como as outras formas (1 a 12 parcelas); `completarPrazos`, `completarPrazosNoPatch` e `prazosDoCartao` (30×N) saíram. `parcelas_cartao` é só legado: o domain a **deriva** dos prazos (`completarParcelasCartao`: nº de parcelas no cartão, nulo nas outras formas), porque o CHECK `condicao_parcelas_cartao_forma_ck` (0019) segue valendo no banco.
- **Eventos**: `cadastros.condicao_pagamento.alterada@1` e `cadastros.cliente.alterado@1` ganham `prazo_medio_dias` (nulo no legado), aditivo, sem nova versão.
- **BKO**: a lista dos prazos agrupa por forma (descrição, dias e prazo médio; legado com a marca "Incompleto"); o formulário tem Código, Descrição, Forma, Parcela 1, Parcela 2… com "+ Parcela" e remover, e "Prazo médio (dias)"; o cliente tem só o campo "Prazo médio (dias)". Descritores e funções puras em `web/prazos.ts`.
