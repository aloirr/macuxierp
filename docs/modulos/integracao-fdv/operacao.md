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

## Reprocessar
Marca para o próximo ciclo delta só o registro em `falha` (erro por linha aberto) ou `pendente` (`pendente = true` ou `hash_confirmado <> hash`). O integrado nunca é tocado; não há carga completa nem inativação nova. A origem do lote vem das marcas em `registro_publicado.fonte_refs` (`MARCA_REENVIO`): `inativado_por = zerar` (gravada pela `portal_inativar_espelho`) e `reenvio = reprocessar` (gravada pelo Reprocessar). O conector grava `lote_envio.contagens.origem` (`ciclo`, `reprocessar` ou `zerar`); a divisão de lote (413) herda a origem.

## Banco do /config (pendente com o banco-dados)
O papel do portal não lê tabela do módulo. O plugin chama `integracao_fdv.portal_monitor(tenant)`, `portal_log(tenant, entidade)` e `portal_reprocessar(tenant, entidade, request_id)`, que repetem em SQL as consultas de `api/operacao.ts` (`lerInsumosMonitor`, `lerInsumosLog`, `reprocessarCadastro`) e devolvem só os insumos. A `portal_log` agrupa os erros por código e campo e não devolve `external_id`, nome nem payload. A `portal_inativar_espelho` (0053) deve gravar a marca `inativado_por = zerar`.
