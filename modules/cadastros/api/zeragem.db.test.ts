/**
 * "Zerar dados" (RN-CAD-10, T-0058) no PostgreSQL real, contra as funções do cadastros da migração 0043 (papel macuxierp_config,
 * com a sessão de superadmin): fatos -> planoZeragem -> portal_zerar. As portas de usos (pedido, faturamento) e de integração
 * ficam de fora: o "em uso" é simulado nos fatos (só o caso da filial chama core.portal_usos_filiais e
 * plataforma.portal_tirar_filiais_dos_usuarios, as funções da v3, como apoio de teste, sem importar outro módulo). Sem Postgres o teste pula (PG_DISPONIVEL, `bash db/scripts/pg-local.sh`); com Postgres e sem a 0043 ele falha.
 */
import { randomUUID } from 'node:crypto';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planoZeragem, type FatosZeragem } from '../domain';
import { CADASTROS_ZERAR_PORTAL, type CadastroZerarPortal } from '@macuxierp/platform-sdk';
import { FatosBanco, existentesDoBanco } from './zeragem';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const uuid = () => randomUUID();

describe.skipIf(!PG_DISPONIVEL)('plugin "Zerar dados" no banco (cadastros.portal_zeragem_fatos e portal_zerar)', () => {
  let efemero: BancoEfemero;
  let sessao: string;
  let T: string;
  const id = { filial: uuid(), vendedor: uuid(), cond: uuid(), tabela: uuid(), produto: uuid(), cliente: uuid(), clienteUso: uuid() };

  const q = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const n = async (tabela: string) => (await q(`SELECT count(*)::int AS n FROM cadastros.${tabela} WHERE tenant_id = $1`, [T]))[0]!.n as number;

  /** Uma transação como macuxierp_config com a sessão de superadmin (o que o `comPlataforma` faz). */
  async function comoConfig<R>(fn: (consultar: (sql: string, p?: unknown[]) => Promise<Record<string, any>[]>) => Promise<R>): Promise<R> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = await efemero.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE macuxierp_config');
      await c.query(`SET LOCAL macuxierp.sessao_superadmin = '${sessao}'`);
      const r = await fn(async (sql, p = []) => (await c.query(sql, p)).rows);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async function plano(cadastros: CadastroZerarPortal[], emUso: FatosZeragem['usos'] = {}) {
    return comoConfig(async (consultar) => {
      const [l] = await consultar('SELECT cadastros.portal_zeragem_fatos($1::uuid, $2::text[]) AS r', [T, [...CADASTROS_ZERAR_PORTAL]]);
      const existentes = existentesDoBanco(FatosBanco.parse(l!.r));
      return planoZeragem(cadastros, { existentes, usos: emUso, filiaisComNota: [], integracao: [] });
    });
  }
  const aplicar = (p: Awaited<ReturnType<typeof plano>>) =>
    comoConfig(async (consultar) => {
      const [l] = await consultar('SELECT cadastros.portal_zerar($1::uuid, $2::jsonb, $3) AS r', [T, JSON.stringify({ apagar: p.apagar, anular: p.anular, em_uso: p.emUso }), 'req-db']);
      return l!.r as { apagados: { tabela: string; quantidade: number }[]; anulados: { tabela: string; coluna: string; quantidade: number }[] };
    });

  const tirarFiliais = (ids: string[]) => comoConfig(async (consultar) => (await consultar('SELECT plataforma.portal_tirar_filiais_dos_usuarios($1::uuid, $2::uuid[]) AS n', [T, ids]))[0]!.n as number);
  const usosFiscais = (ids: string[]) =>
    comoConfig(async (consultar) => (await consultar('SELECT core.portal_usos_filiais($1::uuid, $2::uuid[]) AS r', [T, ids]))[0]!.r as { em_uso: { tabela: 'filial'; ids: string[]; motivo: 'fiscal' }[] });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    // com o banco disponível, a função da 0043 tem de existir: sem ela o teste FALHA (não passa em branco)
    const temFuncao = (await q("SELECT to_regprocedure('cadastros.portal_zerar(uuid, jsonb, text)') IS NOT NULL AS ok"))[0]!.ok;
    expect(temFuncao, 'cadastros.portal_zerar (migração 0043) ausente no banco').toBe(true);
    await q(`DO $$ BEGIN IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN GRANT macuxierp_config TO CURRENT_USER; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    T = await criarTenant(efemero.admin, 'zerar-a', ['cadastros']);
    sessao = randomUUID();
    const sa = randomUUID();
    await q(`INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'sa-zerar@plataforma.teste', 'Superadmin Ficticio', $2, false, true)`, [sa, HASH]);
    await q(`INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
      VALUES ($1, $2, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'), now() + interval '8 hours', now())`, [sessao, sa, sessao]);
    await q(`
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, external_id)
  VALUES ('${id.filial}', '${T}', '12345678000195', 'Filial', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', 'F1');
INSERT INTO cadastros.vendedor (id, tenant_id, codigo, nome, filial_id, external_id) VALUES ('${id.vendedor}', '${T}', 'V1', 'Vendedor', '${id.filial}', 'V1');
INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias) VALUES ('${id.cond}', '${T}', 'AV', 'À vista', '01', '{0}');
INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio) VALUES ('${id.tabela}', '${T}', 'Padrão', '2026-01-01');
INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao, custo_centavos, external_id)
  VALUES ('${id.produto}', '${T}', 'P1', 'Refrigerante 2 L', '22021000', 'UN', 'UN', 'padrao', 499, 'P1');
INSERT INTO cadastros.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos) VALUES ('${T}', '${id.tabela}', '${id.filial}', '${id.produto}', 1990);
INSERT INTO cadastros.estoque_saldo (tenant_id, filial_id, produto_id, quantidade) VALUES ('${T}', '${id.filial}', '${id.produto}', 100000);
INSERT INTO cadastros.estoque_movimento (tenant_id, filial_id, produto_id, tipo, quantidade, motivo) VALUES ('${T}', '${id.filial}', '${id.produto}', 'entrada', 100000, 'carga inicial');
INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id, tabela_preco_id, filial_id, vendedor_id, limite_credito_centavos)
  VALUES ('${id.cliente}', '${T}', 'PJ', '11222333000181', '9', 'Cliente', '${id.cond}', '${id.tabela}', '${id.filial}', '${id.vendedor}', 0),
         ('${id.clienteUso}', '${T}', 'PJ', '11444777000161', '9', 'Cliente com pedido', '${id.cond}', '${id.tabela}', '${id.filial}', '${id.vendedor}', 0);`);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-10: produto com item de preço e estoque é apagado; a tabela de preço e o vínculo do cliente ficam', async () => {
    const p = await plano(['produto']);
    const r = await aplicar(p);
    expect(Object.fromEntries(r.apagados.map((a) => [a.tabela, a.quantidade]))).toMatchObject({ produto: 1, tabela_preco_item: 1, estoque_saldo: 1, estoque_movimento: 1 });
    expect(r.anulados).toEqual([]);
    expect([await n('produto'), await n('tabela_preco_item'), await n('estoque_saldo'), await n('estoque_movimento')]).toEqual([0, 0, 0, 0]);
    expect(await n('tabela_preco')).toBe(1);
    expect((await q('SELECT count(*)::int AS n FROM cadastros.cliente WHERE tenant_id = $1 AND tabela_preco_id IS NOT NULL', [T]))[0]!.n).toBe(2);
  });

  it('RN-CAD-10: o segundo zerar do mesmo cadastro é vazio (idempotência)', async () => {
    const p = await plano(['produto']);
    expect(p.apagar).toEqual([]);
    const r = await aplicar(p);
    expect(r.apagados).toEqual([]);
    expect(r.anulados).toEqual([]);
  });

  it('RN-CAD-10: vendedor em uso (pedido do cliente) fica mantido (nada é apagado)', async () => {
    const p = await plano(['vendedor'], { vendedor: { pedido: [id.vendedor] } });
    expect(p.apagar).toEqual([]);
    expect(p.mantidos.length).toBeGreaterThan(0);
    const r = await aplicar(p);
    expect(r.apagados).toEqual([]);
    expect(await n('vendedor')).toBe(1);
  });

  it('RN-CAD-10: condicao_pagamento livre sai e anula condicao_pagamento_id dos clientes; o cliente fica', async () => {
    const p = await plano(['condicao_pagamento']);
    const r = await aplicar(p);
    expect(r.apagados).toEqual([{ tabela: 'condicao_pagamento', quantidade: 1 }]);
    expect(r.anulados).toEqual([{ tabela: 'cliente', coluna: 'condicao_pagamento_id', quantidade: 2 }]);
    expect(await n('cliente')).toBe(2);
  });

  it('RN-CAD-10: plano velho (registro apagado entre o plano e o efeito) dá MXC03 sumiu', async () => {
    const extra = uuid();
    await q("INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio) VALUES ($1, $2, 'Extra', '2026-01-01')", [extra, T]);
    const p = await plano(['preco']);
    expect(p.apagar.length).toBeGreaterThan(0);
    await q('DELETE FROM cadastros.tabela_preco WHERE id = $1', [extra]);
    const e = await aplicar(p).catch((x: unknown) => x as { code?: string; detail?: string; hint?: string });
    expect(e).toMatchObject({ code: 'MXC03', detail: 'sumiu' });
  });

  it('RN-CAD-10: plano velho com id em uso no apagar é recusado (MXC03 em_uso)', async () => {
    const e = await comoConfig(async (consultar) =>
      consultar('SELECT cadastros.portal_zerar($1::uuid, $2::jsonb, $3) AS r', [
        T,
        JSON.stringify({ apagar: [{ tabela: 'vendedor', ids: [id.vendedor] }], anular: [], em_uso: [{ tabela: 'vendedor', ids: [id.vendedor] }] }),
        'req-db',
      ]),
    ).catch((x: unknown) => x as { code?: string; detail?: string });
    expect(e).toMatchObject({ code: 'MXC03', detail: 'em_uso' });
  });

  it('RN-CAD-10: zerar filial apaga a filial e a tira dos usuários (os outros ids ficam, na ordem)', async () => {
    const outra = uuid();
    const u = uuid();
    await q('INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[])', [u, T, 'filial@zerar.teste', 'Usuario Ficticio', HASH, 'leitura', [outra, id.filial]]);
    // sem uso fiscal: a filial sai; o plano leva os ids para o tirarFiliais, como o plugin faz (efeito, antes do portal_zerar)
    const p = await comoConfig(async (consultar) => {
      const [l] = await consultar('SELECT cadastros.portal_zeragem_fatos($1::uuid, $2::text[]) AS r', [T, [...CADASTROS_ZERAR_PORTAL]]);
      const existentes = existentesDoBanco(FatosBanco.parse(l!.r));
      return planoZeragem(['filial'], { existentes, usos: {}, filiaisComNota: [], integracao: [] });
    });
    const filiais = p.apagar.filter((a) => a.tabela === 'filial').flatMap((a) => a.ids);
    expect(filiais).toEqual([id.filial]);
    const r = await comoConfig(async (consultar) => {
      const mudou = (await consultar('SELECT plataforma.portal_tirar_filiais_dos_usuarios($1::uuid, $2::uuid[]) AS n', [T, filiais]))[0]!.n as number;
      const [z] = await consultar('SELECT cadastros.portal_zerar($1::uuid, $2::jsonb, $3) AS r', [T, JSON.stringify({ apagar: p.apagar, anular: p.anular, em_uso: p.emUso }), 'req-filial']);
      return { mudou, z: z!.r as { apagados: { tabela: string; quantidade: number }[] } };
    });
    expect(r.mudou).toBe(1);
    expect(r.z.apagados.find((a) => a.tabela === 'filial')).toEqual({ tabela: 'filial', quantidade: 1 });
    expect(await n('filial')).toBe(0);
    expect((await q('SELECT filial_ids::text[] AS f FROM plataforma.usuario WHERE id = $1', [u]))[0]!.f).toEqual([outra]);
    expect(await tirarFiliais([id.filial])).toBe(0);
    expect((await usosFiscais([id.filial])).em_uso).toEqual([]);
  });
});
