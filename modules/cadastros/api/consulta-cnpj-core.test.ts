import { describe, expect, it } from 'vitest';
import type { Transacao } from '@macuxierp/platform-sdk';
import { criarConsultaCnpjParaCore } from './consulta-cnpj-core';
import { CNPJ_A } from './fixtures-teste';
import { dependenciasEmMemoria } from './memoria';
import type { FonteExterna, Fontes } from './portas';

const tx: Transacao = { consultar: async () => [] };
const AGORA = new Date('2026-11-24T14:00:00Z');

const fonte = (id: FonteExterna<Record<string, unknown>>['id'], resposta: Record<string, unknown> | null | Error): FonteExterna<Record<string, unknown>> => ({
  id,
  async consultar() {
    if (resposta instanceof Error) throw resposta;
    return resposta;
  },
});
const BRASILAPI = { razao_social: 'ACME LTDA', cnae_fiscal: 4712100, municipio: 'MANAUS', uf: 'AM', email: 'a@b.com', porte: 'DEMAIS' };

function porta(fontes: Fontes) {
  const m = dependenciasEmMemoria({ fontes });
  return criarConsultaCnpjParaCore({ repositorios: m.deps.repositorios, fontes: m.deps.fontes, relogio: { agora: () => AGORA } });
}

describe('ConsultaCnpjParaCore (T-0101)', () => {
  it('RF-CAD-02: devolve a sugestão com fonte e instante, com IBGE resolvido pela tabela oficial', async () => {
    const m = dependenciasEmMemoria({ fontes: { cnpj: [fonte('brasilapi', BRASILAPI)], cep: [] } });
    m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
    const r = await criarConsultaCnpjParaCore({ repositorios: m.deps.repositorios, fontes: m.deps.fontes, relogio: { agora: () => AGORA } }).consultar(tx, 't', CNPJ_A);
    expect(r).toMatchObject({ ok: true, fonte: 'brasilapi', sugestao: { razao_social: 'ACME LTDA', email: 'a@b.com', porte: 'DEMAIS', endereco: { municipio_ibge: '1302603' } } });
  });
  it('RF-CAD-02: os dois provedores falham -> fonte_indisponivel, sem lançar', async () => {
    const r = await porta({ cnpj: [fonte('brasilapi', new Error('x')), fonte('receita-aberta', new Error('y'))], cep: [] }).consultar(tx, 't', CNPJ_A);
    expect(r).toEqual({ ok: false, motivo: 'fonte_indisponivel' });
  });
  it('RN-CAD-01: CNPJ inválido -> cnpj_invalido, sem chamar a fonte', async () => {
    let chamou = false;
    const f: FonteExterna<Record<string, unknown>> = { id: 'brasilapi', async consultar() { chamou = true; return BRASILAPI; } };
    expect(await porta({ cnpj: [f], cep: [] }).consultar(tx, 't', '11222333000180')).toEqual({ ok: false, motivo: 'cnpj_invalido' });
    expect(chamou).toBe(false);
  });
  it('RF-CAD-02: a fonte responde que não existe -> nao_encontrado', async () => {
    expect(await porta({ cnpj: [fonte('brasilapi', null)], cep: [] }).consultar(tx, 't', CNPJ_A)).toEqual({ ok: false, motivo: 'nao_encontrado' });
  });
});
