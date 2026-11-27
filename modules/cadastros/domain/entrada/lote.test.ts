import { CODIGOS_ERRO_LINHA_HUB, LoteResultado } from '@macuxierp/platform-sdk/hub-v1';
import { describe, expect, it } from 'vitest';
import {
  LIMITE_ERROS_GUARDADOS, codigoLinhaHub, repetidosNoLote, cursorDoLote, errosDoLote, estadoFinalDoLote, maisNovoQue, obsoletosDoLote, cursorDepoisDoLote, reprocessavel, resultadoDoLote,
} from './lote';

const erro = (linha: number, codigo: string, campo: string | null = null) => ({ linha, campo, codigo, motivo: 'texto com 12.345.678/0001-95 que não pode sair' });

describe('RN-INT-03: código por linha do Hub (decisão 3 do T-0057)', () => {
  it('só devolve código da lista do Hub, em minúsculas', () => {
    for (const c of ['CARGA_OBRIGATORIO', 'CARGA_FORMATO', 'CARGA_TAMANHO', 'CARGA_REFERENCIA', 'CARGA_DEPENDENCIA', 'CARGA_DUPLICADO', 'CARGA_CONFLITO', 'CARGA_BANCO', 'RN-CAD-01', 'D8', 'PERFIL_SEM_PERMISSAO', 'QUALQUER_COISA']) {
      expect(CODIGOS_ERRO_LINHA_HUB).toContain(codigoLinhaHub(c));
    }
  });
  it('mapeia cada código da carga ao do Hub; sem código próprio vira valor_nao_permitido', () => {
    expect(codigoLinhaHub('CARGA_OBRIGATORIO')).toBe('campo_obrigatorio');
    expect(codigoLinhaHub('CARGA_FORMATO')).toBe('formato_invalido');
    expect(codigoLinhaHub('CARGA_TAMANHO')).toBe('valor_fora_da_faixa');
    expect(codigoLinhaHub('CARGA_DEPENDENCIA')).toBe('referencia_ausente');
    expect(codigoLinhaHub('CARGA_CONFLITO')).toBe('regra_invalida');
    expect(codigoLinhaHub('RN-CAD-02')).toBe('regra_invalida');
    expect(codigoLinhaHub('CARGA_BANCO')).toBe('falha_processamento');
    expect(codigoLinhaHub('PERFIL_SEM_PERMISSAO')).toBe('valor_nao_permitido');
  });
  it('só referencia_ausente e falha_processamento são reprocessáveis', () => {
    expect(CODIGOS_ERRO_LINHA_HUB.filter(reprocessavel)).toEqual(['referencia_ausente', 'falha_processamento']);
  });
});

describe('RN-INT-01: erros por linha sem o dado (LGPD)', () => {
  const externos = ['A', 'B', 'C'];
  it('o índice é o do registro (linha 2 do kit = índice 0) e o texto da linha não é guardado', () => {
    const r = errosDoLote([erro(2, 'CARGA_OBRIGATORIO', 'nome'), erro(4, 'RN-CAD-01', 'cnpj')], externos);
    expect(r.erros).toEqual([
      { indice: 0, external_id: 'A', campo: 'nome', codigo: 'campo_obrigatorio' },
      { indice: 2, external_id: 'C', campo: 'cnpj', codigo: 'regra_invalida' },
    ]);
    expect(JSON.stringify(r.erros)).not.toContain('12.345');
    expect([...r.indicesComErro]).toEqual([0, 2]);
  });
  it('linha fora do lote vira índice 0; repetido (mesmo índice, campo e código) conta uma vez', () => {
    const r = errosDoLote([erro(0, 'CARGA_BANCO'), erro(0, 'CARGA_BANCO')], externos);
    expect(r.erros).toEqual([{ indice: 0, external_id: 'A', campo: null, codigo: 'falha_processamento' }]);
  });
  it('guarda até o limite e informa o total e os omitidos', () => {
    const muitos = Array.from({ length: LIMITE_ERROS_GUARDADOS + 3 }, (_, i) => erro(i + 2, 'CARGA_FORMATO', 'x'));
    const r = errosDoLote(muitos, muitos.map((_, i) => `E${i}`));
    expect(r.erros).toHaveLength(LIMITE_ERROS_GUARDADOS);
    expect(r.total).toBe(LIMITE_ERROS_GUARDADOS + 3);
    expect(r.omitidos).toBe(3);
  });
});

describe('cursor do delta (ADR 0014 §3): o último registro aplicado', () => {
  const reg = (indice: number, alterado_em: string, external_id: string) => ({ indice, alterado_em, external_id });
  it('é o maior (alterado_em, external_id) entre os registros sem erro', () => {
    const c = cursorDoLote([reg(0, '2026-11-20T10:00:00.000Z', 'A'), reg(1, '2026-11-21T10:00:00.000Z', 'B'), reg(2, '2026-11-21T10:00:00.000Z', 'C'), reg(3, '2026-11-22T10:00:00.000Z', 'D')], new Set([3]));
    expect(c).toEqual({ alterado_em: '2026-11-21T10:00:00.000Z', external_id: 'C' });
  });
  it('sem registro aplicado não há cursor', () => {
    expect(cursorDoLote([reg(0, '2026-11-20T10:00:00.000Z', 'A')], new Set([0]))).toBeNull();
    expect(cursorDoLote([], new Set())).toBeNull();
  });
  it('o cursor guardado nunca anda para trás', () => {
    const a = { alterado_em: '2026-11-21T10:00:00.000Z', external_id: 'B' };
    expect(maisNovoQue({ alterado_em: '2026-11-21T10:00:00.000Z', external_id: 'C' }, a)).toBe(true);
    expect(maisNovoQue({ alterado_em: '2026-11-20T10:00:00.000Z', external_id: 'Z' }, a)).toBe(false);
    expect(maisNovoQue(a, a)).toBe(false);
    expect(maisNovoQue(a, null)).toBe(true);
  });
});

describe('obsoletos do delta (ADR 0014 §3; contrato ContagensLote.obsoletas: versão mais antiga que a atual não grava)', () => {
  const cursor = { alterado_em: '2026-11-21T10:00:00.000Z', external_id: 'M' };
  const r = (indice: number, alterado_em: string, external_id: string) => ({ indice, alterado_em, external_id });
  it('ADR 0014 §3 (sem RN no 03): só o registro estritamente anterior ao cursor (alterado_em, external_id) é obsoleto', () => {
    const o = obsoletosDoLote([
      r(0, '2026-11-20T10:00:00.000Z', 'Z'), r(1, '2026-11-21T10:00:00.000Z', 'A'), r(2, '2026-11-21T10:00:00.000Z', 'M'),
      r(3, '2026-11-21T10:00:00.000Z', 'N'), r(4, '2026-11-22T10:00:00.000Z', 'A'),
    ], cursor);
    expect([...o]).toEqual([0, 1]);
  });
  it('ADR 0014 §3: sem cursor nada é obsoleto', () => {
    expect(obsoletosDoLote([r(0, '2020-01-01T00:00:00.000Z', 'A')], null).size).toBe(0);
  });
  it('ADR 0014 §3: o cursor depois do lote é o maior entre o do lote e o já guardado (nunca recua)', () => {
    const novo = { alterado_em: '2026-11-22T10:00:00.000Z', external_id: 'A' };
    expect(cursorDepoisDoLote(null, cursor)).toEqual(cursor);
    expect(cursorDepoisDoLote(novo, cursor)).toEqual(novo);
    expect(cursorDepoisDoLote({ alterado_em: '2026-11-20T10:00:00.000Z', external_id: 'Z' }, cursor)).toEqual(cursor);
    expect(cursorDepoisDoLote(null, null)).toBeNull();
  });
});

describe('estado final e resultado do lote', () => {
  it('concluido sem erro e concluido_com_erros com erro', () => {
    expect(estadoFinalDoLote(0)).toBe('concluido');
    expect(estadoFinalDoLote(2)).toBe('concluido_com_erros');
  });
  it('monta o LoteResultado do contrato do SDK com status (nunca estado) e mensagens fixas', () => {
    const r = resultadoDoLote({
      id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c', entidade: 'filial', modo: 'delta', estado: 'concluido_com_erros',
      contagens: { recebidas: 3, duplicadas_no_lote: 0, com_erro: 1, novas: 1, atualizadas: 1, inalteradas: 0, obsoletas: 0, erros_total: 1, erros_omitidos: 0, invalidas_omitidas: 0 },
      erros: [{ indice: 1, external_id: 'B', campo: 'cnpj', codigo: 'regra_invalida' }],
      cursor_alterado_em: '2026-11-21T10:00:00.000Z', cursor_external_id: 'A',
      recebido_em: '2026-11-26T12:00:00.000Z', concluido_em: '2026-11-26T12:00:05.000Z', erro_codigo: null,
    }, 1000);
    expect(LoteResultado.parse(r)).toEqual(r);
    expect(r).toMatchObject({ status: 'concluido_com_erros', cursor: { alterado_em: '2026-11-21T10:00:00.000Z', external_id: 'A' }, erros_total: 1, erros_omitidos: 0 });
    expect(r.erros[0]).toMatchObject({ indice: 1, codigo: 'regra_invalida', reprocessavel: false, origem: 'hub' });
    expect(r).not.toHaveProperty('estado');
  });
  it('lote ainda na fila vem sem cursor, sem erros e sem conclusão; o limite de erros da consulta corta a lista', () => {
    const base = {
      id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c', entidade: 'cliente', modo: 'delta' as const, estado: 'recebido' as const, contagens: {}, erros: [],
      cursor_alterado_em: null, cursor_external_id: null, recebido_em: '2026-11-26T12:00:00.000Z', concluido_em: null, erro_codigo: null,
    };
    const r = resultadoDoLote(base, 1000);
    expect(LoteResultado.parse(r)).toEqual(r);
    expect(r).toMatchObject({ status: 'recebido', cursor: null, concluido_em: null, contagens: { recebidas: 0, novas: 0 } });
    const cortado = resultadoDoLote({ ...base, estado: 'concluido_com_erros', contagens: { erros_total: 3 }, erros: [0, 1, 2].map((i) => ({ indice: i, external_id: null, campo: null, codigo: 'campo_obrigatorio' as const })) }, 2);
    expect(cortado.erros).toHaveLength(2);
    expect(cortado).toMatchObject({ erros_total: 3, erros_omitidos: 1 });
  });
});

describe('delta com o mesmo external_id mais de uma vez (duplicado_no_lote)', () => {
  it('vale o último do lote; os anteriores saem sem erro e são contados', () => {
    const r = repetidosNoLote([{ indice: 0, external_id: 'A' }, { indice: 1, external_id: 'B' }, { indice: 2, external_id: 'A' }, { indice: 3, external_id: 'A' }]);
    expect([...r]).toEqual([0, 2]);
  });
  it('sem repetição, nada sai', () => {
    expect(repetidosNoLote([{ indice: 0, external_id: 'A' }, { indice: 1, external_id: 'B' }]).size).toBe(0);
  });
});
