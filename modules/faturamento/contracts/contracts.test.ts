import { describe, expect, it } from 'vitest';
import { CHAVE_ACESSO_REGEX, NotaAutorizadaPayload, NotaCanceladaPayload, TituloBaixadoPayload, TituloGeradoPayload, ConfigurarFilialEntrada, TipoEmissao, AbrirContingenciaEntrada, ContingenciaResumo, EpecPendente, FiltroEpecPendentes, NotaEmitidaContingenciaPayload, NotaParaCliente } from './index';

const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nota = { id: u(1), filial_id: u(2), cliente_id: u(3), serie: 1, numero: 5, chave_acesso: '13261112ABC34501DE35550010000001231876543214', emitida_em: '2026-11-21T14:00:00.000Z', total_centavos: 100, protocolo: '113260000000001' };
const base = { pedido_id: u(4), ambiente: 'producao', nota, itens: [{ sequencia: 1, quantidade: 10000, valor_centavos: 100 }], vendedor_id: null, quantidade_itens: 1 };

describe('contratos de eventos do faturamento', () => {
  it('RN-FAT-05 (ADR 0011): TipoEmissao aceita 1, 4 (EPEC), 6 e 7; recusa 2, 3, 5 e 9', () => {
    for (const t of [1, 4, 6, 7]) expect(TipoEmissao.safeParse(t).success).toBe(true);
    for (const t of [0, 2, 3, 5, 9]) expect(TipoEmissao.safeParse(t).success).toBe(false);
  });
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

describe('contratos da contingência por filial (T-0021, lote 4)', () => {
  const abrir = { filial_id: u(2), modalidade: 'epec', motivo: 'SEFAZ-AM sem resposta há 10 min' };
  it('RN-FAT-05: a abertura aceita svc_an, svc_rs e epec; ambiente e inicio_em são opcionais; recusa modalidade fora da v1 (FS-DA)', () => {
    for (const modalidade of ['svc_an', 'svc_rs', 'epec']) expect(AbrirContingenciaEntrada.safeParse({ ...abrir, modalidade }).success).toBe(true);
    expect(AbrirContingenciaEntrada.safeParse({ ...abrir, ambiente: 'producao', inicio_em: '2026-11-21T14:00:00.000Z' }).success).toBe(true);
    expect(AbrirContingenciaEntrada.safeParse({ ...abrir, modalidade: 'fs_da' }).success).toBe(false);
    expect(AbrirContingenciaEntrada.safeParse({ ...abrir, ambiente: 'teste' }).success).toBe(false);
    expect(AbrirContingenciaEntrada.safeParse({ modalidade: 'epec', motivo: abrir.motivo }).success).toBe(false);
  });
  it('RN-FAT-09: o resumo leva ligada_por e desligada_por (nulos na aberta) e a EPEC pendente leva o prazo e a situação', () => {
    const r = { id: u(1), filial_id: u(2), ambiente: 'producao', modalidade: 'svc_rs', motivo: abrir.motivo, inicio_em: '2026-11-21T14:00:00.000Z', fim_em: null, ligada_por: u(5), desligada_por: null };
    expect(ContingenciaResumo.safeParse(r).success).toBe(true);
    expect(ContingenciaResumo.safeParse({ ...r, ligada_por: undefined }).success).toBe(false);
    const e = { id: u(1), filial_id: u(2), ambiente: 'producao', serie: 1, numero: 7, chave_acesso: null, status: 'emitida_contingencia', epec_protocolo: '113260000000001', epec_autorizada_em: '2026-11-21T14:00:00.000Z', prazo_ate: '2026-11-28T14:00:00.000Z', situacao_prazo: 'no_prazo' };
    expect(EpecPendente.safeParse(e).success).toBe(true);
    expect(EpecPendente.safeParse({ ...e, situacao_prazo: 'atrasado' }).success).toBe(false);
    expect(FiltroEpecPendentes.parse({ situacao: 'vencido' })).toEqual({ situacao: 'vencido', limite: 50 });
  });
});

describe('faturamento.nota.emitida_contingencia@1 (EPEC registrada; RN-FAT-07, RN-FAT-08)', () => {
  const emitida = { ...base, pedido_uuid: u(9), nota: { ...nota, protocolo: null }, tp_emis: 4, epec_protocolo: '891260000000007', epec_autorizada_em: '2026-11-21T14:05:00.000Z' };
  it('RN-FAT-08: leva o mesmo que nota.autorizada@1 (pedido_id, pedido_uuid, número, série, chave, itens, quantidades) mais tp_emis 4, epec_protocolo e epec_autorizada_em; o protocolo da NF-e é nulo', () => {
    expect(NotaEmitidaContingenciaPayload.safeParse(emitida).success).toBe(true);
    const r = NotaEmitidaContingenciaPayload.parse({ ...emitida, conta_como_real: true });
    expect(r).toMatchObject({ pedido_id: u(4), pedido_uuid: u(9), tp_emis: 4, epec_protocolo: '891260000000007', nota: { numero: 5, serie: 1, chave_acesso: nota.chave_acesso, protocolo: null } });
    expect(r.itens).toEqual(base.itens);
  });
  it('RN-FAT-08: exige chave de acesso, tp_emis 4, protocolo EPEC de 15 dígitos, data UTC e pedido_uuid (nullable); recusa protocolo da NF-e preenchido', () => {
    expect(NotaEmitidaContingenciaPayload.safeParse({ ...emitida, pedido_uuid: null }).success).toBe(true);
    for (const ruim of [{ pedido_uuid: undefined }, { tp_emis: 6 }, { tp_emis: 1 }, { epec_protocolo: '123' }, { epec_autorizada_em: '21/11/2026' }, { nota: { ...nota, protocolo: null, chave_acesso: null } }, { nota: { ...nota, protocolo: '113260000000001' } }]) {
      expect(NotaEmitidaContingenciaPayload.safeParse({ ...emitida, ...ruim }).success).toBe(false);
    }
  });
});

describe('cenário B (ADR 0014)', () => {
  const chave = '13261112345678000195550010000012341000012345';
  const item = { sequencia: 1, produto_id: null, codigo: 'P1', descricao: 'Item', unidade: 'UN', quantidade: 10_000, valor_unitario_centavos: 100, total_centavos: 100 };
  it('RN-FAT-04: NotaParaCliente não carrega XML (campo extra é recusado)', () => {
    const base = { chave_acesso: chave, pedido_id: '11111111-1111-4111-8111-111111111111', numero: 1, serie: 1, emitida_em: '2026-11-24T14:00:00.000Z', protocolo: '1', total_produtos_centavos: 100, total_desconto_centavos: 0, total_centavos: 100, itens: [item] };
    expect(NotaParaCliente.safeParse(base).success).toBe(true);
    expect(NotaParaCliente.safeParse({ ...base, xml: '<NFe/>' }).success).toBe(false);
  });
});
