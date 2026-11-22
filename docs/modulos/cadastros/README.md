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
- **Filial**: `industrial_ipi` (boolean, padrão `false`) e `regime_pis_cofins` (`cumulativo` | `nao_cumulativo`, nulo por padrão). RN-FIS-02: o regime de PIS/COFINS só vale no CRT 3; informado nos CRT 1, 2 ou 4 a API devolve 422 `RN-FIS-02` (violação, não normalização). Exigir o regime no CRT 3 é do fiscal.
- **Produto**: `producao_propria` (boolean, padrão `false`): fabricado pelo estabelecimento (CFOP 5101/6101) × revendido (5102/6102).
- Campos aditivos nos contratos e nos eventos `cadastros.filial.alterada@1` e `cadastros.produto.alterado@1` (seguem `@1`). Colunas `regime_pis_cofins` e `producao_propria` vêm da migração 0023 do banco-dados.
- **CSV**: linha de filial com CRT diferente de 3 e célula do regime vazia grava o regime como nulo (normalização pela RN-FIS-02, não 422). Filial aceita `industrial_ipi` e `regime_pis_cofins`; produto aceita `producao_propria` (célula vazia não altera). BKO: colunas "Industrial (IPI)", "Regime PIS/COFINS" e "Fabricado pela empresa".
- **Consulta para o fiscal** (`api/consulta-fiscal.ts`, `criarConsultaParaFiscal`): `emitente(tx, filial_id)` devolve `{ uf, crt (numérico 1..4), regime_pis_cofins?, industrial_ipi }` ou `null`; `producaoPropria(tx, produto_ids)` devolve o `Set` dos produtos fabricados. Compatível com `ConsultaEmitenteFiscal` do fiscal sem importá-lo. `FilialParaFaturamento` ganhou `industrial_ipi` e `regime_pis_cofins`.
