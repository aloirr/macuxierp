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
