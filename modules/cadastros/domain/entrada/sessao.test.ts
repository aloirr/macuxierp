import { describe, expect, it } from 'vitest';
import {
  LIMITE_INATIVACAO_PCT_PADRAO, VALIDADE_CONFIRMACAO_DIAS, alvoDaInativacao, concluirSessao, confirmarInativacao, iniciarSessao, registrarParte, type SessaoCarga,
} from './sessao';

const ex = (id: string, external_id: string | null, inativo = false) => ({ id, external_id, inativo });
const AGORA = '2026-11-24T12:00:00.000Z';
const nova = (): SessaoCarga => iniciarSessao({ id: '11111111-1111-4111-8111-111111111111', entidade: 'produto', iniciada_em: '2026-11-24T11:00:00.000Z' });
const parte = (s: SessaoCarga, n: number, ultimo: boolean, externos: string[], protegidos: string[] = []): SessaoCarga => {
  const r = registrarParte(s, { parte: n, ultimo, externos, protegidos });
  if (!r.ok) throw new Error(r.codigo);
  return r.sessao;
};
const dez = Array.from({ length: 10 }, (_, i) => ex(String(i), `E${i}`));

describe('sessão de carga completa da entrada', () => {
  it('RN-INT-06: o padrão da trava é 30% e a confirmação vale 7 dias', () => {
    expect(LIMITE_INATIVACAO_PCT_PADRAO).toBe(30);
    expect(VALIDADE_CONFIRMACAO_DIAS).toBe(7);
  });

  it('RN-INT-06: aceita as partes em ordem (1, 2, 3...) e junta o que foi visto', () => {
    let s = parte(nova(), 1, false, ['E0', 'E1']);
    s = parte(s, 2, false, ['E2']);
    s = parte(s, 3, true, ['E3']);
    expect(s.vistos).toEqual(['E0', 'E1', 'E2', 'E3']);
    expect(s.ultimo_recebido).toBe(true);
  });

  it('RN-INT-06: parte repetida (reenvio do Conector) é idempotente e não soma de novo', () => {
    const s1 = parte(nova(), 1, false, ['E0']);
    const r = registrarParte(s1, { parte: 1, ultimo: false, externos: ['E9'], protegidos: [] });
    expect(r).toEqual({ ok: true, repetida: true, sessao: s1 });
  });

  it('RN-INT-06: parte que pula número é recusada (parte_fora_de_ordem) e a sessão não muda', () => {
    expect(registrarParte(nova(), { parte: 2, ultimo: false, externos: [], protegidos: [] })).toEqual({ ok: false, codigo: 'parte_fora_de_ordem' });
  });

  it('RN-INT-06: depois do lote "último" a sessão está encerrada e recusa mais partes', () => {
    const s = parte(nova(), 1, true, ['E0']);
    expect(registrarParte(s, { parte: 2, ultimo: false, externos: [], protegidos: [] })).toEqual({ ok: false, codigo: 'sessao_encerrada' });
  });

  it('RN-INT-06: sessão incompleta (sem o último lote) não inativa nada', () => {
    const s = parte(nova(), 1, false, ['E0']);
    const r = concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), agora: AGORA });
    expect(r).toEqual({ estado: 'incompleta', inativar: [] });
  });

  it('RN-INT-06: ao concluir o último lote, inativa os ativos da entidade não vistos desde o início da sessão', () => {
    const s = parte(parte(nova(), 1, false, ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']), 2, true, ['E8']);
    const r = concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), agora: AGORA });
    expect(r.estado).toBe('concluida');
    expect(r.inativar).toEqual(['9']);
  });

  it('RN-INT-06: o registro que veio inválido nunca é inativado: o external_id dele protege', () => {
    const s = parte(nova(), 1, true, ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'], ['E9']);
    const r = concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), agora: AGORA });
    expect(r).toMatchObject({ estado: 'concluida', inativar: [] });
  });

  it('RN-INT-06: quem já está inativo e o ativo sem external_id ficam fora (nada é apagado, só deleted_at)', () => {
    const s = parte(nova(), 1, true, ['A', 'B', 'C', 'D']);
    const r = concluirSessao({ sessao: s, existentes: [ex('1', 'A'), ex('2', 'B'), ex('3', 'C'), ex('4', 'D'), ex('5', 'X', true), ex('6', null)], em_uso: new Set(), agora: AGORA });
    expect(r).toMatchObject({ estado: 'concluida', inativar: [] });
  });

  it('RN-INT-06: trava de 30% - acima do limite o resultado é aguardando_confirmacao, com as inativações paradas', () => {
    const s = parte(nova(), 1, true, ['E0', 'E1', 'E2', 'E3', 'E4', 'E5']); // 4 de 10 = 40%
    const r = concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), agora: AGORA });
    expect(r.estado).toBe('aguardando_confirmacao');
    if (r.estado !== 'aguardando_confirmacao') throw new Error('esperava trava');
    expect(r.inativar).toEqual(['6', '7', '8', '9']);
    expect(r.percentual_pct).toBe(40);
    expect(r.limite_pct).toBe(30);
    expect(r.expira_em).toBe('2026-12-01T12:00:00.000Z');
  });

  it('RN-INT-06: exatamente 30% passa; acima de 30% trava (compara as contagens, sem o arredondamento do percentual)', () => {
    const s30 = parte(nova(), 1, true, ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
    expect(concluirSessao({ sessao: s30, existentes: dez, em_uso: new Set(), agora: AGORA }).estado).toBe('concluida');
    // o percentual arredondado do plano da carga (0,31) não pode esconder a diferença em 304 de 1000 (30,4%)
    const mil = Array.from({ length: 1000 }, (_, i) => ex(String(i), `E${i}`));
    const vistos = mil.slice(0, 696).map((e) => e.external_id as string); // 304 de 1000 = 30,4%
    const s = parte(nova(), 1, true, vistos);
    expect(concluirSessao({ sessao: s, existentes: mil, em_uso: new Set(), agora: AGORA }).estado).toBe('aguardando_confirmacao');
  });

  it('RN-INT-06: o limite é configurável (limite_inativacao_pct); 100 libera tudo e valor fora de 0 a 100 é erro de programação', () => {
    const s = parte(nova(), 1, true, []);
    expect(concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), limite_inativacao_pct: 100, agora: AGORA }).estado).toBe('concluida');
    expect(concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), limite_inativacao_pct: 10, agora: AGORA }).estado).toBe('aguardando_confirmacao');
    expect(() => concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), limite_inativacao_pct: 101, agora: AGORA })).toThrow(RangeError);
  });

  it('RN-INT-06: sem ativos com chave não há o que inativar nem o que travar', () => {
    const s = parte(nova(), 1, true, []);
    expect(concluirSessao({ sessao: s, existentes: [], em_uso: new Set(), agora: AGORA })).toMatchObject({ estado: 'concluida', inativar: [] });
  });

  it('RN-INT-06: o plano é o da carga (planoSubstituicao): conta os inativados em uso e os ativos sem chave', () => {
    const s = parte(nova(), 1, true, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    const r = concluirSessao({ sessao: s, existentes: [...'ABCDEFGHIJ'].map((c, i) => ex(String(i), c)).concat(ex('99', null)), em_uso: new Set(['9']), agora: AGORA });
    expect(r).toMatchObject({ estado: 'concluida', inativar: ['9'], mantidos_em_uso: 1, sem_chave: 1 });
  });

  it('RN-INT-06: a confirmação vale até a expiração (7 dias); depois dela as inativações não saem', () => {
    const s = parte(nova(), 1, true, ['E0']);
    const r = concluirSessao({ sessao: s, existentes: dez, em_uso: new Set(), agora: AGORA });
    if (r.estado !== 'aguardando_confirmacao') throw new Error('esperava trava');
    expect(confirmarInativacao({ inativar: r.inativar, expira_em: r.expira_em }, '2026-11-30T23:59:59.000Z')).toEqual({ ok: true, inativar: r.inativar });
    expect(confirmarInativacao({ inativar: r.inativar, expira_em: r.expira_em }, '2026-12-01T12:00:00.000Z')).toEqual({ ok: false, codigo: 'confirmacao_expirada' });
  });

  it('RN-INT-06: só as entidades com linha própria inativam (forma sozinha e endereço não inativam cliente nem condição)', () => {
    expect(alvoDaInativacao('prazo_pagamento')).toBe('condicao_pagamento');
    expect(alvoDaInativacao('cliente')).toBe('cliente');
    expect(alvoDaInativacao('produto_unidade')).toBe('produto_unidade');
    expect(alvoDaInativacao('cliente_endereco')).toBeNull();
    expect(alvoDaInativacao('forma_pagamento')).toBeNull();
  });
});
