import { describe, expect, it } from 'vitest';
import { precoVigente, tabelaVigente, validarLotePreco, validarVigenciaTabela } from './preco';

const F1 = '00000000-0000-4000-8000-000000000001'; // padrão
const F2 = '00000000-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const tabela = { vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', inativa: false };
const itens = [
  { filial_id: F1, produto_id: P1, preco_centavos: 1000, desconto_maximo_bp: 500 },
  { filial_id: F2, produto_id: P1, preco_centavos: 1200, desconto_maximo_bp: 0 },
];
const pedir = (o: Partial<Parameters<typeof precoVigente>[0]> = {}) =>
  precoVigente({ tabela, itens, produto_id: P1, filial_id: F2, filial_padrao_id: F1, data: '2026-06-01', ...o });

describe('preço vigente', () => {
  it('RN-CAD-06: usa o preço da filial pedida', () => {
    expect(pedir()).toMatchObject({ ok: true, item: { preco_centavos: 1200 }, origem_filial_id: F2 });
  });
  it('RN-CAD-06: tabela sem item na filial cai na filial padrão', () => {
    const r = pedir({ itens: [itens[0]!] });
    expect(r).toMatchObject({ ok: true, item: { preco_centavos: 1000 }, origem_filial_id: F1 });
  });
  it('RN-CAD-06: sem item nem na filial padrão não há preço', () => {
    expect(pedir({ itens: [] })).toEqual({ ok: false, motivo: 'sem_preco' });
  });
  it('RN-CAD-06: fora da vigência da tabela, inativa ou antes do início, não há preço', () => {
    expect(pedir({ data: '2027-01-01' })).toEqual({ ok: false, motivo: 'fora_da_vigencia' });
    expect(pedir({ data: '2025-12-31' })).toEqual({ ok: false, motivo: 'fora_da_vigencia' });
    expect(pedir({ tabela: { ...tabela, inativa: true } })).toEqual({ ok: false, motivo: 'fora_da_vigencia' });
  });
  it('RN-CAD-06: tabela sem fim de vigência vale para sempre; os limites são inclusivos', () => {
    expect(pedir({ tabela: { ...tabela, vigencia_fim: null }, data: '2099-01-01' }).ok).toBe(true);
    expect(pedir({ data: '2026-12-31' }).ok).toBe(true);
    expect(pedir({ data: '2026-01-01' }).ok).toBe(true);
  });
});

describe('lote de preços', () => {
  const item = (produto_id: string, filial_id = F1) => ({ filial_id, produto_id, preco_centavos: 1, desconto_maximo_bp: 0 });
  it('RN-CAD-06: o mesmo produto duas vezes na mesma filial é recusado', () => {
    const v = validarLotePreco([item(P1), item(P1)]);
    expect(v[0]).toMatchObject({ rn: 'RN-CAD-06', campo: 'itens.1' });
  });
  it('RN-CAD-06: o mesmo produto em filiais diferentes é aceito', () => {
    expect(validarLotePreco([item(P1, F1), item(P1, F2)])).toEqual([]);
  });
  it('RN-CAD-06: lote acima de 5.000 itens é recusado', () => {
    const muitos = Array.from({ length: 5001 }, (_, i) => item(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
    expect(validarLotePreco(muitos)[0]?.campo).toBe('itens');
    expect(validarLotePreco(muitos.slice(0, 5000))).toEqual([]);
  });
});

describe('vigência da tabela de preço', () => {
  it('RN-CAD-06: fim da vigência no mesmo dia do início ou depois passa; sem fim passa', () => {
    expect(validarVigenciaTabela('2026-01-10', '2026-01-10')).toEqual({ ok: true });
    expect(validarVigenciaTabela('2026-01-10', null)).toEqual({ ok: true });
  });
  it('RN-CAD-06: fim da vigência anterior ao início é recusado', () => {
    const r = validarVigenciaTabela('2026-01-10', '2026-01-09');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violacao).toMatchObject({ rn: 'RN-CAD-06', campo: 'vigencia_fim' });
  });
});

describe('tabela vigente', () => {
  it('RN-CAD-06: vigente só ativa e dentro das datas, com os limites inclusivos e fim aberto', () => {
    expect(tabelaVigente(tabela, '2026-06-01')).toBe(true);
    expect(tabelaVigente(tabela, '2026-01-01')).toBe(true);
    expect(tabelaVigente(tabela, '2026-12-31')).toBe(true);
    expect(tabelaVigente(tabela, '2025-12-31')).toBe(false);
    expect(tabelaVigente(tabela, '2027-01-01')).toBe(false);
    expect(tabelaVigente({ ...tabela, inativa: true }, '2026-06-01')).toBe(false);
    expect(tabelaVigente({ ...tabela, vigencia_fim: null }, '2099-01-01')).toBe(true);
  });
});
