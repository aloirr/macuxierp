/**
 * Cadastro de regras contra o PostgreSQL real (papel macuxierp_app, RLS por tenant). Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 * Exige a migração 0082 (catálogo `fiscal.regra_base`, `regra_base_id` e `ajustar_mva` sem padrão).
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegraEntrada } from '../contracts';
import { regra } from '../domain/fixtures';
import { repositorioCatalogoSql, repositorioRegrasSql } from './regras-sql';

const entrada = (p: Partial<RegraEntrada> = {}): RegraEntrada => {
  const { id: _id, ...r } = regra();
  return { ...r, ...p };
};

describe.skipIf(!PG_DISPONIVEL)('cadastro de regras fiscais (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let REF: string;
  const HOJE = '2026-11-28';

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'reg-a', ['fiscal']);
    B = await criarTenant(efemero.admin, 'reg-b', ['fiscal']);
    REF = (await efemero.admin.query('SELECT plataforma.tenant_referencia() AS id')).rows[0].id as string;
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-FIS-04: insere, lê o detalhe e a lista com situação, fonte e percentuais de 4 casas', async () => {
    const c = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(entrada({ ncm_prefixo: '2202', aliquota_icms: 185000, valor_unidade_ipi: null, vigencia_inicio: '2026-01-01' }), HOJE));
    expect(c).toMatchObject({ ncm_prefixo: '2202', aliquota_icms: 185000, situacao: 'vigente', vigencia_inicio: '2026-01-01', vigencia_fim: null, fonte: { tipo: 'convenio' } });
    expect(c.updated_at).toMatch(/\.\d{3}Z$/);
    const lido = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).obter(c.id, HOJE));
    expect(lido).toEqual(c);
    const lista = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).listar({ limite: 10, hoje: HOJE, busca: '2202' }));
    expect(lista.map((l) => l.id)).toEqual([c.id]);
  });
  it('RN-FIS-01: RLS, o outro tenant não vê nem altera a regra', async () => {
    const c = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(entrada({ ncm_prefixo: '3303', vigencia_inicio: '2026-02-01' }), HOJE));
    expect(await app.comTenant(B, (tx) => repositorioRegrasSql(tx).obter(c.id, HOJE))).toBeNull();
    expect(await app.comTenant(B, (tx) => repositorioRegrasSql(tx).listar({ limite: 10, hoje: HOJE }))).toEqual([]);
    expect(await app.comTenant(B, (tx) => repositorioRegrasSql(tx).atualizar(c.id, entrada(), c.updated_at, HOJE))).toBeNull();
  });
  it('RN-FIS-04: atualizar exige o updated_at lido (conflito se mudou) e excluir é lógico', async () => {
    const c = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(entrada({ ncm_prefixo: '4404', vigencia_inicio: '2026-03-01' }), HOJE));
    const nova = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).atualizar(c.id, entrada({ ncm_prefixo: '4404', versao: '2026.9', vigencia_inicio: '2026-03-01' }), c.updated_at, HOJE));
    expect(nova).toMatchObject({ versao: '2026.9' });
    expect(await app.comTenant(A, (tx) => repositorioRegrasSql(tx).atualizar(c.id, entrada({ ncm_prefixo: '4404', vigencia_inicio: '2026-03-01' }), c.updated_at, HOJE))).toBe('conflito');
    const excluida = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).excluir(c.id, HOJE));
    expect(excluida?.id).toBe(c.id);
    expect(await app.comTenant(A, (tx) => repositorioRegrasSql(tx).obter(c.id, HOJE))).toBeNull();
    expect(await app.comTenant(A, (tx) => repositorioRegrasSql(tx).excluir(c.id, HOJE))).toBeNull();
  });
  it('RN-FIS-01: mesmos filtros e mesmo início de vigência é 409 (cadastro repetido); situação filtra por data civil', async () => {
    await app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(entrada({ ncm_prefixo: '5505', vigencia_inicio: '2026-04-01', vigencia_fim: '2026-06-30' }), HOJE));
    await expect(app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(entrada({ ncm_prefixo: '5505', vigencia_inicio: '2026-04-01' }), HOJE))).rejects.toMatchObject({ status: 409 });
    const enc = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).listar({ limite: 50, hoje: HOJE, situacao: 'encerrada' }));
    expect(enc.map((l) => l.ncm_prefixo)).toEqual(['5505']);
    const fut = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).listar({ limite: 50, hoje: '2026-01-01', situacao: 'futura' }));
    expect(fut.length).toBeGreaterThan(0);
  });
  it('RN-FIS-05: ajustar_mva nulo grava e volta nulo (0082, sem default)', async () => {
    const c = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(entrada({ ncm_prefixo: '6606', ajustar_mva: null, vigencia_inicio: '2026-05-01' }), HOJE));
    expect(c.ajustar_mva).toBeNull();
  });

  describe('catálogo regra_base (0082)', () => {
    let baseId: string;
    const base = async (chave: string, extra = '') => {
      const r = await efemero.admin.query(
        `INSERT INTO fiscal.regra_base (tenant_id, chave, titulo, tributo, codigo, aliquota_icms, ajustar_mva, fonte_tipo, fonte_referencia, versao, vigencia_inicio ${extra ? ', ' + extra.split('|')[0] : ''})
         VALUES ($1, $2, 'ICMS interno 18%', 'icms', '00', 180000, null, 'convenio', 'Convênio ICMS 142/2018', '2026.1', '2026-01-01' ${extra ? ', ' + extra.split('|')[1] : ''}) RETURNING id`,
        [REF, chave],
      );
      return r.rows[0].id as string;
    };
    beforeAll(async () => {
      baseId = await base('icms-interno-18');
    });
    it('RN-FIS-04: todo tenant lê o catálogo e vê a vigência e a fonte', async () => {
      for (const t of [A, B]) {
        const l = await app.comTenant(t, (tx) => repositorioCatalogoSql(tx).listar({ limite: 10 }));
        expect(l).toHaveLength(1);
        expect(l[0]).toMatchObject({ id: baseId, chave: 'icms-interno-18', titulo: 'ICMS interno 18%', descricao: null, vigencia_inicio: '2026-01-01', fonte: { tipo: 'convenio' } });
      }
      expect((await app.comTenant(A, (tx) => repositorioCatalogoSql(tx).obter(baseId)))?.id).toBe(baseId);
    });
    it('RN-FIS-04: aplicar guarda regra_base_id e uma só regra viva por base no tenant (409 na segunda)', async () => {
      const modelo = (await app.comTenant(A, (tx) => repositorioCatalogoSql(tx).obter(baseId)))!;
      const { id: _i, chave: _c, titulo: _t, descricao: _d, ...campos } = modelo;
      const criada = await app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(campos, HOJE, baseId));
      const origem = await efemero.admin.query('SELECT regra_base_id FROM fiscal.regra_tributaria WHERE id = $1', [criada.id]);
      expect(origem.rows[0].regra_base_id).toBe(baseId);
      await expect(app.comTenant(A, (tx) => repositorioRegrasSql(tx).inserir(campos, HOJE, baseId))).rejects.toMatchObject({ status: 409 });
    });
    it('RN-FIS-05: o banco recusa ST interestadual no catálogo; o tenant não grava no catálogo', async () => {
      await expect(
        efemero.admin.query(
          `INSERT INTO fiscal.regra_base (tenant_id, chave, titulo, tributo, codigo, mva_original, aliquota_interna_destino, uf_origem, uf_destino, fonte_tipo, fonte_referencia, versao, vigencia_inicio)
           VALUES ($1, 'st-inter', 'ST', 'icms', '10', 400000, 180000, 'AM', 'SP', 'convenio', 'x', '1', '2026-01-01')`,
          [REF],
        ),
      ).rejects.toThrow();
      await expect(app.comTenant(A, (tx) => tx.consultar(`UPDATE fiscal.regra_base SET titulo = 'x'`))).rejects.toThrow(/permission denied/);
      expect((await efemero.admin.query('SELECT titulo FROM fiscal.regra_base WHERE id = $1', [baseId])).rows[0].titulo).toBe('ICMS interno 18%');
    });
  });
});
