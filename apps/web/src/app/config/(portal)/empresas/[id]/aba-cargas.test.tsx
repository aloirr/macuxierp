import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ValidarCargaPlataformaResposta } from '@macuxierp/platform-sdk';
import { EMP, conferencia as conferenciaBruta, situacoes } from '@/lib/config/cargas-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import { AbaCargas, EfeitoSubstituir, ImportarCarga, PainelConferencia, rotuloArquivo } from './aba-cargas';

const dados = situacoes({ filial: { situacao: 'carregado', quantidade: 1 }, produto: { situacao: 'com_erro', erros: 2 } });
const aba = (d: typeof dados | null = dados) => renderToStaticMarkup(<AbaCargas empresaId={EMP} dados={d} fuso="America/Manaus" />);
const conf = ValidarCargaPlataformaResposta.parse(conferenciaBruta({ com_erro: 2, linhas: [
  { linha: 21, motivo: 'O NCM 4202.22.10 exige CEST: preencha a coluna cest.', acao: 'Preencha a coluna cest.' },
  { linha: null, motivo: 'Cabeçalho inválido.', acao: 'Baixe o modelo.' },
] }));

describe('aba Cargas (T-0058)', () => {
  it('uma linha por cadastro: número, nome, chip, data e quantidade, Modelo e Importar', () => {
    const h = aba();
    expect(h.match(/class="linha-carga"/g)).toHaveLength(10);
    expect(h).toContain('<span class="carga-nome">Filiais</span>');
    expect(h).toMatch(/color:var\(--mx-cor-verde-sucesso\)[^"]*"[^>]*>Carregado<\/span>/);
    expect(h).toMatch(/color:var\(--mx-cor-aviso-texto\)[^"]*"[^>]*>2 com erro<\/span>/);
    expect(h).toMatch(/color:var\(--mx-cor-texto-secundario\)[^"]*"[^>]*>Não carregado<\/span>/);
    expect(h).toContain('23/11/2026 14:39 · 1 registro');
    expect(h).toContain(`href="/config/empresas/${EMP}/cargas/produto/modelo"`);
    expect(h).toContain('aria-label="Importar Produtos"');
    expect(h.indexOf('Filiais')).toBeLessThan(h.indexOf('Produtos'));
  });
  it('dependente bloqueado mostra "Carregue antes" (com ponto) e o Importar desligado; "Unidades (opcional)" sem ponto', () => {
    const h = aba();
    const endereco = h.slice(h.indexOf('data-cadastro="cliente_endereco"'));
    expect(endereco).toContain('Carregue antes: Clientes.');
    expect(endereco).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Importar Endereços de cliente"/);
    expect(h).toContain('<span class="carga-nome">Unidades (opcional)</span>');
    expect(h).not.toContain('(opcional).');
    expect(h).not.toContain('Modo completo');
    expect(h).not.toContain('Exportar resumo');
  });
  it('a janela de importar fica fechada por padrão', () => {
    expect(aba()).not.toContain('role="dialog"');
  });
  it('sem dados da API: erro com "Tentar de novo"', () => {
    const h = aba(null);
    expect(h).toContain('Não foi possível carregar as cargas');
    expect(h).toContain('?aba=cargas');
  });
});

describe('janela Importar', () => {
  const h = renderToStaticMarkup(<ImportarCarga empresaId={EMP} cadastro="produto" aoFechar={() => undefined} aoGravar={() => undefined} />);
  it('título, Escolher arquivo, Cancelar; Substituir tudo (secundário em erro) e Adicionar (primário, à direita) desligados', () => {
    expect(h).toContain('Importar Produtos');
    expect(h).toContain('Escolher arquivo');
    expect(h).toMatch(/type="file"[^>]*accept="\.csv,text\/csv"/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Substituir tudo<\/button>/);
    expect(h).toMatch(/class="mx-botao-secundario botao-perigo-contorno"[^>]*>Substituir tudo/);
    expect(h).toMatch(/class="mx-botao"[^>]*disabled=""[^>]*>Adicionar<\/button>/);
    expect(h.indexOf('Cancelar')).toBeLessThan(h.indexOf('Substituir tudo'));
    expect(h.indexOf('Substituir tudo')).toBeLessThan(h.indexOf('>Adicionar<'));
    expect(h).not.toMatch(/>Gravar/);
    // Estoque (substituir_permitido false no SDK): só Cancelar e Adicionar, sem "Substituir tudo".
    const e = renderToStaticMarkup(<ImportarCarga empresaId={EMP} cadastro="estoque" aoFechar={() => undefined} aoGravar={() => undefined} />);
    expect(e).toContain('Importar Estoque');
    expect(e).not.toContain('Substituir tudo');
    expect(e).toContain('Cancelar');
    expect(e).toMatch(/class="mx-botao"[^>]*disabled=""[^>]*>Adicionar<\/button>/);
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-modal="true"');
    expect(h).not.toContain('Baixar erros');
    expect(h).not.toContain('Vai inativar');
    expect(h).not.toContain('Acima de 30%');
  });
  it('conferência: duas caixas, lista "Linha N: motivo" sem repetir a ação, e Baixar erros', () => {
    const p = renderToStaticMarkup(<PainelConferencia conferencia={conf} aoBaixar={() => undefined} />);
    expect(p).toMatch(/>44<\/span><span>prontas para gravar<\/span>/);
    expect(p).toMatch(/>2<\/span><span>com erro \(ficam de fora\)<\/span>/);
    expect(p).toContain('<b>Linha 21:</b> O NCM 4202.22.10 exige CEST: preencha a coluna cest.</li>');
    expect(p).toContain('<b>Arquivo:</b> Cabeçalho inválido. Baixe o modelo.');
    expect(p).toContain('Baixar erros');
    expect(p).not.toContain('Vai inativar');
    expect(p).not.toContain('Acima de 30%');
  });
  it('nome do arquivo com a contagem de linhas (prontas + com erro) depois da conferência', () => {
    expect(rotuloArquivo('clientes.csv', null)).toBe('clientes.csv');
    expect(rotuloArquivo('clientes.csv', { ...conf, prontas: 132, com_erro: 2 })).toBe('clientes.csv · 134 linhas');
    expect(rotuloArquivo('a.csv', { ...conf, prontas: 1, com_erro: 0 })).toBe('a.csv · 1 linha');
  });
  it('efeito do Substituir tudo por cadastro; acima de 30% traz o aviso do FDV', () => {
    const p = renderToStaticMarkup(<EfeitoSubstituir cadastro="produto" efeito={{ total: 266, a_inativar: 120, percentual: (120 * 100) / 266, acima_limite_fdv: true }} />);
    expect(p).toContain('Vai inativar 120 de 266 produtos (45%).');
    expect(p).toContain('Acima de 30%, o FDV pede confirmação no monitor de integração dele antes de aplicar.');
    const abaixo = renderToStaticMarkup(<EfeitoSubstituir cadastro="produto" efeito={{ total: 266, a_inativar: 10, percentual: (10 * 100) / 266, acima_limite_fdv: false }} />);
    expect(abaixo).toContain('Vai inativar 10 de 266 produtos (4%).');
    expect(abaixo).not.toContain('Acima de 30%');
  });
  it('sem erros: sem lista e sem Baixar erros', () => {
    const p = renderToStaticMarkup(<PainelConferencia conferencia={{ ...conf, com_erro: 0, linhas: [] }} aoBaixar={() => undefined} />);
    expect(p).toMatch(/>0<\/span><span>com erro \(ficam de fora\)<\/span>/);
    expect(p).not.toContain('lista-problemas');
    expect(p).not.toContain('Baixar erros');
  });
});
