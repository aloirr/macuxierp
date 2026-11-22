# Módulo faturamento (T-0021, lotes 1 e 1c)

Fatia vertical: `contracts` (Zod, eventos), `domain` (regras puras), `api` (plugin `/v1/faturamento`, só as portas neste lote) e `web`. Lote 1 = emissão e autorização da NF-e 55 no domain, nos contratos e nas portas. Lote 1c = repositório SQL sobre a 0013, consumidor de `pedido.pedido.aprovado@1`, rotas e o trabalho do worker (BKO e demais eventos ficam para os próximos). Premissa da v1: só filial emissora no AM (cUF 13). Nada fala com a SEFAZ real: certificado A1 de teste gerado em execução e SEFAZ-AM simulada (T-0045).

## Fluxo
```
pedido.pedido.aprovado@1 ─► pedido_a_faturar (fila; sem ler o schema pedido)
POST /notas {pedido_id, itens?, idempotencia}
  └─ 1 transação: situação do pedido (FOR SHARE) → cálculo fiscal → montarNota → reservar_numero → nota (em_autorizacao) + outbox
emissão (tx da reserva, nota em rascunho): EmissorNFe.montar → grava chave/cNF/dhEmi → EmissorNFe.assinar (A1 pela porta lerA1) → nota_xml 'nfe_assinada' (versao = max+1) → em_autorizacao | worker: lê a última nfe_assinada → EmissorNFe.transmitir → interpretarRetorno
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

## Montagem da nota e entrada do emissor (`domain/nota.ts`, `domain/conteudo.ts`, `domain/itens-emissao.ts`)
- Total ou parcial (RF-FAT-01): item pelo saldo `quantidade − quantidade_faturada`; status do pedido só `aprovado` ou `faturado_parcial`. `vProd = arred(qtd4 × preço / 10^4)`, meio para cima.
- Frete e desconto das notas parciais pelo acumulado (RN-CORE-03), de modo que a soma das notas bate com o pedido; rateio entre itens sem perder centavo, a diferença vai ao primeiro item (padrão do `ratear` do SDK). Totais pela soma do cálculo fiscal.
- Homologação (RN-FAT-04): `xNome` do destinatário = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"; `vai_ao_fdv = false`.
- O XML e a chave são do `@macuxierp/nfe-emissor`: `notaParaEmissaoDe` (domain) monta a `NotaParaEmissao` em centavos a partir do conteúdo gravado; `itemParaEmissao` mapeia o `ItemResultado` de `fiscal.calculo@1` (ICMS 00/40/41/50 e CSOSN 101, 102, 103, 201, 202, 203, 300, 400; PIS/COFINS; IBS/CBS/IS da NT 2025.002-RTC). Totais não entram: o emissor os calcula e confere.
- Pedido e destinatário vêm dos contracts reais do `pedido` (`PedidoAprovadoV1`, `ClienteRetrato`). Endereço do destinatário: o do cadastro; sem ele, o endereço principal do retrato (reserva), com o xMun do próprio retrato do pedido (`municipio_nome`, aditivo no contrato do pedido), não dos cadastros; xMun nulo é recusado só em `validarNotaParaEmissao` (único lugar da regra).
- `interpretarRetorno(cStat, xMotivo)` (fonte da verdade: `domain/retorno.ts`): o cStat 104 (lote processado) não é rejeição, o resultado vem do cStat do `protNFe`; duplicidade (204, 539) exige `consultarProtocolo` antes de mudar o status e nunca publica `nota.rejeitada@1`.
- `notaParaEmissaoDe` devolve violações (antes da reserva do número) onde o emissor não montaria ou a SEFAZ rejeitaria (CST/CSOSN sem suporte, CFOP ausente, IPI, PIS/COFINS sem CST, vPag ≠ vNF); o `ErroMontagemNFe` do emissor também vira violação.
- Chave e CNPJ alfanuméricos (NT 2025.001, válidos desde jul/2026): letras só nas 12 primeiras posições do CNPJ; DV módulo 11 com ASCII − 48. IE e CPF seguem só dígitos.
- `indFinal`: 0 por padrão em venda a contribuinte (`ind_ie_dest` 1) e 1 nos demais casos.

## Emissão (`api/emissao.ts`) e worker (`api/transmissor.ts`)
- **API** (`criarServicoEmissao`): trava a idempotência (advisory lock), lê a situação do pedido (`FOR SHARE`), calcula o fiscal, valida no domain (`notaParaEmissaoDe`: violações antes de montar), confere no `EmissorNFe.montar` com número provisório (o emissor confere vProd e tributos; `ErroMontagemNFe` vira violação), exige o A1 da filial (`lerA1`; sem A1 = violação `RN-CORE-06` antes da reserva), reserva o número, grava a nota em `rascunho` com o **conteúdo** e o cNF sorteado pelo emissor (chave, cNF e dhEmi), **assina com o A1 e guarda a `nfe_assinada`** (só INSERT, `versao` = max+1) e só então a leva a `em_autorizacao`, tudo na mesma transação (a migração 0020 só aceita a `nfe_assinada` em rascunho, rejeitada ou emitida_contingencia). O reenvio da rejeitada remonta e reassina com a nota ainda `rejeitada`, grava a versão nova e só então vai a `em_autorizacao`; 23505 no reenvio concorrente = repetição idempotente. A API não fala com a SEFAZ; a rota enfileira `faturamento.transmitir_nota`. Contingência (lote 4): o assinado só depois do UPDATE para `emitida_contingencia`.
- **Worker** (`criarTransmissor`, `api/transmissor.ts`): NÃO monta nem assina. tx1 trava a nota (`pg_try_advisory_xact_lock`), lê o A1 (só a `credencial` do mTLS do transporte) e **lê a última `nfe_assinada`**; a SEFAZ é chamada **fora de transação** por `EmissorNFe.transmitir` (lote síncrono; se vier 103, grava o `nRec` numa tx curta e consulta o recibo); tx2 aplica o retorno com `processarRetorno`, que monta o `nfeProc` (`montarNfeProc`) e o **guarda antes de mudar o status** (o gatilho leva a `autorizada`); duplicidade (204/539) consulta o protocolo fora da transação e aplica numa tx3. Retry, duplicidade e guarda pendente usam o MESMO assinado e o `DigestValue` dele (o `digVal` do protocolo tem de bater). O seletor de transporte é injetado e o `pfx` é zerado ao fim. A varredura (`transmitirPendentes`) só pega nota com `updated_at` mais antigo que N minutos (padrão 2). `verProc` é a constante `VER_PROC` do domain.
- **Guarda (RN-FAT-03)**: `c_stat`, `x_motivo`, recibo, protocolo e `autorizada_em` vão no MESMO UPDATE da passagem a `autorizada_guarda_pendente`; guardar o `nfeProc` (a `nfe_assinada` guardada + `<protNFe>` da SEFAZ) em `nota_xml` leva a nota a `autorizada` por gatilho (o repositório não chama `mudarStatus` depois), com savepoint. Antes de guardar, o `DigestValue` do assinado guardado tem de ser o `digVal` do protocolo; sem um dos dois (`sem_digest`) ou diferentes (`digest_diferente`), a nota fica em guarda pendente, sem evento. Guarda pendente é reprocessada por `consultarProtocolo`, sem reenviar.
- Idempotência: `UNIQUE (tenant_id, idempotencia_chave)` + advisory lock; pedido a faturar por `ON CONFLICT DO NOTHING`; itens por upsert; mesma chave com outro pedido ou outros itens = 422 `RN-CORE-05`.
- Regras de pagamento, frete, origem e município são **campos da `NotaParaEmissao`** e validações do domain (`pagamento.ts`, `validacao-emissao.ts`), não código de XML: indPag pelo `ehAVista` do contrato do cadastros (só a classe da forma; 0 à vista, 1 a prazo); `cobr/dup` só quando `classeForma` é `boleto`, `card` em `cartao` e no débito (04); detPag pela `forma_tpag` do pedido (nula = 99 com xPag "Conforme condição combinada"); `cobr/dup` só no boleto, parcelas da condição com rateio sem perder centavo; grupo `card` (tpIntegra 2); vFrete = `Frete.valor_centavos` (nulo = 0), modFrete CIF 0 / FOB 1 / sem frete 9; `orig` = `ProdutoRetrato.origem`; `municipio_nome` nulo (emitente ou destinatário) é violação antes da reserva, só em `validarNotaParaEmissao`.
- **MEI (CRT 4, NT 2024.001)**: `Crt` aceita 4. CRT 1 e 4 usam CSOSN (CST é violação); o MEI não destaca crédito: CSOSN 101 e 201 com CRT 4 são violação antes da reserva (`domain/validacao-emissao.ts`). PIS/COFINS sem grupo no cálculo viram CST 99 zerado (Outr). Teste ponta a ponta de nota de MEI (CRT 4, CSOSN 102) com o emissor real e o simulador em `api/emissao-simulador.test.ts`.
- Campos do lote 3 do fiscal: o `ItemResultado` inteiro (com `cfop`, `ibs_cbs`, `is`) viaja em `NotaItemMontado.calculo.resultado`, e portanto na `NotaParaEmissao`; o CFOP vem de `ItemResultado.cfop` (`cfopDoItem`, com o mapa da porta como reserva); os totais vIBS/vCBS/vIS leem `ibs_cbs` e `is`.
- Premissas provisórias: natOp "VENDA DE MERCADORIA"; **a trava de IBS/CBS/IS saiu**: o emissor aceita os grupos (NT 2025.002-RTC v1.53) e o `domain/itens-emissao.ts` mapeia `ibs_cbs` e `is` do cálculo. Ficam as travas do que o emissor ainda não monta (violação antes da reserva): ICMS CST 10/20/30/51/60/70/90, CSOSN 500/900, FCP próprio, IPI com valor, PIS/COFINS CST 03; e o CSOSN 101/201 com CRT 4 (domain).

## Rotas (`/v1/faturamento`, `api/rotas.ts`)
| Rota | Ação | Notas |
|---|---|---|
| `POST /notas` | `faturamento.nota.emitir` | emite do pedido (total ou parcial); 201, ou 200 na repetição; enfileira a transmissão; audita |
| `GET /notas`, `GET /notas/:id` | `faturamento.ver` | filtros na URL (filial, cliente, pedido, status, ambiente, série, número, `de`/`ate`), cursor por `id`; `vendedor` recebe 403 (carteira entra com o BKO) |
| `GET /notas/:id/xml` | `faturamento.nota.emitir` | download do `nfeProc` guardado (404 enquanto não guardado) |
| `GET /rejeicoes` | `faturamento.ver` | painel RF-FAT-08: código, mensagem e ação sugerida |
| `POST /notas/:id/reenviar` | `faturamento.nota.emitir` | só rejeitada, mesmo número (RN-FAT-07); enfileira a transmissão |

## Portas (`api/portas.ts`)
| Porta | Quem implementa | Uso |
|---|---|---|
| `SituacaoPedidoDoPedido` | `criarConsultaParaFaturar` de `@macuxierp/pedido/api` | situação do pedido (contrato real `SituacaoPedidoParaFaturar`) com `FOR SHARE` |
| `NotaEmAberto` | aqui, consumida pelo pedido | `temNotaEmAutorizacao` bloqueia o cancelamento do pedido |
| `CalculoFiscal` | adaptador sobre `fiscal.calculo@1` (motor do fiscal + regras buscadas pela API) | devolve `CalculoSaida` e o CFOP por item; `item_id` = `String(sequencia)` |
| `PedidosAprovados` | `api/sql.ts` + consumidor `criarConsumidorPedidoAprovado` | fila `faturamento.pedido_a_faturar`, sem ler o schema `pedido` |
| `RepositorioNotas` | `api/sql.ts` (0013) | numeração, nota com conteúdo, status, guarda do XML, transmissões, eventos e leituras das rotas, na mesma tx |
| `SefazTransporte` | `@macuxierp/nfe-sefaz` (real), via `SeletorTransporte` injetado no worker | autorizar, consultarRecibo, consultarProtocolo (o faturamento não importa simulador nem transporte real) |
| `EmissorNFe` | `criarEmissorNFe()` do `@macuxierp/nfe-emissor` (REAL) | `montar(NotaParaEmissao)` → `{xml, chave, cNF, dhEmi}`; `assinar(xml, a1)` → `{xml, digVal}`; `transmitir(xmlAssinado, idLote, transporte)`; eventos e inutilização no lote 2. Único montador do XML (RD-0254) |
| `ConsultaCadastrosFaturamento` | adaptador a criar no `cadastros/api` | filial emissora (com CRT), cliente, condição de pagamento (tPag e prazos), número inicial |
| `AmbienteFiscalDaFilial` | `api/sql.ts` (`faturamento.ambiente_da_filial`) | ambiente da filial (só leitura) |
| `lerA1` (`A1DaFilial`) | worker/api: `lerA1DecifradoDaFilial` do core + `abrirA1` do emissor | `{ certificado, credencial }`: o certificado assina (emissão); a credencial (pfx + senha) vai ao seletor de transporte; `pfx` zerado ao fim |

## Eventos publicados
Agregado = `nota.id` nos eventos de nota (`nota.autorizada@1`, `nota.cancelada@1`, `nota.rejeitada@1`) e `titulo.id` nos de título (`titulo.gerado@1`, `titulo.baixado@1`; recado R-20261121-234815).
Campos e regras: somente em `contracts/index.ts` (Zod), fonte da verdade. Publica `faturamento.nota.autorizada@1`, `nota.cancelada@1`, `nota.rejeitada@1`, `titulo.gerado@1` e `titulo.baixado@1`; consome `pedido.pedido.aprovado@1`. `ambiente = homologacao` é descartado pelo `integracao-fdv` (RN-FAT-04). `nota.autorizada@1` só sai depois do XML guardado (RN-FAT-03).

## P-2 (nota em autorização × cancelamento do pedido; resolução proposta)
1. Nota em `em_autorizacao` (ou `emitida_contingencia`) bloqueia o cancelamento do pedido: o `pedido` chama `NotaEmAberto.temNotaEmAutorizacao`, com `FOR SHARE` na linha da nota, e recusa com 422 `RN-PED-02`. A reserva do número e esse bloqueio usam a mesma trava do pedido, então não há corrida.
2. Nota `cancelada` devolve as quantidades: o `pedido` consome `nota.cancelada@1` (campos `pedido_id`, `itens[].sequencia`, `quantidade`, `valor_centavos`) e recua o status. O recuo não volta ao FDV (T-0013 2); o FDV vê a nota cancelada pela entidade `nota` (T-0009 2.10).
3. Rejeitada e denegada não consomem saldo: só `autorizada` conta como faturada.

## Pendências e dublês que restam
- **Troca pelo montador único (T-0021 1c, T-0018 §8)**: saíram `domain/xml.ts`, `domain/chave.ts`, `xNomeDestinatario`/`XNOME_HOMOLOGACAO` e os dublês `AssinadorA1`/`EmissorNFe` das portas. A `NotaParaEmissao` agora é a do emissor (centavos, sem totais). **Fora do XML por limite do emissor**: `card` (tpIntegra) nos cartões e `cobr/dup` do boleto (a cobrança segue no conteúdo gravado, para os títulos); pedir ao `engenheiro-software`/T-0018 se a SEFAZ exigir.
- **A1 na emissão**: a porta `lerA1` (e o `abrirA1`) é ligada no apps/api e no apps/worker pelo `engenheiro-software`; o papel da API passa a precisar ler o A1 decifrado (a chave do secret fica no servidor).
- **banco-dados**: o papel da API lê o A1 decifrado.
- **Trava por nota (pendência)**: hoje o `pg_try_advisory_xact_lock` só cobre a tx1; o efeito é limitado e a duplicidade vira consulta. Evoluir para trava por nota com lease ou trava de sessão.
- **Limites do emissor (pendência)**: CSOSN 500 em revenda com ST, CST 10 e outros, FCP, IPI e PIS/COFINS 03.
- **card e cobr/dup fora do XML**: são opcionais no modelo 55; o `card` de `pagamento.ts` fica só no conteúdo gravado (com comentário).
- **Adaptadores que faltam**: `ConsultaCadastrosFaturamento` (cadastros/api: o `criarConsultaParaPedido` não traz CNPJ, IE, CRT nem endereço da filial) e `CalculoFiscal` sobre `fiscal.calculo@1` (o fiscal ainda não tem `api`; ele recebe `origem` por item e devolve o CFOP à parte).
- `faturamento.nota` não tem colunas para `infCpl` nem `itens_solicitados`: vão no jsonb `transporte` (`{ mod_frete, inf_cpl, itens_solicitados }`; `pagamento` = `{ pagamentos, cobranca }`). Pedir ao banco-dados colunas próprias quando convier.
- Fora do lote 1c: DANFE, CC-e, cancelamento (`nota.cancelada@1`), inutilização, SVC, títulos (`titulo.gerado@1`, as parcelas já saem de `montarPagamento`), BKO, CSV, carteira do vendedor e atualização do status de `pedido_a_faturar` (faturado_parcial, faturado).
- `divArred` é local até o sdk exportar (RD-0367/0368); `DataCivil` do contrato também (RD-0369); o `FUSO_TENANT` de `api/sql.ts` é fixo em `America/Manaus` (a v1 só tem tenant no AM): **pendência: o fuso vem do tenant (RN-CORE)**; IBS/CBS/IS fora do `vNF` em 2026; frete pelo acumulado do valor bruto e desconto pelo acumulado da quantidade (P-4).

## O que o apps/api e o apps/worker ligam (`@macuxierp/faturamento/api`, só isto é exportado)
- **apps/api**: `criarPluginFaturamento(deps)` com `DependenciasFaturamento` (= `DepsEmissao`, em `api/emissao.ts`) e `repositoriosSql({ outbox: new OutboxPg() })` (`.notas`, `.pedidos`, `.ambiente`, `.notaEmAberto`); `situacao` = `criarConsultaParaFaturar()` de `@macuxierp/pedido/api`; `emissor` = `criarEmissorNFe()`; `lerA1` = a porta que liga `lerA1DecifradoDaFilial` + `abrirA1` (a chave do secret fica na API). Tirar o faturamento de `SEM_ROTAS`. Passar `.notaEmAberto` ao `dependenciasDeProducao` do pedido (`extras.notas`).
- **apps/worker**: registrar `criarConsumidorPedidoAprovado()`; `criarTransmissor(deps)` com `DepsTransmissor` (`api/transmissor.ts`; `lerA1` = `lerA1DecifradoDaFilial` do core, `sefaz` = `criarSeletorTransporte(...)`); chamar `transmitirNota(tenant_id, nota_id)` no trabalho `TRABALHO_TRANSMITIR_NOTA` e `transmitirPendentes(tenant_id, limite, paradasHaMinutos)` na varredura. O trabalho abre transações próprias (a SEFAZ vai fora de transação): não segurar a `tx` do executor na chamada. As portas são tipos exportados do mesmo ponto de entrada.
- **lockfile**: `@macuxierp/nfe-sefaz` está nas dependências do `modules/faturamento/package.json`; o `pnpm-lock.yaml` acompanha a dependência no mesmo commit (importer `modules/faturamento`).

## Diferenças da 0013 que o repositório SQL (lote 1c) segue
- Guardar a `nfe_autorizada` em `nota_xml` leva a nota a `autorizada` por gatilho; o repositório não chama `mudarStatus` depois.
- Totais com o sufixo `_centavos`.
- `nota_item.quantidade` em bigint, escala 4.
- `reservar_numero(p_filial, p_ambiente, p_serie, p_numero_inicial)` recusa ambiente diferente do da filial.
- Q9 = `faturamento.buracos_numeracao(p_filial, p_ambiente, p_serie)`.
- O papel de leitura não vê `destinatario_retrato`, `transporte` nem `nota_xml.xml`.
- **Migração 0020 (banco-dados, combinado)**: `nota_xml` aceita o tipo `nfe_assinada` (só INSERT, várias linhas por nota, `UNIQUE (nota_id, versao) WHERE tipo = 'nfe_assinada'`, `protocolo` nulo, o INSERT não muda o status da nota). Até ela existir, o CHECK da 0013 recusa o tipo e a coluna `versao` não existe: `api/sql-assinada.db.test.ts` e os testes de transmissão de `api/sql.db.test.ts` falham no banco real (os unitários, com o repositório em memória, passam).
