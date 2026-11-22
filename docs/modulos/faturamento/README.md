# Módulo faturamento (T-0021, lotes 1, 1c e 2)

Fatia vertical: `contracts` (Zod, eventos), `domain` (regras puras), `api` (plugin `/v1/faturamento`, só as portas neste lote) e `web`. Lote 1 = emissão e autorização da NF-e 55 no domain, nos contratos e nas portas. Lote 1c = repositório SQL sobre a 0013, consumidor de `pedido.pedido.aprovado@1`, rotas e o trabalho do worker (BKO e demais eventos ficam para os próximos). Premissa da v1: só filial emissora no AM (cUF 13). Nada fala com a SEFAZ real: certificado A1 de teste gerado em execução e SEFAZ-AM simulada (T-0045).

## Fluxo
```
pedido.pedido.aprovado@1 ─► pedido_a_faturar (fila; sem ler o schema pedido)
POST /notas {pedido_id, itens?, idempotencia}
  └─ API, 1 transação: situação do pedido (FOR SHARE) → cálculo fiscal → montarNota → emissor.montar (nº provisório, só conferir) → temA1Ativo (metadados) → reservar_numero → emissor.montar → nota (RASCUNHO, com conteúdo, chave, cNF e dhEmi) + enfileira faturamento.transmitir_nota
worker (ADR 0005 item 4; só ele lê o A1 decifrado): lerA1 → (rascunho/rejeitada) remonta do conteúdo gravado com o MESMO nº/cNF/dhEmi, confere a chave → EmissorNFe.assinar → nota_xml 'nfe_assinada' (versao = max+1) → em_autorizacao (mesma tx) → EmissorNFe.transmitir FORA da tx → interpretarRetorno
         A1 vencido/revogado ou chave que não bate: nota fica em rascunho/rejeitada com o motivo em transporte.envio_pendente, sem queimar número
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

## Emissão e worker
Cabeçalhos com o passo a passo, em `api/emissao.ts` (API: confere, reserva o número, grava o rascunho) e `api/transmissor.ts` (worker: trava a nota, assina, guarda a `nfe_assinada`, transmite, aplica o retorno). Aqui só o que não está lá:
- **Corrida worker × reenvio (RN-FAT-07, RN-FAT-03)**: quem assina relê a nota com `FOR UPDATE`, e o UPDATE para `em_autorizacao` exige a revisão lida; se não bater, a tx desfaz.
- **Varredura** (`transmitirPendentes`): `em_autorizacao` e `autorizada_guarda_pendente` paradas há 2 min, mais o `rascunho` sem `nfe_assinada` (2 min; 30 min quando há `envio_pendente`).
- **Prazo de inutilização (RN-FAT-01)**: `RepositorioNotas.numeradasNaoEnviadas(tx, antesDe)` lista `rascunho`/`rejeitada` numeradas emitidas antes do corte, para o alerta antes do dia 10; só a função existe, o alerta o engenheiro liga depois.
- Filial emissora sem IE é violação `RF-FAT-01` antes da reserva. Repetir `POST /notas` com a nota ainda em `rascunho` enfileira o trabalho de novo.
- Guarda, digest, MEI, pagamento e campos do emissor: `domain/` e `api/emissao.ts` (testes nomeados pela RN).

## Rotas (`/v1/faturamento`, `api/rotas.ts`)
| Rota | Ação | Notas |
|---|---|---|
| `POST /notas` | `faturamento.nota.emitir` | emite do pedido (total ou parcial); 201, ou 200 na repetição; enfileira a transmissão; audita |
| `GET /notas`, `GET /notas/:id` | `faturamento.ver` | filtros na URL (filial, cliente, pedido, status, ambiente, série, número, `de`/`ate`), cursor por `id`; `vendedor` recebe 403 (carteira entra com o BKO) |
| `GET /notas/:id/xml` | `faturamento.nota.emitir` | download do `nfeProc` guardado (404 enquanto não guardado) |
| `GET /rejeicoes` | `faturamento.ver` | painel RF-FAT-08: código, mensagem e ação sugerida |
| `POST /notas/:id/reenviar` | `faturamento.nota.emitir` | só rejeitada, mesmo número (RN-FAT-07); enfileira a transmissão |
| `POST /notas/:id/cancelar` | `faturamento.nota.emitir` | lote 2: grava o pedido `pendente` (`nota_evento`) e enfileira `faturamento.processar_evento`; 202; `Idempotency-Key` obrigatória; sem A1 ativo (metadados) 422 |
| `POST /notas/:id/carta-correcao` | `faturamento.nota.emitir` | idem, CC-e (sequência 1 a 20); 202 com `{ evento, avisos }` |
| `POST /inutilizacoes` | `faturamento.nota.emitir` | grava `inutilizacao` `pendente` (avança a numeração) e enfileira `faturamento.processar_inutilizacao`; 202 |
| `POST /notas/:id/consultar` | `faturamento.nota.emitir` | enfileira `faturamento.consultar_nota` (reconcilia sem editar nota autorizada); 202 |
| `GET /notas/:id/eventos` | `faturamento.ver` | cancelamento e CC-e da nota (`vendedor` recebe 403) |
| `GET /titulos`, `GET /titulos/:id` | `faturamento.ver` | títulos a receber: filtros cliente, status e vencimento, paginado (`vendedor` 403) |
| `POST /titulos/:id/baixas` | `faturamento.ver` + perfil | baixa parcial ou total; `Idempotency-Key` obrigatória; só administrador, gerente e faturista (ver titulos.md) |
| `POST /titulos/:id/baixas/:baixa_id/estornar` | `faturamento.ver` + perfil | estorna a baixa; mesmo perfil |
| `GET`/`PUT /filiais/:id/configuracao` | `faturamento.ver`; PUT só administrador | bandeira "faturamento real com NF-e simulada" (desligada por padrão); PUT com `Idempotency-Key` obrigatória e auditoria |

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
| `ConsultaA1Ativo` (`temA1Ativo`) | apps/api: `criarPortaA1` do `@macuxierp/core/api` (`a1ValidoDaFilial`) com o `noTenant` ligado à tx da requisição | só o veredito `{ ativo }` ou `{ ativo: false, motivo, mensagem }` sobre os metadados do certificado; nunca decifra |
| `lerA1` (`A1DaFilial`), SÓ no worker | `lerA1DecifradoDaFilial` do core + `abrirA1` do emissor | `{ certificado, credencial }`: o certificado assina; a credencial (pfx + senha) vai ao seletor de transporte; `pfx` zerado no `finally`; `null` = sem A1 ativo, `ErroCertificadoA1` = A1 inválido/vencido |

## Eventos publicados
Agregado = `nota.id` nos eventos de nota (`nota.autorizada@1`, `nota.cancelada@1`, `nota.rejeitada@1`) e `titulo.id` nos de título (`titulo.gerado@1`, `titulo.baixado@1`; recado R-20261121-234815).
Campos e regras: somente em `contracts/index.ts` (Zod), fonte da verdade. Publica `faturamento.nota.autorizada@1`, `nota.cancelada@1`, `nota.rejeitada@1`, `titulo.gerado@1` e `titulo.baixado@1`; consome `pedido.pedido.aprovado@1`. `ambiente = homologacao` é descartado pelo `integracao-fdv` (RN-FAT-04). `nota.autorizada@1` só sai depois do XML guardado (RN-FAT-03).

## P-2 (nota em autorização × cancelamento do pedido; resolução proposta)
1. É "nota em aberto" toda nota do pedido em rascunho numerada, `em_autorizacao`, `emitida_contingencia`, `autorizada_guarda_pendente`, `autorizada` ou `rejeitada` (que pode ser reenviada); só `cancelada`, `inutilizada` e `denegada` ficam fora. Nota em aberto bloqueia o cancelamento do pedido: o `pedido` chama `NotaEmAberto.temNotaEmAutorizacao`, com `FOR SHARE` na linha da nota, e recusa com 422 `RN-PED-02`. Para cancelar o pedido, cancele a nota antes (evento de cancelamento). A reserva do número e esse bloqueio usam a mesma trava do pedido, então não há corrida.
2. Nota `cancelada` devolve as quantidades: o `pedido` consome `nota.cancelada@1` (campos `pedido_id`, `itens[].sequencia`, `quantidade`, `valor_centavos`) e recua o status. O recuo não volta ao FDV (T-0013 2); o FDV vê a nota cancelada pela entidade `nota` (T-0009 2.10).
3. Saldo da emissão pelo próprio faturamento (RN-FAT-01/RF-FAT-01): o saldo por item desconta a soma das quantidades das notas do mesmo pedido em qualquer status menos `cancelada`, `inutilizada` e `denegada` (`quantidadesJaFaturadas`), sem esperar o `pedido` consumir o evento; vale o maior entre essa soma e a `quantidade_faturada` do pedido. A emissão trava a linha do pedido em `faturamento.pedido_a_faturar` (`FOR UPDATE`), então duas emissões simultâneas não passam juntas. O reenvio da rejeitada não conta a própria nota.

## Eventos fiscais (lote 2)
Cancelamento, CC-e, inutilização e consulta: fluxo, travas e pendências em `eventos.md`.

## Pendências e dublês que restam
- **Pedido guardado dos eventos (banco-dados)**: a 0013 não tem `dh_evento`, `id_lote` nem `fuso_minutos` em `nota_evento`. Hoje o `dhEvento` é o `updated_at` da linha `pendente` (renovado a cada UPDATE, estável até o fim do ciclo), o `idLote` sai dele e o fuso é o de Manaus. Pedir as colunas por recado quando convier.
- **Troca pelo montador único (T-0021 1c, T-0018 §8)**: saíram `domain/xml.ts`, `domain/chave.ts`, `xNomeDestinatario`/`XNOME_HOMOLOGACAO` e os dublês `AssinadorA1`/`EmissorNFe` das portas. A `NotaParaEmissao` agora é a do emissor (centavos, sem totais). **Fora do XML por limite do emissor**: `card` (tpIntegra) nos cartões e `cobr/dup` do boleto (a cobrança segue no conteúdo gravado, para os títulos); pedir ao `engenheiro-software`/T-0018 se a SEFAZ exigir.
- **A1 só no worker (ADR 0005 item 4)**: a API não lê o A1 decifrado; `lerA1` e `abrirA1` são ligados só no apps/worker. A API usa `temA1Ativo` sobre os metadados que o `macuxierp_app` já lê (0003). Pendência: a `criarPortaA1` do core recebe `noTenant`, então o adaptador do apps/api liga `noTenant: (fn) => fn(tx)` por requisição (ou o core expõe uma variante que recebe a `tx`).
- **Adaptador do worker**: zera o `pfx` quando o `abrirA1` lança `ErroCertificadoA1` (o transmissor só zera o que recebe).
- **Controle no jsonb `transporte` (pendência)**: `envio_pendente` e `revisao` convivem com o frete em `transporte`; pedir colunas ao banco-dados.
- **Trava por nota (pendência)**: hoje o `pg_try_advisory_xact_lock` só cobre a tx1; o efeito é limitado e a duplicidade vira consulta. Evoluir para trava por nota com lease ou trava de sessão.
- **Limites do emissor (pendência)**: CSOSN 500 em revenda com ST, CST 10 e outros, FCP, IPI e PIS/COFINS 03.
- **card e cobr/dup fora do XML**: são opcionais no modelo 55; o `card` de `pagamento.ts` fica só no conteúdo gravado (com comentário).
- **Adaptadores que faltam**: `ConsultaCadastrosFaturamento` (cadastros/api: o `criarConsultaParaPedido` não traz CNPJ, IE, CRT nem endereço da filial) e `CalculoFiscal` sobre `fiscal.calculo@1` (o fiscal ainda não tem `api`; ele recebe `origem` por item e devolve o CFOP à parte).
- `faturamento.nota` não tem colunas para `infCpl` nem `itens_solicitados`: vão no jsonb `transporte` (`{ mod_frete, inf_cpl, itens_solicitados }`; `pagamento` = `{ pagamentos, cobranca }`). Pedir ao banco-dados colunas próprias quando convier.
- Fora dos lotes 2 e 5: DANFE, SVC, BKO, CSV, carteira do vendedor e atualização do status de `pedido_a_faturar` (faturado_parcial, faturado).
- `divArred` é local até o sdk exportar (RD-0367/0368); `DataCivil` do contrato também (RD-0369); o `FUSO_TENANT` de `api/sql.ts` é fixo em `America/Manaus` (a v1 só tem tenant no AM): **pendência: o fuso vem do tenant (RN-CORE)**; IBS/CBS/IS fora do `vNF` em 2026; frete pelo acumulado do valor bruto e desconto pelo acumulado da quantidade (P-4).

## O que o apps/api e o apps/worker ligam (`@macuxierp/faturamento/api`, só isto é exportado)
- **apps/api** (`criarPluginFaturamento(deps: DependenciasFaturamento)`, `DependenciasFaturamento` = `DepsRotas` (`DepsEmissao` + `eventos`); **sem `lerA1` e sem assinatura**, o tipo recusa): `repositoriosSql({ outbox: new OutboxPg() })` (`.notas`, `.eventos`, `.pedidos`, `.ambiente`, `.notaEmAberto`); `pedidos`, `notas` e `ambiente` dali; `situacao` = `criarConsultaParaFaturar()` de `@macuxierp/pedido/api`; `cadastros` = `ConsultaCadastrosFaturamento`; `calculo` = `CalculoFiscal`; `emissor` = `criarEmissorNFe()` (só o `montar` é usado); `certificado` = `{ temA1Ativo(tx, filial_id) }` sobre `criarPortaA1` do core (veredito sobre metadados, usado na emissão e nos eventos). Tirar o faturamento de `SEM_ROTAS`. Passar `.notaEmAberto` ao `dependenciasDeProducao` do pedido (`extras.notas`).
- **apps/worker** (`criarTransmissor(deps: DepsTransmissor)`, papel `macuxierp_worker`): `banco`; `notas` e `ambiente` de `repositoriosSql`; `emissor` = `criarEmissorNFe()` completo (`montar`, `assinar`, `transmitir`); `lerA1(tx, filial_id)` = `lerA1DecifradoDaFilial(tx, chave, filial)` do core + `abrirA1(pfx, senha)` do emissor, devolvendo `{ certificado, credencial }` (`null` sem A1; deixar subir o `ErroCertificadoA1` do `abrirA1`); `sefaz` = `criarSeletorTransporte(...)`. Registrar também `criarConsumidorPedidoAprovado()`. No trabalho `TRABALHO_TRANSMITIR_NOTA` chamar `transmitirNota(tenant_id, nota_id)` (assina, guarda a `nfe_assinada` e transmite) e `transmitirPendentes(tenant_id, limite, paradasHaMinutos)` na varredura. O trabalho abre transações próprias (a SEFAZ vai fora de transação): não segurar a `tx` do executor na chamada.
- **Eventos no worker**: `criarProcessadorEventos(deps)` (`DepsProcessadorEventos`: `banco`, `notas`, `eventos`, `cadastros.filial`, `ambiente`, `lerA1`, `emissor`, `sefaz`; `lerA1` e `emissor` iguais aos do `criarTransmissor`): trabalhos `TRABALHO_PROCESSAR_EVENTO` → `processarEvento(tenant_id, evento_id)`, `TRABALHO_PROCESSAR_INUTILIZACAO` → `processarInutilizacao`, `TRABALHO_CONSULTAR_NOTA` → `consultarNota`; varredura `processarPendentes(tenant_id, limite, paradasHaMinutos)` (nota_evento e inutilizacao `pendente` há N min). Mesma regra: SEFAZ fora de transação, nota (e notas da faixa) travada com `FOR UPDATE` onde o evento muda o status, um só `try/finally` zera o `pfx`.
- **lockfile**: `@macuxierp/nfe-sefaz` está nas dependências do `modules/faturamento/package.json`; o `pnpm-lock.yaml` acompanha a dependência no mesmo commit (importer `modules/faturamento`).

## Títulos e bandeira (lote 5): o que o engenheiro liga
Detalhes e regras em `docs/modulos/faturamento/titulos.md`. Resumo:
A ligação no apps/api e no worker, as rotas de títulos, a varredura e a bandeira estão em `docs/modulos/faturamento/titulos.md` (fonte única). Aqui só o essencial:
- `repositoriosSql(...)` devolve `.titulos` e `.configuracao`; o worker passa `log` (obrigatório no `criarProcessadorEventos`).
- Eventos novos: `faturamento.titulo.gerado@1` e `titulo.baixado@1` (agregado `titulo.id`), publicados pelo repositório de notas (`publicarEvento`) na tx; `conta_como_real`, `produto_id` e `filial_id` por item de `itens[]` são campos opcionais.
- Pendências para outros donos: ação `faturamento.titulo.baixar` no `PERMISSOES` do platform-sdk; migração `faturamento.configuracao_filial` do banco-dados.

## Diferenças da 0013 que o repositório SQL (lote 1c) segue
- Guardar a `nfe_autorizada` em `nota_xml` leva a nota a `autorizada` por gatilho; o repositório não chama `mudarStatus` depois.
- Totais com o sufixo `_centavos`.
- `nota_item.quantidade` em bigint, escala 4.
- `reservar_numero(p_filial, p_ambiente, p_serie, p_numero_inicial)` recusa ambiente diferente do da filial.
- Q9 = `faturamento.buracos_numeracao(p_filial, p_ambiente, p_serie)`.
- O papel de leitura não vê `destinatario_retrato`, `transporte` nem `nota_xml.xml`.
- **Migração 0020 (banco-dados, combinado)**: `nota_xml` aceita o tipo `nfe_assinada` (só INSERT, várias linhas por nota, `UNIQUE (nota_id, versao) WHERE tipo = 'nfe_assinada'`, `protocolo` nulo, o INSERT não muda o status da nota). Até ela existir, o CHECK da 0013 recusa o tipo e a coluna `versao` não existe: `api/sql-assinada.db.test.ts` e os testes de transmissão de `api/sql.db.test.ts` falham no banco real (os unitários, com o repositório em memória, passam).
