import { describe, expect, it } from 'vitest';
import { escopoDaCarteira, planejarTransferencia, vendedorExternoFdv, vincularVendedorFdv } from './carteira';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

describe('carteira', () => {
  it('D7: o vendedor vê só a própria carteira; sem cadastro de vendedor não vê ninguém', () => {
    expect(escopoDaCarteira('vendedor', [A])).toEqual({ todos: false, vendedor_ids: [A] });
    expect(escopoDaCarteira('vendedor', [])).toEqual({ todos: false, vendedor_ids: [] });
  });
  it('D7: os demais perfis veem a carteira toda', () => {
    for (const p of ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'] as const) {
      expect(escopoDaCarteira(p, [])).toEqual({ todos: true });
    }
  });
  it('D7: transfere a carteira inteira quando não há lista', () => {
    expect(planejarTransferencia({ de: A, para: B, cliente_ids: undefined, carteira_de: [C1, C2] })).toEqual({ ok: true, cliente_ids: [C1, C2] });
  });
  it('D7: transfere só os clientes pedidos, se estiverem na carteira de origem', () => {
    expect(planejarTransferencia({ de: A, para: B, cliente_ids: [C2], carteira_de: [C1, C2] })).toEqual({ ok: true, cliente_ids: [C2] });
    const r = planejarTransferencia({ de: A, para: B, cliente_ids: [C1], carteira_de: [C2] });
    expect(r.ok).toBe(false);
  });
  it('D7: origem igual ao destino ou carteira vazia é recusado', () => {
    expect(planejarTransferencia({ de: A, para: A, cliente_ids: undefined, carteira_de: [C1] }).ok).toBe(false);
    expect(planejarTransferencia({ de: A, para: B, cliente_ids: undefined, carteira_de: [] }).ok).toBe(false);
  });
});

describe('carteira do cliente vindo do FDV (T-0105 item 2)', () => {
  const ativo = { inativo: false };
  it('D7: sem vendedor indicado o cliente nasce sem carteira e sem aviso; o código é normalizado', () => {
    expect(vendedorExternoFdv(undefined)).toBeNull();
    expect(vendedorExternoFdv('  ')).toBeNull();
    expect(vendedorExternoFdv(' V01 ')).toBe('V01');
    expect(vincularVendedorFdv(null, null, null)).toEqual({ vendedor_id: null, aviso: null });
  });
  it('D7: sem a porta do espelho (não consultado) o cliente nasce sem carteira e sem aviso', () => {
    expect(vincularVendedorFdv('V01', undefined, null)).toEqual({ vendedor_id: null, aviso: null });
  });
  it('D7: vendedor ativo no espelho e no ERP entra na carteira dele', () => {
    expect(vincularVendedorFdv('V01', { vendedor_id: A, ativo: true }, ativo)).toEqual({ vendedor_id: A, aviso: null });
  });
  it('D7 (provisório, pendente de RN do PO): vendedor inexistente (espelho ou ERP) não recusa o cliente: nasce sem carteira, com aviso', () => {
    expect(vincularVendedorFdv('V99', { vendedor_id: null, ativo: false }, null)).toEqual({ vendedor_id: null, aviso: 'vendedor_fdv_nao_encontrado' });
    expect(vincularVendedorFdv('V99', null, null)).toEqual({ vendedor_id: null, aviso: 'vendedor_fdv_nao_encontrado' });
    expect(vincularVendedorFdv('V98', { vendedor_id: A, ativo: true }, null)).toEqual({ vendedor_id: null, aviso: 'vendedor_fdv_nao_encontrado' });
  });
  it('D7 (provisório, pendente de RN do PO): vendedor inativo no espelho ou no ERP: sem carteira, com aviso de inativo', () => {
    expect(vincularVendedorFdv('V02', { vendedor_id: A, ativo: false }, ativo)).toEqual({ vendedor_id: null, aviso: 'vendedor_fdv_inativo' });
    expect(vincularVendedorFdv('V03', { vendedor_id: A, ativo: true }, { inativo: true })).toEqual({ vendedor_id: null, aviso: 'vendedor_fdv_inativo' });
  });
});
