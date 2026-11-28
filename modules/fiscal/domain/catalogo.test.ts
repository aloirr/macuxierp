import { describe, expect, it } from 'vitest';
import { regra } from './fixtures';
import { catalogoAplicavel, ehRegraSt, resolverRegra, situacaoDaRegra, validarRegraParaCadastro } from './catalogo';
import type { CatalogoRegra, RegraEntrada } from '../contracts';

const entrada = (p: Partial<RegraEntrada> = {}): RegraEntrada => {
  const { id: _id, ...r } = regra();
  return { ...r, ...p };
};
const modelo = (p: Partial<CatalogoRegra> = {}): CatalogoRegra => {
  return { ...regra(), chave: 'icms-interno-18', titulo: 'ICMS interno 18%', descricao: null, ...p };
};
const ST = { codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000 } as const;

describe('validarRegraParaCadastro', () => {
  it('RN-FIS-04: regra sem fonte, sem versão ou com vigência invertida é recusada', () => {
    expect(validarRegraParaCadastro(entrada())).toEqual([]);
    expect(validarRegraParaCadastro(entrada({ fonte: null }))).toMatchObject([{ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE', campo: 'fonte' }]);
    expect(validarRegraParaCadastro(entrada({ fonte: { tipo: 'NT', referencia: '  ' } }))[0]).toMatchObject({ codigo: 'REGRA_SEM_FONTE' });
    expect(validarRegraParaCadastro(entrada({ versao: ' ' }))[0]).toMatchObject({ codigo: 'REGRA_SEM_FONTE', campo: 'versao' });
    expect(validarRegraParaCadastro(entrada({ vigencia_inicio: '2026-05-01', vigencia_fim: '2026-04-30' }))[0]).toMatchObject({ rn: 'RN-FIS-04', campo: 'vigencia_fim' });
  });
  it('RN-FIS-02: o código do ICMS precisa servir ao CRT da regra (CST no regime normal, CSOSN no Simples)', () => {
    expect(validarRegraParaCadastro(entrada({ crt: 3, codigo: '102' }))[0]).toMatchObject({ rn: 'RN-FIS-02', codigo: 'CODIGO_INCOMPATIVEL_CRT', campo: 'codigo' });
    expect(validarRegraParaCadastro(entrada({ crt: 1, codigo: '102' }))).toEqual([]);
    expect(validarRegraParaCadastro(entrada({ crt: 1, codigo: '00' }))[0]).toMatchObject({ codigo: 'CODIGO_INCOMPATIVEL_CRT' });
    expect(validarRegraParaCadastro(entrada({ crt: null, codigo: '999' }))[0]).toMatchObject({ codigo: 'CODIGO_INCOMPATIVEL_CRT' });
  });
  it('RN-FIS-05: ST interestadual (ou de UF aberta) exige ajustar_mva decidido ou MVA ajustada; ST interna dispensa', () => {
    const interestadual = { ...ST, uf_origem: 'AM', uf_destino: 'SP' };
    expect(validarRegraParaCadastro(entrada({ ...interestadual, ajustar_mva: null }))[0]).toMatchObject({ rn: 'RN-FIS-05', codigo: 'CODIGO_NAO_SUPORTADO', campo: 'ajustar_mva' });
    expect(validarRegraParaCadastro(entrada({ ...ST, ajustar_mva: null }))[0]).toMatchObject({ campo: 'ajustar_mva' }); // UF aberta pode ser interestadual
    expect(validarRegraParaCadastro(entrada({ ...interestadual, ajustar_mva: true }))).toEqual([]);
    expect(validarRegraParaCadastro(entrada({ ...interestadual, ajustar_mva: false }))).toEqual([]);
    expect(validarRegraParaCadastro(entrada({ ...interestadual, ajustar_mva: null, mva_ajustada: 500000 }))).toEqual([]);
    expect(validarRegraParaCadastro(entrada({ ...ST, uf_origem: 'AM', uf_destino: 'AM', ajustar_mva: null }))).toEqual([]);
  });
  it('RN-FIS-05: ST por pauta, preço tabelado ou lista (modBCST diferente de 4) não é suportado', () => {
    expect(validarRegraParaCadastro(entrada({ ...ST, uf_origem: 'AM', uf_destino: 'AM', mod_bc_st: 1 }))[0]).toMatchObject({ codigo: 'CODIGO_NAO_SUPORTADO', campo: 'mod_bc_st' });
    expect(validarRegraParaCadastro(entrada({ ...ST, uf_origem: 'AM', uf_destino: 'AM', mod_bc_st: 4 }))).toEqual([]);
  });
  it('RN-FIS-01: IPI com alíquota e valor por unidade ao mesmo tempo é regra ambígua', () => {
    expect(validarRegraParaCadastro(entrada({ tributo: 'ipi', codigo: null, cst_ipi: '50', aliquota_ipi: 50000, valor_unidade_ipi: 100 }))[0]).toMatchObject({ codigo: 'REGRA_INCOMPLETA', campo: 'aliquota_ipi' });
  });
});

describe('catalogoAplicavel', () => {
  it('RN-FIS-05: o catálogo não carrega regra de ST interestadual (nem de UF aberta); ST interna e regras sem ST passam', () => {
    expect(catalogoAplicavel(modelo())).toEqual([]);
    expect(catalogoAplicavel(modelo({ ...ST, uf_origem: 'AM', uf_destino: 'AM' }))).toEqual([]);
    expect(catalogoAplicavel(modelo({ ...ST, uf_origem: 'AM', uf_destino: 'SP', ajustar_mva: true }))[0]).toMatchObject({ rn: 'RN-FIS-05', codigo: 'CODIGO_NAO_SUPORTADO', campo: 'uf_destino' });
    expect(catalogoAplicavel(modelo({ ...ST, ajustar_mva: true }))[0]).toMatchObject({ codigo: 'CODIGO_NAO_SUPORTADO' });
  });
  it('RN-FIS-04: modelo sem fonte ou com vigência invertida não é aplicável', () => {
    expect(catalogoAplicavel(modelo({ vigencia_inicio: '2026-05-01', vigencia_fim: '2026-04-30' }))[0]).toMatchObject({ campo: 'vigencia_fim' });
    expect(catalogoAplicavel(modelo({ fonte: null }))[0]).toMatchObject({ codigo: 'REGRA_SEM_FONTE' });
  });
  it('RN-FIS-05: ehRegraSt reconhece pelo código, pela alíquota interna de destino ou pela MVA', () => {
    expect(ehRegraSt(entrada({ codigo: '00' }))).toBe(false);
    expect(ehRegraSt(entrada({ codigo: '10' }))).toBe(true);
    expect(ehRegraSt(entrada({ codigo: '90', aliquota_interna_destino: 180000 }))).toBe(true);
    expect(ehRegraSt(entrada({ codigo: '00', mva_original: 100000 }))).toBe(true);
  });
});

describe('situacaoDaRegra', () => {
  it('RN-FIS-04: vigente, futura ou encerrada pela data civil do tenant', () => {
    const v = { vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31' };
    expect(situacaoDaRegra(v, '2026-06-01')).toBe('vigente');
    expect(situacaoDaRegra(v, '2025-12-31')).toBe('futura');
    expect(situacaoDaRegra(v, '2027-01-01')).toBe('encerrada');
    expect(situacaoDaRegra({ ...v, vigencia_fim: null }, '2030-01-01')).toBe('vigente');
  });
});

describe('resolverRegra', () => {
  const alvo = { ncm: '22021000', cfop: '5102', uf_origem: 'AM', uf_destino: 'SP', tipo_cliente: 'contribuinte', crt: 3, data_emissao: '2026-06-10' } as const;
  it('RN-FIS-01: devolve a regra mais específica por tributo, sem usar o catálogo; empate é erro, nunca escolha silenciosa', () => {
    const geral = regra({ codigo: '00' });
    const especifica = regra({ codigo: '20', ncm_prefixo: '2202' });
    const r = resolverRegra([geral, especifica], alvo);
    expect(r.icms).toMatchObject({ ok: true, valor: { id: especifica.id } });
    expect(r.pis).toMatchObject({ ok: true });
    expect(r.ipi).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA' }] });
    const empate = resolverRegra([regra({ ncm_prefixo: '2202' }), regra({ ncm_prefixo: '2202' })], alvo);
    expect(empate.icms).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_EMPATE' }] });
  });
});
