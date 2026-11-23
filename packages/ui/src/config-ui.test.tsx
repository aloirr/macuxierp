import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DialogoMotivo, avaliarConfirmacao } from './DialogoMotivo.js';
import { TabelaDensa } from './TabelaDensa.js';
import { acumularPagina } from './paginacao.js';

const nada = () => {};
const motivos = [{ codigo: 'a', rotulo: 'Motivo A' }];

describe('DialogoMotivo semTexto', () => {
  it('não renderiza textarea nem "(opcional)"', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="T" semTexto aoConfirmar={nada} aoCancelar={nada} />);
    expect(h).not.toContain('<textarea');
    expect(h).not.toContain('(opcional)');
    expect(h).toContain('Confirmar');
  });
  it('ignora textoObrigatorio na avaliação', () => {
    expect(avaliarConfirmacao({ texto: '' }, { semTexto: true, textoObrigatorio: true })).toBeNull();
  });
  it('semTexto não afeta motivo nem validar', () => {
    expect(avaliarConfirmacao({ texto: '' }, { semTexto: true, motivos })?.campo).toBe('motivo');
    expect(avaliarConfirmacao({ motivo: 'a', texto: '' }, { semTexto: true, motivos })).toBeNull();
    expect(avaliarConfirmacao({ texto: '' }, { semTexto: true, validar: () => 'ruim' })?.mensagem).toBe('ruim');
  });
});

describe('TabelaDensa carregar mais', () => {
  it('sem linhas, a região viva existe e está vazia', () => {
    const h = renderToStaticMarkup(<TabelaDensa colunas={[{ id: 'n', titulo: 'N' }]} linhas={[]} chaveLinha={() => ''} aoCarregarMais={nada} />);
    expect(h).toMatch(/<p role="status" aria-live="polite"[^>]*><\/p>/);
  });
  const colunas = [{ id: 'n', titulo: 'N' }];
  const linhas = [{ n: 'a' }, { n: 'b' }];
  const base = { colunas, linhas, chaveLinha: (l: { n: string }) => l.n };
  it('botão só com temMais e aoCarregarMais', () => {
    expect(renderToStaticMarkup(<TabelaDensa {...base} temMais aoCarregarMais={nada} />)).toContain('Carregar mais');
    expect(renderToStaticMarkup(<TabelaDensa {...base} temMais />)).not.toContain('Carregar mais');
    expect(renderToStaticMarkup(<TabelaDensa {...base} aoCarregarMais={nada} />)).not.toContain('Carregar mais');
  });
  it('desabilita e mostra "Carregando…"', () => {
    const h = renderToStaticMarkup(<TabelaDensa {...base} temMais carregandoMais aoCarregarMais={nada} />);
    expect(h).toContain('Carregando…');
    expect(h).toContain('disabled');
  });
  it('status com a contagem', () => {
    const h = renderToStaticMarkup(<TabelaDensa {...base} aoCarregarMais={nada} />);
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('2 registros carregados.');
  });
  it('sem aoCarregarMais não há role="status"', () => {
    expect(renderToStaticMarkup(<TabelaDensa {...base} />)).not.toContain('role="status"');
  });
});

describe('acumularPagina', () => {
  const k = (l: { id: string; v: number }) => l.id;
  it('soma sem duplicar, mantém ordem e substitui na posição, sem mutar', () => {
    const atuais = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
    const pagina = [{ id: 'b', v: 2 }, { id: 'c', v: 1 }];
    const r = acumularPagina(atuais, pagina, k);
    expect(r).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 1 }]);
    expect(atuais).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]);
    expect(pagina).toHaveLength(2);
  });
  it('chave repetida na mesma página fica uma vez, com a última versão', () => {
    const r = acumularPagina([{ id: 'a', v: 1 }], [{ id: 'c', v: 1 }, { id: 'c', v: 2 }], k);
    expect(r).toEqual([{ id: 'a', v: 1 }, { id: 'c', v: 2 }]);
  });
});
