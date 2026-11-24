import { describe, expect, it } from 'vitest';
import { planoSubstituicao } from './substituicao';

const ex = (id: string, external_id: string | null, inativo = false) => ({ id, external_id, inativo });
const base = { entidade: 'produto', em_uso: new Set<string>() };

describe('plano de substituição da carga', () => {
  it('RN-CAD-10: no modo adicionar o plano é vazio', () => {
    const r = planoSubstituicao({ ...base, modo: 'adicionar', externos_do_arquivo: ['A'], existentes: [ex('1', 'A'), ex('2', 'B')] });
    expect(r).toEqual({ inativar: [], mantidos_em_uso: 0, sem_chave: 0, percentual_inativado: 0, com_chave: 0 });
  });
  it('RN-CAD-10: substituir tudo inativa o existente que faltou no arquivo', () => {
    const r = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A'], existentes: [ex('1', 'A'), ex('2', 'B')] });
    expect(r.inativar).toEqual(['2']);
    expect(r.mantidos_em_uso).toBe(0);
  });
  it('RN-CAD-10: o que está em uso também é inativado (nunca apagado) e conta como mantido', () => {
    const r = planoSubstituicao({ ...base, em_uso: new Set(['2']), modo: 'substituir_tudo', externos_do_arquivo: ['A'], existentes: [ex('1', 'A'), ex('2', 'B'), ex('3', 'C')] });
    expect(r.inativar).toEqual(['2', '3']);
    expect(r.mantidos_em_uso).toBe(1);
  });
  it('RN-CAD-10: quem já está inativo fica de fora', () => {
    const r = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A'], existentes: [ex('1', 'A'), ex('2', 'B', true)] });
    expect(r.inativar).toEqual([]);
  });
  it('RN-CAD-10: arquivo com todos os existentes não inativa ninguém', () => {
    const r = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A', 'B'], existentes: [ex('1', 'A'), ex('2', 'B')] });
    expect(r).toEqual({ inativar: [], mantidos_em_uso: 0, sem_chave: 0, percentual_inativado: 0, com_chave: 2 });
  });
  it('RN-CAD-10: percentual = inativar / ativos com 2 casas; zero ativos dá 0', () => {
    const r = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: [], existentes: [ex('1', 'A'), ex('2', 'B'), ex('3', 'C')] });
    expect(r.percentual_inativado).toBe(1);
    const p = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A'], existentes: [ex('1', 'A'), ex('2', 'B'), ex('3', 'C')] });
    expect(p.percentual_inativado).toBe(0.67);
    const z = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A'], existentes: [ex('1', 'A', true)] });
    expect(z.percentual_inativado).toBe(0);
  });
  it('RN-CAD-10: external_id repetido no arquivo não muda o plano', () => {
    const r = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A', 'A', 'A'], existentes: [ex('1', 'A'), ex('2', 'B')] });
    expect(r.inativar).toEqual(['2']);
  });
  it('RN-CAD-10: existente ativo sem external_id não é inativado: só conta em sem_chave e fica fora do percentual', () => {
    const r = planoSubstituicao({ ...base, modo: 'substituir_tudo', externos_do_arquivo: ['A'], existentes: [ex('1', 'A'), ex('2', null), ex('3', 'B'), ex('4', null, true)] });
    expect(r.inativar).toEqual(['3']);
    expect(r.sem_chave).toBe(1);
    expect(r.percentual_inativado).toBe(0.5);
  });
});
