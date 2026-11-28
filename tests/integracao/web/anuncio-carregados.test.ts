/**
 * T-0135 (quadro de 28/11, "Para o testes"): o anúncio ao leitor de tela da `TabelaDensa` de `packages/ui` depois do
 * "Carregar mais" concorda com o número: "1 registro carregado." e "2 registros carregados.". Renderiza o componente real
 * (sem dublê), com o React do próprio `packages/ui`. O singular está ligado desde o #958 do designer-ux (dono do
 * `packages/ui/src/TabelaDensa.tsx`): o caso roda sempre.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  it('1 linha: "1 registro carregado." (singular)', async () => {
    expect(await anuncio(1)).toBe('1 registro carregado.');
  });
});
