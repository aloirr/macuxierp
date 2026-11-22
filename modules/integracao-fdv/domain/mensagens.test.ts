import { describe, expect, it } from 'vitest';
import { mensagemDaPausa, mensagemDoErro } from './mensagens';

describe('catálogo de mensagens', () => {
  it('RN-INF-04: mensagem vem do catálogo pelo código; código desconhecido nunca ecoa texto', () => {
    expect(mensagemDoErro('referencia_ausente')).toContain('ainda não foi confirmado');
    expect(mensagemDoErro('texto livre com 12345678900')).not.toContain('12345678900');
    expect(mensagemDoErro(null)).toContain('Erro não catalogado');
    expect(mensagemDaPausa('credencial')).toContain('Troque a chave');
  });

  it('RN-INF-04: resposta_grande e pedido_invalido têm mensagem própria no catálogo', () => {
    expect(mensagemDoErro('resposta_grande')).not.toContain('Erro não catalogado');
    expect(mensagemDoErro('pedido_invalido')).not.toContain('Erro não catalogado');
  });

  it('RN-INF-04: código que causa pausa mostra o texto do motivo, um texto por fato', () => {
    for (const c of ['chave_revogada', 'credencial_revogada', 'credencial_invalida']) expect(mensagemDoErro(c)).toBe(mensagemDaPausa('credencial'));
    expect(mensagemDoErro('modulo_inativo')).toBe(mensagemDaPausa('licenca_fdv'));
    expect(mensagemDoErro('abaixo_da_minima')).toBe(mensagemDaPausa('versao'));
    expect(mensagemDoErro('versao_conector_nao_suportada')).toBe(mensagemDaPausa('versao'));
    expect(mensagemDoErro('chave_idempotencia_reutilizada')).toBe(mensagemDaPausa('idempotencia'));
    expect(mensagemDoErro('entidade_de_outro_conector')).toBe(mensagemDaPausa('topologia'));
  });
});
