-- 0069 — Versão do contrato do Hub por registro do espelho e índice da varredura do prazo (T-0107, v0.3.16); prazos
-- com parcelas_dias em texto voltam a pendente (T-0112). Aditiva e reexecutável. Porquê: docs/banco/README.md (0069).

SET LOCAL lock_timeout = '5s';

-- Default constante: as linhas que já existem leem 'v1' sem reescrita da tabela (o CHECK só lê cada linha).
ALTER TABLE integracao_fdv.registro_publicado ADD COLUMN IF NOT EXISTS contrato_enviado text NOT NULL DEFAULT 'v1'
  CONSTRAINT registro_publicado_contrato_enviado_check CHECK (contrato_enviado IN ('v1', 'v2'));

COMMENT ON COLUMN integracao_fdv.registro_publicado.contrato_enviado IS
  'Versão do contrato do Hub com que o registro foi tentado e resolvido (aceito ou recusado firme). T-0107.';

-- Varredura da virada de versão (só prazo_pagamento tem v2): por tenant, em ordem de id, com FOR UPDATE SKIP LOCKED.
-- Inclui os inativos (o delta também envia ativo:false). Sem CONCURRENTLY: o migrador roda o arquivo numa transação.
CREATE INDEX IF NOT EXISTS registro_publicado_varredura_prazo_idx ON integracao_fdv.registro_publicado (tenant_id, id)
  WHERE entidade = 'prazo_pagamento' AND NOT pendente AND deleted_at IS NULL AND payload IS NOT NULL;

-- T-0112: o espelho de antes da T-0085 guardava parcelas_dias como texto ("28/56"), que o Hub recusa. Todos os
-- tenants (a migração roda como dona da tabela, que não tem FORCE RLS); o hash não muda. O gatilho tocar_updated_at
-- ajusta o updated_at. O payload anulado (NULL) fica de fora pelo jsonb_typeof.
UPDATE integracao_fdv.registro_publicado
   SET pendente = true, updated_at = now()
 WHERE entidade = 'prazo_pagamento'
   AND deleted_at IS NULL
   AND NOT pendente
   AND jsonb_typeof(payload -> 'parcelas_dias') = 'string';
