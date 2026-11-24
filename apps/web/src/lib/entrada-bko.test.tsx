import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinhaEntradaBko } from './entrada-bko-provisorio';

const estado = vi.hoisted(() => ({ falha: false, corpo: null as unknown, status: null as unknown }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));
vi.mock('./api', async (orig) => ({ ...(await orig<object>()), usaApiFalsaAgora: () => false, getValidado: async (c: string, schema: { parse: (x: unknown) => unknown }) => { if (estado.falha) throw new Error('HTTP 404'); return schema.parse(c.includes('entrada') ? estado.corpo : estado.status); } }));

import { MENSAGEM_DONO_CLIENTE, buscarSituacaoEntrada } from './entrada-bko-provisorio';
import { entidadeDaRota, linhaDoCliente, situacaoDaEntrada, textoLinhaStatus } from './entrada-bko';
import { resultadoDaResposta } from './descritor/escrita';
import { BlocoEntradaCliente, ChipDonoCliente, LinhaStatusEntrada } from '@/components/entrada-bko/entrada-bko';
import { DetalheGenerico } from '@/components/descritor/detalhe-generico';
import { FormularioGenerico } from '@/components/descritor/formulario-generico';
import { LISTA_TITULOS } from '@/lib/telas/faturamento';
import { TELAS_PEDIDO } from '@/lib/telas/pedido';

const FUSO = 'America/Manaus';
const base = (o: Partial<LinhaEntradaBko> = {}): LinhaEntradaBko => ({ cadastro: 'cliente', dono: 'cliente', ultimo_lote: { em: '2026-11-24T09:12:00.000Z', recebidas: 42, gravadas: 40, com_erro: 2 }, erros: 0, confirmacao_pendente: false, ...o });

describe('entrada do cliente no BKO: textos e mapeamento', () => {
  it('linha de status: lote com erro, erros abertos e pendência (data no fuso do tenant)', () => {
    expect(textoLinhaStatus(base({ confirmacao_pendente: true }), FUSO)).toBe('Último lote 24/11 05h12: 40 de 42 gravados, 2 com erro · Inativação aguardando confirmação.');
    expect(textoLinhaStatus(base({ ultimo_lote: { em: '2026-11-24T09:12:00.000Z', recebidas: 5, gravadas: 5, com_erro: 0 }, erros: 3 }), FUSO)).toBe('Último lote 24/11 05h12: 5 de 5 gravados · 3 erros abertos');
    expect(textoLinhaStatus(base({ ultimo_lote: null }), FUSO)).toBe('Nenhum lote recebido ainda.');
  });
  it('mapeia a rota (e o detalhe) para o nome da F2; só dono cliente vale', () => {
    expect(entidadeDaRota('/cadastros/clientes')).toBe('cliente');
    expect(entidadeDaRota('/cadastros/clientes/:id')).toBe('cliente');
    expect(entidadeDaRota('/cadastros/condicoes-pagamento')).toBe('prazo_pagamento');
    expect(entidadeDaRota('/pedido/pedidos')).toBeUndefined();
    expect(linhaDoCliente([base()], '/cadastros/clientes')).toBeDefined();
    expect(linhaDoCliente([base({ dono: 'erp' })], '/cadastros/clientes')).toBeUndefined();
    expect(linhaDoCliente(null, '/cadastros/clientes')).toBeUndefined();
  });
  it('situação: erp sem Chip; pendência vence erro; erros; em dia', () => {
    expect(situacaoDaEntrada(base({ dono: 'erp' }))).toBeNull();
    expect(situacaoDaEntrada(base({ erros: 2, confirmacao_pendente: true }))?.texto).toBe('Aguardando confirmação');
    expect(situacaoDaEntrada(base({ erros: 2 }))?.texto).toBe('Com erros');
    expect(situacaoDaEntrada(base())?.texto).toBe('Em dia');
  });
  it('Chip e linha de status renderizam', () => {
    const h = renderToStaticMarkup(<><ChipDonoCliente /><LinhaStatusEntrada linha={base()} fuso={FUSO} /></>);
    expect(h).toContain('Vem do servidor do cliente');
    expect(h).toContain('Último lote 24/11 05h12: 40 de 42 gravados, 2 com erro');
  });
});

describe('409 dono_cliente', () => {
  it('mostra a MENSAGEM_DONO_CLIENTE e pede recarga', () => {
    const r = resultadoDaResposta(409, false, { codigo: 'CONFLITO', mensagem: 'x', detalhes: { codigo: 'dono_cliente' } });
    expect(r).toMatchObject({ ok: false, mensagem: MENSAGEM_DONO_CLIENTE, donoCliente: true, desatualizado: true });
  });
  it('outro 409 segue com o texto de sempre', () => {
    expect(resultadoDaResposta(409, false, { codigo: 'CONFLITO', detalhes: { codigo: 'outro' } })).toMatchObject({ mensagem: expect.stringContaining('mudou') });
  });
});

describe('modo só leitura nas telas genéricas', () => {
  beforeEach(() => vi.resetModules());
  it('lista: sem botão Novo quando só leitura; com ele quando não', async () => {
    vi.doMock('@/lib/listas', () => ({ buscarPagina: async () => ({ itens: [], proximo_cursor: null }) }));
    const { ListaGenerica: L } = await import('@/components/descritor/lista-generica');
    const f = (s: boolean) => L({ tela: { ...LISTA_TITULOS, novo: { rota: '/x/novo', rotulo: 'Novo título' } } as never, rota: '/r', rotaDaPagina: '/r', busca: new URLSearchParams(), perfil: 'administrador', acesso: 'x', fuso: FUSO, somenteLeitura: s });
    expect(renderToStaticMarkup(await f(true))).not.toContain('Novo título');
    expect(renderToStaticMarkup(await f(false))).toContain('Novo título');
  });
  it('detalhe: Chip e status no cabeçalho, sem ações; erp segue igual', () => {
    const vista = { titulo: 'Cliente 1', cabecalho: [], tabelas: [], pendencias: [], acoes: [{ id: 'a', rotulo: 'Excluir cliente', metodo: 'DELETE', caminho: '/v1/x', entrada: 'nenhuma' }] } as never;
    const cliente = renderToStaticMarkup(<DetalheGenerico vista={vista} rota="/r" rotaDaPagina="/r" voltar="/v" entrada={base()} fuso={FUSO} />);
    expect(cliente).toContain('Vem do servidor do cliente');
    expect(cliente).toContain('Último lote');
    expect(cliente).not.toContain('Excluir cliente');
    const erp = renderToStaticMarkup(<DetalheGenerico vista={vista} rota="/r" rotaDaPagina="/r" voltar="/v" />);
    expect(erp).not.toContain('Vem do servidor');
    expect(erp).toContain('Excluir cliente');
  });
  it('formulário: campos readOnly/aria-readonly e sem botão de enviar', () => {
    const rota = Object.keys(TELAS_PEDIDO).find((r) => TELAS_PEDIDO[r]?.tipo === 'formulario') ?? '';
    const ro = renderToStaticMarkup(<FormularioGenerico rota={rota} opcoes={{}} produtos={[]} somenteLeitura />);
    expect(ro).toContain('aria-readonly');
    expect(ro).not.toContain('type="submit"');
    const normal = renderToStaticMarkup(<FormularioGenerico rota={rota} opcoes={{}} produtos={[]} />);
    expect(normal).toContain('type="submit"');
    expect(normal).not.toContain('aria-readonly');
  });
});

describe('bloco "Entrada do cliente" e falha da rota', () => {
  it('tabela com Cadastro, Dono, Último lote, Erros, Situação; erp com "—"', () => {
    const h = renderToStaticMarkup(<BlocoEntradaCliente fuso={FUSO} linhas={[base({ erros: 2 }), base({ cadastro: 'produto', dono: 'erp', ultimo_lote: null })]} />);
    for (const t of ['Entrada do cliente', 'Cadastro', 'Dono', 'Último lote', 'Erros abertos', 'Situação', 'Servidor do cliente', 'Macuxi ERP', 'Com erros']) expect(h).toContain(t);
    expect(h).toContain('24/11 05h12 · 40 de 42, 2 com erro');
    expect(h).not.toContain('<select');
  });
  it('rota ok devolve as linhas; falha devolve null (sem Chip, sem bloco)', async () => {
    estado.falha = false;
    estado.corpo = { cadastros: [base()] };
    expect(await buscarSituacaoEntrada('x')).toHaveLength(1);
    estado.falha = true;
    expect(await buscarSituacaoEntrada('x')).toBeNull();
    estado.falha = false;
    estado.corpo = { qualquer: 1 };
    expect(await buscarSituacaoEntrada('x')).toBeNull();
  });
});
