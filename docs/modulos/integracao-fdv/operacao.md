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

## Virada de versão de contrato do Hub (T-0107, passo manual)
Ligar uma versão nova de contrato (por exemplo, `PRAZO_CONTRATO_V2_LIGADO`) **não marca nada como pendente**: o hash do payload não muda, então o worker não vê diferença e não reenvia. Na virada, o reenvio é manual:
1. **Deploy** da versão com a flag ligada.
2. **Reenviar o cadastro afetado**, por uma destas duas vias:
   - /config → empresa → aba **Integração** → botão **Ações** da linha do cadastro → **Reprocessar** (sem confirmação; reenvia falhas e pendentes); ou
   - /config → empresa → aba **Dados** → **Ações** da linha → **Carga completa** (reenvia tudo, com confirmação).
3. **Conferir a chegada** no monitor da aba Integração (ou no monitor do BKO): os **pendentes caem a zero** e a última carga mostra a data e hora novas. Falha por linha: **Log** da mesma linha.
4. **Limite:** reverter a flag **não reenvia** na versão antiga; se precisar voltar, repita o passo 2 depois do deploy da reversão.
5. **Próximo passo:** o reenvio automático (coluna `contrato_enviado`, desenho aprovado pelo engenheiro-software) entra na v0.3.16 e torna este passo desnecessário.
