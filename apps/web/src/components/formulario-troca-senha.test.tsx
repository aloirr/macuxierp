import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormularioTrocaSenha } from './formulario-troca-senha';

describe('FormularioTrocaSenha (36 A)', () => {
  it('o retorno do envio fica logo depois do botão e não sobra mensagem no topo', async () => {
    const h = renderToStaticMarkup(<FormularioTrocaSenha acao={async () => ({})} />);
    const botao = h.indexOf('>Trocar senha</button>');
    expect(botao).toBeGreaterThan(0);
    expect(h.indexOf('data-resultado-acao')).toBeGreaterThan(botao);
    expect(h.indexOf('data-resultado-acao')).toBeLessThan(h.indexOf('</form>'));
    expect(h).not.toContain('class="erro"');
  });
});
