import { describe, expect, it } from 'vitest';
import { avaliarTrocaAmbiente } from './ambiente';
import { alertaVencimento, avaliarA1Valido, avaliarCertificado, diasParaVencer } from './certificado';
import { avaliarAlteracaoUsuario, gerarSenhaProvisoria } from './usuarios';

const AGORA = new Date('2026-11-21T15:00:00Z');
const dia = (n: number) => new Date(AGORA.getTime() + n * 86_400_000);
/** Bytes determinísticos no lugar de `randomBytes`: o domain não usa módulo do Node. */
const bytes = (n: number, semente: number) => Uint8Array.from({ length: n }, (_, i) => (i * 131 + semente * 17 + (i >> 3) * 29) % 256);
const CNPJ_EMPRESA = '11222333000181';

describe('RN-CORE-06: certificado A1 na entrada', () => {
  const base = { cnpjEmpresa: CNPJ_EMPRESA, cnpjCertificado: '11222333000262', validoDe: dia(-300), validoAte: dia(60), agora: AGORA, fuso: 'America/Manaus' };

  it('RN-CORE-06: aceita certificado da mesma raiz de CNPJ e na validade (D4: filial com outro sufixo)', () => {
    expect(avaliarCertificado(base)).toEqual({ ok: true });
  });

  it('RN-CORE-06: recusa certificado de outra raiz de CNPJ', () => {
    const r = avaliarCertificado({ ...base, cnpjCertificado: '99888777000155' });
    expect(r).toMatchObject({ ok: false, motivo: 'outra_raiz' });
  });

  it('RN-CORE-06: recusa vencido com "Certificado vencido em DD/MM/AAAA: envie o novo" no fuso do tenant', () => {
    // vence 21/11/2026 02:00 UTC = 20/11/2026 22:00 em Manaus
    const r = avaliarCertificado({ ...base, validoAte: new Date('2026-11-21T02:00:00Z') });
    expect(r).toEqual({ ok: false, motivo: 'vencido', mensagem: 'Certificado vencido em 20/11/2026: envie o novo' });
  });

  it('RN-CORE-06: recusa certificado que ainda não começou a valer', () => {
    expect(avaliarCertificado({ ...base, validoDe: dia(2) })).toMatchObject({ ok: false, motivo: 'ainda_nao_vale' });
  });

  it('RN-CORE-06: a raiz alfanumérica também é comparada', () => {
    expect(avaliarCertificado({ ...base, cnpjEmpresa: '12ABC34501DE35', cnpjCertificado: '12ABC34500AB11' })).toEqual({ ok: true });
  });
});

describe('RF-CORE-04: alerta de vencimento do A1', () => {
  it('RF-CORE-04: conta os dias inteiros que faltam', () => {
    expect(diasParaVencer(dia(30), AGORA)).toBe(30);
    expect(diasParaVencer(new Date(AGORA.getTime() + 29.5 * 86_400_000), AGORA)).toBe(29);
    expect(diasParaVencer(dia(-1), AGORA)).toBe(-1);
  });

  it('RF-CORE-04: alerta a 30 dias ou menos, inclusive vencido; sem alerta a 31', () => {
    expect(alertaVencimento(dia(31), AGORA)).toBe(false);
    expect(alertaVencimento(dia(30), AGORA)).toBe(true);
    expect(alertaVencimento(dia(0.5), AGORA)).toBe(true);
    expect(alertaVencimento(dia(-5), AGORA)).toBe(true);
  });
});

describe('RN-CORE-08: ambiente fiscal por filial', () => {
  const ok = 'R-20261121-153000-alexandre';

  it('RN-CORE-08: sem linha vale homologação (atual nulo) e voltar para homologação não pede recado', () => {
    expect(avaliarTrocaAmbiente({ atual: null, novo: 'homologacao', recado: null })).toEqual({ ok: true, ambiente: 'homologacao', recado: null });
  });

  it('RN-CORE-08: produção exige o recado de aprovação do Alexandre', () => {
    expect(avaliarTrocaAmbiente({ atual: null, novo: 'producao', recado: null })).toMatchObject({ ok: false });
    expect(avaliarTrocaAmbiente({ atual: 'homologacao', novo: 'producao', recado: 'R-20261121-153000-joao' })).toMatchObject({ ok: false });
    expect(avaliarTrocaAmbiente({ atual: 'homologacao', novo: 'producao', recado: 'R-2026-alexandre' })).toMatchObject({ ok: false });
  });

  it('RN-CORE-08: aceita R-AAAAMMDD-HHMMSS-alexandre e com sufixo numérico, registrando o recado', () => {
    expect(avaliarTrocaAmbiente({ atual: 'homologacao', novo: 'producao', recado: ok })).toEqual({ ok: true, ambiente: 'producao', recado: ok });
    expect(avaliarTrocaAmbiente({ atual: null, novo: 'producao', recado: 'R-20261121-153000-2-alexandre' })).toMatchObject({ ok: true });
  });

  it('RN-CORE-08: voltar à homologação descarta o recado enviado', () => {
    expect(avaliarTrocaAmbiente({ atual: 'producao', novo: 'homologacao', recado: ok })).toEqual({ ok: true, ambiente: 'homologacao', recado: null });
  });
});

describe('RN-CORE-01: usuário, perfil e último administrador', () => {
  const adm = { id: 'a', perfil: 'administrador' as const, ativo: true };

  it('RN-CORE-01: o tenant não pode ficar sem administrador ativo (inativar)', () => {
    expect(avaliarAlteracaoUsuario({ atual: adm, alteracao: { ativo: false }, outrosAdministradoresAtivos: 0 })).toMatchObject({ ok: false });
    expect(avaliarAlteracaoUsuario({ atual: adm, alteracao: { ativo: false }, outrosAdministradoresAtivos: 1 })).toEqual({ ok: true });
  });

  it('RN-CORE-01: o tenant não pode ficar sem administrador ativo (rebaixar perfil)', () => {
    expect(avaliarAlteracaoUsuario({ atual: adm, alteracao: { perfil: 'gerente' }, outrosAdministradoresAtivos: 0 })).toMatchObject({ ok: false });
    expect(avaliarAlteracaoUsuario({ atual: adm, alteracao: { perfil: 'administrador' }, outrosAdministradoresAtivos: 0 })).toEqual({ ok: true });
  });

  it('RN-CORE-01: alterar não administrador nunca é bloqueado pela regra', () => {
    const g = { id: 'g', perfil: 'gerente' as const, ativo: true };
    expect(avaliarAlteracaoUsuario({ atual: g, alteracao: { ativo: false }, outrosAdministradoresAtivos: 0 })).toEqual({ ok: true });
  });

  it('RF-CORE-02: senha provisória tem 16 caracteres sem ambíguos, varia por bytes e cobre todas as classes', () => {
    const s = gerarSenhaProvisoria(bytes(256, 1));
    expect(s).toMatch(/^[A-HJ-NP-Za-km-z2-9!@#%+=?]{16}$/);
    expect(s).toMatch(/[A-Z]/);
    expect(s).toMatch(/[a-z]/);
    expect(s).toMatch(/[0-9]/);
    expect(gerarSenhaProvisoria(bytes(256, 2))).not.toBe(s);
  });

  it('RF-CORE-02: senha provisória recusa bytes insuficientes', () => {
    expect(() => gerarSenhaProvisoria(bytes(3, 1))).toThrow();
  });
});

describe('RN-CORE-06: validade do A1 (função única)', () => {
  const agora = new Date('2026-11-21T15:00:00Z');
  const fuso = 'America/Manaus';
  it('RN-CORE-06: avaliarCertificado e avaliarA1Valido dão a mesma mensagem para o mesmo certificado', () => {
    const validoDe = new Date('2025-01-01T00:00:00Z');
    const validoAte = new Date('2026-11-20T12:00:00Z');
    const a = avaliarCertificado({ cnpjEmpresa: '11222333000181', cnpjCertificado: '11222333000181', validoDe, validoAte, agora, fuso });
    const b = avaliarA1Valido({ validoDe, validoAte }, agora, fuso);
    expect(a.ok ? '' : a.mensagem).toBe(b.valido ? '' : b.mensagem);
  });
});

describe('RN-CORE-06: filial tem A1 válido (porta para o cadastros)', () => {
  const agora = new Date('2026-11-21T15:00:00Z');
  const fuso = 'America/Manaus';
  it('RN-CORE-06: sem certificado ativo, não é válido', () => {
    expect(avaliarA1Valido(null, agora, fuso)).toMatchObject({ valido: false, motivo: 'sem_certificado' });
  });
  it('RN-CORE-06: vencido bloqueia, com a mensagem "Certificado vencido em DD/MM/AAAA: envie o novo"', () => {
    const r = avaliarA1Valido({ validoDe: new Date('2025-01-01T00:00:00Z'), validoAte: new Date('2026-11-20T12:00:00Z') }, agora, fuso);
    expect(r).toEqual({ valido: false, motivo: 'vencido', mensagem: 'Certificado vencido em 20/11/2026: envie o novo' });
  });
  it('RN-CORE-06: ainda não vale não é válido', () => {
    expect(avaliarA1Valido({ validoDe: new Date('2026-12-01T00:00:00Z'), validoAte: new Date('2027-12-01T00:00:00Z') }, agora, fuso)).toMatchObject({ valido: false, motivo: 'ainda_nao_vale' });
  });
  it('RN-CORE-06: na validade é válido, com validade e dias para vencer', () => {
    const r = avaliarA1Valido({ validoDe: new Date('2026-01-01T00:00:00Z'), validoAte: new Date('2026-12-01T15:00:00Z') }, agora, fuso);
    expect(r).toEqual({ valido: true, valido_ate: '2026-12-01T15:00:00.000Z', dias_para_vencer: 10 });
  });
});
