# Integração FDV: operação nas telas (T-0086)

Desenho: `docs/desenho/T-0086.md`. Contratos: `packages/platform-sdk/src/portal-integracao-operacao.ts`. Regras no `domain/operacao.ts`.

## Rotas
| Onde | Rota | Ação |
|---|---|---|
| /config | `GET C.monitor` | `plataforma.integracao_fdv.ver` |
| /config | `GET C.log` (só códigos, campos e contagens, ADR 0013) | `plataforma.integracao_fdv.ver` |
| /config | `POST C.reprocessar` (`Idempotency-Key` obrigatória; 409 com lote em voo) | `plataforma.integracao_fdv.operar` |
| BKO | `GET /v1/integracao-fdv/entidades/:entidade/log` (completo) e `.../log.csv` | `integracao-fdv.ver` |

As três do /config checam o módulo licenciado na empresa (422 `RN-CORE-02`) e usam a empresa alvo do `:id`.

## Virada de versão de contrato do Hub (T-0107, automática)
Ligar (ou desligar) uma versão de contrato (por exemplo, `PRAZO_CONTRATO_V2_LIGADO`) **não exige mais reenvio manual**. Cada registro do espelho guarda em `contrato_enviado` a versão do envelope em que foi enviado (aceito ou recusado pelo Hub). No começo de cada ciclo da entidade, o worker marca como pendente, os registros vivos do tenant cuja versão enviada é diferente da vigente; o delta os reenvia na versão vigente e grava a nova versão.
1. **Deploy** da versão com a flag ligada. Nada mais a fazer: no ciclo seguinte os pendentes sobem e voltam a zero no monitor da aba Integração.
2. **O que volta:** só a entidade que mudou de versão (hoje, `prazo_pagamento`), com os inativos já confirmados (vão como `ativo: false`) e os recusados em versão antiga. Aceito na versão vigente não volta; ciclo sem virada não marca nada; outro tenant não é tocado.
3. **Limite:** reverter a flag também reenvia, **automaticamente na versão antiga**. Não há "só os novos": a versão vigente vale para o cadastro inteiro da entidade.
4. **Reenvio manual** (Reprocessar ou Carga completa) segue disponível para outros casos, mas deixa de ser passo da virada.

## Referência ainda não confirmada (RN-INF-02, T-0112)
A linha cuja referência (filial, forma de pagamento, produto, vendedor, cliente ou tabela de preço) ainda não foi confirmada no FDV **não vai em `linhas_invalidas`**: o Hub a recusaria à toa. O ERP a retém em silêncio, ela segue pendente e volta sozinha quando a referência for confirmada (delta e `acordarDependentes`; na carga completa o cursor passa por ela). O Log mostra o registro ("Aguardando <cadastro> ser confirmada no FDV." / "Nada a fazer: aguarde."), gravado em `lote_erro` (origem `erp`, reprocessável, sem migração) no lote em que ela foi retida, uma vez enquanto estiver aberta. Delta só com linhas retidas não monta lote e, por isso, não grava o registro no Log.

## Credencial recusada: retomada automática a cada 30 minutos (decisão 25 B)
- Com a pausa `credencial` ou `licenca_fdv`, o envio e a reconciliação **não chamam** o Hub (o limite de falhas de autenticação do Hub é por IP, de toda a VM).
- Só o **sinal** sonda: com a pausa mais antiga do tenant (`pausada_em`) com 30 minutos ou mais, faz **uma** chamada `POST /sinal`.
  - Hub aceitou: as pausas `credencial` e `licenca_fdv` de todas as entidades saem sozinhas e o envio volta (`proximo_em` = agora). O código da última recusa (`sinal.ultimo_codigo`) é limpo.
  - Hub recusou de novo (401/403): a pausa é renovada com `pausada_em` = agora, recomeçando os 30 minutos, e o código do Hub (ou `http_<status>`) fica em `ultimo_codigo`.
  - Rede ou 5xx: a pausa não muda; o próximo sinal tenta de novo.
- Continuam **manuais** ("Tentar de novo"): `versao`, `envelope`, `idempotencia`, `topologia` e `licenca_erp`.
- O monitor mostra `proxima_tentativa_em` (= `pausada_em` + 30 min) nas entidades pausadas por `credencial` ou `licenca_fdv` e `ultimo_codigo` no sinal.
- Log de aviso na pausa e na sondagem só com `tenant_id`, entidade (ou `todas`), motivo, código do Hub, HTTP e resultado: nunca a chave, o conector nem o corpo.
