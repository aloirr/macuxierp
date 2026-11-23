import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { destinoErroEmpresa } from './empresa';
import { ConfigIndisponivel, ConfigSemPermissao, ErroPlataforma, SEM_PERMISSAO } from './erros';

describe('destino do erro da ficha da empresa', () => {
  it('403 TROCAR_SENHA vai à troca de senha', () => {
    expect(destinoErroEmpresa(new ErroPlataforma(403, CODIGO_TROCAR_SENHA))).toEqual({ tipo: 'senha' });
  });
  it('403 sem permissão mostra o texto de sem permissão', () => {
    expect(destinoErroEmpresa(new ConfigSemPermissao())).toEqual({ tipo: 'tela', texto: SEM_PERMISSAO, naoAchou: false });
  });
  it('404 e falha geral mantêm os textos', () => {
    expect(destinoErroEmpresa(new ErroPlataforma(404, 'NAO_ENCONTRADO'))).toMatchObject({ naoAchou: true, texto: 'Empresa não encontrada. Volte à lista.' });
    expect(destinoErroEmpresa(new ConfigIndisponivel('x'))).toMatchObject({ naoAchou: false, texto: 'Não foi possível carregar. Tente de novo.' });
  });
});
