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
