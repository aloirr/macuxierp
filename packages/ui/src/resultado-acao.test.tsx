import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultadoAcao, precisaRolar, useResultado } from './ResultadoAcao.js';

const html = (p: Parameters<typeof ResultadoAcao>[0]) => renderToStaticMarkup(<ResultadoAcao {...p} />);

describe('ResultadoAcao (decisão 36 A): resultado logo abaixo do botão', () => {
  it('sem resultado: as duas regiões ficam montadas e vazias (o leitor anuncia o próximo)', () => {
    const h = html({ resultado: null, id: 'r1' });
    expect(h).toContain('id="r1"');
    expect(h).toMatch(/role="status" aria-live="polite" aria-atomic="true"><\/div>/);
    expect(h).toMatch(/role="alert" aria-atomic="true"><\/div>/);
    expect(h).toContain('data-resultado-acao=""');
  });

  it('sucesso e aviso: texto dentro do role="status"; a região de alerta fica vazia', () => {
    for (const tom of ['sucesso', 'aviso'] as const) {
      const h = html({ resultado: { tom, texto: 'Conexão testada. O FDV respondeu.' } });
      expect(h).toMatch(/role="status"[^>]*>.*Conexão testada\. O FDV respondeu\./);
      expect(h).toMatch(/role="alert" aria-atomic="true"><\/div>/);
      expect(h).toContain(`data-resultado-acao="${tom}"`);
    }
  });

  it('a chave não é key do React (a região não remonta) e o módulo é \'use client\'', () => {
    const fonte = readFileSync(new URL('./ResultadoAcao.tsx', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/key=\{chave\}/);
    expect(fonte).toContain("'use client'");
  });

  it('erro: texto no role="alert" e a região educada vazia (sem anúncio duplo)', () => {
    const h = html({ resultado: { tom: 'erro', texto: 'Não foi possível testar a conexão. Tente de novo.' } });
    expect(h).toMatch(/role="alert"[^>]*>.*Não foi possível testar a conexão/);
    expect(h).toMatch(/role="status"[^>]*><\/div>/);
  });

  it('detalhe opcional vem depois do texto', () => {
    const h = html({ resultado: { tom: 'aviso', texto: 'Enviado com ressalvas.', detalhe: <a href="#log">Ver no Log</a> } });
    expect(h.indexOf('Enviado com ressalvas.')).toBeLessThan(h.indexOf('Ver no Log'));
  });

  it('ocupa a linha inteira abaixo do botão (também numa fila flex)', () => {
    const h = html({ resultado: { tom: 'sucesso', texto: 'ok' } });
    expect(h).toContain('flex-basis:100%');
    expect(h).toContain('width:100%');
  });

  it('cores só por token (var(--mx-cor-…)), sem hex', () => {
    for (const tom of ['sucesso', 'aviso', 'erro'] as const) {
      const h = html({ resultado: { tom, texto: 'x' } });
      expect(h).toContain('var(--mx-cor-');
      expect(h).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    }
    expect(readFileSync(new URL('./ResultadoAcao.tsx', import.meta.url), 'utf8')).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('rola só quando o resultado nasce fora da área visível', () => {
    expect(precisaRolar({ top: 100, bottom: 140 }, 800)).toBe(false);
    expect(precisaRolar({ top: 780, bottom: 840 }, 800)).toBe(true);
    expect(precisaRolar({ top: -20, bottom: 20 }, 800)).toBe(true);
  });

  it('useResultado: estado inicial é resultado null e chave 0', () => {
    function Sonda() {
      const [r, chave, mostrar, limpar] = useResultado();
      return <p data-r={String(r)} data-chave={chave} data-fns={`${typeof mostrar}/${typeof limpar}`} />;
    }
    const h = renderToStaticMarkup(<Sonda />);
    expect(h).toContain('data-r="null"');
    expect(h).toContain('data-chave="0"');
    expect(h).toContain('data-fns="function/function"');
  });
});
