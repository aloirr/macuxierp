# T-0021 — Cancelamento do pedido concorrente com o reenvio da nota (plano e relatório)

Dono: `testes`. Branch `nuvem/T-0021-testes-cancelamento-concorrente`, sobre o `origin/main` **6370f36**; harness ajustado ao `main` **244fbd0** (#205 e #210) em 22/11/2026, às 03h40 (Manaus). Pedido do
`gerente-projetos` (lote 5 do faturamento). Sessão da nuvem de 22/11/2026, das 03h00 às 03h50 (horário de Manaus), com
o Postgres local (`bash db/scripts/pg-local.sh`, PostgreSQL 16) e Node 24.

**Critério:** com a nota do pedido em aberto (`em_autorizacao`, ou autorizada e ainda não aplicada ao pedido), o
cancelamento do pedido e o reenvio da nota chegam juntos e (1) o cancelamento é recusado com 422 `RN-PED-02` ("O pedido
tem nota em autorização", `modules/pedido/api/servico.ts:451`); (2) não há deadlock (40P01) e as duas transações
terminam no prazo; (3) o saldo não passa (`quantidade_faturada` e `valor_faturado_centavos` ≤ pedido), o status final é
coerente (nunca `cancelado` com nota autorizada) e nenhuma nota é duplicada.

## Arquivo e montagem

`tests/integracao/banco/cancelamento-concorrente.db.test.ts`, um banco efêmero com as migrações do `main`, papéis
`macuxierp_app` (API) e `macuxierp_worker` (worker e consumidor), RLS e gatilhos reais.

- **Pedido:** `criarServico` com o adaptador SQL e a porta `NotaEmAberto` de produção do faturamento
  (`notaEmAbertoSql`, `modules/faturamento/api/sql.ts:586`), ligada na mão (O-01) pelo parâmetro `extras` de
  `dependenciasDeProducao` (`modules/pedido/api/index.ts`), como a F4. Cadastros do pedido em memória.
- **Faturamento:** `criarServicoEmissao` com o repositório SQL, a fila `pedido_a_faturar` real e a porta
  `SituacaoPedidoParaFaturar` real do pedido (`criarConsultaParaFaturar`, `FOR SHARE` em `pedido.pedido`). O reenvio
  segue o caminho da rota `POST /notas/:id/reenviar` (nota `FOR UPDATE` + `reenviarNota`). O transmissor do worker usa o
  emissor real, os `titulos` do `repositoriosSql` (lote 5: geração na mesma transação da autorização), `log` mudo e o A1
  de teste gerado em tempo de execução; recebe também a `situacao` (a mesma `criarConsultaParaFaturar()`, `FOR SHARE`),
  dependência opcional da correção do D-03 no faturamento: as deps vão numa variável, e o transmissor do `main` a ignora; o transporte é o `transporteFake` (contrato real da SEFAZ).
  O simulador da T-0045 não foi preciso: o que importa aqui é a ordem das travas, não a resposta da SEFAZ.
- **Volta ao pedido:** o consumidor `faturamento.nota.autorizada@1` do pedido, com o evento lido da outbox.
- **Ordem forçada:** um portão segura a primeira transação logo depois da trava dela; a segunda só sai quando o
  Postgres a mostra esperando trava (`pg_stat_activity.wait_event_type = 'Lock'`) ou quando já terminou. Toda corrida
  tem prazo de 15 s e falha se aparecer 40P01. As rodadas soltas (20 por cenário, `Promise.all`, alternando quem sai
  primeiro) cobrem a ordem que o Postgres escolher.

Como rodar: `bash db/scripts/pg-local.sh` e
`pnpm test:tests tests/integracao/banco/cancelamento-concorrente.db.test.ts` (ou
`bash tests/scripts/rodar-antes-do-push.sh --arquivo tests/integracao/banco/cancelamento-concorrente.db.test.ts`).

## Ajuste ao main 244fbd0 (#205 e #210)

- **#205** (faturamento lote 5) trocou o `notaEmAbertoSql`: conta `rascunho` numerada, `em_autorizacao`,
  `emitida_contingencia`, `autorizada_guarda_pendente`, `autorizada` e `rejeitada` (só `cancelada`, `inutilizada` e
  `denegada` ficam fora) e lê a nota **sem `FOR SHARE`** (o `FOR SHARE` dava deadlock com o reenvio, que trava a nota e
  depois pede o `FOR SHARE` do pedido; o `FOR UPDATE` do pedido no cancelamento basta, porque todo caminho que cria ou
  reabre nota pede antes o `FOR SHARE` do pedido). Por isso **a espera do cancelamento pela trava da nota deixou de
  existir**: em 2a, 2b e 4 a asserção "a segunda transação esperou a trava" saiu; ficam sem deadlock, uma nota e saldo íntegro.
- **#210** (pedido) acrescentou `notasAutorizadas` à porta `NotaEmAberto` do pedido. **O-02:** o faturamento do `main` ainda
  não implementa esse método (a porta dele só tem `temNotaEmAutorizacao`); o gancho do teste delega ao `notaEmAbertoSql`
  quando ele tiver o método e, até lá, ao `semNotaEmAberto.notasAutorizadas` (devolve `[]`, o mesmo da produção). Quem
  preenche é o `modulo-faturamento`.
- Com o #205, **D-01, D-02, D-03 e D-03b passaram** pelo lado do cancelamento: os `it.fails` ficaram vermelhos e viraram
  `it` (com `expect(preparo).toBeDefined()` no lugar da guarda). O cenário 6 mudou de resultado esperado: a `rejeitada`
  conta como em aberto, o cancelamento é 422 e o reenvio, que esperou o `FOR UPDATE` do pedido, segue até `faturado`.

## Matriz (critério → teste → resultado)

Resultado: 15 testes, verdes **3 vezes seguidas** (≈ 7,6 s cada), em 22/11/2026, 03h25 (Manaus); de novo no `main` 244fbd0, 3 vezes (≈ 7,8 s), às 03h40. Cada defeito tem um
`it` de preparo (corre o cenário, afirma sem deadlock e as pré-condições, guarda o observado) e um `it.fails` só com a
asserção do esperado; corrigido, o `it.fails` fica vermelho e vira `it`. Cada `it.fails` abre com uma guarda: sem o
preparo (por exemplo, rodado sozinho com `-t "\[D-01]"`), ele sai cedo, não falha e fica **vermelho**, em vez de passar
por um `TypeError`.

| # | Cenário | Teste | Resultado |
|---|---|---|---|
| 1 | Nota `em_autorizacao`, sem corrida: a porta diz `true`, o cancelamento é 422 `RN-PED-02`; autorizada, a nota fatura o pedido (`faturado`, 1 × 10 000 Qtd4, R$ 10,00); o evento reentregue não soma de novo | `preparo: nota em_autorizacao …` | verde |
| 2a | `em_autorizacao` × reenvio pela API, **cancelamento primeiro** (cancelamento segura `FOR UPDATE` do pedido; desde o #205 o reenvio não espera): 422 `RN-PED-02`, reenvio recusado `RN-FAT-07`, sem deadlock, uma nota, depois `faturado` | `em_autorizacao × reenvio pela API (cancelamento primeiro)` | verde |
| 2b | O mesmo, **reenvio primeiro** (o reenvio segura `FOR UPDATE` da nota; desde o #205 o cancelamento lê a nota sem `FOR SHARE` e não espera) | `… (reenvio primeiro)` | verde |
| 2c | 20 rodadas soltas de 2a/2b | `… 20 rodadas soltas` | verde |
| 3 | `em_autorizacao` × retorno autorizado no worker, **cancelamento primeiro**: a porta vê `em_autorizacao` sem travar a nota; 422, depois autorizada e `faturado` | `em_autorizacao × retorno autorizado no worker (cancelamento primeiro)` | verde |
| 4 | `em_autorizacao` × retorno autorizado no worker, **worker primeiro** (a nota fica autorizada na transação do worker, ainda sem commit; o cancelamento lê a versão confirmada, `em_autorizacao`) | `[D-01, preparo]` + `[D-01]` | verde (D-01 corrigido no #205) |
| 5 | Nota autorizada com o `nota.autorizada@1` ainda na outbox (sem corrida) | `[D-02, preparo]` + `[D-02]` | verde (D-02 corrigido no #205) |
| 6 | `rejeitada` × reenvio pela API, **cancelamento primeiro**: desde o #205 o cancelamento é 422 `RN-PED-02` (`rejeitada` em aberto); o reenvio espera no `FOR SHARE` da situação e segue; autorizada, `faturado` | `rejeitada × reenvio pela API (cancelamento primeiro)` | verde |
| 7 | `rejeitada` × reenvio pela API, **reenvio primeiro** (o reenvio segura o `FOR SHARE` do pedido; o cancelamento espera e passa depois do commit) | `[D-03, preparo]` + `[D-03]` | verde (D-03 corrigido no #205, pelo cancelamento) |
| 7b | Nota `rascunho` recém-emitida, **sem corrida**: o cancelamento passa e o worker assina e autoriza depois | `[D-03b, preparo]` + `[D-03b]` | verde (D-03b corrigido no #205, pelo cancelamento) |
| 8 | 20 rodadas soltas de 6/7: nunca deadlock; cancelamento 200 ou 422; reenvio responde pelo domínio; uma nota; saldo íntegro | `rejeitada × reenvio pela API, 20 rodadas soltas` | verde |

**Deadlock:** nenhum 40P01 em nenhuma ordem (6 corridas com portão e 40 soltas por rodada, 3 rodadas). As travas
sempre se encadeiam no mesmo sentido ou esperam o commit da outra. **Saldo:** nunca passou do pedido. **Nota
duplicada:** nenhuma.

## Achados

Situação no `main` 244fbd0: os quatro **corrigidos pelo lado do cancelamento** (porta do #205). A conferência do pedido no
worker antes de assinar (dependência `situacao` do transmissor) é a segunda metade da correção de D-03 e D-03b, ainda na
branch do `modulo-faturamento`; com o cancelamento já recusado, este arquivo não consegue mais chegar ao worker com o pedido
`cancelado`, então a prova dela fica nos testes do faturamento.

| Id | Defeito | Observado (antes do #205) | Esperado | Dono |
|---|---|---|---|---|
| **D-01** | O `notaEmAbertoSql` só conta `em_autorizacao` e `emitida_contingencia`. Com o worker autorizando a nota ao mesmo tempo, o `FOR SHARE` do cancelamento espera o commit do worker, o Postgres reavalia o `WHERE` na versão nova (`autorizada`), a linha sai e a porta responde `false` | cancelamento 200, pedido `cancelado`; o consumidor recusa a nota (`status_invalido`, alerta) e o pedido fica **`cancelado` com nota autorizada** | 422 `RN-PED-02` e o pedido termina `faturado` | modulo-faturamento (porta, P-2 da T-0013) + modulo-pedido (texto de `RN-PED-02`) |
| **D-02** | O mesmo buraco sem corrida: nota `autorizada` (ou `autorizada_guarda_pendente`) cujo `nota.autorizada@1` ainda não foi aplicado ao pedido não conta como nota em aberto | porta `false`, cancelamento 200, pedido `cancelado` com nota autorizada, alerta `status_invalido` | porta `true` até o pedido aplicar a nota; 422; pedido `faturado` | modulo-faturamento (porta) + modulo-pedido (texto de `RN-PED-02`) |
| **D-03** | Reenvio da `rejeitada` confirma antes do cancelamento: a nota continua `rejeitada` (com conteúdo novo e trabalho na fila), a porta não a vê, o cancelamento passa; o worker assina e transmite sem conferir o status do pedido (`transmissor.ts`, `preparar`) | nota **autorizada** para pedido **`cancelado`**; alerta `status_invalido` | ou o cancelamento é recusado (nota reenviada/rascunho na fila conta como em aberto), ou o worker não assina nota de pedido cancelado (situação do pedido com `FOR SHARE` antes de assinar) | modulo-faturamento (worker) |
| **D-03b** | O mesmo buraco sem corrida: nota `rascunho` recém-emitida (trabalho na fila do worker) não conta como nota em aberto; o cancelamento passa e o worker assina e autoriza sem conferir o pedido | pedido **`cancelado`** com nota **`autorizada`** | ou o cancelamento é recusado, ou a nota não é assinada | modulo-faturamento (worker: confere a situação do pedido antes de assinar) |

**Correção proposta pelo engenheiro:** a porta `NotaEmAberto` conta `rascunho`, `em_autorizacao`, `emitida_contingencia`,
`autorizada_guarda_pendente` e `autorizada` (a `rejeitada` fica para decisão de produto); o worker confere o pedido com `FOR SHARE` antes de assinar.

**Texto de `RN-PED-02`:** o `ehRecusaNotaEmAberto` do teste reconhece a recusa da porta pelo 422, pelo código `RN-PED-02`
e pela palavra "nota" no texto (`modules/pedido/api/servico.ts:451`, hoje "O pedido tem nota em autorização"), sem
depender de "autorização"; a transição inválida, com o mesmo código, não cita nota. Se o `modulo-pedido` trocar o texto
e tirar a palavra "nota", o regex precisa mudar junto.

Observação **O-01** (não é defeito da F3): `dependenciasDeProducao` do pedido (`modules/pedido/api/index.ts:26`) e o
`montarModulos` da API (`apps/api/src/modulos.ts:89`) ainda ligam `semNotaEmAberto`; o teste liga o `notaEmAbertoSql`
na mão, pelo `extras`. A ligação de produção é pendência da F4 (P-2), junto com as rotas do faturamento (`SEM_ROTAS`).

Fora do escopo, só anotado: o `modules/faturamento/api/eventos-simulador.test.ts` ("autoriza → cancela") às vezes
estoura 5 s sob carga (não é deste teste). Na 1ª rodada do `--tudo` (22/11, 03h35), dois tempos-limite sob carga, fora
deste teste: `modules/integracao-fdv/api/agenda-conector.db.test.ts` (RN-INF-03, 5 s) e
`packages/nfe-emissor/src/c3-simulador.test.ts` (C3, 30 s); isolados, verdes (314 e 76); o rerun único do `--tudo` saiu verde.

## Revisão do engenheiro

Nenhum 🔴 no teste. Os 🟡 1 a 3 aplicados: (1) guarda no início de cada `it.fails`; (2) caso novo `[D-03b]`; (3) a
montagem pelo `extras` de `dependenciasDeProducao`, igual à F4. Os defeitos D-01, D-02, D-03 e D-03b confirmados como
🔴 do produto.

## Parecer do corretor

Liberado com ajustes (RD-0664 e RD-0665 aplicados; RD-0666 não usado). Relatório:
`docs/qualidade/redundancias/2026-11-22-T-0021-cancelamento-concorrente.md`.

## Antes do push

Bloco do `bash tests/scripts/rodar-antes-do-push.sh --tudo` no corpo do PR.
