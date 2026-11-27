import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { destinoErroEmpresa, lerApoio } from './empresa';
import { ConfigIndisponivel, ConfigNaoAutenticado, ConfigSemPermissao, ErroPlataforma, SEM_PERMISSAO } from './erros';

describe('destino do erro da ficha da empresa', () => {
  it('403 TROCAR_SENHA vai à troca de senha', () => {
    expect(destinoErroEmpresa(new ErroPlataforma(403, CODIGO_TROCAR_SENHA))).toEqual({ tipo: 'senha' });
  });
  it('403 sem permissão mostra o texto de sem permissão', () => {
    expect(destinoErroEmpresa(new ConfigSemPermissao())).toEqual({ tipo: 'tela', texto: SEM_PERMISSAO, naoAchou: false });
  });
  it('404 e falha geral mantêm os textos', () => {
    expect(destinoErroEmpresa(new ErroPlataforma(404, 'NAO_ENCONTRADO'))).toMatchObject({ naoAchou: true, texto: 'Empresa não encontrada. Volte à lista.' });
    expect(destinoErroEmpresa(new ConfigIndisponivel('x'))).toMatchObject({ naoAchou: false, texto: 'Não foi possível carregar a empresa.' });
  });
});

describe('leitura de apoio da aba: cada leitura leva o id da própria falha', () => {
  it('uma falha não herda nem apaga o id da outra', async () => {
    const falha = (id?: string) => async () => { throw new ConfigIndisponivel('x', id); };
    const a = await lerApoio(falha('req-integracao'));
    const b = await lerApoio(falha('req-monitor'));
    const c = await lerApoio(falha());
    expect(a).toMatchObject({ valor: null, requestId: 'req-integracao' });
    expect(b).toMatchObject({ valor: null, requestId: 'req-monitor' });
    expect(c.valor).toBeNull();
    expect(c.requestId).toBeUndefined();
    expect(await lerApoio(async () => 7)).toMatchObject({ valor: 7 });
    expect(await lerApoio(async () => { throw new ConfigNaoAutenticado(); })).toMatchObject({ valor: null, naoAutenticado: true });
  });
});
