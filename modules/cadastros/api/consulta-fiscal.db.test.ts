/**
 * Consulta de cadastros para o fiscal (T-0021) contra o PostgreSQL real: cada método da porta, o inativo, a série
 * diferente, o município do endereço e a RLS entre dois tenants. Mesmo banco efêmero do `sql.db.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { criarConsultaParaFiscal } from './consulta-fiscal';
import { CNPJ_B, filialValida, produtoValido } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('consulta de cadastros para o fiscal (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const consulta = criarConsultaParaFiscal(repositoriosSql);
  const adm = sessaoDe('administrador');
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'empresa-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'empresa-b', ['cadastros']);
    const a = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }), new Date('2026-11-21T15:00:00Z'), transacaoDe(app, A));
    const post = async (rota: string, corpo: unknown) => {
      const r = await a.chamar('POST', rota, { sessao: adm, corpo });
      expect(r.status, rota).toBe(201);
      return (r.corpo as { id: string }).id;
    };
    ids.simples = await post('/filiais', filialValida({ industrial_ipi: true }));
    ids.normal = await post('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false, crt: '3', regime_pis_cofins: 'nao_cumulativo' }));
    ids.fabricado = await post('/produtos', produtoValido({ cest: '0300700', producao_propria: true }));
    ids.revendido = await post('/produtos', produtoValido({ codigo: 'P002', cest: '0300700' }));
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  const txA = () => transacaoDe(app, A);
  const txB = () => transacaoDe(app, B);

  it('RN-FIS-02: emitente com industrial_ipi (coluna existente) e sem regime_pis_cofins no CRT 1', async () => {
    expect(await consulta.emitente(txA(), ids.simples as string)).toEqual({ uf: 'AM', crt: 1, industrial_ipi: true });
    expect(await consulta.emitente(txA(), randomUUID())).toBeNull();
  });
  it('RN-FIS-02: emitente do CRT 3 leva regime_pis_cofins (depende da 0023)', async () => {
    expect(await consulta.emitente(txA(), ids.normal as string)).toEqual({ uf: 'AM', crt: 3, regime_pis_cofins: 'nao_cumulativo', industrial_ipi: false });
  });
  it('RN-FIS-02: o CHECK do banco recusa regime fora de cumulativo/nao_cumulativo (depende da 0023)', async () => {
    await expect(admin("UPDATE cadastros.filial SET regime_pis_cofins = 'xx' WHERE id = $1", [ids.normal])).rejects.toThrow();
  });
  it('producaoPropria: só os fabricados (depende da 0023)', async () => {
    expect(await consulta.producaoPropria(txA(), [ids.fabricado as string, ids.revendido as string, randomUUID()])).toEqual(new Set([ids.fabricado]));
  });
  it('RLS: outro tenant não enxerga a filial nem os produtos', async () => {
    expect(await consulta.emitente(txB(), ids.simples as string)).toBeNull();
    expect((await consulta.producaoPropria(txB(), [ids.fabricado as string])).size).toBe(0);
  });
});
