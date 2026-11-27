import { describe, expect, it } from 'vitest';
import { resultadoErro, resultadoSucesso } from './resultado-acao';

describe('resultado-acao (36 A): tom do retorno', () => {
  it('sucesso e erro levam o texto como está', () => {
    expect(resultadoSucesso('Chave revogada.')).toEqual({ tom: 'sucesso', texto: 'Chave revogada.' });
    expect(resultadoErro('Não foi possível testar a conexão. Tente de novo em instantes.')).toEqual({ tom: 'erro', texto: 'Não foi possível testar a conexão. Tente de novo em instantes.' });
  });
});
