import { describe, expect, it } from 'vitest';
import { criarPluginIntegracaoFdv, lerChaveIntegracao } from './index';

const chave = Buffer.alloc(32, 9);

describe('plugin de rotas do integracao-fdv (C-7)', () => {
  it('RF-INF-05: a chave mestra é validada na montagem (32 bytes) e copiada; null = ausente, e a montagem segue', () => {
    expect(() => criarPluginIntegracaoFdv({ chaveMestra: Buffer.alloc(31, 9) })).toThrow('32 bytes');
    expect(() => criarPluginIntegracaoFdv({ chaveMestra: Buffer.alloc(33, 9) })).toThrow('32 bytes');
    expect(() => criarPluginIntegracaoFdv({ chaveMestra: Buffer.alloc(0) })).toThrow('32 bytes');
    expect(() => criarPluginIntegracaoFdv({ chaveMestra: null }).rotas).not.toThrow();
    try {
      criarPluginIntegracaoFdv({ chaveMestra: Buffer.alloc(31, 7) });
    } catch (x) {
      expect((x as Error).message).not.toContain('07'); // o erro nunca cita o valor da chave
    }
  });

  const plugin = criarPluginIntegracaoFdv({ chaveMestra: chave });
  const rotas = plugin.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`);

  it('RN-CORE-02: declara exatamente as rotas da C-7, cada uma com a ação de ver ou de configurar', () => {
    expect(rotas.sort()).toEqual(
      [
        'GET /monitor integracao-fdv.ver',
        'GET /lotes integracao-fdv.ver',
        'GET /lotes/exportar integracao-fdv.ver',
        'GET /lotes/:id/erros integracao-fdv.ver',
        'PUT /credencial integracao-fdv.configurar',
        'POST /credencial/testar integracao-fdv.configurar',
        'PUT /configuracao integracao-fdv.configurar',
        'POST /entidades/:entidade/carga-completa integracao-fdv.configurar',
        'POST /entidades/:entidade/retomar integracao-fdv.configurar',
      ].sort(),
    );
  });
  it('RF-INF-05: a chave mestra vem do apps/api e o erro de leitura cita só o nome da variável, nunca o valor', () => {
    expect(lerChaveIntegracao('11'.repeat(32))).toHaveLength(32);
    let mensagem = '';
    try {
      lerChaveIntegracao('segredo-curto');
    } catch (x) {
      mensagem = (x as Error).message;
    }
    expect(mensagem).toContain('MACUXIERP_CHAVE_INTEGRACAO');
    expect(mensagem).not.toContain('segredo-curto');
    expect(() => lerChaveIntegracao(undefined)).toThrow('MACUXIERP_CHAVE_INTEGRACAO');
  });
});
