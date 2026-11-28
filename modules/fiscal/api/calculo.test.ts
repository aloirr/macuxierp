import { describe, expect, it } from 'vitest';
import type { Transacao } from '@macuxierp/platform-sdk';
import { regra } from '../domain/fixtures';
import { criarCalculoFiscal, type EntradaCalculoDoFiscal } from './calculo';
import type { EmitenteFiscal, RepositorioFiscal } from './portas';

const tx = {} as Transacao;
const item = (sequencia: number, extra: Partial<EntradaCalculoDoFiscal['itens'][number]> = {}) => ({
  sequencia, produto_id: `p${sequencia}`, ncm: '22021000', origem: '0', quantidade: 1, preco_unitario_centavos: 100000,
  valor_centavos: 100000, desconto_centavos: 0, frete_centavos: 0, outras_centavos: 0, ...extra,
});
const entrada = (ufDest = 'AM', ind: '1' | '2' | '9' = '1', itens = [item(1)]): EntradaCalculoDoFiscal => ({
  filial_id: 'f1', data_emissao: '2026-11-21', itens,
  pedido: { pedido: { cliente_retrato: { tipo_pessoa: 'PJ', ind_ie_dest: ind, endereco: { uf: ufDest } } } },
});
function montar(emitente: EmitenteFiscal | null, regras: ReturnType<typeof regra>[], fabricados: string[] = []) {
  const chamadas: unknown[] = [];
  const consultas: string[][] = [];
  const repositorio: RepositorioFiscal = {
    async regras(_t, f) { chamadas.push(f); return regras; },
    async cargas() { return new Map(); },
  };
  return { chamadas, calc: criarCalculoFiscal({ emitentes: { emitente: async () => emitente, producaoPropria: async (_t, ids) => { consultas.push(ids); return new Set(ids.filter((i) => fabricados.includes(i))); } }, repositorio }), consultas };
}
const normal: EmitenteFiscal = { uf: 'AM', crt: 3, regime_pis_cofins: 'cumulativo' };

describe('adaptador CalculoFiscal sobre fiscal.calculo@1', () => {
  it('RN-FIS-01: calcula o ICMS pela regra e devolve o CFOP por sequência (item_id = String(sequencia))', async () => {
    const { calc, chamadas } = montar(normal, [regra()]);
    const r = await calc.calcular(tx, entrada('AM', '1', [item(1), item(2)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cfops).toEqual({ 1: '5102', 2: '5102' });
    expect(r.saida.itens.map((i) => i.item_id)).toEqual(['1', '2']);
    expect(r.saida.itens[0]?.cfop).toBe('5102');
    expect(r.saida.itens[0]?.icms.v_icms).toBe(18000);
    expect(chamadas[0]).toMatchObject({ data_emissao: '2026-11-21', uf_origem: 'AM', uf_destino: 'AM', crt: 3, ncms: ['22021000'] });
  });
  it('RN-FIS-05: o adaptador devolve regra_aplicada e calc_st do item e do total (63 A), revalidados pelo CalculoSaida; sem regra de ST, omitidos', async () => {
    const com = await montar(normal, [regra({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000 })]).calc.calcular(tx, entrada());
    if (!com.ok) throw new Error(JSON.stringify(com.erros));
    expect(com.saida.itens[0]).toMatchObject({ regra_aplicada: { st: true, ipi: false }, calc_st: { v_bc: 140000, p_aliq: 180000, v_valor: 7200 } });
    expect(com.saida.totais.calc_st).toEqual({ v_bc: 140000, v_valor: 7200 });
    const sem = await montar(normal, [regra()]).calc.calcular(tx, entrada());
    if (!sem.ok) throw new Error('esperava ok');
    expect(sem.saida.itens[0]?.regra_aplicada).toEqual({ st: false, ipi: false });
    expect(sem.saida.totais.calc_st).toBeUndefined();
    expect(sem.saida.itens[0]?.calc_st).toBeUndefined();
  });
  it('RN-FIS-01: pedido misto escolhe o CFOP por item (fabricado × revenda): interna e interestadual contribuinte', async () => {
    const itens = [item(1), item(2)];
    const regras = [regra({ cfop: '5101' }), regra({ cfop: '5102' }), regra({ cfop: '6101' }), regra({ cfop: '6102' })];
    const caso = async (uf: string) => {
      const m = montar(normal, regras, ['p1']);
      const r = await m.calc.calcular(tx, entrada(uf, '1', itens));
      expect(m.consultas).toEqual([['p1', 'p2']]);
      return r.ok ? r.cfops : r;
    };
    expect(await caso('AM')).toEqual({ 1: '5101', 2: '5102' });
    expect(await caso('SP')).toEqual({ 1: '6101', 2: '6102' });
  });
  it('RN-FIS-01: com ST o item fabricado sai 5401/6401 e o de revenda 5403/6403', async () => {
    for (const [uf, fab, rev] of [['AM', '5401', '5403'], ['SP', '6401', '6403']] as const) {
      const st = { codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000 };
      const regras = [regra({ cfop: uf === 'AM' ? '5102' : '6102', ...st }), regra({ cfop: uf === 'AM' ? '5101' : '6101', ...st }), regra({ cfop: fab, ...st }), regra({ cfop: rev, ...st })];
      const r = await montar(normal, regras, ['p1']).calc.calcular(tx, entrada(uf, '1', [item(1), item(2)]));
      expect(r.ok && r.cfops).toEqual({ 1: fab, 2: rev });
    }
  });
  it('RN-FIS-01: item sem produto_id é revenda e fica fora da consulta', async () => {
    const m = montar(normal, [regra({ cfop: '5101' }), regra({ cfop: '5102' })], ['p1']);
    const r = await m.calc.calcular(tx, entrada('AM', '1', [item(1), item(2, { produto_id: undefined })]));
    expect(r.ok && r.cfops).toEqual({ 1: '5101', 2: '5102' });
    expect(m.consultas).toEqual([['p1']]);
    const sem = montar(normal, [regra({ cfop: '5102' })], ['p1']);
    const r2 = await sem.calc.calcular(tx, entrada('AM', '1', [item(1, { produto_id: undefined })]));
    expect(r2.ok && r2.cfops).toEqual({ 1: '5102' });
    expect(sem.consultas).toEqual([]);
  });
  it('RN-FIS-01: venda para outra UF sai com CFOP 6102 e operação interestadual', async () => {
    const { calc } = montar(normal, [regra()]);
    const r = await calc.calcular(tx, entrada('SP'));
    expect(r.ok && r.cfops[1]).toBe('6102');
    expect(r.ok && r.saida.operacao).toBe('interestadual');
  });
  it('RN-FIS-01: sem regra aplicável volta erro tipado, nunca exceção', async () => {
    const { calc } = montar(normal, []);
    const r = await calc.calcular(tx, entrada());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]?.codigo).toBe('REGRA_NAO_ENCONTRADA');
  });
  it('RN-FIS-01: CST 60 refina o CFOP para 5405 e recalcula com o novo CFOP', async () => {
    const { calc } = montar(normal, [regra({ cfop: '5102', codigo: '60', aliquota_icms: null }), regra({ cfop: '5405', codigo: '60', aliquota_icms: null })]);
    const r = await calc.calcular(tx, entrada());
    expect(r.ok && r.cfops[1]).toBe('5405');
  });
  it('RN-FIS-01: não contribuinte (ind_ie_dest 9) chega ao motor como consumidor final: IPI entra na base do ICMS; contribuinte não', async () => {
    const industrial: EmitenteFiscal = { ...normal, industrial_ipi: true };
    const regras = [regra({ cfop: '5101', cst_ipi: '50', aliquota_ipi: 100000 })];
    const nc = await montar(industrial, regras, ['p1']).calc.calcular(tx, entrada('AM', '9'));
    const c = await montar(industrial, regras, ['p1']).calc.calcular(tx, entrada('AM', '1'));
    expect(nc.ok && nc.saida.itens[0]?.icms.v_bc).toBe(110000);
    expect(c.ok && c.saida.itens[0]?.icms.v_bc).toBe(100000);
  });
  it('RN-FIS-01: CFOP refinado que muda de novo (5405 com CST 00) volta REGRA_INCOMPLETA com o item', async () => {
    const { calc } = montar(normal, [regra({ cfop: '5102', codigo: '60', aliquota_icms: null }), regra({ cfop: '5405', codigo: '00' })]);
    const r = await calc.calcular(tx, entrada());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatchObject({ rn: 'RN-FIS-01', codigo: 'REGRA_INCOMPLETA', item_id: '1', mensagem: 'CFOP 5405 CST incoerente' });
  });
  it('RN-FIS-01: filial sem dados fiscais volta REGRA_INCOMPLETA', async () => {
    const { calc } = montar(null, [regra()]);
    const r = await calc.calcular(tx, entrada());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatchObject({ rn: 'RN-FIS-01', codigo: 'REGRA_INCOMPLETA' });
  });
});
