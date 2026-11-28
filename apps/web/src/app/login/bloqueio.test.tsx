import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RESPOSTA_CONTA_BLOQUEADA as R } from '@macuxierp/core/web';
import { ComEsqueciSenha, EsqueciSenha } from '@/components/esqueci-senha';
import { contaBloqueada, entrouComTemporaria, sinalDeBloqueioNaResposta } from '@/lib/login-regras';
import { VisaoLogin } from './formulario';

vi.mock('./entrar', () => ({ entrarAction: vi.fn() }));
vi.mock('./esqueci', () => ({ pedirEsqueciAction: vi.fn() }));

const valores = { email: 'usuario@exemplo.com.br', senha: '' };

describe('T-0111: conta bloqueada na tela de entrada', () => {
  it('reconhece o bloqueio num ponto só: só 423 ou CODIGO_CONTA_BLOQUEADA do SDK; o 429 do IP não é bloqueio', () => {
    expect(contaBloqueada({ tipo: 'bloqueada' })).toBe(true);
    for (const t of ['ok', 'credencial', 'campos', 'indisponivel']) expect(contaBloqueada({ tipo: t })).toBe(false);
    expect(sinalDeBloqueioNaResposta(429, null)).toBe(false);
    expect(sinalDeBloqueioNaResposta(429, { codigo: 'MUITAS_TENTATIVAS' })).toBe(false);
    expect(sinalDeBloqueioNaResposta(423, null)).toBe(true);
    expect(sinalDeBloqueioNaResposta(401, { codigo: 'CONTA_BLOQUEADA', detalhes: { recuperar: true } })).toBe(true);
    expect(sinalDeBloqueioNaResposta(401, { codigo: 'CREDENCIAL' })).toBe(false);
  });

  it('"entrou com a temporária" só com deve_trocar_senha e motivo_troca temporaria', () => {
    expect(entrouComTemporaria({ deve_trocar_senha: true, motivo_troca: 'temporaria' })).toBe(true);
    expect(entrouComTemporaria({ deve_trocar_senha: false, motivo_troca: 'temporaria' })).toBe(false);
    expect(entrouComTemporaria({ deve_trocar_senha: true, motivo_troca: 'provisoria' })).toBe(false);
    expect(entrouComTemporaria(null)).toBe(false);
  });

  it('com a conta bloqueada o link "Esqueci a senha" some (o botão Recuperar a senha o substitui)', () => {
    const f = (ocultarLink: boolean) => renderToStaticMarkup(<ComEsqueciSenha disponivel ocultarLink={ocultarLink}><i>f</i></ComEsqueciSenha>);
    expect(f(false)).toContain('Esqueci a senha');
    expect(f(true)).not.toContain('Esqueci a senha');
  });


  it('mostra o cartão de aviso, o botão "Recuperar a senha" e o "Entrar" desabilitado', () => {
    const h = renderToStaticMarkup(<VisaoLogin valores={valores} bloqueada aoRecuperar={() => undefined} />);
    expect(h).toContain(R.titulo);
    expect(h).toContain(R.mensagem);
    expect(h).toContain('faixa-aviso');
    expect(h).toContain(`<button class="mx-botao botao-recuperar" type="button">${R.acao.rotulo}</button>`);
    expect(h).toMatch(/<button class="mx-botao" type="submit" disabled="">Entrar<\/button>/);
    expect(h).not.toContain('Muitas tentativas');
  });

  it('sem bloqueio: nada de cartão e "Entrar" habilitado', () => {
    const h = renderToStaticMarkup(<VisaoLogin valores={valores} />);
    expect(h).not.toContain(R.titulo);
    expect(h).not.toContain(R.acao.rotulo);
    expect(h).toMatch(/<button class="mx-botao" type="submit">Entrar<\/button>/);
  });

  it('sem "Esqueci" disponível, o cartão aparece sem o botão', () => {
    const h = renderToStaticMarkup(<VisaoLogin valores={valores} bloqueada />);
    expect(h).toContain(R.titulo);
    expect(h).not.toContain(R.acao.rotulo);
  });

  it('Recuperar a senha abre só com o e-mail já preenchido (sem campo de empresa), sem URL nem storage', () => {
    const h = renderToStaticMarkup(<EsqueciSenha emailInicial="usuario@exemplo.com.br" aoVoltar={() => undefined} />);
    expect(h).not.toMatch(/empresa|código/i);
    expect(h).toContain('value="usuario@exemplo.com.br"');
    expect(h).toContain('Enviar senha temporária');
    expect(h).toContain('Voltar para entrar');
    const fonte = readFileSync(new URL('./formulario.tsx', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/localStorage|sessionStorage|searchParams|router\.(push|replace)|\?email=/);
  });
});
