/**
 * v0.3.29, migração 0078 (RN-CORE-01, RN-CORE-17): usuários da empresa no /config. E-mail único só entre os não
 * excluídos; listar (e-mail mascarado), criar, editar, redefinir a senha, inativar, reativar e excluir; MXU01 no
 * último administrador ativo. Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const SQL_0078 = readFileSync(
  fileURLToPath(new URL('../migrations/0078_plataforma_usuarios_config.sql', import.meta.url)),
  'utf8',
);
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const HASH_NOVO = '$argon2id$v=19$m=65536,t=3,p=4$bm92b3NhbHQ$bm92b2hhc2g';
const SA = '5a000000-0000-4000-8000-000000000078';
const PORTAL = [
  'plataforma.empresa_usuarios_listar(uuid)',
  'plataforma.empresa_usuario_criar(uuid, text, text, text, text, uuid[], text)',
  'plataforma.empresa_usuario_editar(uuid, uuid, jsonb, text)',
  'plataforma.empresa_usuario_redefinir_senha(uuid, uuid, text, text)',
  'plataforma.empresa_usuario_inativar(uuid, uuid, text)',
  'plataforma.empresa_usuario_reativar(uuid, uuid, text)',
  'plataforma.empresa_usuario_excluir(uuid, uuid, text)',
];
const INTERNAS = [
  'plataforma.usuario_situacao(plataforma.usuario)',
  'plataforma.usuario_alvo(uuid, uuid)',
  'plataforma.ha_outro_admin(uuid, uuid)',
  'plataforma.exigir_outro_admin(uuid, uuid)',
  'plataforma.revogar_sessoes_usuario(uuid, uuid)',
  'plataforma.usuario_json(plataforma.usuario)',
  'plataforma.auditoria_repetida(uuid, text, text, uuid)',
  'plataforma.usuario_mudar_situacao(uuid, uuid, text, text)',
];

/** A: a empresa dos testes (admin da fixture + os criados aqui); B: outra empresa, para o isolamento. */
const A = novoTenant('usu-0078-a');
const B = novoTenant('usu-0078-b');

interface Item {
  id: string;
  nome: string;
  email_mascarado: string;
  perfil: string;
  situacao: string;
  ultimo_admin_ativo: boolean;
  deve_trocar_senha: boolean;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — usuários da empresa no /config (v0.3.29, 0078, RN-CORE-17)',
  () => {
    let banco: BancoDeTeste;
    let s: string;

    const req = (r: string | null): string => (r === null ? 'NULL' : `'${r}'`);
    const comoConfig = (sql: string, sessao: string | null = s): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
    const json = <T>(sql: string): T => JSON.parse(comoConfig(sql)[0] ?? 'null') as T;
    const recusa = (sql: string, codigo: string, padrao: RegExp, sessao: string | null = s): void =>
      recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });
    const listar = (t = A.id): Item[] => json<Item[]>(`SELECT plataforma.empresa_usuarios_listar('${t}');`);
    const criarSql = (email: string, perfil: string, r: string | null, t = A.id): string =>
      `SELECT plataforma.empresa_usuario_criar('${t}', '${email}', 'Pessoa Ficticia', '${perfil}', '${HASH}', '{}', ${req(r)});`;
    const criar = (email: string, perfil: string, r: string | null = null): Item =>
      json<Item>(criarSql(email, perfil, r));
    const editarSql = (usuario: string, patch: string): string =>
      `SELECT plataforma.empresa_usuario_editar('${A.id}', '${usuario}', '${patch}', NULL);`;
    const acao = (nome: string, usuario: string, r: string | null = null, t = A.id): string =>
      `SELECT plataforma.empresa_usuario_${nome}('${t}', '${usuario}', ${req(r)});`;
    const auditoria = (filtro = 'true'): Record<string, unknown>[] =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT acao, entidade_id, request_id, depois FROM plataforma.auditoria
        WHERE acao LIKE 'plataforma.usuario.%' AND ${filtro} ORDER BY ocorrido_em, id`,
      );
    const linha = (id: string): Record<string, unknown> =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT ativo, deleted_at IS NOT NULL AS excluido, deve_trocar_senha, falhas_login, bloqueado_ate IS NULL AS sem_trava,
         (SELECT count(*)::int FROM plataforma.sessao x WHERE x.usuario_id = u.id AND x.revogada_em IS NULL) AS sessoes
       FROM plataforma.usuario u WHERE id = '${id}'`,
      )[0] ?? {};

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      s = randomUUID();
      executar(
        banco.conexao,
        `${fixturePlataforma(A)}${fixturePlataforma(B)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0078@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${s}', '${SA}', encode(sha256(convert_to('${s}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
    });

    afterAll(() => banco?.remover());

    it('privilégios: as do portal só do config; as internas sem EXECUTE; todas definer com search_path fixo e comentadas', () => {
      for (const f of [...PORTAL, ...INTERNAS]) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
           has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
        );
        expect({ f, ...r }).toEqual({
          f,
          definer: true,
          cfg: 'search_path=pg_catalog, pg_temp',
          comentado: true,
          publico: false,
          app: false,
          config: PORTAL.includes(f),
        });
      }
    });

    it('sessão inválida = MXS01; empresa inexistente = P0002', () => {
      recusa(`SELECT plataforma.empresa_usuarios_listar('${A.id}');`, 'MXS01', /inválida/, null);
      recusa(`SELECT plataforma.empresa_usuarios_listar('${randomUUID()}');`, 'P0002', /não encontrada/);
    });

    it('listar e criar: e-mail só mascarado, senha provisória, idempotente; e-mail repetido = 23505 email_em_uso', () => {
      expect(listar()).toEqual([
        expect.objectContaining({
          id: A.usuario,
          email_mascarado: 'ad****@usu-0078-a.teste',
          situacao: 'ativo',
          ultimo_admin_ativo: true,
        }),
      ]);
      const c = criar('Faturista.Ficticia@Empresa.Teste ', 'faturista', 'req-criar-1');
      expect(c).toMatchObject({
        perfil: 'faturista',
        situacao: 'ativo',
        deve_trocar_senha: true,
        ultimo_admin_ativo: false,
      });
      expect(criar('faturista.ficticia@empresa.teste', 'faturista', 'req-criar-1')).toEqual(c);
      recusa(criarSql('FATURISTA.ficticia@empresa.teste', 'gerente', 'req-criar-2'), '23505', /email_em_uso/);
      // O mesmo e-mail em outra empresa pode.
      expect(json<Item>(criarSql('faturista.ficticia@empresa.teste', 'gerente', null, B.id))).toMatchObject({
        perfil: 'gerente',
      });
      recusa(criarSql('x@empresa.teste', 'dono', null), '23514', /usuario_perfil_check/);
      expect(listar().map((u) => u.id)).toContain(c.id);
      expect(listar().some((u) => JSON.stringify(u).includes('faturista.ficticia'))).toBe(false);
      expect(auditoria(`request_id = 'req-criar-1'`)).toHaveLength(1);
    });

    it('MXU01: o último administrador ativo não é inativado, excluído nem rebaixado; com outro admin, pode', () => {
      recusa(acao('inativar', A.usuario), 'MXU01', /último administrador/);
      recusa(acao('excluir', A.usuario), 'MXU01', /último administrador/);
      recusa(editarSql(A.usuario, '{"perfil": "gerente"}'), 'MXU01', /último administrador/);
      // Um admin inativo não conta como o outro.
      const inativo = criar('admin.dois@empresa.teste', 'administrador');
      expect(json<Item>(acao('inativar', inativo.id))).toMatchObject({ situacao: 'inativo' });
      recusa(acao('inativar', A.usuario), 'MXU01', /último administrador/);
      expect(json<Item>(acao('reativar', inativo.id))).toMatchObject({
        situacao: 'ativo',
        ultimo_admin_ativo: false,
      });
      expect(json<Item>(acao('inativar', A.usuario))).toMatchObject({ situacao: 'inativo' });
      expect(listar().find((u) => u.id === inativo.id)).toMatchObject({ ultimo_admin_ativo: true });
      expect(json<Item>(acao('reativar', A.usuario))).toMatchObject({ situacao: 'ativo' });
      expect(linha(A.usuario)).toMatchObject({ ativo: true, sessoes: 0 });
    });

    it('inativar segue na lista e reserva o e-mail; excluir some, libera o e-mail e é idempotente; sessões revogadas', () => {
      const u = criar('vendedor.ficticio@empresa.teste', 'vendedor');
      executar(
        banco.conexao,
        `INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em)
         VALUES ('${A.id}', '${u.id}', gen_random_uuid(), repeat('d', 64), now() + interval '1 day');`,
      );
      expect(json<Item>(acao('inativar', u.id, 'req-inat'))).toMatchObject({ situacao: 'inativo' });
      expect(linha(u.id)).toMatchObject({ ativo: false, excluido: false, sessoes: 0 });
      expect(listar().find((x) => x.id === u.id)).toMatchObject({ situacao: 'inativo' });
      recusa(criarSql('vendedor.ficticio@empresa.teste', 'vendedor', null), '23505', /email_em_uso/);
      // Inativar de novo não muda nada nem audita.
      const antes = auditoria(`entidade_id = '${u.id}'`).length;
      json<Item>(acao('inativar', u.id, 'req-inat-2'));
      expect(auditoria(`entidade_id = '${u.id}'`)).toHaveLength(antes);
      expect(json<Record<string, unknown>>(acao('excluir', u.id, 'req-exc'))).toMatchObject({
        situacao: 'excluido',
      });
      expect(json<Record<string, unknown>>(acao('excluir', u.id, 'req-exc'))).toEqual({
        id: u.id,
        situacao: 'excluido',
      });
      recusa(acao('excluir', u.id, 'req-exc-outro'), 'P0002', /usuário não encontrado/);
      // O mesmo request_id em outro usuário exclui de fato.
      const w = criar('outro.vendedor@empresa.teste', 'vendedor');
      json<Record<string, unknown>>(acao('excluir', w.id, 'req-exc'));
      expect(linha(w.id)).toMatchObject({ excluido: true });
      recusa(acao('reativar', u.id), 'P0002', /usuário não encontrado/);
      expect(linha(u.id)).toMatchObject({ ativo: false, excluido: true });
      expect(listar().some((x) => x.id === u.id)).toBe(false);
      const novo = criar('vendedor.ficticio@empresa.teste', 'vendedor');
      expect(novo.id).not.toBe(u.id);
      // Usuário de outra empresa: P0002 (sem vazar entre tenants).
      recusa(acao('inativar', B.usuario), 'P0002', /usuário não encontrado/);
    });

    it('editar e redefinir a senha: só campos da lista, sem mudança não audita, senha provisória e sessões revogadas', () => {
      const u = criar('fiscal.ficticio@empresa.teste', 'fiscal');
      recusa(editarSql(u.id, '{"email": "x@y.teste"}'), '23514', /campo fora da lista: email/);
      recusa(editarSql(u.id, '{"nome": null}'), '23514', /campo obrigatório: nome/);
      recusa(editarSql(u.id, '{"perfil": null}'), '23514', /campo obrigatório: perfil/);
      recusa(
        `SELECT plataforma.empresa_usuario_criar('${A.id}', 'sem.nome@empresa.teste', '  ', 'fiscal', '${HASH}', '{}', NULL);`,
        '23514',
        /campo obrigatório: nome/,
      );
      const antes = auditoria(`entidade_id = '${u.id}'`).length;
      json<Item>(editarSql(u.id, '{"perfil": "fiscal"}'));
      expect(auditoria(`entidade_id = '${u.id}'`)).toHaveLength(antes);
      const e = json<Item>(editarSql(u.id, '{"nome": "Nome Novo Ficticio", "perfil": "gerente"}'));
      expect(e).toMatchObject({ nome: 'Nome Novo Ficticio', perfil: 'gerente' });
      expect(auditoria(`entidade_id = '${u.id}' AND acao = 'plataforma.usuario.editar'`)[0]).toMatchObject({
        depois: { campos: ['nome', 'perfil'] },
      });
      executar(
        banco.conexao,
        `UPDATE plataforma.usuario SET falhas_login = 5, bloqueado_ate = now() + interval '10 minutes', deve_trocar_senha = false WHERE id = '${u.id}';`,
      );
      expect(listar().find((x) => x.id === u.id)).toMatchObject({ situacao: 'bloqueado' });
      const senhaSql = `SELECT plataforma.empresa_usuario_redefinir_senha('${A.id}', '${u.id}', '${HASH_NOVO}', 'req-senha');`;
      const r = json<Item>(senhaSql);
      expect(r).toMatchObject({ situacao: 'ativo', deve_trocar_senha: true });
      expect(linha(u.id)).toMatchObject({ falhas_login: 0, sem_trava: true });
      json<Item>(senhaSql);
      // O mesmo request_id em outro usuário não é repetição: a ação acontece.
      json<Item>(
        `SELECT plataforma.empresa_usuario_redefinir_senha('${A.id}', '${A.usuario}', '${HASH_NOVO}', 'req-senha');`,
      );
      expect(linha(A.usuario)).toMatchObject({ deve_trocar_senha: true });
      expect(auditoria(`request_id = 'req-senha' AND entidade_id = '${u.id}'`)).toHaveLength(1);
    });

    it('auditoria sem e-mail, nome nem hash (LGPD)', () => {
      const tudo = JSON.stringify(auditoria());
      for (const valor of ['ficticia', 'Ficticia', 'ficticio', 'Ficticio', '@empresa.teste', '$argon2id'])
        expect(tudo).not.toContain(valor);
    });

    it('inativo antigo do BKO volta como inativo na primeira execução; reexecutar não traz excluído de volta', () => {
      const antigo = randomUUID();
      // Simula o banco antes da 0078 numa transação desfeita: o UNIQUE da 0002 de volta e um inativo do jeito antigo
      // (ativo = false com deleted_at).
      const saida = linhas(
        rodarScript(
          banco.conexao,
          `BEGIN;
UPDATE plataforma.usuario SET email = id::text || '@dup.teste' WHERE deleted_at IS NOT NULL;
ALTER TABLE plataforma.usuario ADD CONSTRAINT usuario_tenant_id_email_key UNIQUE (tenant_id, email);
INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, ativo, deleted_at)
  VALUES ('${antigo}', '${A.id}', 'inativo.antigo@empresa.teste', 'Inativo Antigo', '${HASH}', 'vendedor', false,
    '2026-11-01T00:00:00Z');
${SQL_0078}
SELECT 'r:' || (deleted_at IS NULL AND NOT ativo)::text FROM plataforma.usuario WHERE id = '${antigo}';
SELECT 'u:' || count(*)::text FROM pg_constraint WHERE conrelid = 'plataforma.usuario'::regclass AND contype = 'u';
ROLLBACK;`,
        ),
      );
      expect(saida).toEqual(expect.arrayContaining(['r:true', 'u:0']));
      // Fora da simulação: um excluído pelas funções novas continua excluído quando a 0078 roda de novo.
      const x = criar('excluido.de.verdade@empresa.teste', 'vendedor');
      json<Record<string, unknown>>(acao('excluir', x.id));
      rodarScript(banco.conexao, SQL_0078, { transacao: true });
      expect(linha(x.id)).toMatchObject({ ativo: false, excluido: true });
    });

    it('a 0078 reexecuta sem erro, com o índice parcial e sem o UNIQUE antigo', () => {
      rodarScript(banco.conexao, SQL_0078, { transacao: true });
      rodarScript(banco.conexao, SQL_0078, { transacao: true });
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'plataforma.usuario'::regclass AND contype = 'u') AS unicos,
         (SELECT indexdef FROM pg_indexes WHERE schemaname = 'plataforma' AND indexname = 'usuario_email_vivo_uq') AS indice`,
      );
      expect(r?.unicos).toBe(0);
      expect(r?.indice).toMatch(/UNIQUE INDEX .* \(tenant_id, email\) WHERE \(deleted_at IS NULL\)/);
    });
  },
);
