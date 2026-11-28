-- 0081 — Último administrador: trava por empresa antes de contar os administradores ativos (v0.3.31, T-0135,
-- RN-CORE-01). Aditiva e reexecutável (CREATE OR REPLACE, mesma assinatura).
-- Correção da 0078: o cabeçalho dela diz v0.3.29, mas ela entrou na v0.3.30 (aplicada; migração aplicada não se edita).
-- O porquê e o teste da corrida: docs/banco/README.md, seção "Último administrador: a trava da 0081".
--
-- A corrida: dois superadmins inativam (ou excluem, ou tiram o perfil de) os dois últimos administradores de uma
-- empresa ao mesmo tempo. Cada transação trava só o próprio usuário (usuario_alvo, FOR UPDATE) e conta os outros
-- administradores ativos: sem trava comum, as duas veem o outro ainda ativo e as duas gravam, e a empresa fica sem
-- administrador. Hoje o portal já passa pelo FOR UPDATE do tenant em empresa_alvo (0033) antes, o que serializa as
-- chamadas do /config; a garantia, porém, dependia dessa ordem e não estava na guarda. A 0081 põe a trava na própria
-- guarda (exigir_outro_admin), por empresa: pg_advisory_xact_lock (até o fim da transação), sem travar a linha do
-- tenant (nada de FOR UPDATE nela, que barraria as FKs para o tenant). A guarda passa a VOLATILE: a STABLE usa o
-- retrato do comando que a chamou, tirado antes de esperar a trava, e não veria a gravação da outra transação. Na
-- VOLATILE, em READ COMMITTED (o do portal: apps/api/src/plataforma/retentativa.ts), a contagem depois da trava vê o
-- que a primeira gravou, e a segunda recebe MXU01. Sem deadlock: depois da trava a guarda só lê.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION plataforma.exigir_outro_admin(p_tenant uuid, p_usuario uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('plataforma.ultimo_admin/' || p_tenant::text, 0));
  IF NOT plataforma.ha_outro_admin(p_tenant, p_usuario) THEN
    RAISE EXCEPTION 'último administrador ativo' USING ERRCODE = 'MXU01';
  END IF;
END $$;
COMMENT ON FUNCTION plataforma.exigir_outro_admin(uuid, uuid) IS
  'Interna (0078, trava na 0081): trava a empresa (pg_advisory_xact_lock por tenant, até o fim da transação) e dá MXU01 se não há outro administrador ativo (ha_outro_admin). VOLATILE: conta depois da trava. RN-CORE-01, T-0135.';

REVOKE ALL ON FUNCTION plataforma.exigir_outro_admin(uuid, uuid) FROM PUBLIC;
