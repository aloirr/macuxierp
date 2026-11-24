import { describe, expect, it } from 'vitest';
import type { RegistroLote } from '../contracts';
import { chaveIdempotencia, conteudoCanonicoLote, dividirAoMeio, geracaoDoReenvio, limiteRegistrosDoLote, montarLotes, ordenarRegistros, precisaFechamento, versaoContratoDoLote } from './lote';

const reg = (id: string, em: string, extra: Record<string, unknown> = {}): RegistroLote => ({ external_id: id, alterado_em: em, ativo: true, ...extra });
const SESSAO = '11111111-1111-4111-8111-111111111111';
const base = { entidade: 'produto' as const, modo: 'delta' as const, enviadoEm: '2026-11-21T20:00:00.000Z' };

describe('T-0085 lote 2: versão do envelope do prazo', () => {
  const prazo = { ...base, entidade: 'prazo_pagamento' as const, registros: [reg('PZ-1', '2026-01-01T00:00:00.000Z')] };
  it('v1 é o padrão: sem a opção, o prazo vai em v1', () => {
    expect(montarLotes(prazo)[0]!.corpo.versao_contrato).toBe('v1');
    expect(versaoContratoDoLote('prazo_pagamento', false)).toBe('v1');
  });
  it('com a opção ligada só o prazo vai em v2; as demais entidades seguem em v1', () => {
    expect(montarLotes({ ...prazo, contratoPrazoV2: true })[0]!.corpo.versao_contrato).toBe('v2');
    expect(montarLotes({ ...base, contratoPrazoV2: true, registros: [reg('P1', '2026-01-01T00:00:00.000Z')] })[0]!.corpo.versao_contrato).toBe('v1');
  });
});

describe('montagem de lote', () => {
  it('RN-INF-02: ordena por alterado_em e external_id em ordem binária C', () => {
    const o = ordenarRegistros([reg('b', '2026-01-01T00:00:01.000Z'), reg('a', '2026-01-01T00:00:01.000Z'), reg('Z', '2026-01-01T00:00:01.000Z'), reg('c', '2026-01-01T00:00:00.000Z')]);
    expect(o.map((r) => r.external_id)).toEqual(['c', 'Z', 'a', 'b']);
  });

  it('RN-INF-02: cursor declarado é o par do último registro', () => {
    const [l] = montarLotes({ ...base, registros: [reg('b', '2026-01-02T00:00:00.000Z'), reg('a', '2026-01-01T00:00:00.000Z')] });
    expect(l!.cursor_declarado).toEqual({ alterado_em: '2026-01-02T00:00:00.000Z', external_id: 'b' });
    expect(l!.corpo.sessao).toBeUndefined();
  });

  it('RF-INF-02: lote de até 5.000 registros; sessão completa em partes 1..n com ultimo na última', () => {
    const regs = Array.from({ length: 12_000 }, (_, i) => reg(`id${String(i).padStart(5, '0')}`, '2026-01-01T00:00:00.000Z'));
    const lotes = montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, registros: regs });
    expect(lotes.map((l) => l.corpo.registros.length)).toEqual([5000, 5000, 2000]);
    expect(lotes.map((l) => l.corpo.sessao)).toEqual([
      { id: SESSAO, parte: 1, ultimo: false },
      { id: SESSAO, parte: 2, ultimo: false },
      { id: SESSAO, parte: 3, ultimo: true },
    ]);
  });

  it('RF-INF-02: corpo não passa de 4 MiB', () => {
    const grande = 'x'.repeat(100_000);
    const regs = Array.from({ length: 100 }, (_, i) => reg(`id${String(i).padStart(3, '0')}`, '2026-01-01T00:00:00.000Z', { nome: grande }));
    const lotes = montarLotes({ ...base, registros: regs });
    expect(lotes.length).toBeGreaterThan(1);
    for (const l of lotes) expect(l.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(lotes.reduce((n, l) => n + l.corpo.registros.length, 0)).toBe(100);
  });

  it('M5: até 500 linhas inválidas detalhadas, o resto só na contagem, no primeiro lote', () => {
    const inv = Array.from({ length: 520 }, (_, i) => ({ external_id: `e${i}`, codigo: 'campo_obrigatorio', campo: 'nome' }));
    const [l] = montarLotes({ ...base, registros: [reg('a', '2026-01-01T00:00:00.000Z')], linhas_invalidas: inv });
    expect(l!.corpo.linhas_invalidas).toHaveLength(500);
    expect(l!.corpo.linhas_invalidas_omitidas).toBe(20);
  });

  it('carga completa exige sessão', () => {
    expect(() => montarLotes({ ...base, modo: 'completo', registros: [] })).toThrow();
  });

  it('completo sem registros = [] (o Hub recusaria lote_vazio)', () => {
    expect(montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, registros: [] })).toEqual([]);
    expect(montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, sessaoParteInicial: 1, registros: [], linhas_invalidas: [] })).toEqual([]);
  });

  it('T-0061: completo em andamento sem registros e com registroDeFechamento monta a parte final só com ele e ultimo: true', () => {
    const fecho = reg('f', '2026-01-01T00:00:00.000Z', { nome: 'x' });
    const lotes = montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, sessaoParteInicial: 3, registros: [], registroDeFechamento: fecho });
    expect(lotes).toHaveLength(1);
    expect(lotes[0]!.corpo.registros).toEqual([fecho]);
    expect(lotes[0]!.corpo.sessao).toEqual({ id: SESSAO, parte: 3, ultimo: true });
    expect(lotes[0]!.cursor_declarado).toEqual({ alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'f' });
  });

  it('T-0061: completo em andamento sem registros e sem registroDeFechamento devolve [] (nunca parte vazia com ultimo)', () => {
    expect(montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, sessaoParteInicial: 3, registros: [] })).toEqual([]);
  });

  it('T-0061: o registroDeFechamento só vale na parte final vazia (com registros, ou sem sessão em andamento, é ignorado)', () => {
    const fecho = reg('f', '2026-01-01T00:00:00.000Z');
    const [l] = montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, sessaoParteInicial: 2, registros: [reg('a', '2026-01-02T00:00:00.000Z')], registroDeFechamento: fecho });
    expect(l!.corpo.registros.map((r) => r.external_id)).toEqual(['a']);
    expect(montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, registros: [], registroDeFechamento: fecho })).toEqual([]);
    expect(montarLotes({ ...base, registros: [], registroDeFechamento: fecho })).toEqual([]);
  });

  it('T-0061: com registroDeFechamento, o cursor do lote é o cursor local (cursorDeFechamento), nunca o do registro', () => {
    const fecho = reg('f', '2026-01-01T00:00:00.000Z');
    const local = { alterado_em: '2026-01-05T00:00:00.000Z', external_id: 'z' };
    const [l] = montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, sessaoParteInicial: 2, registros: [], registroDeFechamento: fecho, cursorDeFechamento: local });
    expect(l!.corpo.cursor).toEqual(local);
    expect(l!.cursor_declarado).toEqual(local);
    expect(l!.corpo.registros.map((r) => r.external_id)).toEqual(['f']);
  });

  it('T-0061: sem registros válidos mas com linhas inválidas, o fecho entra junto das linhas inválidas na parte final', () => {
    const fecho = reg('f', '2026-01-01T00:00:00.000Z');
    const [l] = montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, sessaoParteInicial: 2, registros: [], linhas_invalidas: [{ external_id: 'x', codigo: 'campo_obrigatorio', campo: 'sku' }], registroDeFechamento: fecho });
    expect(l!.corpo.registros.map((r) => r.external_id)).toEqual(['f']);
    expect(l!.corpo.linhas_invalidas.map((i) => i.external_id)).toEqual(['x']);
    expect(l!.corpo.sessao).toEqual({ id: SESSAO, parte: 2, ultimo: true });
  });

  it('T-0061: precisaFechamento só na parte final de sessão completa em andamento, sem registros válidos', () => {
    const ok = { modo: 'completo' as const, sessaoParteInicial: 2, sessaoContinua: false, registrosValidos: 0 };
    expect(precisaFechamento(ok)).toBe(true);
    expect(precisaFechamento({ ...ok, modo: 'delta' })).toBe(false);
    expect(precisaFechamento({ ...ok, sessaoParteInicial: 1 })).toBe(false);
    expect(precisaFechamento({ ...ok, sessaoParteInicial: undefined })).toBe(false);
    expect(precisaFechamento({ ...ok, sessaoContinua: true })).toBe(false);
    expect(precisaFechamento({ ...ok, registrosValidos: 1 })).toBe(false);
  });
});

describe('limite de registros por lote', () => {
  it('RN-INF-03: vale o menor entre o da credencial e o do contrato (5.000); sem credencial, o do contrato', () => {
    expect(limiteRegistrosDoLote(100)).toBe(100);
    expect(limiteRegistrosDoLote(9000)).toBe(5000);
    expect(limiteRegistrosDoLote()).toBe(5000);
  });
});

describe('lote vazio', () => {
  it('RF-INF-02: delta sem registros e sem linhas inválidas não gera lote; com linha inválida gera', () => {
    expect(montarLotes({ ...base, registros: [] })).toEqual([]);
    expect(montarLotes({ ...base, registros: [], linhas_invalidas: [{ external_id: 'e', codigo: 'campo_obrigatorio', campo: 'nome' }] })).toHaveLength(1);
  });
});

describe('Idempotency-Key e geração', () => {
  const [l] = montarLotes({ ...base, registros: [reg('a', '2026-01-01T00:00:00.000Z')] });
  const corpo = l!.corpo;

  it('RN-INF-03: mesma chave para o mesmo conteúdo, ainda que enviado_em e cursor mudem', () => {
    const outro = { ...corpo, enviado_em: '2030-01-01T00:00:00.000Z', cursor: null };
    expect(chaveIdempotencia(outro, 1)).toBe(chaveIdempotencia(corpo, 1));
    expect(chaveIdempotencia(corpo, 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('RN-INF-03: conteúdo diferente ou geração nova muda a chave', () => {
    expect(chaveIdempotencia(corpo, 2)).not.toBe(chaveIdempotencia(corpo, 1));
    expect(chaveIdempotencia({ ...corpo, registros: [] }, 1)).not.toBe(chaveIdempotencia(corpo, 1));
    expect(conteudoCanonicoLote(corpo)).not.toContain('enviado_em');
  });

  it('RN-INF-04: reenvio depois de falhou ou recusado usa geração nova; retentativa mantém', () => {
    expect(geracaoDoReenvio('falhou', 1)).toBe(2);
    expect(geracaoDoReenvio('recusado', 3)).toBe(4);
    expect(geracaoDoReenvio('enviando', 2)).toBe(2);
    expect(geracaoDoReenvio('montado', 1)).toBe(1);
    expect(geracaoDoReenvio('aceito', 1)).toBe(1);
  });

  it('RN-INF-03: mesmo conteúdo depois de concluido_com_erros usa geração nova e chave diferente', () => {
    const g = geracaoDoReenvio('concluido_com_erros', 1);
    expect(g).toBe(2);
    expect(geracaoDoReenvio('concluido', 4)).toBe(5);
    expect(chaveIdempotencia(corpo, g)).not.toBe(chaveIdempotencia(corpo, 1));
  });

  it('RN-INF-03: congelamento da Idempotency-Key de um corpo fixo', () => {
    const fixo = { ...corpo, registros: [reg('a', '2026-01-01T00:00:00.000Z', { nome: 'X' })], linhas_invalidas: [], linhas_invalidas_omitidas: 0 };
    expect(chaveIdempotencia(fixo, 1)).toBe('f0be623fdfa5211f017b3f09a0e7c13b773a300fbdb4425a287a3afd0a6ecbcf');
  });

  it('413: divide ao meio com geração nova; sessão mantém a parte e avança a segunda', () => {
    const regs = Array.from({ length: 5 }, (_, i) => reg(`id${i}`, '2026-01-01T00:00:00.000Z'));
    const [lote] = montarLotes({ ...base, modo: 'completo', sessaoId: SESSAO, registros: regs });
    const [a, b] = dividirAoMeio(lote!)!;
    expect(a.corpo.registros).toHaveLength(3);
    expect(b.corpo.registros).toHaveLength(2);
    expect(a.geracao).toBe(2);
    expect(b.geracao).toBe(2);
    expect(a.chave_idempotencia).not.toBe(lote!.chave_idempotencia);
    expect(a.corpo.sessao).toEqual({ id: SESSAO, parte: 1, ultimo: false });
    expect(b.corpo.sessao).toEqual({ id: SESSAO, parte: 2, ultimo: true });
    expect(a.cursor_declarado?.external_id).toBe('id2');
    expect(b.cursor_declarado?.external_id).toBe('id4');
    expect(dividirAoMeio(montarLotes({ ...base, registros: [regs[0]!] })[0]!)).toBeNull();
  });
});

describe('RF-INF-02: sessão continuada (parte inicial e continuação)', () => {
  const regs = [reg('a', '2026-01-01T00:00:00.000Z'), reg('b', '2026-01-02T00:00:00.000Z')];
  const sessaoId = '11111111-1111-4111-8111-111111111111';

  it('a parte começa onde a sessão parou e só a última leva ultimo', () => {
    const [meio] = montarLotes({ entidade: 'produto', modo: 'completo', registros: regs, enviadoEm: '2026-11-21T20:00:00.000Z', sessaoId, sessaoParteInicial: 3, sessaoContinua: true });
    expect(meio!.corpo.sessao).toEqual({ id: sessaoId, parte: 3, ultimo: false });
    const [fim] = montarLotes({ entidade: 'produto', modo: 'completo', registros: regs, enviadoEm: '2026-11-21T20:00:00.000Z', sessaoId, sessaoParteInicial: 3 });
    expect(fim!.corpo.sessao).toEqual({ id: sessaoId, parte: 3, ultimo: true });
  });
});
