import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CADASTROS_CARGA_PORTAL, ENTIDADES_ENVIO_FDV, IntegracaoFdvPlataforma, ValidarCargaPlataformaResposta, type EfeitoSubstituir as SdkEfeito } from '@macuxierp/platform-sdk';
import { avisoCarga, entidadesDaCarga, estadoCargaCompleta, rotuloComLote } from '@/lib/config/integracao-fdv';
import { AVISO_LIMITE_FDV } from '@/lib/config/cargas';
import { EMP, conferencia as conferenciaBruta, situacoes } from '@/lib/config/cargas-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import { AbaDados, EfeitoSubstituir, ImportarCarga, PainelConferencia, rotuloArquivo, origemDaCarga } from './aba-dados';

const dados = situacoes({ filial: { situacao: 'carregado', quantidade: 1 }, produto: { situacao: 'com_erro', erros: 2 } });
const aba = (d: typeof dados | null = dados) => renderToStaticMarkup(<AbaDados empresaId={EMP} dados={d} fuso="America/Manaus" />);
const conf = ValidarCargaPlataformaResposta.parse(conferenciaBruta({ com_erro: 2, linhas: [
  { linha: 21, motivo: 'O NCM 4202.22.10 exige CEST: preencha a coluna cest.', acao: 'Preencha a coluna cest.' },
  { linha: null, motivo: 'Cabeçalho inválido.', acao: 'Baixe o modelo.' },
] }));

describe('aba Dados (T-0058, T-0086)', () => {
  it('uma tabela só: uma linha por cadastro com situação, última carga (data, hora, registros), origem, Modelo e Importar', () => {
    const h = aba();
    expect(h.match(/<tr[^>]*data-/g) ?? h.match(/<tbody>[\s\S]*<\/tbody>/)).toBeTruthy();
    for (const t of ['Cadastro', 'Situação', 'Última carga', 'Origem', 'Modelo', 'Importar']) expect(h).toContain(`>${t}<`);
    expect(h).toContain('>Filiais<');
    expect(h).toMatch(/color:var\(--mx-cor-verde-sucesso\)[^"]*"[^>]*>Carregado<\/span>/);
    expect(h).toMatch(/color:var\(--mx-cor-aviso-texto\)[^"]*"[^>]*>2 com erro<\/span>/);
    expect(h).toMatch(/color:var\(--mx-cor-texto-secundario\)[^"]*"[^>]*>Não carregado<\/span>/);
    expect(h).toContain('23/11/2026 14:39 · 1 registro');
    expect(h).toContain('>CSV<');
    expect(h).toContain(`href="/config/empresas/${EMP}/cargas/produto/modelo"`);
    expect(h).toContain('aria-label="Importar Produtos"');
    expect(h.match(/aria-label="Importar /g)).toHaveLength(CADASTROS_CARGA_PORTAL.length);
    expect(h.indexOf('Filiais')).toBeLessThan(h.indexOf('Produtos'));
  });
  it('sai da tela: Zerar dados, lista de cargas antiga e "Cargas" no título', () => {
    const h = aba();
    expect(h).not.toContain('>Dados<');
    expect(h).toContain('>Ações<');
    expect(h).not.toContain('Zerar');
    expect(h).not.toContain('lista-cargas');
    expect(h).not.toContain('>Cargas<');
    expect(h).not.toContain('role="dialog"');
  });
  it('o Importar fica sempre ligado; "Unidades (opcional)" sem ponto', () => {
    const h = aba();
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Importar /);
    expect(h).toContain('Unidades (opcional)');
    expect(h).not.toContain('(opcional).');
  });
  it('origem: CSV com carga e nada sem carga', () => {
    expect(origemDaCarga({ ultima: '23/11/2026 14:39 · 1 registro' })).toBe('CSV');
    expect(origemDaCarga({ ultima: null })).toBeNull();
  });
  it('sem dados da API: erro com "Tentar de novo" para a aba Dados', () => {
    const h = aba(null);
    expect(h).toContain('Não foi possível carregar os dados');
    expect(h).toContain('?aba=dados');
  });
});

describe('coluna Carga completa na aba Dados (decisão do PO em 24/11)', () => {
  const ligadas = ['produto', 'cliente', 'cliente_endereco', 'forma_pagamento'];
  const integ = (voo: string[] = [], lig: string[] = ligadas) => IntegracaoFdvPlataforma.parse({
    empresa_id: EMP, modulo_licenciado: true, credencial_id: EMP, conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'abcd1234', criada_em: '2026-11-23T12:00:00.000Z', ultimo_uso_em: null,
    entidades_habilitadas: ENTIDADES_ENVIO_FDV.filter((e) => lig.includes(e)), limite_registros_lote: 500, ultimo_sinal: null,
    cadastros: ENTIDADES_ENVIO_FDV.map((entidade) => ({ entidade, ligada: lig.includes(entidade), ultimo_envio_em: null, falha: null, lote_em_voo: voo.includes(entidade) })),
  });
  const com = (i: IntegracaoFdvPlataforma | null) => renderToStaticMarkup(<AbaDados empresaId={EMP} dados={dados} fuso="America/Manaus" integracao={i} />);
  it('coluna e botão só nos cadastros ligados; os outros ficam com "—"; o aviso e a confirmação só abrem no clique', () => {
    const h = com(integ());
    expect(h).toContain('>Carga completa<');
    expect(h).toMatch(/<button[^>]*aria-label="Carga completa: Produtos"[^>]*>Carga completa<\/button>/);
    expect(h).toMatch(/<button[^>]*aria-label="Carga completa: Clientes"/);
    expect(h).not.toContain('aria-label="Carga completa: Filiais"');
    expect(h).not.toContain('aria-label="Carga completa: Condições de pagamento"'); // falta prazo_pagamento
    expect(h).not.toMatch(/aria-label="Carga completa: Produtos"[^>]*disabled/);
    expect(h).not.toContain('role="dialog"');
    expect(h).not.toContain('pode demorar');
  });
  it('lote em voo: botão desligado com "Enviando…"', () => {
    const h = com(integ(['produto']));
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Carga completa: Produtos"[^>]*>Enviando…<\/button>|<button[^>]*aria-label="Carga completa: Produtos"[^>]*disabled=""[^>]*>Enviando…<\/button>/);
    expect(h).toMatch(/aria-label="Carga completa: Clientes"[^>]*>Carga completa<\/button>/);
  });
  it('cadastro de duas entidades: lote em voo em qualquer uma desliga o botão', () => {
    expect(com(integ(['cliente_endereco']))).toMatch(/aria-label="Carga completa: Clientes"[^>]*disabled=""[^>]*>Enviando…|disabled=""[^>]*aria-label="Carga completa: Clientes"[^>]*>Enviando…/);
  });
  it('sem a integração lida (ou sem licença) nenhum botão aparece e a tabela segue inteira', () => {
    expect(com(null)).not.toContain('aria-label="Carga completa');
    expect(com({ ...integ(), modulo_licenciado: false })).not.toContain('aria-label="Carga completa');
    expect(aba()).toContain('aria-label="Importar Produtos"');
  });
  it('estado puro: entidades por cadastro e rótulo', () => {
    expect(entidadesDaCarga('condicao_pagamento')).toEqual(['forma_pagamento', 'prazo_pagamento']);
    expect(entidadesDaCarga('cliente')).toEqual(['cliente', 'cliente_endereco']);
    expect(entidadesDaCarga('preco')).toEqual(['preco']);
    expect(entidadesDaCarga('inexistente')).toEqual([]);
    expect(estadoCargaCompleta('produto', integ(['produto']))).toMatchObject({ visivel: true, loteEmVoo: true });
    expect(estadoCargaCompleta('filial', integ())).toMatchObject({ visivel: false, loteEmVoo: false });
    expect(rotuloComLote(true, 'Carga completa')).toBe('Enviando…');
    expect(rotuloComLote(false, 'Carga completa')).toBe('Carga completa');
    expect(rotuloComLote(false, 'Reprocessar')).toBe('Reprocessar');
    expect(avisoCarga).toBe('Envia tudo de uma vez: pode demorar e inativar cadastros no FDV.');
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
    expect(p).toContain(AVISO_LIMITE_FDV);
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

describe('endereços inativados (T-0070)', () => {
  const efeito: SdkEfeito = { total: 40, a_inativar: 12, percentual: 30, acima_limite_fdv: false, enderecos_a_inativar: 5 };
  it('a confirmação do Substituir tudo de clientes mostra "e 5 endereços"', () => {
    expect(renderToStaticMarkup(<EfeitoSubstituir cadastro="cliente" efeito={efeito} />)).toContain('Vai inativar 12 de 40 clientes (30%) e 5 endereços.');
  });
});

