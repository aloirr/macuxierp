import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Erro from '@/app/error';
import { MensagemRecarregar } from '@/components/mensagem-recarregar';
import { SISTEMA_ATUALIZADO, ehAcaoAusente } from './sistema-atualizado';

describe('sistema atualizado (server action que sumiu depois do deploy)', () => {
  it('reconhece as mensagens do Next e não confunde outros erros', () => {
    expect(ehAcaoAusente(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))).toBe(true);
    expect(ehAcaoAusente(new Error('Server Action "abc" was not found on the server.'))).toBe(true);
    expect(ehAcaoAusente(new Error('Server action not found.'))).toBe(true);
    expect(ehAcaoAusente(new Error('boom'))).toBe(false);
    expect(ehAcaoAusente(undefined)).toBe(false);
  });
  it('a página de erro mostra a mensagem com o botão Recarregar; outro erro segue a falha genérica', () => {
    const h = renderToStaticMarkup(<Erro error={new Error('Failed to find Server Action "x"')} reset={() => undefined} />);
    expect(h).toContain(SISTEMA_ATUALIZADO);
    expect(h).toContain('>Recarregar<');
    const g = renderToStaticMarkup(<Erro error={new Error('x')} reset={() => undefined} />);
    expect(g).toContain('Algo deu errado');
    expect(g).not.toContain('Recarregar');
  });
  it('só a mensagem do sistema atualizado leva o botão', () => {
    expect(renderToStaticMarkup(<MensagemRecarregar texto={SISTEMA_ATUALIZADO} />)).toContain('>Recarregar<');
    expect(renderToStaticMarkup(<MensagemRecarregar texto="Outro erro." />)).not.toContain('Recarregar');
    const av = renderToStaticMarkup(<MensagemRecarregar texto={SISTEMA_ATUALIZADO} />);
    expect(av).toContain('faixa-aviso');
    expect(av).toContain('role="status"');
    expect(av).toContain('mx-botao-secundario');
    expect(av).not.toContain('class="erro"');
  });
});
