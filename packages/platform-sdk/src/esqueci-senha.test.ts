import { describe, expect, it } from 'vitest';
import { corpoErroApi, erros } from './erros';
import {
  CAMINHOS_ESQUECI_SENHA,
  CodigoEmpresaLogin,
  emailSenhaTemporaria,
  LIMITES_ESQUECI_SENHA,
  MENSAGEM_ESQUECI_NEUTRA,
  MuitasTentativasResposta,
  PedidoSenhaTemporariaResposta,
  PedirSenhaTemporariaEntrada,
  PedirSenhaTemporariaPlataformaEntrada,
  SenhaATrocarResposta,
  SituacaoEsqueciResposta,
  VALIDADE_SENHA_TEMPORARIA_HORAS,
} from './esqueci-senha';
import { CODIGO_TROCAR_SENHA } from './eu';

describe('RN-CORE-13: pedido da senha temporária (POST /v1/auth/esqueci e /v1/plataforma/auth/esqueci)', () => {
  it('entrada do tenant: código da empresa (trim, 1–60) e e-mail normalizado', () => {
    expect(PedirSenhaTemporariaEntrada.parse({ empresa: ' AM2808 ', email: ' Ana@Exemplo.COM ' })).toEqual({ empresa: 'AM2808', email: 'ana@exemplo.com' });
    expect(() => PedirSenhaTemporariaEntrada.parse({ empresa: '   ', email: 'a@b.co' })).toThrow();
    expect(() => PedirSenhaTemporariaEntrada.parse({ empresa: 'x'.repeat(61), email: 'a@b.co' })).toThrow();
    expect(() => PedirSenhaTemporariaEntrada.parse({ empresa: 'AM2808', email: 'sem-arroba' })).toThrow();
    expect(PedirSenhaTemporariaEntrada.parse({ empresa: 'AM2808', email: 'a@b.co', senha: 'x' })).not.toHaveProperty('senha');
    expect(CodigoEmpresaLogin.parse('x'.repeat(60))).toHaveLength(60);
  });

  it('entrada do superadmin: só o e-mail', () => {
    expect(PedirSenhaTemporariaPlataformaEntrada.parse({ email: 'Root@Exemplo.com' })).toEqual({ email: 'root@exemplo.com' });
    expect(() => PedirSenhaTemporariaPlataformaEntrada.parse({})).toThrow();
  });

  it('resposta 202 neutra: só o texto fixo, tenha ou não a conta', () => {
    expect(PedidoSenhaTemporariaResposta.parse({ mensagem: MENSAGEM_ESQUECI_NEUTRA })).toEqual({ mensagem: MENSAGEM_ESQUECI_NEUTRA });
    expect(() => PedidoSenhaTemporariaResposta.parse({ mensagem: 'Conta não encontrada' })).toThrow();
  });

  it('situação: esqueci_disponivel booleano (false sem os PROD_SMTP_*)', () => {
    expect(SituacaoEsqueciResposta.parse({ esqueci_disponivel: false })).toEqual({ esqueci_disponivel: false });
    expect(() => SituacaoEsqueciResposta.parse({ esqueci_disponivel: 'sim' })).toThrow();
  });

  it('caminhos, validade de 72 h e limites do FDV, congelados', () => {
    expect(CAMINHOS_ESQUECI_SENHA).toEqual({ tenant: '/v1/auth/esqueci', plataforma: '/v1/plataforma/auth/esqueci', situacao: '/v1/auth/esqueci/situacao' });
    expect(VALIDADE_SENHA_TEMPORARIA_HORAS).toBe(72);
    expect(LIMITES_ESQUECI_SENHA).toEqual({ por_ip: { maximo: 5, janela_s: 900 }, por_conta: { maximo: 3, janela_s: 3600 } });
    expect(Object.isFrozen(CAMINHOS_ESQUECI_SENHA)).toBe(true);
    expect(Object.isFrozen(LIMITES_ESQUECI_SENHA.por_ip) && Object.isFrozen(LIMITES_ESQUECI_SENHA.por_conta)).toBe(true);
  });
});

describe('RN-CORE-13: 429 MUITAS_TENTATIVAS com retry_after_s no envelope de erro', () => {
  it('erros.muitasTentativas leva retry_after_s em detalhes e o corpo passa no contrato', () => {
    const corpo = corpoErroApi(erros.muitasTentativas('Muitas tentativas: tente de novo em alguns minutos', 120));
    expect(corpo).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas: tente de novo em alguns minutos', detalhes: { retry_after_s: 120 } });
    expect(MuitasTentativasResposta.parse(corpo)).toEqual(corpo);
  });

  it('sem retry_after_s segue compatível com o login atual (sem detalhes)', () => {
    expect(corpoErroApi(erros.muitasTentativas('Acesso travado'))).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'Acesso travado' });
  });

  it('retry_after_s é inteiro ≥ 1', () => {
    expect(() => erros.muitasTentativas('x', 0)).toThrow(RangeError);
    expect(() => erros.muitasTentativas('x', 1.5)).toThrow(RangeError);
    expect(() => MuitasTentativasResposta.parse({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'x', detalhes: { retry_after_s: 0 } })).toThrow();
    expect(() => MuitasTentativasResposta.parse({ codigo: 'OUTRO', mensagem: 'x', detalhes: { retry_after_s: 5 } })).toThrow();
  });
});

describe('RN-CORE-13: 403 da troca obrigatória (provisória ou temporária)', () => {
  it('reaproveita CODIGO_TROCAR_SENHA, com motivo e expira_em opcional', () => {
    const base = { codigo: CODIGO_TROCAR_SENHA, mensagem: 'Troque a senha para continuar' };
    expect(SenhaATrocarResposta.parse({ ...base, motivo: 'provisoria' })).toEqual({ ...base, motivo: 'provisoria' });
    const temp = { ...base, motivo: 'temporaria', expira_em: '2026-11-26T14:00:00.000Z' };
    expect(SenhaATrocarResposta.parse(temp)).toEqual(temp);
    expect(() => SenhaATrocarResposta.parse({ ...base, motivo: 'outra' })).toThrow();
    expect(() => SenhaATrocarResposta.parse({ ...temp, expira_em: '26/11/2026' })).toThrow();
    expect(() => SenhaATrocarResposta.parse({ ...base, codigo: 'SENHA_A_TROCAR', motivo: 'provisoria' })).toThrow();
  });
});

describe('RN-CORE-13: e-mail da senha temporária', () => {
  it('texto simples com a senha, 72 h, uso único e troca no primeiro acesso, sem dado do destinatário', () => {
    const e = emailSenhaTemporaria({ senha: 'Tmp#2026ab', validade_horas: VALIDADE_SENHA_TEMPORARIA_HORAS });
    expect(e.assunto).toBe('Macuxi ERP: sua senha temporária');
    expect(e.texto).toContain('Tmp#2026ab');
    expect(e.texto).toContain('72 horas');
    expect(e.texto).toContain('uma vez só');
    expect(e.texto).toContain('trocar a senha');
    expect(e.texto).not.toMatch(/<[a-z]|https?:\/\/|@/i);
  });

  it('recusa senha vazia e validade fora de inteiro ≥ 1', () => {
    expect(() => emailSenhaTemporaria({ senha: '', validade_horas: 72 })).toThrow(RangeError);
    expect(() => emailSenhaTemporaria({ senha: '   ', validade_horas: 72 })).toThrow(RangeError);
    expect(() => emailSenhaTemporaria({ senha: 'Tmp#2026ab', validade_horas: 0 })).toThrow(RangeError);
  });
});
