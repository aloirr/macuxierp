-- 0069 — Versão do contrato do Hub por registro do espelho e índice da varredura do prazo (T-0107, v0.3.16); prazos
-- com parcelas_dias em texto voltam a pendente e as pausas credencial/licenca_fdv são retomadas (T-0112).
-- Aditiva e reexecutável. Porquê: docs/banco/README.md (0069).

SET LOCAL lock_timeout = '5s';

ALTER TABLE integracao_fdv.registro_publicado ADD COLUMN IF NOT EXISTS contrato_enviado text NOT NULL DEFAULT 'v1'
  CONSTRAINT registro_publicado_contrato_enviado_check CHECK (contrato_enviado IN ('v1', 'v2'));

COMMENT ON COLUMN integracao_fdv.registro_publicado.contrato_enviado IS
  'Versão do contrato do Hub com que o registro foi tentado e resolvido (aceito ou recusado firme). T-0107.';

-- Varredura da virada de versão (T-0107).
CREATE INDEX IF NOT EXISTS registro_publicado_varredura_prazo_idx ON integracao_fdv.registro_publicado (tenant_id, id)
  WHERE entidade = 'prazo_pagamento' AND NOT pendente AND deleted_at IS NULL AND payload IS NOT NULL;

-- T-0112: prazos com parcelas_dias em texto voltam a pendente.
UPDATE integracao_fdv.registro_publicado
   SET pendente = true, updated_at = now()
 WHERE entidade = 'prazo_pagamento'
   AND deleted_at IS NULL
   AND NOT pendente
   AND jsonb_typeof(payload -> 'parcelas_dias') = 'string';

-- T-0112: retomada única das pausas credencial/licenca_fdv (pedido do Alexandre via PO, 26/11 19h17:
-- 'não quero ter que fazer essas coisas')
UPDATE integracao_fdv.cursor_entidade
   SET pausada_motivo = NULL, pausada_em = NULL, proximo_em = now()
 WHERE pausada_motivo IN ('credencial', 'licenca_fdv') AND deleted_at IS NULL;
