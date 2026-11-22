# Módulo faturamento (T-0021, lote 1)

Fatia vertical: `contracts` (Zod, eventos), `domain` (regras puras), `api` (plugin `/v1/faturamento`, só as portas neste lote) e `web`. Lote 1 = emissão e autorização da NF-e 55 no domain, nos contratos e nas portas. Rotas, repositório, worker e BKO entram depois da migração 0013 (T-0019). Premissa da v1: só filial emissora no AM (cUF 13). Nada fala com a SEFAZ real: certificado A1 de teste gerado em execução e SEFAZ-AM simulada (T-0045).

## Fluxo
```
pedido.pedido.aprovado@1 ─► pedido_a_faturar (fila; sem ler o schema pedido)
POST /notas {pedido_id, itens?, idempotencia}
  └─ 1 transação: situação do pedido (FOR SHARE) → cálculo fiscal → montarNota → reservar_numero → nota (em_autorizacao) + outbox
worker: gerarXmlNFe → AssinadorA1 → SefazTransporte.autorizar → interpretarRetorno
  ├ 100  → grava nota_xml (XML autorizado com protocolo, imutável) ─► só então status autorizada ─► nota.autorizada@1, títulos, DANFE, e-mail
  │        (falha ao guardar: autorizada_guarda_pendente, nada mais anda; RN-FAT-03)
  ├ 110/301/302/303 → denegada (terminal)   ├ 103/105 → continua em_autorizacao (consulta)
  ├ 108/109 → SEFAZ fora: consulta de status e, se confirmado, contingência (RN-FAT-05)
  └ demais → rejeitada ─► nota.rejeitada@1 (código, mensagem, ação) ─► corrige e reenvia com o mesmo número
eventos: cancelamento (nota.cancelada@1) e CC-e só sobre autorizada; inutilização de faixa por série
```

## Máquina de estados
Fonte da verdade: `domain/estados.ts` (`TRANSICOES`) e `StatusNota` em `contracts`; não há tabela copiada aqui. Em resumo: autorizada só vai a cancelada, por evento; rejeitada reenvia com o mesmo número; só `rascunho` e `rejeitada` editam; DANFE, e-mail, evento e integração só com `autorizada` (XML já guardado).

Rejeitada que não será mais reenviada: **o número só se fecha por inutilização** (registro em `inutilizacao` que cobre o número, `numeroInutilizavel`). Quando a inutilização é registrada, a nota passa de `rejeitada` a `inutilizada` (terminal; migração 0013), sem passar por `cancelada` (cancelamento é só de autorizada); `numeroInutilizavel` é a condição da transição. Denegada consome o número e não se inutiliza.

## Numeração (RN-FAT-01)
- Chave de 44 dígitos: cUF 13, AAMM (Manaus), CNPJ, mod 55, série, nNF, tpEmis, cNF e DV módulo 11 (resto 0 ou 1 vira DV 0). `cNF` de 8 dígitos nunca igual ao nNF.
- Série por (tenant, filial, ambiente, modelo, série). `faturamento.reservar_numero` roda na mesma transação que grava a nota e recebe o número inicial pelo app (`ConsultaCadastrosFaturamento.numeroInicial`). Rejeitada reenvia com o número que já tem; número perdido só sai por inutilização.
- O ambiente da nota vem de trigger no banco e é imutável. Sem linha em `core.ambiente_fiscal` = homologação; produção só pelo script do operador (ADR 0006).

## Montagem e XML (`domain/nota.ts`, `domain/xml.ts`)
- Total ou parcial (RF-FAT-01): item pelo saldo `quantidade − quantidade_faturada`; status do pedido só `aprovado` ou `faturado_parcial`. `vProd = arred(qtd4 × preço / 10^4)`, meio para cima.
- Frete e desconto das notas parciais pelo acumulado (RN-CORE-03), de modo que a soma das notas bate com o pedido; rateio entre itens sem perder centavo, a diferença vai ao primeiro item (padrão do `ratear` do SDK). Totais pela soma do cálculo fiscal.
- Homologação (RN-FAT-04): `xNome` do destinatário = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"; `vai_ao_fdv = false`.
- `gerarXmlNFe` devolve `<NFe><infNFe>` 4.00 sem assinatura, determinístico e com escape. Lê o `ItemResultado` real de `fiscal.calculo@1` (alíquotas em décimos de milésimo de ponto percentual); ICMS 00, 10, 20, 40/41/50 e CSOSN 101, 102, 103, 201, 202, 203, 300, 400; ICMS-ST e FCP/FCP-ST; IPI, PIS, COFINS; IBS/CBS/IS na estrutura mínima da NT 2025.002-RTC (confirmar o leiaute com o fiscal no lote 3).
- Pedido e destinatário vêm dos contracts reais do `pedido` (`PedidoAprovadoV1`, `ClienteRetrato`). Endereço do destinatário: o do cadastro; sem ele, o endereço principal do retrato (reserva), com o xMun resolvido pelos cadastros (`municipioNome`).
- `interpretarRetorno(cStat, xMotivo)` (fonte da verdade: `domain/retorno.ts`): o cStat 104 (lote processado) não é rejeição, o resultado vem do cStat do `protNFe`; duplicidade (204, 539) exige `consultarProtocolo` antes de mudar o status e nunca publica `nota.rejeitada@1`.
- `gerarXmlNFe` lança `ErroViolacao` onde a SEFAZ rejeitaria (CSOSN/CST sem suporte, campo exigido pelo layout que o contrato do cálculo não trouxe, CFOP ausente, IPI, PIS/COFINS sem CST, base ou alíquota, vPag ≠ vNF, chave inválida).
- Chave e CNPJ alfanuméricos (NT 2025.001, válidos desde jul/2026): letras só nas 12 primeiras posições do CNPJ; DV módulo 11 com ASCII − 48. IE e CPF seguem só dígitos.
- `indFinal`: 0 por padrão em venda a contribuinte (`ind_ie_dest` 1) e 1 nos demais casos.

## Emissão (`api/emissao.ts`, serviço de aplicação)
`criarServicoEmissao(deps)` orquestra as portas (emitir, reenviar, transmitir, processar retorno), sem SQL nem HTTP; o contrato do fluxo está nos comentários do código e nos testes de `api/emissao.test.ts`.
Premissas provisórias: natOp "VENDA DE MERCADORIA"; tPag 99 com xPag "Conforme condição combinada" quando a forma vier nula (combinado com a T-0015); IBS/CBS/IS geram violação até o leiaute da NT 2025.002 (T-0020).

## Portas (`api/portas.ts`)
| Porta | Quem implementa | Uso |
|---|---|---|
| `SituacaoPedidoParaFaturar` | `pedido/api` (T-0015) | situação do pedido com `FOR SHARE` na transação que reserva o número |
| `NotaEmAberto` | aqui, consumida pelo pedido | `temNotaEmAutorizacao` bloqueia o cancelamento do pedido |
| `CalculoFiscal` | adaptador sobre `fiscal.calculo@1` (motor do fiscal + regras buscadas pela API) | devolve `CalculoSaida` e o CFOP por item; `item_id` = `String(sequencia)` |
| `PedidosAprovados` | fila "a faturar" (0013), preenchida por `pedido.pedido.aprovado@1` | pedido inteiro sem ler o schema `pedido` |
| `RepositorioNotas` | SQL do faturamento (0013) | reservarNumero, gravarNota, mudarStatus, guardarXml, publicarEvento, tudo na mesma tx |
| `SefazTransporte` | `@macuxierp/nfe-sefaz` (T-0045), pronta do worker | autorizar (recibo), consultarRecibo, consultarProtocolo, statusServico, cancelar, cartaCorrecao, inutilizar |
| `ConsultaCadastrosFaturamento` | sobre contratos de `cadastros` | filial emissora, cliente, nome do município (xMun), número inicial |
| `AmbienteFiscalDaFilial` | sobre `core` | ambiente da filial (só leitura) |
| `AssinadorA1` | worker | assina com o A1 decifrado só na memória |

## Eventos publicados (agregado = `nota.id`)
Campos e regras: somente em `contracts/index.ts` (Zod), fonte da verdade. Publica `faturamento.nota.autorizada@1`, `nota.cancelada@1`, `nota.rejeitada@1`, `titulo.gerado@1` e `titulo.baixado@1`; consome `pedido.pedido.aprovado@1`. `ambiente = homologacao` é descartado pelo `integracao-fdv` (RN-FAT-04). `nota.autorizada@1` só sai depois do XML guardado (RN-FAT-03).

## P-2 (nota em autorização × cancelamento do pedido; resolução proposta)
1. Nota em `em_autorizacao` (ou `emitida_contingencia`) bloqueia o cancelamento do pedido: o `pedido` chama `NotaEmAberto.temNotaEmAutorizacao`, com `FOR SHARE` na linha da nota, e recusa com 422 `RN-PED-02`. A reserva do número e esse bloqueio usam a mesma trava do pedido, então não há corrida.
2. Nota `cancelada` devolve as quantidades: o `pedido` consome `nota.cancelada@1` (campos `pedido_id`, `itens[].sequencia`, `quantidade`, `valor_centavos`) e recua o status. O recuo não volta ao FDV (T-0013 2); o FDV vê a nota cancelada pela entidade `nota` (T-0009 2.10).
3. Rejeitada e denegada não consomem saldo: só `autorizada` conta como faturada.

## Pendências
- P-1 (banco-dados, T-0019): schema combinado com o banco-dados em 21/11/2026, às 23h18 de Manaus; o número da migração é o que o gerente reservar. Tabelas: `serie_numeracao`, `pedido_a_faturar`, `nota`, `nota_item`, `nota_xml` (só INSERT), `nota_evento`, `inutilizacao`, `contingencia`, `transmissao`, `titulo`, `titulo_baixa`; recado a enviar com campos e consultas.
- P-2 acima: confirmar com `modulo-pedido` (T-0015).
- P-3 dublês que restam: `SituacaoPedido`/`SituacaoPedidoParaFaturar` (o `pedido/contracts` ainda só traz o evento; sai com a T-0015) e `SefazTransporte`, `PedidoAutorizacao`, `PedidoEvento`, `RespostaSefaz` (T-0045). O `divArred` ainda é local (o SDK não exporta o `dividirArredondando`).
- P-3a lacunas dos contracts, a pedir por recado: (pedido) o `Frete` não traz valor em centavos (a nota usa 0 até chegar), a forma e a condição de pagamento não trazem parcelas/`tPag`, e o `ClienteRetrato` não traz o nome do município (resolvido por `municipioNome`); (fiscal) o `ItemResultado` não devolve o CFOP e o `ProdutoRetrato` do pedido não traz a origem da mercadoria (o adaptador de `CalculoFiscal` os resolve), faltam os campos de ICMS retido (CST 60, CSOSN 500), CST 30/51/70/90 e o leiaute final de IBS/CBS/IS; sem eles o XML não é gerado (`ErroViolacao`).
- P-3b depende da 0013 (T-0019) e do `@macuxierp/nfe-sefaz` (T-0045): rotas `/v1/faturamento`, implementação SQL de `RepositorioNotas`/`PedidosAprovados`/`NotaEmAberto`, e o worker que chama `transmitir` e `processarRetorno`. O `guardarXml` do repositório deve rodar em savepoint, para a falha da guarda não abortar a tx e a nota ficar em `autorizada_guarda_pendente`.
- P-3c premissas provisórias: natOp fixo; tPag 99 com xPag "Conforme condição combinada" quando a forma vier nula (combinado com a T-0015); frete 0. A T-0015 vai acrescentar: `Frete.valor_centavos`, `forma_tpag`/`codigo`/`nome` na forma de pagamento, `municipio_nome` no `ClienteRetrato` e o contrato `SituacaoPedidoParaFaturar`; quando chegarem, saem os dublês e os valores fixos.
- P-3d para a 0013 (banco-dados): `UNIQUE (tenant_id, idempotencia_chave)` em `nota` (o `pedido_id` não é único: faturamento parcial gera várias notas do mesmo pedido); `RepositorioNotas.lerXml` e `atualizarConteudo` (reenvio da rejeitada regrava total, itens e XML assinado; número, série e chave não mudam, RN-FAT-07).
- P-4 premissas a validar: frete pelo acumulado do valor bruto faturado e desconto pelo acumulado da quantidade (a soma das notas bate com o pedido); IBS/CBS/IS fora do `vNF` em 2026.
- P-5 fora deste lote: DANFE em PDF, CC-e, cancelamento, inutilização, SVC, títulos (RF-FAT-03 a 07), painel de rejeições (RF-FAT-08), rotas e BKO; `core.certificado.alterado@1` e `core.ambiente_fiscal.alterado@1` entram no manifest na T-0018.

## Diferenças da 0013 que o repositório SQL (lote 1c) segue
- Guardar a `nfe_autorizada` em `nota_xml` leva a nota a `autorizada` por gatilho; o repositório não chama `mudarStatus` depois.
- Totais com o sufixo `_centavos`.
- `nota_item.quantidade` em bigint, escala 4.
- `reservar_numero(p_filial, p_ambiente, p_serie, p_numero_inicial)` recusa ambiente diferente do da filial.
- Q9 = `faturamento.buracos_numeracao(p_filial, p_ambiente, p_serie)`.
- O papel de leitura não vê `destinatario_retrato`, `transporte` nem `nota_xml.xml`.
