import { describe, expect, it } from 'vitest';
import { CODIGO_EMAIL_EM_USO, CODIGO_EMPRESA_SUSPENSA, corpoErroApi, erros, MENSAGEM_EMAIL_EM_USO, MENSAGEM_EMPRESA_SUSPENSA, MENSAGEM_LOGIN_INVALIDO } from './erros';
import { MENSAGEM_ESQUECI_NEUTRA, SenhaATrocarResposta } from './esqueci-senha';
import { CODIGO_TROCAR_SENHA, EuResposta, MOTIVOS_TROCA_SENHA } from './eu';
import {
  CAMINHO_LOGIN,
  DESTINOS_LOGIN,
  LoginEntrada,
  LoginResposta,
} from './login';
import { EntrarPlataformaEntrada, EuPlataforma, SLUG_RESERVADO_SUPERADMIN } from './portal-config';
import { SENHA_MAXIMA } from './senha';

const ID = '00000000-0000-4000-8000-000000000001';
const EXPIRA = '2026-11-23T21:00:00.000Z';

describe('RN-CORE-12: login único (POST /v1/auth/login)', () => {
  it('rota e destinos do login', () => {
    expect(CAMINHO_LOGIN).toBe('/v1/auth/login');
    expect(DESTINOS_LOGIN).toEqual(['bko', 'config']);
  });

  it('LoginEntrada (ADR 0021 §6): e-mail normalizado e a senha como veio; `empresa` opcional e ignorado (qualquer valor passa)', () => {
    expect(LoginEntrada.parse({ email: ' Ana@Exemplo.COM ', senha: ' s e n h a ' })).toEqual({ email: 'ana@exemplo.com', senha: ' s e n h a ' });
    for (const empresa of [' am2808 ', '', '-abc', 'MACUXI', 42, null]) {
      expect(LoginEntrada.safeParse({ empresa, email: 'a@b.co', senha: 'x' }).success, JSON.stringify(empresa)).toBe(true);
    }
    for (const errado of [
      { email: 'sem-arroba', senha: 'x' },
      { email: 'a@b.co', senha: '' },
      { email: 'a@b.co', senha: 'x'.repeat(SENHA_MAXIMA + 1) },
      { senha: 'x' },
    ]) {
      expect(() => LoginEntrada.parse(errado), JSON.stringify(errado)).toThrow();
    }
  });

  it('textos travados pelo PO (ADR 0021, seção Textos), exatamente assim, e os erros do SDK que os usam', () => {
    expect(MENSAGEM_LOGIN_INVALIDO).toBe('E-mail ou senha inválidos.');
    expect(MENSAGEM_EMPRESA_SUSPENSA).toBe('Sua empresa está suspensa. Fale com o administrador da Macuxi.');
    expect(MENSAGEM_EMAIL_EM_USO).toBe('Este e-mail já está em uso em outra empresa. Use outro e-mail.');
    expect(MENSAGEM_ESQUECI_NEUTRA).toBe('Se o e-mail estiver cadastrado, enviamos as instruções.');
    expect(corpoErroApi(erros.loginInvalido())).toEqual({ codigo: 'NAO_AUTENTICADO', mensagem: MENSAGEM_LOGIN_INVALIDO });
    expect(erros.loginInvalido().status).toBe(401);
    const suspensa = erros.empresaSuspensa();
    expect([suspensa.status, suspensa.codigo, suspensa.message]).toEqual([403, CODIGO_EMPRESA_SUSPENSA, MENSAGEM_EMPRESA_SUSPENSA]);
    expect(CODIGO_EMPRESA_SUSPENSA).toBe('EMPRESA_SUSPENSA');
    const emUso = erros.emailEmUso();
    expect(corpoErroApi(emUso)).toEqual({ codigo: 'CONFLITO', mensagem: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO }, detalhes: { codigo: CODIGO_EMAIL_EM_USO } });
    expect(CODIGO_EMAIL_EM_USO).toBe('email_em_uso');
  });

  it('ADR 0021 §5: o MACUXI não é mais caminho de login (destinoDoCodigo saiu); fica só o slug reservado', async () => {
    const login = await import('./login');
    expect(login).not.toHaveProperty('destinoDoCodigo');
    expect(SLUG_RESERVADO_SUPERADMIN).toBe('macuxi');
    expect(LoginEntrada.parse({ empresa: 'MACUXI', email: 'a@b.co', senha: 'x'.repeat(8) })).not.toHaveProperty('empresa', 'config');
  });

  it('LoginResposta do BKO: a resposta de hoje (sem destino) continua passando e vira destino bko', () => {
    const hoje = { token_acesso: 'jwt.abc.def', expira_em: EXPIRA };
    expect(LoginResposta.parse(hoje)).toEqual({ destino: 'bko', ...hoje });
    expect(LoginResposta.parse({ destino: 'bko', ...hoje })).toEqual({ destino: 'bko', ...hoje });
    expect(() => LoginResposta.parse({ destino: 'bko', expira_em: EXPIRA })).toThrow();
    expect(() => LoginResposta.parse({ ...hoje, expira_em: '23/11/2026' })).toThrow();
  });

  it('LoginResposta do /config: só o vencimento; o token nunca no corpo (vai no COOKIE_CONFIG)', () => {
    expect(LoginResposta.parse({ destino: 'config', expira_em: EXPIRA })).toEqual({
      destino: 'config',
      expira_em: EXPIRA,
    });
    expect(() =>
      LoginResposta.parse({ destino: 'config', expira_em: EXPIRA, token_acesso: 'jwt.abc.def' }),
    ).toThrow();
    expect(() => LoginResposta.parse({ destino: 'outro', token_acesso: 'jwt', expira_em: EXPIRA })).toThrow();
  });

  it('EntrarPlataformaEntrada (/config/entrar, obsoleto) continua valendo até a rota sair', () => {
    expect(EntrarPlataformaEntrada.parse({ email: ' Root@Macuxi.com.br ', senha: 'x' })).toEqual({
      email: 'root@macuxi.com.br',
      senha: 'x',
    });
  });
});

describe('RN-CORE-12/13: motivo da troca e destino, campos opcionais e compatíveis', () => {
  it('MOTIVOS_TROCA_SENHA é a fonte única do motivo', () => {
    expect(MOTIVOS_TROCA_SENHA).toEqual(['provisoria', 'temporaria']);
  });

  it('SenhaATrocarResposta: destino opcional; a resposta de hoje sem destino continua passando', () => {
    const hoje = {
      codigo: CODIGO_TROCAR_SENHA,
      mensagem: 'Troque a senha',
      motivo: 'temporaria',
      expira_em: EXPIRA,
    };
    expect(SenhaATrocarResposta.parse(hoje)).toEqual(hoje);
    expect(SenhaATrocarResposta.parse({ ...hoje, destino: 'config' }).destino).toBe('config');
    expect(() => SenhaATrocarResposta.parse({ ...hoje, destino: 'portal' })).toThrow();
  });

  it('EuResposta.usuario: motivo_troca opcional', () => {
    const eu = {
      usuario: { id: ID, nome: 'Ana', perfil: 'administrador', deve_trocar_senha: true },
      empresa: { id: ID, slug: 'am2808', razao_social: 'Empresa Teste Ltda', fuso: 'America/Manaus' },
      filiais: [],
      modulos: [],
    };
    expect(EuResposta.parse(eu).usuario.motivo_troca).toBeUndefined();
    expect(
      EuResposta.parse({ ...eu, usuario: { ...eu.usuario, motivo_troca: 'temporaria' } }).usuario
        .motivo_troca,
    ).toBe('temporaria');
    expect(() => EuResposta.parse({ ...eu, usuario: { ...eu.usuario, motivo_troca: 'outra' } })).toThrow();
  });

  it('EuPlataforma: motivo_troca opcional', () => {
    const eu = { superadmin: { id: ID, nome: 'Root' }, deve_trocar_senha: false, sessao_expira_em: EXPIRA };
    expect(EuPlataforma.parse(eu)).toEqual(eu);
    expect(
      EuPlataforma.parse({ ...eu, deve_trocar_senha: true, motivo_troca: 'provisoria' }).motivo_troca,
    ).toBe('provisoria');
    expect(() => EuPlataforma.parse({ ...eu, motivo_troca: 'x' })).toThrow();
  });
});
