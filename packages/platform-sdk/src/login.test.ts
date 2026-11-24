import { describe, expect, it } from 'vitest';
import { SenhaATrocarResposta } from './esqueci-senha';
import { CODIGO_TROCAR_SENHA, EuResposta, MOTIVOS_TROCA_SENHA } from './eu';
import {
  CAMINHO_LOGIN,
  CodigoEmpresaLogin,
  DESTINOS_LOGIN,
  destinoDoCodigo,
  LoginEntrada,
  LoginResposta,
} from './login';
import { CODIGO_SUPERADMIN_LOGIN, EntrarPlataformaEntrada, EuPlataforma } from './portal-config';
import { SENHA_MAXIMA } from './senha';

const ID = '00000000-0000-4000-8000-000000000001';
const EXPIRA = '2026-11-23T21:00:00.000Z';

describe('RN-CORE-12: login único (POST /v1/auth/login)', () => {
  it('rota e destinos do login', () => {
    expect(CAMINHO_LOGIN).toBe('/v1/auth/login');
    expect(DESTINOS_LOGIN).toEqual(['bko', 'config']);
  });

  it('LoginEntrada: código (aparado, maiúsculo), e-mail normalizado e a senha como veio', () => {
    expect(
      LoginEntrada.parse({ empresa: ' am2808 ', email: ' Ana@Exemplo.COM ', senha: ' s e n h a ' }),
    ).toEqual({
      empresa: 'AM2808',
      email: 'ana@exemplo.com',
      senha: ' s e n h a ',
    });
    expect(LoginEntrada.parse({ empresa: 'macuxi', email: 'root@macuxi.com.br', senha: 'x' }).empresa).toBe(
      CODIGO_SUPERADMIN_LOGIN,
    );
    for (const errado of [
      { empresa: '', email: 'a@b.co', senha: 'x' },
      { empresa: 'XX1234', email: 'a@b.co', senha: 'x' },
      { empresa: 'AM2808', email: 'sem-arroba', senha: 'x' },
      { empresa: 'AM2808', email: 'a@b.co', senha: '' },
      { empresa: 'AM2808', email: 'a@b.co', senha: 'x'.repeat(SENHA_MAXIMA + 1) },
    ]) {
      expect(() => LoginEntrada.parse(errado), JSON.stringify(errado.empresa)).toThrow();
    }
  });

  it('destinoDoCodigo: só o código reservado leva ao /config; qualquer empresa leva ao BKO', () => {
    expect(destinoDoCodigo(CODIGO_SUPERADMIN_LOGIN)).toBe('config');
    expect(destinoDoCodigo(CodigoEmpresaLogin.parse(' macuxi '))).toBe('config');
    expect(destinoDoCodigo('AM2808')).toBe('bko');
    expect(destinoDoCodigo(CodigoEmpresaLogin.parse('am2808'))).toBe('bko');
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
