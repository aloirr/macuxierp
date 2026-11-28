/**
 * T-0135 (quadro de 28/11, "Para o testes"): o anúncio ao leitor de tela da `TabelaDensa` de `packages/ui` depois do
 * "Carregar mais" concorda com o número: "1 registro carregado." e "2 registros carregados.". Renderiza o componente real
 * (sem dublê), com o React do próprio `packages/ui`. O singular fica desligado até o PR do designer-ux (dono do
 * `packages/ui/src/TabelaDensa.tsx`): desligado, o caso roda e só avisa "pendente"; para ligar, `apoio-e2e.mjs`.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exigirQuandoLigada } from '../../e2e/apoio-e2e.mjs';

const UI = join(__dirname, '../../../packages/ui');
const doUi = createRequire(join(UI, 'package.json'));
const { createElement } = doUi('react') as { createElement: (c: unknown, p: object) => unknown };
const { renderToStaticMarkup } = doUi('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

async function anuncio(n: number): Promise<string> {
  const { TabelaDensa } = (await import(join(UI, 'src/TabelaDensa.tsx'))) as { TabelaDensa: unknown };
  const linhas = Array.from({ length: n }, (_, i) => ({ n: `linha-${i + 1}` }));
  const html = renderToStaticMarkup(
    createElement(TabelaDensa, { colunas: [{ id: 'n', titulo: 'N' }], linhas, chaveLinha: (l: { n: string }) => l.n, temMais: true, aoCarregarMais: () => undefined }),
  );
  const m = /<p role="status"[^>]*>([^<]*)<\/p>/.exec(html);
  return m?.[1] ?? '';
}

describe('T-0135: anúncio "N registro(s) carregado(s)." da TabelaDensa', () => {
  it('2 linhas: "2 registros carregados."', async () => {
    expect(await anuncio(2)).toBe('2 registros carregados.');
  });
  it('1 linha: "1 registro carregado." (singular; ligar depois do PR do designer-ux)', async () => {
    const texto = await anuncio(1);
    // Desligada, aceita só o texto de hoje ou o certo: qualquer outra coisa reprova já.
    expect(['1 registro carregado.', '1 registros carregados.']).toContain(texto);
    expect(exigirQuandoLigada('singularRegistroCarregado', texto === '1 registro carregado.', `anúncio com 1 linha: "${texto}"`)).toBe(texto === '1 registro carregado.');
  });
});
