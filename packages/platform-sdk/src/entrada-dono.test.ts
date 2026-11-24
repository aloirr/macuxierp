import { describe, expect, it } from 'vitest';
import { CODIGO_DONO_CLIENTE, DONOS_ENTIDADE, MENSAGEM_DONO_CLIENTE } from './entrada-dono';
import { corpoErroApi, erros } from './erros';
import * as sdk from './index';

describe('dono por entidade (ADR 0014 §14)', () => {
  it('os donos são cliente e erp', () => {
    expect(DONOS_ENTIDADE).toEqual(['cliente', 'erp']);
  });

  it('erros.donoCliente(): 409 CONFLITO com detalhes.codigo dono_cliente e a mensagem do BKO', () => {
    const e = erros.donoCliente();
    expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', message: MENSAGEM_DONO_CLIENTE });
    expect(corpoErroApi(e)).toEqual({ codigo: 'CONFLITO', mensagem: 'Vem do servidor do cliente', detalhes: { codigo: 'dono_cliente' } });
    expect(CODIGO_DONO_CLIENTE).toBe('dono_cliente');
  });

  it('sai pelo índice do SDK', () => {
    expect(sdk.DONOS_ENTIDADE).toBe(DONOS_ENTIDADE);
    expect(sdk.CODIGO_DONO_CLIENTE).toBe(CODIGO_DONO_CLIENTE);
    expect(sdk.MENSAGEM_DONO_CLIENTE).toBe(MENSAGEM_DONO_CLIENTE);
  });
});
