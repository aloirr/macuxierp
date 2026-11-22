import { describe, expect, it } from 'vitest';
import { CHAVE_ACESSO_REGEX, NotaAutorizadaPayload, NotaCanceladaPayload, TituloBaixadoPayload, TituloGeradoPayload, ConfigurarFilialEntrada } from './index';

const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nota = { id: u(1), filial_id: u(2), cliente_id: u(3), serie: 1, numero: 5, chave_acesso: '13261112ABC34501DE35550010000001231876543214', emitida_em: '2026-11-21T14:00:00.000Z', total_centavos: 100, protocolo: '113260000000001' };
const base = { pedido_id: u(4), ambiente: 'producao', nota, itens: [{ sequencia: 1, quantidade: 10000, valor_centavos: 100 }], vendedor_id: null, quantidade_itens: 1 };

describe('contratos de eventos do faturamento', () => {
  it('RN-FAT-01: a chave aceita CNPJ alfanumérico (NT 2025.001) e recusa letra fora do CNPJ', () => {
    expect(CHAVE_ACESSO_REGEX.test(nota.chave_acesso)).toBe(true);
    expect(CHAVE_ACESSO_REGEX.test('13261112ABC34501DE3555001000000123187654321A')).toBe(false);
    expect(CHAVE_ACESSO_REGEX.test('13261112ABC34501DEAB550010000001231876543214')).toBe(false);
  });
  it('T-0009 2.10: nota.autorizada@1 e nota.cancelada@1 levam pedido_uuid (nullable)', () => {
    expect(NotaAutorizadaPayload.safeParse({ ...base, pedido_uuid: null }).success).toBe(true);
    expect(NotaAutorizadaPayload.safeParse({ ...base, pedido_uuid: u(9) }).success).toBe(true);
    expect(NotaAutorizadaPayload.safeParse(base).success).toBe(false);
    const canc = { ...base, pedido_uuid: null, protocolo_cancelamento: '113260000000002', motivo: 'Cancelamento por erro de digitação' };
    expect(NotaCanceladaPayload.safeParse(canc).success).toBe(true);
  });
  it('estoque (R-20261122-022626): nota.autorizada@1 e nota.cancelada@1 aceitam, por item, produto_id e filial_id (quantidade é inteiro em escala 4), sem quebrar o leitor antigo', () => {
    const novo = { ...base, pedido_uuid: null, itens: [{ ...base.itens[0], produto_id: u(7), filial_id: u(2) }] };
    const a = NotaAutorizadaPayload.parse(novo);
    expect(a.itens[0]).toMatchObject({ produto_id: u(7), filial_id: u(2), quantidade: 10000 });
    expect(NotaCanceladaPayload.safeParse({ ...novo, protocolo_cancelamento: '113260000000002', motivo: 'Cancelamento por erro de digitação' }).success).toBe(true);
    expect(NotaAutorizadaPayload.safeParse({ ...base, pedido_uuid: null }).success).toBe(true);
    expect(NotaAutorizadaPayload.safeParse({ ...novo, itens: [{ ...novo.itens[0], quantidade: 1.5 }] }).success).toBe(false);
  });
  it('bandeira real com NF-e simulada: conta_como_real é opcional nos 4 payloads (ausente = como hoje)', () => {
    const t = { titulo_id: u(5), nota_id: u(1), pedido_id: u(4), cliente_id: u(3), ambiente: 'homologacao', numero: 5, serie: 1, parcela: 1, total_parcelas: 1, emissao: '2026-11-21', vencimento: '2026-12-21', valor_centavos: 100, saldo_centavos: 100 };
    expect(NotaAutorizadaPayload.parse({ ...base, pedido_uuid: null, conta_como_real: true }).conta_como_real).toBe(true);
    expect(NotaAutorizadaPayload.parse({ ...base, pedido_uuid: null }).conta_como_real).toBeUndefined();
    expect(NotaCanceladaPayload.safeParse({ ...base, pedido_uuid: null, protocolo_cancelamento: '113260000000002', motivo: 'Cancelamento por erro de digitação', conta_como_real: true }).success).toBe(true);
    expect(TituloGeradoPayload.parse({ ...t, conta_como_real: true }).conta_como_real).toBe(true);
    expect(TituloGeradoPayload.parse(t).conta_como_real).toBeUndefined();
    expect(TituloBaixadoPayload.parse({ ...t, baixado_em: '2026-12-20', valor_baixado_centavos: 100, conta_como_real: true }).conta_como_real).toBe(true);
    expect(ConfigurarFilialEntrada.safeParse({ faturamento_real_nfe_simulada: true }).success).toBe(true);
    expect(ConfigurarFilialEntrada.safeParse({}).success).toBe(false);
  });
  it('C-5: titulo.baixado@1 leva valor_baixado_centavos', () => {
    const t = { titulo_id: u(5), nota_id: u(1), pedido_id: u(4), cliente_id: u(3), ambiente: 'producao', numero: 5, serie: 1, parcela: 1, total_parcelas: 1, emissao: '2026-11-21', vencimento: '2026-12-21', valor_centavos: 100, saldo_centavos: 0, baixado_em: '2026-12-20' };
    expect(TituloBaixadoPayload.safeParse(t).success).toBe(false);
    expect(TituloBaixadoPayload.safeParse({ ...t, valor_baixado_centavos: 100 }).success).toBe(true);
  });
  it('T-0021: campos novos são aditivos no @1 (payload antigo continua válido)', () => {
    expect(NotaAutorizadaPayload.safeParse({ ...base, pedido_uuid: null }).success).toBe(true);
  });
  it('T-0021: conta_como_real e produto_id/filial_id por item são aceitos', () => {
    const itens = [{ sequencia: 1, quantidade: 10000, valor_centavos: 100, produto_id: u(7), filial_id: u(2) }];
    const aut = { ...base, itens, conta_como_real: true, pedido_uuid: null };
    expect(NotaAutorizadaPayload.safeParse(aut).success).toBe(true);
    const canc = { ...aut, protocolo_cancelamento: '113260000000002', motivo: 'Cancelamento por erro de digitação' };
    expect(NotaCanceladaPayload.safeParse(canc).success).toBe(true);
    const t = { titulo_id: u(5), nota_id: u(1), pedido_id: u(4), cliente_id: u(3), ambiente: 'homologacao', numero: 5, serie: 1, parcela: 1, total_parcelas: 1, emissao: '2026-11-21', vencimento: '2026-12-21', valor_centavos: 100, saldo_centavos: 100, conta_como_real: true };
    expect(TituloGeradoPayload.safeParse(t).success).toBe(true);
    expect(TituloBaixadoPayload.safeParse({ ...t, baixado_em: '2026-12-20', valor_baixado_centavos: 100 }).success).toBe(true);
  });
  it('T-0021: conta_como_real não booleano é recusado', () => {
    expect(NotaAutorizadaPayload.safeParse({ ...base, pedido_uuid: null, conta_como_real: 'sim' }).success).toBe(false);
  });
});
