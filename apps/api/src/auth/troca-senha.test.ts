import { CODIGO_TROCAR_SENHA, SenhaATrocarResposta } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { bloqueiaPorTrocaDeSenha, corpoTrocarSenha, MENSAGEM_TROCAR_SENHA, MENSAGEM_TROCAR_SENHA_TEMPORARIA } from './troca-senha';

describe('guard da troca de senha provisória (T-0052, RN-CORE-10)', () => {
  it('sem a flag nada é bloqueado', () => {
    expect(bloqueiaPorTrocaDeSenha('GET', '/v1/cadastros/clientes', false)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('POST', '/v1/core/usuarios', false)).toBe(false);
  });

  it('com a flag, toda rota de módulo do tenant é bloqueada, qualquer método', () => {
    for (const [metodo, rota] of [
      ['GET', '/v1/cadastros/clientes'],
      ['POST', '/v1/pedido/pedidos'],
      ['PUT', '/v1/core/empresa'],
      ['DELETE', '/v1/cadastros/clientes/:id'],
      ['HEAD', '/v1/cadastros/clientes'],
    ] as const) {
      expect(bloqueiaPorTrocaDeSenha(metodo, rota, true), `${metodo} ${rota}`).toBe(true);
    }
  });

  it('com a flag, só GET /v1/auth/eu (e o HEAD dele), POST /v1/auth/sair e POST /v1/auth/senha passam', () => {
    expect(bloqueiaPorTrocaDeSenha('GET', '/v1/auth/eu', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('HEAD', '/v1/auth/eu', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('POST', '/v1/auth/sair', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('POST', '/v1/auth/senha', true)).toBe(false);
    // outro método no mesmo caminho não é a rota liberada
    expect(bloqueiaPorTrocaDeSenha('GET', '/v1/auth/senha', true)).toBe(true);
    expect(bloqueiaPorTrocaDeSenha('DELETE', '/v1/auth/eu', true)).toBe(true);
  });

  it('rotas que não leem a sessão do tenant ficam fora: saúde, login, refresh, portal /config e rota inexistente (404)', () => {
    expect(bloqueiaPorTrocaDeSenha('GET', '/v1/saude', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('POST', '/v1/auth/login', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('POST', '/v1/auth/refresh', true)).toBe(false);
    // T-0076: o "Esqueci a senha" não lê a sessão do tenant
    expect(bloqueiaPorTrocaDeSenha('POST', '/v1/auth/esqueci', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('GET', '/v1/auth/esqueci/situacao', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('GET', '/v1/plataforma/empresas', true)).toBe(false);
    expect(bloqueiaPorTrocaDeSenha('GET', undefined, true)).toBe(false);
  });

  it('o corpo do 403 é o SenhaATrocarResposta: motivo provisoria sem expira_em', () => {
    const corpo = corpoTrocarSenha({});
    expect(corpo).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA, motivo: 'provisoria' });
    expect(SenhaATrocarResposta.parse(corpo)).toEqual(corpo);
    expect(MENSAGEM_TROCAR_SENHA).toBe('Troque a senha provisória antes de continuar');
  });

  it('na sessão da temporária (RN-CORE-13): motivo temporaria e expira_em = o fim dela, em ISO UTC', () => {
    const fim = new Date('2026-11-26T12:00:00.000Z');
    const corpo = corpoTrocarSenha({ motivo_troca: 'temporaria', temporaria_expira_em: fim });
    expect(corpo).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA_TEMPORARIA, motivo: 'temporaria', expira_em: '2026-11-26T12:00:00.000Z' });
    expect(SenhaATrocarResposta.parse(corpo)).toEqual(corpo);
    expect(corpoTrocarSenha({ motivo_troca: 'temporaria' })).not.toHaveProperty('expira_em');
  });
});
