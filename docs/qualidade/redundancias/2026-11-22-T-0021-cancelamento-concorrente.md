# Redundâncias — T-0021 (cancelamento do pedido concorrente com o reenvio da nota)

Rodada única antes do push · 22/11/2026 (Manaus) · branch `nuvem/T-0021-testes-cancelamento-concorrente`, sobre o `origin/main` d9960c6, diff não commitado.
Escopo: `tests/integracao/banco/cancelamento-concorrente.db.test.ts` e `docs/testes/T-0021-cancelamento-concorrente.md`. Dono de tudo: `testes`.

Comparado com `tests/apoio/api-pg.ts`, `tests/ponta-a-ponta-fdv/apoio/erp-pedidos.ts`, `tests/t0022/**`, `modules/faturamento/api/*.db.test.ts` e `modules/pedido/api/sql.db.test.ts`: o teste reaproveita `depsFake`, `transporteFake`, `a1DeTeste`, `pedidoManual`, `prepararCadastros`, `pedidoAprovado` e `SELECT_EVENTO`, sem reimplementar. Os 13 testes cobrem cenários distintos (o 1 é sem corrida; 2a/2b e 6/D-03 fixam a ordem; 2c e 8 são as rodadas soltas).

| ID | Onde | Tipo | O que se repete | Sev. | Proposta | Status |
|---|---|---|---|---|---|---|
| RD-0664 | `cancelamento-concorrente.db.test.ts:227` e `:237`; `:294` e `:401`; `:192` | código | o prazo (`new Promise<never>(... rej(new Error(\`trava: ...\`)) ...).unref()` + `Promise.race`) escrito 2×; a alternância de ordem das rodadas soltas (`i % 2 === 0 ? juntas(canc, reenv) : juntas(reenv, canc).then(({ a, b }) => ({ a: b, b: a }))`) escrita 2×; o comentário de `semTrava` diz "dentro do prazo", que é conferido em outro lugar | baixa | Criar `comPrazo` e `soltas` (abaixo); `corrida` usa `await comPrazo(Promise.all([a, b]))`; apagar `juntas`; as linhas 294 e 401 viram `const { canc, reenv } = await soltas(c, i);`; o comentário da linha 192 vira `/** Não terminou em deadlock (40P01). */`. | corrigido no #216 |
| RD-0665 | `cancelamento-concorrente.db.test.ts:6-16` e `:75`; `T-0021-cancelamento-concorrente.md:18-19`, `:24`, `:26-29`, `:54`, `:66-68` | doc | o cabeçalho do teste reescreve a seção "Arquivo e montagem" do doc (peças reais, dublês, T-0045, portão, `pg_stat_activity`, prazo, 40P01); "como a F4 vai ligar / ainda liga `semNotaEmAberto`" 4× (teste:7, teste:75, doc:19, O-01); "nenhuma (uma nota por pedido em todos os casos)" diz o mesmo 2× | baixa | Fonte da verdade: o doc. Cabeçalho do teste (linhas 1-17) passa a ser o bloco abaixo; teste:75 → `// O-01 do doc: a produção ainda liga semNotaEmAberto; aqui, o notaEmAbertoSql na mão`; doc:18-19 → `` (`notaEmAbertoSql`, `modules/faturamento/api/sql.ts:554`), ligada na mão (O-01). Cadastros do pedido em memória. ``; doc:54-56, final → `**Nota duplicada:** nenhuma.` | corrigido no #216 |

Código proposto para RD-0664 (no lugar de `juntas`, depois de `esperarBloqueio`):

```ts
/** Rejeita se as duas transações não terminarem em `PRAZO_MS`. */
const comPrazo = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error(`trava: as duas transações não terminaram em ${PRAZO_MS} ms`)), PRAZO_MS).unref())]);
/** Rodada solta, sem portão: as duas ao mesmo tempo, com prazo; nas rodadas ímpares o reenvio sai primeiro. */
async function soltas(c: Caso, i: number) {
  const reenvAntes = i % 2 === 1 ? capturar(reenviar(c.nota_id)) : undefined;
  const canc = capturar(cancelar(c.pedido_id));
  const [rc, rr] = await comPrazo(Promise.all([canc, reenvAntes ?? capturar(reenviar(c.nota_id))]));
  return { canc: rc, reenv: rr };
}
```

Cabeçalho proposto para RD-0665:

```ts
/**
 * T-0021 (lote 5 do faturamento): cancelamento do pedido CONCORRENTE com o reenvio da nota, no PostgreSQL real
 * (papéis `macuxierp_app` e `macuxierp_worker`, RLS, gatilhos). Montagem, ordem forçada, matriz e defeitos:
 * docs/testes/T-0021-cancelamento-concorrente.md. Sem Postgres, pula (`bash db/scripts/pg-local.sh`).
 */
```

Manter: o `efeitos` do pedido (outbox e auditoria do SDK) repete `modules/pedido/api/sql.db.test.ts:50-60`, mas são 2 cópias e o lugar comum (`modules/pedido/api/fixtures-teste.ts`) é puro e usado por testes sem banco; extrair puxaria o `pg` para eles. Não catalogado. Também ficam os comentários dos ganchos (linhas 67-71, 113, 121) e as frases `[D-0x]` dos `it.fails` (são a asserção do esperado, não cópia da tabela).

Parecer: liberado com ajustes (2 achados baixos, ambos do `testes`, no mesmo diff; nenhum defeito funcional encaminhado). RD-0666 não usado.

## Reteste — 22/11/2026 (Manaus), PR #216, head 088596d

Lido o `git diff origin/main...origin/nuvem/T-0021-testes-cancelamento-concorrente` (o teste mudou depois da rodada: ajuste ao `main` #205 e #210).

- **RD-0664, corrigido no #216.** `comPrazo` e `soltas` estão em `cancelamento-concorrente.db.test.ts:242-250`, com o texto proposto; `juntas` saiu; `corrida` usa `await comPrazo(Promise.all([a, b]))` (:235); as duas rodadas soltas usam `const { canc, reenv } = await soltas(c, i);` (:316 e :442); o comentário de `semTrava` é `/** Não terminou em deadlock (40P01). */` (:190).
- **RD-0665, corrigido no #216.** Cabeçalho do teste (:1-5) igual ao proposto; o comentário O-01 (:62) aponta para o doc; doc:18-20 com a frase proposta (mais "pelo parâmetro `extras` ... como a F4", que não repete outro trecho); fim da seção de deadlock com `**Nota duplicada:** nenhuma.`

Observações (sem achado novo, para o `testes` decidir no próximo toque):
- O-R1: doc:56-60 ainda descreve o par `it` de preparo + `it.fails` com guarda, mas doc:50 diz que todos os `it.fails` viraram `it` e o teste não tem mais `it.fails`. Texto desatualizado (item 4 da lista de antes do PR).
- O-R2: "sem espera desde o #205 (a porta lê a nota sem `FOR SHARE`)" aparece na seção "Ajuste ao main" do doc e de novo nas linhas 2a, 2b e 6 da matriz e no teste (:57, :296, :342). A fonte da verdade é a seção "Ajuste ao main"; as outras poderiam só citar "(#205)".
