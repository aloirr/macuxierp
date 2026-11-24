import { describe, expect, it } from 'vitest';
import { CATALOGO_ERRO, acaoDoErro, mensagemDaPausa, mensagemDoErro, motivoDoErro } from './mensagens';

describe('catálogo de mensagens', () => {
  it('RN-INF-04: mensagem vem do catálogo pelo código; código desconhecido nunca ecoa texto', () => {
    expect(mensagemDoErro('referencia_ausente')).toContain('ainda não foi confirmado');
    expect(mensagemDoErro('texto livre com 12345678900')).not.toContain('12345678900');
    expect(mensagemDoErro(null)).toContain('Erro não catalogado');
    expect(mensagemDaPausa('credencial')).toContain('Troque a chave');
  });

  it('RN-INF-04: chave_alterada e chave_duplicada têm mensagem própria no catálogo, sem valor de campo', () => {
    for (const c of ['chave_alterada', 'chave_duplicada']) expect(mensagemDoErro(c)).not.toContain('Erro não catalogado');
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

describe('motivo e ação separados (T-0086, Log do BKO)', () => {
  it('RN-INF-04: todo código do catálogo tem motivo e ação; o Monitor junta os dois e o Log não repete a frase', () => {
    for (const [codigo, t] of Object.entries(CATALOGO_ERRO)) {
      expect(t.motivo, codigo).toBeTruthy();
      expect(t.acao, codigo).toBeTruthy();
      expect(mensagemDoErro(codigo)).toBe(`${t.motivo} ${t.acao}`);
      expect(motivoDoErro(codigo)).not.toContain(t.acao);
      expect(acaoDoErro(codigo)).toBe(t.acao);
    }
  });

  it('RN-INF-04: a ação não descreve o que o sistema faz por trás; espera é "Aguarde."', () => {
    for (const c of ['referencia_ausente', 'acima_do_limite', 'rede', 'limite_de_taxa']) expect(acaoDoErro(c)).toBe('Aguarde.');
    expect(acaoDoErro('resposta_grande')).toBe('Aguarde; se persistir, fale com o suporte.');
    for (const t of Object.values(CATALOGO_ERRO)) expect(t.acao).not.toMatch(/sozinho|divide|repete/i);
  });

  it('RN-INF-04: código desconhecido cai na ação genérica, nunca em texto do Hub', () => {
    expect(acaoDoErro('campo_invalido')).toContain('Corrija');
    expect(acaoDoErro('codigo_novo_do_hub')).toContain('suporte');
    expect(acaoDoErro(null)).toContain('suporte');
    expect(motivoDoErro('codigo_novo_do_hub')).toContain('Erro não catalogado');
  });
});
