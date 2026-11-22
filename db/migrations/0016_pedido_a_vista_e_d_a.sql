-- 0016 — Schema pedido: coluna a_vista com o índice parcial do crédito, CHECK do endereço no retrato do cliente e os
-- dois CHECKs da emenda D-A (T-0014). Fonte: docs/desenho/T-0013.md, seção 7 (tabela pedido) e emenda D-A; regras
-- RN-PED-02 e RN-PED-04. Aditiva e reexecutável; só toca em pedido.pedido. Motivos em docs/banco/README.md (0016).

-- Travas: falha inteira em 5 s, sem fila atrás do ALTER (padrão da 0011).
SET LOCAL lock_timeout = '5s';

-- À vista (seção 3.1 e decisão do Alexandre de 22/11, 00h30 em Manaus). Calculada pelo domain (aVista, T-0015) na
-- criação e na edição do pedido manual; não muda se a condição do cadastro mudar depois. A regra (forma tPag 01, 17 ou
-- 04 e todos os prazos iguais a 0) é do domain, não do banco: aqui fica só o valor gravado.
ALTER TABLE pedido.pedido ADD COLUMN IF NOT EXISTS a_vista boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN pedido.pedido.a_vista IS
  'Calculada pelo domain (aVista, T-0015) na criação e na edição do manual; não muda se a condição do cadastro mudar '
  'depois. A regra de à vista é do domain (T-0013 §3.1), não do banco.';

-- Compromisso de crédito por cliente (P5, RN-PED-04): soma só o pedido a prazo. Troca o índice total da 0012 pelo
-- parcial.
DROP INDEX IF EXISTS pedido.pedido_cliente_status_idx;
CREATE INDEX IF NOT EXISTS pedido_credito_idx ON pedido.pedido (tenant_id, cliente_id, status) WHERE NOT a_vista;

-- CHECKs (seção 7). O ADD valida as linhas existentes: o schema pedido ainda não tem gravação em produção (a porta e as
-- rotas são da T-0015), então não há linha fora da regra.
DO $$
BEGIN
  -- Retrato do cliente com o endereço principal (ClienteRetrato.endereco, seção 8): a nota usa o endereço retratado.
  -- coalesce: sem a chave, o jsonb_typeof dá NULL, e CHECK com NULL passaria.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_retrato_endereco_objeto') THEN
    ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_retrato_endereco_objeto
      CHECK (coalesce(jsonb_typeof(cliente_retrato -> 'endereco') = 'object', false));
  END IF;
  -- D-A: o pedido do FDV chega aprovado (recebido → aprovado no gatilho da RN-PED-02) e nunca vai a análise nem é
  -- recusado no ERP; o problema de cadastro vira rejeitado_erp antes de gravar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_analise') THEN
    ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_analise
      CHECK (origem <> 'fdv' OR status NOT IN ('em_analise', 'recusado'));
  END IF;
  -- D-A: o pedido do FDV não passa pela avaliarPedido, então não tem pendência ('[]': motivo no README, 0016).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_pendencia') THEN
    ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_pendencia
      CHECK (origem <> 'fdv' OR pendencias = '[]'::jsonb);
  END IF;
END $$;

-- Privilégio por coluna (matriz da 0012): a edição do manual recalcula a_vista (app); o worker grava no recebimento e
-- segue a mesma matriz do cabeçalho.
GRANT UPDATE (a_vista) ON pedido.pedido TO macuxierp_app, macuxierp_worker;
