import { describe, expect, it } from 'vitest';
import { PAGINAS } from './paginas';
import {
  adicionarParcela, agruparPrazosPorForma, formularioDoPrazo, formularioPrazoVazio, maxParcelasDaForma, montarPrazo, prazoMedioDoCliente, prazoMedioNaLista, removerParcela, rotulosDasParcelas, trocarForma,
} from './prazos';

const p = (codigo: string, forma_tpag: string, prazos_dias: number[], prazo_medio_dias: number | null) => ({ codigo, descricao: `D ${codigo}`, forma_tpag, prazos_dias, prazo_medio_dias });

describe('lista dos prazos (RN-CAD-15)', () => {
  it('RN-CAD-15: agrupa por forma, mostra descrição, dias e prazo médio, e marca o legado sem prazo médio como Incompleto', () => {
    const g = agruparPrazosPorForma([p('B60', '15', [30, 60], 45), p('AV', '01', [0], 0), p('B30', '15', [30], 30), p('LEG', '15', [15], null), p('CC', '03', [30, 60, 90], 60)]);
    expect(g.map((x) => x.forma)).toEqual(['Dinheiro', 'Cartão de crédito', 'Boleto']);
    const boleto = g[2]!.prazos;
    expect(boleto.map((x) => [x.codigo, x.dias, x.prazo_medio])).toEqual([['B30', '30', '30'], ['B60', '30/60', '45'], ['LEG', '15', 'Incompleto']]);
    expect(prazoMedioNaLista(null)).toBe('Incompleto');
    expect(prazoMedioNaLista(0)).toBe('0');
  });
  it('RN-CAD-15: a página das condições mostra descrição, dias e prazo médio; o cliente mostra o prazo médio', () => {
    const cond = PAGINAS.find((x) => x.id === 'condicoes-pagamento')!;
    expect(cond.colunas.map((c) => c.chave)).toEqual(expect.arrayContaining(['descricao', 'prazos_dias', 'prazo_medio_dias']));
    expect(cond.agruparPor).toBe('forma_tpag');
    expect(PAGINAS.find((x) => x.id === 'clientes')!.colunas.map((c) => c.chave)).toContain('prazo_medio_dias');
  });
});

describe('formulário do prazo (RN-CAD-15)', () => {
  it('RN-CAD-15: "+ Parcela" e remover respeitam o mínimo de 1 e o máximo da forma (à vista 1, cartão 12, boleto 36)', () => {
    let f = { ...formularioPrazoVazio(), forma_tpag: '15' };
    expect(rotulosDasParcelas(f.parcelas.length)).toEqual(['Parcela 1']);
    f = adicionarParcela(adicionarParcela(f));
    expect(f.parcelas).toHaveLength(3);
    expect(removerParcela(f, 1).parcelas).toHaveLength(2);
    expect(removerParcela(removerParcela(removerParcela(f, 0), 0), 0).parcelas).toHaveLength(1);
    expect(maxParcelasDaForma('01')).toBe(1);
    expect(maxParcelasDaForma('03')).toBe(12);
    expect(maxParcelasDaForma('15')).toBe(36);
    let c = { ...formularioPrazoVazio(), forma_tpag: '03' };
    for (let i = 0; i < 20; i++) c = adicionarParcela(c);
    expect(c.parcelas).toHaveLength(12);
  });
  it('RN-CAD-15: trocar para à vista deixa a parcela [0] e o prazo médio 0', () => {
    const f = trocarForma({ ...formularioPrazoVazio(), parcelas: ['30', '60'], prazo_medio_dias: '45' }, '01');
    expect(f).toMatchObject({ forma_tpag: '01', parcelas: ['0'], prazo_medio_dias: '0' });
    expect(adicionarParcela(f).parcelas).toEqual(['0']);
  });
  it('RN-CAD-15: montarPrazo exige código, descrição, parcelas uma a uma e prazo médio, com o erro no campo certo', () => {
    expect(montarPrazo(formularioPrazoVazio()).erros).toMatchObject({ codigo: expect.any(String), descricao: expect.any(String), prazos_dias: expect.any(String), prazo_medio_dias: expect.any(String) });
    const ok = montarPrazo({ codigo: 'B30', descricao: 'Boleto 30', forma_tpag: '15', parcelas: ['30', '60'], prazo_medio_dias: '45' });
    expect(ok.erros).toEqual({});
    expect(ok.corpo).toEqual({ codigo: 'B30', descricao: 'Boleto 30', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 });
    expect(montarPrazo({ codigo: 'X', descricao: 'X', forma_tpag: '15', parcelas: ['1000'], prazo_medio_dias: '30' }).erros).toHaveProperty('prazos_dias');
  });
  it('RN-CAD-15: o legado abre no formulário com o prazo médio vazio, para completar', () => {
    expect(formularioDoPrazo(p('LEG', '15', [15, 30], null))).toMatchObject({ parcelas: ['15', '30'], prazo_medio_dias: '' });
  });
});

describe('prazo médio do cliente (RN-CAD-16)', () => {
  it('RN-CAD-16: vazio = sem restrição (nulo); 0 a 999 vale; fora disso, erro', () => {
    expect(prazoMedioDoCliente('')).toEqual({ valor: null });
    expect(prazoMedioDoCliente('0')).toEqual({ valor: 0 });
    expect(prazoMedioDoCliente(' 45 ')).toEqual({ valor: 45 });
    expect(prazoMedioDoCliente('1000').erro).toBeDefined();
    expect(prazoMedioDoCliente('-1').erro).toBeDefined();
    expect(prazoMedioDoCliente('1,5').erro).toBeDefined();
  });
});
