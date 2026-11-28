import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CODIGO_EMAIL_EM_USO, MENSAGEM_EMAIL_EM_USO, MENSAGEM_EMPRESA_SUSPENSA } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({}) }));
vi.mock('./entrar', () => ({ entrarAction: vi.fn() }));
vi.mock('./esqueci', () => ({ pedirEsqueciAction: vi.fn() }));

import { VisaoLogin } from './formulario';
import { PainelEsqueciVisao } from '@/components/esqueci-senha';
import { FormularioTrocaSenha } from '@/components/formulario-troca-senha';
import { ErroPlataforma, mensagemDoErro } from '@/lib/config/erros';
import { resultadoDaResposta } from '@/lib/descritor/escrita';

/** ADR 0021 (T-0133): "Solicitar a empresa deve sumir de qualquer tela" — nenhum formulário de acesso tem campo de empresa ou código. */
const SEM_EMPRESA = (h: string) => {
  expect(h).not.toMatch(/name="(empresa|codigo|codigo_empresa|slug)"/);
  expect(h).not.toMatch(/Código da empresa|código da empresa/);
  expect(h).not.toMatch(/autoComplete="organization"/);
};

describe('ADR 0021: nenhum formulário de acesso pede a empresa', () => {
  it('entrada (login)', () => SEM_EMPRESA(renderToStaticMarkup(<VisaoLogin valores={{ email: '', senha: '' }} />)));
  it('esqueci a senha', () => SEM_EMPRESA(renderToStaticMarkup(<PainelEsqueciVisao estado={{ fase: 'form', erros: {} }} />)));
  it('troca de senha (com e sem a senha atual) e primeiro acesso com a temporária', () => {
    SEM_EMPRESA(renderToStaticMarkup(<FormularioTrocaSenha acao={async () => ({})} />));
    SEM_EMPRESA(renderToStaticMarkup(<FormularioTrocaSenha acao={async () => ({})} semSenhaAtual />));
  });
  it('as telas de senha do BKO e do /config e a entrada não leem nem gravam código da empresa', () => {
    for (const f of ['./formulario.tsx', './entrar.ts', './esqueci.ts', '../senha/page.tsx', '../config/senha/page.tsx', '../../lib/login-regras.ts', '../../lib/rota-login.ts', '../../lib/login-unico.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/#codigo|mx\.codigo_empresa|CodigoEmpresaLogin|codigo-salvo|MACUXI\b|CODIGO_SUPERADMIN_LOGIN|["']empresa["']/);
    }
    expect(existsSync(new URL('../../lib/codigo-salvo.ts', import.meta.url))).toBe(false);
  });
});

describe('ADR 0021: 403 EMPRESA_SUSPENSA e 409 email_em_uso mostram o texto do SDK', () => {
  it('o texto da suspensão é o do PO (vindo do SDK)', () => {
    expect(MENSAGEM_EMPRESA_SUSPENSA).toBe('Sua empresa está suspensa. Fale com o administrador da Macuxi.');
  });
  it('409 email_em_uso nos Usuários do /config: texto e campo e-mail do SDK, sem confundir com outro conflito', () => {
    const e = new ErroPlataforma(409, 'CONFLITO', { email: 'qualquer outro texto' }, 'qualquer outro texto', { codigo: CODIGO_EMAIL_EM_USO });
    expect(mensagemDoErro(e, 'usuario')).toMatchObject({ texto: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO } });
    const outro = new ErroPlataforma(409, 'CONFLITO');
    expect(mensagemDoErro(outro, 'usuario').texto).not.toBe(MENSAGEM_EMAIL_EM_USO);
  });
  it('409 email_em_uso no cadastro de usuário (descritor): texto do SDK no campo e-mail, sem pedir recarga', () => {
    const r = resultadoDaResposta(409, false, { codigo: 'CONFLITO', mensagem: 'outro texto', campos: { email: 'outro texto' }, detalhes: { codigo: CODIGO_EMAIL_EM_USO } });
    expect(r).toMatchObject({ ok: false, mensagem: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO } });
    expect(r.desatualizado).toBeUndefined();
    expect(resultadoDaResposta(409, false, { mensagem: 'x' }).desatualizado).toBe(true);
  });
});
