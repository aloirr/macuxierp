import { describe, expect, it } from 'vitest';
import { EuResposta } from './eu';

const eu = {
  usuario: { id: '22222222-2222-4222-8222-222222222222', nome: 'Pessoa', perfil: 'faturista' },
  empresa: { id: '11111111-1111-4111-8111-111111111111', slug: 'demo', razao_social: 'Demo Ltda', fuso: 'America/Manaus' },
  filiais: [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Matriz', cnpj: '11.222.333/0001-81' }],
  modulos: [{ id: 'core', menus: [] }],
};

describe('EuResposta (contrato do GET /v1/auth/eu)', () => {
  it('aceita o formato e normaliza o CNPJ da filial (RN-CAD-01)', () => {
    expect(EuResposta.parse(eu).filiais[0]?.cnpj).toBe('11222333000181');
  });

  it('recusa perfil, módulo, CNPJ ou id fora do contrato e descarta campo a mais', () => {
    expect(() => EuResposta.parse({ ...eu, usuario: { ...eu.usuario, perfil: 'dono' } })).toThrow();
    expect(() => EuResposta.parse({ ...eu, modulos: [{ id: 'compras', menus: [] }] })).toThrow();
    expect(() => EuResposta.parse({ ...eu, filiais: [{ ...eu.filiais[0], cnpj: '11.222.333/0001-82' }] })).toThrow();
    expect(() => EuResposta.parse({ ...eu, empresa: { ...eu.empresa, id: 'x' } })).toThrow();
    expect(EuResposta.parse({ ...eu, usuario: { ...eu.usuario, email: 'a@b.c' } }).usuario).not.toHaveProperty('email');
  });

  it('T-0035: avisos_a1 é opcional (compatível) e, quando vem, tem filial, dias inteiros e validade ISO UTC', () => {
    expect(EuResposta.parse(eu)).not.toHaveProperty('avisos_a1');
    const aviso = { filial_id: eu.filiais[0]!.id, dias: -2, valido_ate: '2026-11-19T00:00:00.000Z' };
    expect(EuResposta.parse({ ...eu, avisos_a1: [aviso] }).avisos_a1).toEqual([aviso]);
    expect(EuResposta.parse({ ...eu, avisos_a1: [{ ...aviso, titular: 'Fulano' }] }).avisos_a1?.[0]).not.toHaveProperty('titular');
    expect(() => EuResposta.parse({ ...eu, avisos_a1: [{ ...aviso, dias: 1.5 }] })).toThrow();
    expect(() => EuResposta.parse({ ...eu, avisos_a1: [{ ...aviso, valido_ate: '19/11/2026' }] })).toThrow();
    expect(() => EuResposta.parse({ ...eu, avisos_a1: [{ ...aviso, filial_id: 'x' }] })).toThrow();
  });
});
