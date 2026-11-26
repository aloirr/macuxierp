import { describe, expect, it } from 'vitest';
import { MOTIVO_PRAZO_MEDIO_FAIXA } from '../domain/condicao';
import { PAGINAS } from './paginas';
import {
  adicionarParcela, agruparPrazosPorForma, corpoDoPatchDoPrazo, formularioDoPrazo, formularioPrazoVazio, maxParcelasDaForma, montarPrazo, prazoMedioDoCliente, prazoMedioNaLista, removerParcela, rotulosDasParcelas, trocarForma,
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
  it('RN-CAD-15: "+ Parcela" e remover respeitam o mínimo de 1 e o máximo da forma (à vista 1, cartão 12, boleto 24)', () => {
    let f = { ...formularioPrazoVazio(), forma_tpag: '15' };
    expect(rotulosDasParcelas(f.parcelas.length)).toEqual(['Parcela 1']);
    f = adicionarParcela(adicionarParcela(f));
    expect(f.parcelas).toHaveLength(3);
    expect(removerParcela(f, 1).parcelas).toHaveLength(2);
    expect(removerParcela(removerParcela(removerParcela(f, 0), 0), 0).parcelas).toHaveLength(1);
    expect(maxParcelasDaForma('01')).toBe(1);
    expect(maxParcelasDaForma('03')).toBe(12);
    expect(maxParcelasDaForma('15')).toBe(24);
    let c = { ...formularioPrazoVazio(), forma_tpag: '03' };
    for (let i = 0; i < 20; i++) c = adicionarParcela(c);
    expect(c.parcelas).toHaveLength(12);
  });
  it('RN-CAD-15: trocar para à vista deixa a parcela [0] e o prazo médio 0', () => {
    const f = trocarForma({ ...formularioPrazoVazio(), parcelas: ['30', '60'], prazo_medio_dias: '45' }, '01');
    expect(f).toMatchObject({ forma_tpag: '01', parcelas: ['0'], prazo_medio_dias: '0' });
    expect(adicionarParcela(f).parcelas).toEqual(['0']);
  });
  it('RN-CAD-15: montarPrazo exige código, descrição e parcelas uma a uma, com o erro no campo certo; prazo médio vazio vai como null', () => {
    expect(montarPrazo(formularioPrazoVazio()).erros).toMatchObject({ codigo: expect.any(String), descricao: expect.any(String), prazos_dias: expect.any(String) });
    expect(montarPrazo(formularioPrazoVazio()).erros).not.toHaveProperty('prazo_medio_dias');
    const ok = montarPrazo({ codigo: 'B30', descricao: 'Boleto 30', forma_tpag: '15', parcelas: ['30', '60'], prazo_medio_dias: '45', prazo_medio_sugerido: '' });
    expect(ok.erros).toEqual({});
    expect(ok.corpo).toEqual({ codigo: 'B30', descricao: 'Boleto 30', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 });
    expect(montarPrazo({ codigo: 'X', descricao: 'X', forma_tpag: '15', parcelas: ['366'], prazo_medio_dias: '30', prazo_medio_sugerido: '' }).erros).toHaveProperty('prazos_dias');
    // decisão 14 A: vazio (inclusive só espaços) é aceito e vai como null; o ERP calcula
    const vazio = montarPrazo({ codigo: 'B3', descricao: 'Boleto', forma_tpag: '15', parcelas: ['30', '45'], prazo_medio_dias: '  ', prazo_medio_sugerido: '' });
    expect(vazio.erros).toEqual({});
    expect(vazio.corpo).toMatchObject({ prazos_dias: [30, 45], prazo_medio_dias: null });
    // digitado segue validado de 0 a 365; 0 é um valor, não vazio
    expect(montarPrazo({ codigo: 'B3', descricao: 'B', forma_tpag: '15', parcelas: ['30'], prazo_medio_dias: '366', prazo_medio_sugerido: '' }).erros).toHaveProperty('prazo_medio_dias');
    expect(montarPrazo({ codigo: 'B3', descricao: 'B', forma_tpag: '15', parcelas: ['30'], prazo_medio_dias: 'abc', prazo_medio_sugerido: '' }).erros).toHaveProperty('prazo_medio_dias');
    expect(montarPrazo({ codigo: 'B3', descricao: 'B', forma_tpag: '15', parcelas: ['0'], prazo_medio_dias: '0', prazo_medio_sugerido: '' }).corpo).toMatchObject({ prazo_medio_dias: 0 });
    // à vista continua 0
    expect(montarPrazo({ codigo: 'AV', descricao: 'AV', forma_tpag: '01', parcelas: ['0'], prazo_medio_dias: '5', prazo_medio_sugerido: '' }).erros).toHaveProperty('prazo_medio_dias');
  });
  it('RN-CAD-15 (T-0112): montarPrazo recusa o prazo médio fora da faixa das parcelas e aceita o de dentro', () => {
    const f = { codigo: 'B3', descricao: 'B', forma_tpag: '15', parcelas: ['28', '56'], prazo_medio_dias: '57', prazo_medio_sugerido: '' };
    expect(montarPrazo(f).erros).toEqual({ prazo_medio_dias: MOTIVO_PRAZO_MEDIO_FAIXA });
    expect(montarPrazo({ ...f, prazo_medio_dias: '56' }).corpo).toMatchObject({ prazo_medio_dias: 56 });
  });
  it('RN-CAD-15: o legado abre no formulário com o prazo médio vazio, para completar', () => {
    expect(formularioDoPrazo(p('LEG', '15', [15, 30], null))).toMatchObject({ parcelas: ['15', '30'], prazo_medio_dias: '' });
  });
});

describe('T-0108: a tela não converte o prazo médio calculado em digitado (decisão 17 B, RN-CAD-15)', () => {
  const calc = { ...p('B3', '15', [30, 45], 38), prazo_medio_calculado: true };
  const dig = { ...p('B4', '15', [30, 45], 40), prazo_medio_calculado: false };
  it('RN-CAD-15: o calculado abre com o campo vazio e o valor como sugestão', () => {
    expect(formularioDoPrazo(calc)).toMatchObject({ prazo_medio_dias: '', prazo_medio_sugerido: '38' });
  });
  it('RN-CAD-15: salvar sem mexer mantém o calculado: o PATCH não manda nada, nem o sugerido como valor', () => {
    const f = formularioDoPrazo(calc);
    const r = corpoDoPatchDoPrazo(f, calc);
    expect(r.corpo).toEqual({});
  });
  it('RN-CAD-15: mudar só as parcelas com o campo vazio não manda o prazo médio (a API recalcula e mantém a marca)', () => {
    const r = corpoDoPatchDoPrazo({ ...formularioDoPrazo(calc), parcelas: ['30', '90'] }, calc);
    expect(r.corpo).toEqual({ prazos_dias: [30, 90] });
  });
  it('RN-CAD-15: no PATCH, digitar um número vira digitado', () => {
    expect(corpoDoPatchDoPrazo({ ...formularioDoPrazo(calc), prazo_medio_dias: '40' }, calc).corpo).toEqual({ prazo_medio_dias: 40 });
  });
  it('RN-CAD-15: o digitado abre no campo e apagá-lo manda null', () => {
    const f = formularioDoPrazo(dig);
    expect(f).toMatchObject({ prazo_medio_dias: '40', prazo_medio_sugerido: '' });
    expect(corpoDoPatchDoPrazo(f, dig).corpo).toEqual({});
    expect(corpoDoPatchDoPrazo({ ...f, prazo_medio_dias: '' }, dig).corpo).toEqual({ prazo_medio_dias: null });
  });
});

describe('prazo médio do cliente (RN-CAD-16)', () => {
  it('RN-CAD-16: vazio = sem restrição (nulo); 0 a 365 vale; fora disso, erro', () => {
    expect(prazoMedioDoCliente('')).toEqual({ valor: null });
    expect(prazoMedioDoCliente('0')).toEqual({ valor: 0 });
    expect(prazoMedioDoCliente(' 45 ')).toEqual({ valor: 45 });
    expect(prazoMedioDoCliente('366').erro).toBeDefined();
    expect(prazoMedioDoCliente('-1').erro).toBeDefined();
    expect(prazoMedioDoCliente('1,5').erro).toBeDefined();
  });
});
