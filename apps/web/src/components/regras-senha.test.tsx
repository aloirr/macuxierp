import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RegrasSenha } from './regras-senha';
import { CampoSenha } from './campo-senha';
import { regrasDescumpridas } from '@macuxierp/platform-sdk';

const marcas = (h: string) => ({ ok: (h.match(/regra-ok/g) ?? []).length, falta: (h.match(/regra-falta/g) ?? []).length });

describe('lista de regras de senha (T-0052)', () => {
  it('textos do FDV, exemplo só visual e título', () => {
    const h = renderToStaticMarkup(<RegrasSenha senha="" />);
    for (const t of ['A senha precisa ter', '8 caracteres ou mais', 'Uma letra', 'Um número', 'Um caractere especial']) expect(h).toContain(t);
    expect(h).toContain('aria-hidden="true"> ! @ # $');
  });
  it('vazia: as quatro faltam com ✗ e texto "Falta", e o resumo fica vazio', () => {
    const h = renderToStaticMarkup(<RegrasSenha senha="" />);
    expect(marcas(h)).toEqual({ ok: 0, falta: 4 });
    expect(h).toContain('Falta: ');
    expect(h).not.toContain('A senha atende às regras.');
  });
  it('parcial: ✓ e ✗ ao vivo, sem depender da cor', () => {
    const h = renderToStaticMarkup(<RegrasSenha senha="abc12" />);
    expect(marcas(h)).toEqual({ ok: 2, falta: 2 });
    expect(h).toContain('✓');
    expect(h).toContain('✗');
    expect(h).toContain('Atendida: ');
  });
  it('detalhes.regras da API marca ✗ nas regras citadas, mesmo com a conferência local satisfeita', () => {
    const h = renderToStaticMarkup(<RegrasSenha senha="abcdef1!" faltamNaApi={['letra', 'especial']} />);
    expect(marcas(h)).toEqual({ ok: 2, falta: 2 });
    expect(h).not.toContain('A senha atende às regras.');
  });
  it('tudo ok: resumo "A senha atende às regras." e só ele em aria-live', () => {
    const h = renderToStaticMarkup(<RegrasSenha senha="abcdef1!" />);
    expect(marcas(h)).toEqual({ ok: 4, falta: 0 });
    expect(h).toContain('A senha atende às regras.');
    expect(h.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(h).not.toContain('<li aria-live');
  });
  it('regras: letra Unicode, número, especial (não letra, número nem espaço)', () => {
    expect(regrasDescumpridas('senhaçã1!')).toEqual([]);
    expect(regrasDescumpridas('aaaa aaaa 1')).toEqual(['especial']);
    expect(regrasDescumpridas('12345678!')).toEqual(['letra']);
    expect(regrasDescumpridas('a1!')).toEqual(['caracteres']);
  });
  it('campo de senha: olho "Mostrar senha", tipo password e foco visível pelo botão', () => {
    const h = renderToStaticMarkup(<CampoSenha rotulo="Senha nova" nome="senha_nova" valor="" aoMudar={() => undefined} autoComplete="new-password" />);
    expect(h).toContain('Mostrar senha');
    expect(h).toContain('type="password"');
    expect(h).toContain('autoComplete="new-password"');
  });
});
