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
function montar(emitente: EmitenteFiscal | null, regras: ReturnType<typeof regra>[]) {
  const chamadas: unknown[] = [];
  const repositorio: RepositorioFiscal = {
    async regras(_t, f) { chamadas.push(f); return regras; },
    async cargas() { return new Map(); },
  };
  return { chamadas, calc: criarCalculoFiscal({ emitentes: { emitente: async () => emitente }, repositorio }) };
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
    const nc = await montar(industrial, regras).calc.calcular(tx, entrada('AM', '9'));
    const c = await montar(industrial, regras).calc.calcular(tx, entrada('AM', '1'));
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
