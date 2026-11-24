import { describe, expect, it } from 'vitest';
import { ResultadoPreCadastro, type PreCadastroEntrada } from '../../contracts';
import { mascararDocumento, proximaSituacao, validarPreCadastro } from './validar';

const base = (): PreCadastroEntrada => ({
  tipo: 'PJ',
  documento: '11.222.333/0001-81',
  razao_social: 'Mercado Boa Vista Ltda',
  ie: '110042490114',
  ind_ie_dest: '1',
  endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio_ibge: '3550308', uf: 'SP', cep: '01001-000' },
});

describe('validarPreCadastro', () => {
  it('RN-INT-22: pré-cadastro válido vira cliente com documento, IE e CEP normalizados', () => {
    const r = validarPreCadastro(base());
    expect(r).toEqual({
      ok: true,
      cliente: expect.objectContaining({ documento: '11222333000181', ie: '110042490114', ind_ie_dest: '1' }),
    });
    if (r.ok) expect(r.cliente.endereco.cep).toBe('01001000');
  });

  it('RN-CAD-01: CNPJ com DV errado recusa no campo documento', () => {
    const r = validarPreCadastro({ ...base(), documento: '11.222.333/0001-82' });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'documento', codigo: 'RN-CAD-01', mensagem: 'CNPJ inválido' }] });
  });

  it('RN-CAD-01: CPF válido de PF passa e inválido recusa', () => {
    const pf = { ...base(), tipo: 'PF' as const, ie: null, ind_ie_dest: '9' as const };
    expect(validarPreCadastro({ ...pf, documento: '529.982.247-25' }).ok).toBe(true);
    const r = validarPreCadastro({ ...pf, documento: '529.982.247-26' });
    expect(r.ok === false && r.erros[0]).toMatchObject({ campo: 'documento', codigo: 'RN-CAD-01', mensagem: 'CPF inválido' });
  });

  it('RN-CAD-02: IE com DV errado para a UF recusa no campo ie', () => {
    const r = validarPreCadastro({ ...base(), ie: '110042490115' });
    expect(r.ok === false && r.erros).toEqual([expect.objectContaining({ campo: 'ie', codigo: 'RN-CAD-02' })]);
  });

  it('RN-CAD-02: sem indicador, sugere pelo IE', () => {
    const sem = { ...base(), ind_ie_dest: undefined };
    const a = validarPreCadastro({ ...sem, ie: 'ISENTO' });
    expect(a.ok && a.cliente.ind_ie_dest).toBe('2');
  });

  it('RN-CAD-02: contribuinte (1) sem IE recusa', () => {
    const r = validarPreCadastro({ ...base(), ie: null });
    expect(r.ok === false && r.erros[0]).toMatchObject({ campo: 'ie', codigo: 'RN-CAD-02' });
  });

  it('RN-CAD-03: município fora da UF recusa sem repetir o valor na mensagem', () => {
    const r = validarPreCadastro({ ...base(), endereco: { ...base().endereco, municipio_ibge: '1302603' } });
    expect(r.ok === false && r.erros[0]).toMatchObject({ campo: 'endereco.municipio_ibge', codigo: 'RN-CAD-03' });
    expect(JSON.stringify(r)).not.toContain('1302603');
  });

  it('RN-CAD-03: CEP com tamanho errado e logradouro/bairro vazios recusam, cada um no seu campo', () => {
    const r = validarPreCadastro({ ...base(), endereco: { ...base().endereco, cep: '123', logradouro: ' ', bairro: '' } });
    expect(r.ok === false && r.erros.map((e) => e.campo).sort()).toEqual(['endereco.bairro', 'endereco.cep', 'endereco.logradouro']);
  });

  it('RN-CAD-03: número vazio vira S/N, como na carga', () => {
    const r = validarPreCadastro({ ...base(), endereco: { ...base().endereco, numero: undefined } });
    expect(r.ok && r.cliente.endereco.numero).toBe('S/N');
  });

  it('RN-INT-22: razão social obrigatória e vários erros voltam juntos, sem o valor da célula (LGPD)', () => {
    const r = validarPreCadastro({ ...base(), razao_social: '  ', documento: '99.999.999/9999-99' });
    expect(r.ok === false && r.erros.map((e) => e.campo)).toEqual(['documento', 'razao_social']);
    expect(JSON.stringify(r)).not.toContain('99.999');
  });
});

describe('mascararDocumento', () => {
  it('RN-INT-22: CNPJ mostra a raiz inicial e a filial; CPF mostra só o miolo', () => {
    expect(mascararDocumento('11.222.333/0001-81')).toBe('11.***.***/0001-**');
    expect(mascararDocumento('52998224725')).toBe('***.982.***-**');
  });
  it('RN-INT-22: CNPJ alfanumérico também é mascarado e valor fora do padrão não vaza', () => {
    expect(mascararDocumento('12ABC34501DE35')).toBe('12.***.***/01DE-**');
    expect(mascararDocumento('123')).toBe('***');
  });
});

describe('proximaSituacao', () => {
  it('RN-INT-22: aguardando vínculo vai a recusado ou aceito', () => {
    expect(proximaSituacao('aguardando_vinculo', 'recusar')).toEqual({ ok: true, situacao: 'recusado' });
    expect(proximaSituacao('aguardando_vinculo', 'aceitar')).toEqual({ ok: true, situacao: 'aceito' });
  });
  it('RN-INT-22: o reenvio de um recusado volta à mesma linha como reenviado, que pode ser aceito ou recusado de novo', () => {
    expect(proximaSituacao('recusado', 'reenviar')).toEqual({ ok: true, situacao: 'reenviado' });
    expect(proximaSituacao('reenviado', 'aceitar')).toEqual({ ok: true, situacao: 'aceito' });
    expect(proximaSituacao('reenviado', 'recusar')).toEqual({ ok: true, situacao: 'recusado' });
  });
  it('RN-INT-22: transição inválida é erro (aceito é final; recusado só reenvia)', () => {
    for (const e of ['recusar', 'aceitar', 'reenviar'] as const) {
      expect(proximaSituacao('aceito', e).ok).toBe(false);
    }
    expect(proximaSituacao('recusado', 'aceitar')).toMatchObject({ ok: false, violacao: { rn: 'RN-INT-22' } });
    expect(proximaSituacao('aguardando_vinculo', 'reenviar').ok).toBe(false);
  });
});

describe('contrato do pré-cadastro (RN-INT-22)', () => {
  it('RN-INT-22: o retorno de validarPreCadastro, sem o cliente, passa no ResultadoPreCadastro (ok e erros)', () => {
    const ok = validarPreCadastro(base());
    expect(ok.ok).toBe(true);
    expect(ResultadoPreCadastro.safeParse({ ok: ok.ok }).success).toBe(true);
    const ruim = validarPreCadastro({ ...base(), documento: '123' });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ResultadoPreCadastro.safeParse({ ok: ruim.ok, erros: ruim.erros }).success).toBe(true);
  });
});
