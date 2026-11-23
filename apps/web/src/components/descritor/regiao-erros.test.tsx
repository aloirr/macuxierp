import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TelaFormulario } from '@/lib/descritor/tipos';

const tela = vi.hoisted(() => ({ v: null as unknown }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));
vi.mock('@/lib/telas', () => ({ telaFormulario: () => tela.v }));

import { FormularioGenerico } from './formulario-generico';

describe('RegiaoErros única por tela (MC-0015)', () => {
  it('formulário sem itens: uma região, sem role="alert" nos campos', () => {
    tela.v = { tipo: 'formulario', campos: [{ nome: 'a', rotulo: 'A', tipo: 'texto' }], enviar: 'Salvar', voltar: '/x', api: '/x', depois: () => '/x', validar: () => ({}) } as unknown as TelaFormulario;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/x" opcoes={{}} produtos={[]} />);
    expect(h.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(h).not.toContain('role="alert"');
  });
  it('com itens: só a região do FormularioItens', async () => {
    const { NOVO_PEDIDO } = await vi.importActual<typeof import('@/lib/telas/pedido')>('@/lib/telas/pedido');
    tela.v = NOVO_PEDIDO;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/pedido/pedidos/novo" opcoes={{}} produtos={[]} />);
    expect(h.match(/aria-live="polite"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(h.match(/role="status" aria-live="polite" style/g)).toHaveLength(1);
  });
  it('pedido com erro só no cabeçalho: a região do FormularioItens acende', async () => {
    const { NOVO_PEDIDO } = await vi.importActual<typeof import('@/lib/telas/pedido')>('@/lib/telas/pedido');
    tela.v = NOVO_PEDIDO;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/pedido/pedidos/novo" opcoes={{}} produtos={[]} errosIniciais={{ cliente_id: 'Informe o cliente.' }} />);
    const regioes = [...h.matchAll(/<p role="status" aria-live="polite"[^>]*>([^<]*)<\/p>/g)];
    expect(regioes.filter((m) => m[1] !== '')).toHaveLength(1);
    expect(regioes.filter((m) => m[1] !== '')[0]?.[1]).toContain('erro');
  });
  it('pedido com erro só em itens: a região acende, uma só', async () => {
    const { NOVO_PEDIDO } = await vi.importActual<typeof import('@/lib/telas/pedido')>('@/lib/telas/pedido');
    tela.v = NOVO_PEDIDO;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/pedido/pedidos/novo" opcoes={{}} produtos={[]} errosIniciais={{ 'itens.0.quantidade': 'Quantidade inválida.' }} />);
    expect(h.match(/role="status" aria-live="polite"/g)).toHaveLength(1);
    expect(h.match(/<p role="status" aria-live="polite"[^>]*>([^<]*)<\/p>/)?.[1]).toContain('erro');
  });
  it('erro no cabeçalho e em itens: continua uma região só', async () => {
    const { NOVO_PEDIDO } = await vi.importActual<typeof import('@/lib/telas/pedido')>('@/lib/telas/pedido');
    tela.v = NOVO_PEDIDO;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/pedido/pedidos/novo" opcoes={{}} produtos={[]} errosIniciais={{ cliente_id: 'Informe o cliente.', 'itens.0.quantidade': 'Quantidade inválida.' }} />);
    expect(h.match(/role="status" aria-live="polite"/g)).toHaveLength(1);
  });
  it('tela sem itens com erro: a região é a do Formulario, uma só', () => {
    tela.v = { tipo: 'formulario', campos: [{ nome: 'a', rotulo: 'A', tipo: 'texto' }], enviar: 'Salvar', voltar: '/x', api: '/x', depois: () => '/x', validar: () => ({}) } as unknown as TelaFormulario;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/x" opcoes={{}} produtos={[]} errosIniciais={{ a: 'Inválido.' }} />);
    expect(h.match(/role="status" aria-live="polite"/g)).toHaveLength(1);
    expect(h.match(/<p role="status" aria-live="polite"[^>]*>([^<]*)<\/p>/)?.[1]).toContain('erro');
  });
  it('textarea com erro ganha aria-invalid e aria-describedby, como o input', () => {
    tela.v = { tipo: 'formulario', campos: [{ nome: 'obs', rotulo: 'Obs', tipo: 'area' }], enviar: 'Salvar', voltar: '/x', api: '/x', depois: () => '/x', validar: () => ({}) } as unknown as TelaFormulario;
    const h = renderToStaticMarkup(<FormularioGenerico rota="/x" opcoes={{}} produtos={[]} errosIniciais={{ obs: 'Muito longo.' }} />);
    expect(h).toMatch(/<textarea[^>]*aria-invalid="true"[^>]*aria-describedby="campo-obs-erro"|<textarea[^>]*aria-describedby="campo-obs-erro"[^>]*aria-invalid="true"/);
  });
});
