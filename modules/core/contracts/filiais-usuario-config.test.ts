import { describe, expect, it } from 'vitest';
import { ListaFiliaisConfig, ROTAS_USUARIOS_CONFIG } from './index';

const ID = '3f2c2d8e-5a64-4f0d-9c53-0a6d7d2b1e11';

describe('T-0130: filiais da empresa para o cadastro de usuário do /config', () => {
  it('RN-CORE-01: a lista traz só id, nome e se é a padrão (sem CNPJ nem endereço, sem dado pessoal)', () => {
    const r = ListaFiliaisConfig.parse({ itens: [{ id: ID, nome: 'Matriz', padrao: true, cnpj: '11222333000181' }] });
    expect(r.itens[0]).toEqual({ id: ID, nome: 'Matriz', padrao: true });
  });

  it('a rota de leitura fica ao lado das de usuários, por empresa', () => {
    expect(ROTAS_USUARIOS_CONFIG.filiais).toEqual({ metodo: 'GET', caminho: '/v1/plataforma/empresas/:id/filiais' });
  });
});
