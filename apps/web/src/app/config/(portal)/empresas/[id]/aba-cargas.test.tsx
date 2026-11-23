import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CADASTROS_CARGA_PORTAL, ValidarCargaPlataformaResposta, ZeragemPlataformaResposta } from '@macuxierp/platform-sdk';
import { EMP, conferencia as conferenciaBruta, situacoes } from '@/lib/config/cargas-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import { AVISO_ZERAR, textoSemChave } from '@/lib/config/cargas';
import { AbaCargas, EfeitoSubstituir, ImportarCarga, PainelConferencia, rotuloArquivo, AvisoSemChave, ZerarDados } from './aba-cargas';

const dados = situacoes({ filial: { situacao: 'carregado', quantidade: 1 }, produto: { situacao: 'com_erro', erros: 2 } });
const aba = (d: typeof dados | null = dados) => renderToStaticMarkup(<AbaCargas empresaId={EMP} dados={d} fuso="America/Manaus" />);
const conf = ValidarCargaPlataformaResposta.parse(conferenciaBruta({ com_erro: 2, linhas: [
  { linha: 21, motivo: 'O NCM 4202.22.10 exige CEST: preencha a coluna cest.', acao: 'Preencha a coluna cest.' },
  { linha: null, motivo: 'Cabeçalho inválido.', acao: 'Baixe o modelo.' },
] }));

describe('aba Cargas (T-0058)', () => {
  it('uma linha por cadastro: número, nome, chip, data e quantidade, Modelo e Importar', () => {
    const h = aba();
    expect(h.match(/class="linha-carga"/g)).toHaveLength(CADASTROS_CARGA_PORTAL.length);
    expect(h).toContain('<span class="carga-nome">Filiais</span>');
    expect(h).toMatch(/color:var\(--mx-cor-verde-sucesso\)[^"]*"[^>]*>Carregado<\/span>/);
    expect(h).toMatch(/color:var\(--mx-cor-aviso-texto\)[^"]*"[^>]*>2 com erro<\/span>/);
    expect(h).toMatch(/color:var\(--mx-cor-texto-secundario\)[^"]*"[^>]*>Não carregado<\/span>/);
    expect(h).toContain('23/11/2026 14:39 · 1 registro');
    expect(h).toContain(`href="/config/empresas/${EMP}/cargas/produto/modelo"`);
    expect(h).toContain('aria-label="Importar Produtos"');
    expect(h.indexOf('Filiais')).toBeLessThan(h.indexOf('Produtos'));
  });
  it('sem "Carregue antes": o Importar fica sempre ligado; "Unidades (opcional)" sem ponto', () => {
    const h = aba();
    expect(h).not.toContain('Carregue antes');
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Importar /);
    expect(h).toContain('<span class="carga-nome">Unidades (opcional)</span>');
    expect(h).not.toContain('(opcional).');
    expect(h).not.toContain('Modo completo');
    expect(h).not.toContain('Exportar resumo');
  });
  it('"Zerar dados" no alto da aba e a janela fechada por padrão', () => {
    const h = aba();
    expect(h.indexOf('Zerar dados')).toBeLessThan(h.indexOf('class="lista-cargas"'));
    expect(h).not.toContain('role="dialog"');
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

describe('janela Zerar dados', () => {
  const zerar = (props: Partial<React.ComponentProps<typeof ZerarDados>> = {}) => renderToStaticMarkup(<ZerarDados empresaId={EMP} aoFechar={() => undefined} aoZerar={() => undefined} {...props} />);
  const previa = (extra: Record<string, unknown> = {}) => ZeragemPlataformaResposta.parse({
    empresa_id: EMP, simulado: true, efetivos: ['produto', 'produto_unidade', 'estoque', 'cliente'], apagados: [],
    anulados: [{ tabela: 'cliente', coluna: 'vendedor_id', quantidade: 12 }, { tabela: 'cliente', coluna: 'condicao_pagamento_id', quantidade: 1 }],
    mantidos: [{ cadastro: 'produto', motivo: 'pedido', quantidade: 3 }, { cadastro: 'cliente', motivo: 'nota', quantidade: 2 }],
    bloqueios: [], sem_chave: 12, ...extra,
  });
  const ESCOLHA = ['produto', 'cliente'] as const;
  it('avisa que apaga e não tem volta, orienta exportar, pede a frase e começa com o botão desligado', () => {
    const h = zerar();
    expect(h).toContain(`<p class="faixa-erro sem-margem" role="alert">${AVISO_ZERAR}</p>`);
    expect(h).toContain('Antes de zerar, exporte pelo BKO da empresa (Cadastros &gt; Exportar).');
    expect(h).not.toMatch(/<(a|button)[^>]*>[^<]*(Baixar|Exportar)/);
    expect(h).toContain('autorizo zerar os dados');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Zerar dados<\/button>/);
    expect(h).toContain('role="dialog"');
  });
  it('lista os 9 cadastros com checkbox e rótulos legíveis; por padrão todos marcados', () => {
    const h = zerar();
    expect(h.match(/type="checkbox"/g)).toHaveLength(9);
    expect(h.match(/checked=""/g)).toHaveLength(9);
    expect(h).toContain('<span>Condições de pagamento</span>');
    expect(h).toContain('<span>Endereços de clientes</span>');
    expect(zerar({ selecaoInicial: ESCOLHA }).match(/checked=""/g)).toHaveLength(2);
  });
  it('seleção mínima: sem nenhum marcado pede um cadastro, não mostra prévia e o confirmar fica desligado', () => {
    const h = zerar({ selecaoInicial: [], previaInicial: previa() });
    expect(h).not.toContain('checked=""');
    expect(h).toContain('Escolha ao menos um cadastro.');
    expect(h).not.toContain('Leva junto');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Zerar dados<\/button>/);
  });
  it('prévia: leva junto, mantidos com o detalhe, anulados e o aviso do sem_chave', () => {
    const h = zerar({ selecaoInicial: ESCOLHA, previaInicial: previa() });
    expect(h).toContain('Leva junto: Unidades, Estoque.');
    expect(h).toContain('Mantidos: 5');
    expect(h).toContain('Produtos: 3 em pedidos.');
    expect(h).toContain('Clientes: 2 em notas.');
    expect(h).toContain('12 clientes ficam sem vendedor.');
    expect(h).toContain('1 cliente fica sem condição de pagamento.');
    expect(h).toContain(textoSemChave(12));
  });
  it('sem mantidos, anulados nem sem_chave, a prévia não mostra essas linhas', () => {
    const h = zerar({ selecaoInicial: ['produto'], previaInicial: previa({ efetivos: ['produto'], anulados: [], mantidos: [], sem_chave: 0 }) });
    expect(h).not.toContain('Leva junto');
    expect(h).not.toContain('Mantidos');
    expect(h).not.toContain('ficam sem');
    expect(h).not.toContain('sem código de origem');
  });
  it('bloqueio: mostra o motivo legível e o confirmar fica desligado', () => {
    const h = zerar({ selecaoInicial: ['preco'], previaInicial: previa({ efetivos: ['preco'], bloqueios: [{ cadastro: 'preco', motivo: 'integracao_ligada' }, { cadastro: 'produto', motivo: 'lote_em_andamento' }] }) });
    expect(h).toContain('Desligue o envio de Preços na aba Integração FDV antes de zerar.');
    expect(h).toContain('Há uma carga em andamento. Espere terminar para zerar.');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Zerar dados<\/button>/);
  });
  it('o aviso do FDV sem código de origem só aparece com sem_chave > 0', () => {
    expect(renderToStaticMarkup(<AvisoSemChave semChave={0} />)).toBe('');
    const p = renderToStaticMarkup(<AvisoSemChave semChave={12} />);
    expect(p).toContain('faixa-aviso');
    expect(p).toContain(textoSemChave(12));
  });
});
