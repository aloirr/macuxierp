import { describe, expect, it } from 'vitest';
import type { Transacao } from '@macuxierp/platform-sdk';
import { criarConsultaCnpjParaCore } from './consulta-cnpj-core';
import { BRASILAPI_CNPJ, CNPJ_A, fonte } from './fixtures-teste';
import { dependenciasEmMemoria } from './memoria';
import type { FonteExterna, Fontes } from './portas';

const tx: Transacao = { consultar: async () => [] };
const AGORA = new Date('2026-11-24T14:00:00Z');

function porta(fontes: Fontes) {
  const m = dependenciasEmMemoria({ fontes });
  return criarConsultaCnpjParaCore({ repositorios: m.deps.repositorios, fontes: m.deps.fontes, relogio: { agora: () => AGORA } });
}

describe('ConsultaCnpjParaCore (T-0101)', () => {
  it('RF-CAD-02: devolve a sugestão com fonte e instante', async () => {
    const r = await porta({ cnpj: [fonte('brasilapi', BRASILAPI_CNPJ)], cep: [] }).consultar(tx, 't', CNPJ_A);
    expect(r).toMatchObject({ ok: true, fonte: 'brasilapi', consultado_em: AGORA.toISOString(), sugestao: { razao_social: 'ACME COMERCIO LTDA' } });
  });
  it('RF-CAD-02: os dois provedores falham -> fonte_indisponivel, sem lançar', async () => {
    const r = await porta({ cnpj: [fonte('brasilapi', new Error('x')), fonte('receita-aberta', new Error('y'))], cep: [] }).consultar(tx, 't', CNPJ_A);
    expect(r).toEqual({ ok: false, motivo: 'fonte_indisponivel' });
  });
  it('RN-CAD-01: CNPJ inválido -> cnpj_invalido, sem chamar a fonte', async () => {
    let chamou = false;
    const f: FonteExterna<Record<string, unknown>> = { id: 'brasilapi', async consultar() { chamou = true; return BRASILAPI_CNPJ; } };
    expect(await porta({ cnpj: [f], cep: [] }).consultar(tx, 't', '11222333000180')).toEqual({ ok: false, motivo: 'cnpj_invalido' });
    expect(chamou).toBe(false);
  });
  it('RF-CAD-02: a fonte responde que não existe -> nao_encontrado', async () => {
    expect(await porta({ cnpj: [fonte('brasilapi', null)], cep: [] }).consultar(tx, 't', CNPJ_A)).toEqual({ ok: false, motivo: 'nao_encontrado' });
  });
  it('erro que não é da fonte (ex.: banco) sobe, sem virar fonte_indisponivel', async () => {
    const m = dependenciasEmMemoria({ fontes: { cnpj: [fonte('brasilapi', BRASILAPI_CNPJ)], cep: [] } });
    const repos = m.deps.repositorios(tx);
    const quebrado = { ...repos, consultaExterna: { ...repos.consultaExterna, obter: async () => { throw new Error('current transaction is aborted'); } } };
    const p = criarConsultaCnpjParaCore({ repositorios: () => quebrado, fontes: m.deps.fontes, relogio: { agora: () => AGORA } });
    await expect(p.consultar(tx, 't', CNPJ_A)).rejects.toThrow('aborted');
  });
});
