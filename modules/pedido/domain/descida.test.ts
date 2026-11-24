import { describe, expect, it } from 'vitest';
import { converterNotaCliente, decidirEnfileirar, decidirMarcarDescido, decidirRetornoCliente, STATUS_DESCEM } from './descida';

describe('fila de descida (ADR 0014 §13 e §15)', () => {
  it('RN-PED-01: todo pedido aprovado desce ao banco do cliente, com ou sem faturamento ligado', () => {
    expect(decidirEnfileirar({ status: 'aprovado', jaNaFila: false })).toEqual({ ok: true });
  });
  it('RN-PED-01: o pedido já na fila não entra de novo (idempotente por pedido_uuid)', () => {
    expect(decidirEnfileirar({ status: 'aprovado', jaNaFila: true })).toEqual({ ok: false, codigo: 'ja_na_fila' });
  });
  it.each(['recebido', 'em_analise', 'recusado', 'cancelado'] as const)('RN-PED-02: pedido %s não desce', (status) => {
    expect(decidirEnfileirar({ status, jaNaFila: false })).toEqual({ ok: false, codigo: 'status_nao_desce' });
  });
  it('RN-PED-02: faturado pelo ERP antes de o Conector buscar ainda desce (só cancelado e os anteriores à aprovação não)', () => {
    expect([...STATUS_DESCEM].sort()).toEqual(['aprovado', 'faturado', 'faturado_parcial']);
  });
  it('RN-PED-01: marcar descido duas vezes não desce duas vezes', () => {
    expect(decidirMarcarDescido({ descidoEm: null })).toEqual({ ok: true });
    expect(decidirMarcarDescido({ descidoEm: '2026-11-24T10:00:00.000Z' })).toEqual({ ok: false, codigo: 'ja_descido' });
  });
});

const NOTA_A = { numero: 1234, serie: 1, emitida_em: '2026-11-24T14:30:00.000Z', total_centavos: 2000 };
const NOTA_B = { numero: 1240, serie: 1, emitida_em: '2026-11-25T09:00:00.000Z', total_centavos: 3500 };
const base = { faturamentoLigado: false } as const;

describe('referência da nota do cliente (modo ponte, T-0057)', () => {
  it('RN-PED-02: faturado com nota grava a referência junto da transição (aprovado → parcial e → total)', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'aprovado', retorno: 'faturado_parcial', notaNova: NOTA_A })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado_parcial', nota: NOTA_A });
    expect(decidirRetornoCliente({ ...base, statusAtual: 'aprovado', retorno: 'faturado_total', notaNova: NOTA_A })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado', nota: NOTA_A });
  });
  it('RN-PED-02: sem nota no retorno nada é gravado (nota null)', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'aprovado', retorno: 'faturado_total' })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado', nota: null });
  });
  it('RN-PED-02: parcial → total troca para a última nota (a referência guarda a última)', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado_parcial', retorno: 'faturado_total', notaAtual: NOTA_A, notaNova: NOTA_B })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado', nota: NOTA_B });
  });
  it('RN-PED-02: parcial → parcial com outra nota só atualiza a referência, sem nova transição', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado_parcial', retorno: 'faturado_parcial', notaAtual: NOTA_A, notaNova: NOTA_B })).toEqual({ ok: true, acao: 'atualizar_nota', nota: NOTA_B });
  });
  it('RN-PED-02: os mesmos valores são no-op (ja_aplicado), mesmo com a data em outro fuso ou formato', () => {
    const mesmaData = { ...NOTA_A, emitida_em: '2026-11-24T10:30:00-04:00' };
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado_parcial', retorno: 'faturado_parcial', notaAtual: NOTA_A, notaNova: mesmaData })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_total', notaAtual: NOTA_A, notaNova: NOTA_A })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
  });
  it('RN-PED-02: repetido sem nota no retorno não mexe na referência', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_total', notaAtual: NOTA_A })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
  });
  it('RN-PED-02: status igual sem nota gravada aceita a primeira referência', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_total', notaAtual: null, notaNova: NOTA_A })).toEqual({ ok: true, acao: 'atualizar_nota', nota: NOTA_A });
  });
  it('RN-PED-02: valor diferente com o mesmo status é recusado como nota_cliente_divergente (faturado → faturado)', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_total', notaAtual: NOTA_A, notaNova: NOTA_B })).toMatchObject({ ok: false, rn: 'RN-PED-02', codigo: 'nota_cliente_divergente' });
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_total', notaAtual: NOTA_A, notaNova: { ...NOTA_A, total_centavos: 1 } })).toMatchObject({ ok: false, codigo: 'nota_cliente_divergente' });
  });
  it('RN-PED-02: faturado_parcial depois de faturado é obsoleto (200, sem efeito), mesmo com nota diferente da gravada; nada é gravado', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_parcial', notaAtual: NOTA_B, notaNova: NOTA_A })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'obsoleto' });
  });
  it('RN-PED-02: faturado_parcial depois de faturado com a mesma nota continua obsoleto', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado', retorno: 'faturado_parcial', notaAtual: NOTA_A, notaNova: NOTA_A })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'obsoleto' });
  });
  it('RN-PED-02: cancelado não mexe na referência, mesmo que o retorno traga nota', () => {
    expect(decidirRetornoCliente({ ...base, statusAtual: 'faturado_parcial', retorno: 'cancelado', notaAtual: NOTA_A, notaNova: NOTA_B })).toEqual({ ok: true, acao: 'aplicar', para: 'cancelado', nota: null });
    expect(decidirRetornoCliente({ ...base, statusAtual: 'cancelado', retorno: 'cancelado', notaAtual: NOTA_A, notaNova: NOTA_B })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
  });
  it('RN-CORE-02: com o faturamento ligado a referência do cliente não é comparada nem gravada (o faturado_* novo continua recusado)', () => {
    expect(decidirRetornoCliente({ statusAtual: 'faturado_parcial', retorno: 'faturado_parcial', faturamentoLigado: true, notaAtual: NOTA_A, notaNova: NOTA_B })).toMatchObject({ ok: true, acao: 'sem_efeito' });
    expect(decidirRetornoCliente({ statusAtual: 'aprovado', retorno: 'faturado_total', faturamentoLigado: true, notaNova: NOTA_A })).toMatchObject({ ok: false, codigo: 'faturamento_ligado' });
  });
});

describe('retorno vindo do cliente (modo ponte)', () => {
  it('RN-PED-02: faturado_total em pedido aprovado leva a faturado quando o faturamento está desligado', () => {
    expect(decidirRetornoCliente({ statusAtual: 'aprovado', retorno: 'faturado_total', faturamentoLigado: false })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado', nota: null });
  });
  it('RN-PED-02: faturado_parcial e depois faturado_total seguem a máquina', () => {
    expect(decidirRetornoCliente({ statusAtual: 'aprovado', retorno: 'faturado_parcial', faturamentoLigado: false })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado_parcial', nota: null });
    expect(decidirRetornoCliente({ statusAtual: 'faturado_parcial', retorno: 'faturado_total', faturamentoLigado: false })).toEqual({ ok: true, acao: 'aplicar', para: 'faturado', nota: null });
  });
  it('RN-PED-02: retorno repetido é idempotente e não gera transição', () => {
    expect(decidirRetornoCliente({ statusAtual: 'faturado', retorno: 'faturado_total', faturamentoLigado: false })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
    expect(decidirRetornoCliente({ statusAtual: 'cancelado', retorno: 'cancelado', faturamentoLigado: true })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
    expect(decidirRetornoCliente({ statusAtual: 'faturado_parcial', retorno: 'faturado_parcial', faturamentoLigado: false })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'ja_aplicado' });
  });
  it('RN-PED-02: faturado_parcial que chega depois do faturado_total é obsoleto: ignora, sem erro (o Conector repete até aceitar)', () => {
    expect(decidirRetornoCliente({ statusAtual: 'faturado', retorno: 'faturado_parcial', faturamentoLigado: false })).toEqual({ ok: true, acao: 'sem_efeito', motivo: 'obsoleto' });
  });
  it('RN-CORE-02 e RN-PED-02: com o faturamento ligado o faturado_* é só da nota do ERP e o retorno do cliente é recusado', () => {
    for (const retorno of ['faturado_parcial', 'faturado_total'] as const) {
      expect(decidirRetornoCliente({ statusAtual: 'aprovado', retorno, faturamentoLigado: true })).toMatchObject({ ok: false, rn: 'RN-PED-02', codigo: 'faturamento_ligado' });
    }
  });
  it('RN-PED-02: cancelado vale nos dois modos a partir de aprovado e faturado_parcial', () => {
    for (const statusAtual of ['aprovado', 'faturado_parcial'] as const) {
      for (const faturamentoLigado of [true, false]) {
        expect(decidirRetornoCliente({ statusAtual, retorno: 'cancelado', faturamentoLigado })).toEqual({ ok: true, acao: 'aplicar', para: 'cancelado', nota: null });
      }
    }
  });
  it('RN-PED-02: transição fora da máquina é recusada com a lista do que é possível', () => {
    expect(decidirRetornoCliente({ statusAtual: 'faturado', retorno: 'cancelado', faturamentoLigado: false })).toMatchObject({ ok: false, rn: 'RN-PED-02', codigo: 'transicao_invalida', possiveis: [] });
    expect(decidirRetornoCliente({ statusAtual: 'cancelado', retorno: 'faturado_total', faturamentoLigado: false })).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
    expect(decidirRetornoCliente({ statusAtual: 'em_analise', retorno: 'faturado_total', faturamentoLigado: false })).toMatchObject({ ok: false, codigo: 'transicao_invalida', possiveis: ['aprovado', 'recusado'] });
  });
});

describe('nota do cliente na entrada: texto do Hub para a referência (T-0057)', () => {
  const AGORA = new Date('2026-11-24T14:00:00.000Z');
  const texto = { numero: '1234', serie: '1', chave: '13261112345678000195550010000012341000000014', emitida_em: '2026-11-24T13:30:00.000Z', total_centavos: 2000 };
  const chaveDe = (c43: string) => {
    let soma = 0;
    let peso = 2;
    for (let i = c43.length - 1; i >= 0; i--) {
      soma += Number(c43[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return `${c43}${r < 2 ? 0 : 11 - r}`;
  };
  const CHAVE = chaveDe('1326111234567800019555001000001234100000001');
  it('RN-PED-02: numero e serie em texto viram inteiros; a chave sai fora da referência e vai só para o evento', () => {
    expect(converterNotaCliente(texto, AGORA)).toEqual({
      ok: true, referencia: { numero: 1234, serie: 1, emitida_em: '2026-11-24T13:30:00.000Z', total_centavos: 2000 }, chave: CHAVE,
    });
    // @ts-expect-error a chave é obrigatória
    expect(converterNotaCliente({ ...texto, chave: undefined }, AGORA)).toMatchObject({ ok: false, campo: 'chave' });
  });
  it.each(['1', '999999999'])('RN-PED-02: numero %s é aceito', (numero) => {
    expect(converterNotaCliente({ ...texto, numero }, AGORA).ok).toBe(true);
  });
  it.each(['0', '01', '1000000000', '-1', '1.5', 'abc', ''])('RN-PED-02: numero "%s" é recusado', (numero) => {
    expect(converterNotaCliente({ ...texto, numero }, AGORA)).toMatchObject({ ok: false, codigo: 'nota_cliente_invalida', campo: 'numero' });
  });
  it.each(['0', '1', '999'])('RN-PED-02: serie %s é aceita', (serie) => {
    expect(converterNotaCliente({ ...texto, serie }, AGORA).ok).toBe(true);
  });
  it.each(['00', '01', '1000', '-1', 'x'])('RN-PED-02: serie "%s" é recusada', (serie) => {
    expect(converterNotaCliente({ ...texto, serie }, AGORA)).toMatchObject({ ok: false, campo: 'serie' });
  });
  it('RN-PED-02: total precisa ser inteiro em centavos, a partir de zero', () => {
    expect(converterNotaCliente({ ...texto, total_centavos: 0 }, AGORA).ok).toBe(true);
    expect(converterNotaCliente({ ...texto, total_centavos: -1 }, AGORA)).toMatchObject({ ok: false, campo: 'total_centavos' });
    expect(converterNotaCliente({ ...texto, total_centavos: 10.5 }, AGORA)).toMatchObject({ ok: false, campo: 'total_centavos' });
  });
  it('RN-PED-02: a data pode ser até agora + 5 min; depois disso é recusada (o "agora" vem por parâmetro)', () => {
    expect(converterNotaCliente({ ...texto, emitida_em: '2026-11-24T14:05:00.000Z' }, AGORA).ok).toBe(true);
    expect(converterNotaCliente({ ...texto, emitida_em: '2026-11-24T14:05:00.001Z' }, AGORA)).toMatchObject({ ok: false, campo: 'emitida_em' });
    expect(converterNotaCliente({ ...texto, emitida_em: 'não é data' }, AGORA)).toMatchObject({ ok: false, campo: 'emitida_em' });
  });
  it('RN-PED-02: a chave precisa ter 44 dígitos e o DV módulo 11 correto', () => {
    expect(converterNotaCliente({ ...texto, chave: `${CHAVE.slice(0, 43)}${(Number(CHAVE[43]) + 1) % 10}` }, AGORA)).toMatchObject({ ok: false, campo: 'chave' });
    expect(converterNotaCliente({ ...texto, chave: CHAVE.slice(1) }, AGORA)).toMatchObject({ ok: false, campo: 'chave' });
  });
});
