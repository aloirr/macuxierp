import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlertaBloqueante } from './AlertaBloqueante.js';
import { FaixaPendencias } from './FaixaPendencias.js';
import { ResultadoAcao } from './ResultadoAcao.js';
import { exigirSemPrefixo, temPrefixoProibido } from './semPrefixo.js';

describe('caixa de mensagem sem rótulo no início (decisão 125 B)', () => {
  it.each(['Erro. Falhou', 'Aviso: ver', 'Atenção. x', 'Atencao! x', 'Pronto. Salvo', 'Sucesso - ok', '  erro. x'])('detecta "%s"', (t) => {
    expect(temPrefixoProibido(t)).toBe(true);
  });
  it.each(['Não foi possível salvar. Tente de novo.', 'Erro de rede ao salvar.', 'Pronto para emitir', 'Avisos enviados.'])('aceita "%s"', (t) => {
    expect(temPrefixoProibido(t)).toBe(false);
    expect(() => exigirSemPrefixo(t, 'x')).not.toThrow();
  });
  it('ResultadoAcao recusa prefixo em qualquer tom', () => {
    for (const tom of ['sucesso', 'aviso', 'erro'] as const) {
      expect(() => renderToStaticMarkup(<ResultadoAcao resultado={{ tom, texto: 'Erro. Falhou' }} />)).toThrow(/rótulo/);
    }
  });
  it('AlertaBloqueante recusa prefixo no título e no texto simples', () => {
    expect(() => renderToStaticMarkup(<AlertaBloqueante titulo="Atenção. Bloqueado">x</AlertaBloqueante>)).toThrow(/rótulo/);
    expect(() => renderToStaticMarkup(<AlertaBloqueante titulo="Bloqueado">Aviso. x</AlertaBloqueante>)).toThrow(/rótulo/);
    expect(renderToStaticMarkup(<AlertaBloqueante titulo="Nota bloqueada">Corrija o CNPJ.</AlertaBloqueante>)).toContain('role="alert"');
  });
  it('FaixaPendencias recusa prefixo; o "Erro:" só para leitor de tela continua', () => {
    expect(() => renderToStaticMarkup(<FaixaPendencias itens={[{ nivel: 'bloqueante', codigoRn: 'RN-X', texto: 'Erro. x' }]} />)).toThrow(/rótulo/);
    expect(renderToStaticMarkup(<FaixaPendencias itens={[{ nivel: 'bloqueante', codigoRn: 'RN-X', texto: 'Falta o CNPJ.' }]} />)).toContain('Erro: </span>');
  });
});
