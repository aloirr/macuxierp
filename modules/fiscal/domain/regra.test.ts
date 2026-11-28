import { describe, expect, it } from 'vitest';
import { RegraTributaria } from '../contracts';
import { regra } from './fixtures';
import { meiComCredito, selecionarRegra, type AlvoRegra } from './regra';

const alvo: AlvoRegra = { ncm: '22021000', cfop: '5102', uf_origem: 'AM', uf_destino: 'AM', tipo_cliente: 'contribuinte', crt: 3, data_emissao: '2026-06-10' };

describe('selecionarRegra', () => {
  it('RN-FIS-01: NCM exato vence prefixo maior, que vence prefixo menor, que vence todos', () => {
    const todos = regra();
    const p2 = regra({ ncm_prefixo: '22' });
    const p4 = regra({ ncm_prefixo: '2202' });
    const exato = regra({ ncm_prefixo: '22021000' });
    const sel = (rs: RegraTributaria[]) => (selecionarRegra(rs, alvo) as { ok: true; valor: RegraTributaria }).valor.id;
    expect(sel([todos, p2, p4, exato])).toBe(exato.id);
    expect(sel([todos, p2, p4])).toBe(p4.id);
    expect(sel([todos, p2])).toBe(p2.id);
    expect(sel([todos])).toBe(todos.id);
  });
  it('RN-FIS-01: NCM que não casa com o prefixo não entra', () => {
    const r = selecionarRegra([regra({ ncm_prefixo: '3004' })], alvo);
    expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA' }] });
  });
  it('RN-FIS-01: UF de destino específica vence "todas" e tipo de cliente vence "todos"', () => {
    const geral = regra({ ncm_prefixo: '2202' });
    const uf = regra({ ncm_prefixo: '2202', uf_destino: 'AM' });
    const tipo = regra({ ncm_prefixo: '2202', tipo_cliente: 'contribuinte' });
    expect(selecionarRegra([geral, uf], alvo)).toMatchObject({ ok: true, valor: { id: uf.id } });
    expect(selecionarRegra([geral, tipo], alvo)).toMatchObject({ ok: true, valor: { id: tipo.id } });
    expect(selecionarRegra([regra({ uf_destino: 'SP' })], alvo)).toMatchObject({ ok: false });
  });
  it('RN-FIS-01: empate na mesma especificidade é erro de cadastro, nunca escolha silenciosa', () => {
    const a = regra({ ncm_prefixo: '2202' });
    const b = regra({ ncm_prefixo: '2202', aliquota_icms: 120000 });
    expect(selecionarRegra([a, b], alvo)).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_EMPATE', regra_ids: [a.id, b.id] }] });
  });
  it('RN-FIS-01: sem regra para a combinação é erro', () => {
    expect(selecionarRegra([], alvo)).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA' }] });
  });
  it('RN-FIS-04: regra sem fonte não é aplicada', () => {
    const r = regra({ fonte: null });
    expect(selecionarRegra([r], alvo)).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE' }] });
    expect(selecionarRegra([regra({ fonte: { tipo: 'NT', referencia: '  ' } })], alvo)).toMatchObject({ ok: false });
  });
  it('RN-FIS-04: a regra mais específica sem fonte é erro, sem cair para a menos específica', () => {
    const geral = regra();
    const especifica = regra({ ncm_prefixo: '2202', fonte: null });
    expect(selecionarRegra([geral, especifica], alvo)).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE', regra_ids: [especifica.id] }] });
  });
  it('RN-FIS-04: regra fora da vigência não é aplicada e a vigente menos específica é usada', () => {
    const vencida = regra({ ncm_prefixo: '2202', vigencia_fim: '2026-01-31' });
    const futura = regra({ ncm_prefixo: '22021000', vigencia_inicio: '2027-01-01' });
    expect(selecionarRegra([vencida], alvo)).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-04', codigo: 'REGRA_FORA_DA_VIGENCIA' }] });
    const geral = regra();
    expect(selecionarRegra([vencida, futura, geral], alvo)).toMatchObject({ ok: true, valor: { id: geral.id } });
  });
  it('RN-FIS-04: vigência é inclusiva nos dois extremos', () => {
    const r = regra({ vigencia_inicio: '2026-06-10', vigencia_fim: '2026-06-10' });
    expect(selecionarRegra([r], alvo)).toMatchObject({ ok: true });
  });
  it('RN-FIS-02: CST em filial do Simples (CRT 1 e 4) ou CSOSN em regime normal (CRT 2 e 3) é erro', () => {
    expect(selecionarRegra([regra({ codigo: '00' })], { ...alvo, crt: 1 })).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-02', codigo: 'CODIGO_INCOMPATIVEL_CRT' }] });
    expect(selecionarRegra([regra({ codigo: '102' })], { ...alvo, crt: 3 })).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-02' }] });
    expect(selecionarRegra([regra({ codigo: '102' })], { ...alvo, crt: 2 })).toMatchObject({ ok: false });
  });
  it('RN-FIS-02: CRT 1/4 aceitam CSOSN e CRT 2/3 aceitam CST', () => {
    expect(selecionarRegra([regra({ codigo: '102' })], { ...alvo, crt: 1 })).toMatchObject({ ok: true });
    expect(selecionarRegra([regra({ codigo: '500' })], { ...alvo, crt: 4 })).toMatchObject({ ok: true });
    expect(selecionarRegra([regra({ codigo: '00' })], { ...alvo, crt: 2 })).toMatchObject({ ok: true });
    expect(selecionarRegra([regra({ codigo: '60' })], { ...alvo, crt: 3 })).toMatchObject({ ok: true });
  });
});

describe('selecionarRegra por tributo', () => {
  it('RN-FIS-01: a seleção roda separada por tributo; linha de ICMS sem cst_ipi não serve ao IPI', () => {
    const icms = regra({ cst_ipi: null });
    const ipi = regra({ tributo: 'ipi', cst_ipi: '50', aliquota_ipi: 100000 });
    expect(selecionarRegra([icms, ipi], alvo)).toMatchObject({ ok: true, valor: { id: icms.id } });
    expect(selecionarRegra([icms, ipi], { ...alvo, tributo: 'ipi' })).toMatchObject({ ok: true, valor: { id: ipi.id } });
    expect(selecionarRegra([icms], { ...alvo, tributo: 'ipi' })).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA' }] });
  });
  it('RN-FIS-01: linha única com cst_pis serve ao PIS, e o mais específico vence dentro do tributo', () => {
    const geral = regra({ cst_pis: '01' });
    const esp = regra({ tributo: 'pis', ncm_prefixo: '2202', cst_pis: '01', aliquota_pis: 16500 });
    expect(selecionarRegra([geral, esp], { ...alvo, tributo: 'pis' })).toMatchObject({ ok: true, valor: { id: esp.id } });
  });
  it('RN-FIS-01: empate dentro do tributo é erro; a compatibilidade CST/CSOSN só vale para o ICMS', () => {
    const a = regra({ tributo: 'cofins', cst_cofins: '01' });
    const b = regra({ tributo: 'cofins', cst_cofins: '01' });
    expect(selecionarRegra([a, b], { ...alvo, tributo: 'cofins' })).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_EMPATE' }] });
    expect(selecionarRegra([a], { ...alvo, tributo: 'cofins', crt: 1 })).toMatchObject({ ok: true });
  });
});

describe('contrato da regra (codigo de ICMS)', () => {
  const base = { id: '00000000-0000-4000-8000-0000000000aa', ncm_prefixo: null, uf_origem: null, uf_destino: null, tipo_cliente: null, crt: null, cfop: null, ajustar_mva: false, fonte: { tipo: 'NT', referencia: 'x' }, versao: '1', vigencia_inicio: '2024-01-01', vigencia_fim: null };
  it('RN-FIS-01: linha dedicada de IPI/PIS/COFINS dispensa o codigo de ICMS; linha de ICMS o exige', () => {
    expect(RegraTributaria.safeParse({ ...base, tributo: 'ipi', cst_ipi: '50', aliquota_ipi: 100000 }).success).toBe(true);
    expect(RegraTributaria.safeParse({ ...base, tributo: 'pis', codigo: null, cst_pis: '01' }).success).toBe(true);
    expect(RegraTributaria.safeParse({ ...base, tributo: 'icms' }).success).toBe(false);
    expect(RegraTributaria.safeParse({ ...base, codigo: '00' }).success).toBe(true);
  });
});

describe('emitente MEI (CRT 4, NT 2024.001)', () => {
  const mei = { ...alvo, crt: 4 as const };
  it('RN-FIS-02: MEI não transfere crédito de ICMS: CSOSN 101, 201 e 900 com pCredSN voltam CODIGO_INCOMPATIVEL_CRT', () => {
    for (const r of [regra({ codigo: '101', p_cred_sn: 28200 }), regra({ codigo: '201', p_cred_sn: 28200 }), regra({ codigo: '900', p_cred_sn: 28200 })])
      expect(selecionarRegra([r], mei)).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-02', codigo: 'CODIGO_INCOMPATIVEL_CRT', mensagem: expect.stringContaining('MEI não transfere crédito de ICMS') }] });
  });
  it('RN-FIS-02: MEI aceita 102, 103, 300, 400, 500, 202, 203 e o 900 sem pCredSN (com ou sem alíquota)', () => {
    for (const codigo of ['102', '103', '300', '400', '500', '202', '203']) expect(selecionarRegra([regra({ codigo })], mei)).toMatchObject({ ok: true });
    expect(selecionarRegra([regra({ codigo: '900', p_cred_sn: null })], mei)).toMatchObject({ ok: true });
    expect(selecionarRegra([regra({ codigo: '900', p_cred_sn: null, aliquota_icms: null })], mei)).toMatchObject({ ok: true });
  });
  it('RN-FIS-02: o mesmo 101 no CRT 1 continua com crédito', () => {
    expect(selecionarRegra([regra({ codigo: '101', p_cred_sn: 28200 })], { ...alvo, crt: 1 })).toMatchObject({ ok: true });
    expect(meiComCredito(1, regra({ codigo: '101' }))).toBe(false);
  });
});
