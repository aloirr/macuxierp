/**
 * Consulta de cadastros para o fiscal (T-0021) com o adaptador em memória: emitente (UF, CRT, regime PIS/COFINS,
 * industrial IPI) e produtos fabricados. O mesmo cenário roda no PostgreSQL em `consulta-fiscal.db.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarConsultaParaFiscal } from './consulta-fiscal';
import { CNPJ_B, filialValida, produtoValido } from './fixtures-teste';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';

describe('consulta de cadastros para o fiscal (memória)', () => {
  const m = dependenciasEmMemoria();
  const consulta = criarConsultaParaFiscal(m.deps.repositorios);
  const tx = { consultar: async () => [] };
  const adm = sessaoDe('administrador');
  const ids: Record<string, string> = {};
  let a: ReturnType<typeof criarAmbiente>;

  beforeAll(async () => {
    m.repos.oficiais.municipios.set('1302603', 'Manaus');
    m.repos.oficiais.ncms.add('22021000');
    a = criarAmbiente(criarPluginCadastros(m.deps));
    const post = async (rota: string, corpo: unknown) => {
      const r = await a.chamar('POST', rota, { sessao: adm, corpo });
      expect(r.status, JSON.stringify(r.corpo)).toBe(201);
      return (r.corpo as { id: string }).id;
    };
    ids.simples = await post('/filiais', filialValida());
    ids.normal = await post('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false, crt: '3', regime_pis_cofins: 'nao_cumulativo', industrial_ipi: true }));
    ids.fabricado = await post('/produtos', produtoValido({ producao_propria: true }));
    ids.revendido = await post('/produtos', produtoValido({ codigo: 'P002' }));
  });

  it('RN-FIS-02: emitente do CRT 3 leva UF, CRT, regime PIS/COFINS e industrial IPI', async () => {
    expect(await consulta.emitente(tx, ids.normal as string)).toEqual({ uf: 'AM', crt: 3, regime_pis_cofins: 'nao_cumulativo', industrial_ipi: true });
  });
  it('RN-FIS-02: emitente do Simples não leva regime_pis_cofins; industrial_ipi padrão false; filial inexistente dá null', async () => {
    const e = await consulta.emitente(tx, ids.simples as string);
    expect(e).toEqual({ uf: 'AM', crt: 1, industrial_ipi: false });
    expect(Object.keys(e as object)).not.toContain('regime_pis_cofins');
    expect(await consulta.emitente(tx, randomUUID())).toBeNull();
  });
  it('RN-FIS-02: regime_pis_cofins informado fora do CRT 3 é recusado pela API (422)', async () => {
    const r = await a.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: '44555666000181', padrao: false, emissora: false, crt: '1', regime_pis_cofins: 'cumulativo' }) });
    expect(r.status).toBe(422);
  });
  it('producaoPropria: só os fabricados; produto inexistente e lista vazia dão conjunto sem eles', async () => {
    expect(await consulta.producaoPropria(tx, [ids.fabricado as string, ids.revendido as string, randomUUID()])).toEqual(new Set([ids.fabricado]));
    expect((await consulta.producaoPropria(tx, [])).size).toBe(0);
  });
});
