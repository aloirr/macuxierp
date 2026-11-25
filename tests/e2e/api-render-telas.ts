/**
 * X-6 da v0.3.12 (T-0089): a API de produção (`subirApiE2e`, `tests/e2e/apoio-api.ts`) para o e2e `tests/e2e/render-telas.mjs`
 * abrir TODAS as telas do web contra ela. Uso: `bash tests/e2e/rodar-render-telas.sh`.
 *
 * A lista de telas NÃO é escrita à mão: sai de `PAGINAS_REGISTRADAS` (apps/web/src/lib/paginas.ts), a mesma fonte do menu e da
 * rota `[modulo]/[...pagina]` do shell, e dos `page.tsx` do web (filtro do `arquivosDoWeb`), e vai no JSON de pronto. Rota com `:param` leva um UUID fictício (o registro não existe).
 * O tenant tem TODOS os módulos dos manifestos do web. Nenhuma chamada ao Hub: sem worker de pé, nada sai para o FDV.
 */
import { PAGINAS_REGISTRADAS } from '../../apps/web/src/lib/paginas';
import { MANIFESTOS } from '../../apps/web/src/lib/manifestos';
import { dirname, join, relative, sep } from 'node:path';
import { arquivosDoWeb, preencherCaminho, RAIZ } from '../apoio/caminhos';
import { subirApiE2e } from './apoio-api';

/** Pasta (relativa a apps/web/src/app) de cada `page.tsx` do web: o e2e transforma cada uma em URL. */
const APP = join(RAIZ, 'apps', 'web', 'src', 'app');
const paginasDoApp = arquivosDoWeb()
  .filter((f) => f.startsWith(`${APP}${sep}`) && f.endsWith(`${sep}page.tsx`))
  .map((f) => relative(APP, dirname(f)).split(sep).join('/'))
  .sort();

const telas = PAGINAS_REGISTRADAS.map((p) => ({
  modulo: p.modulo,
  titulo: p.titulo,
  rota: p.rota,
  url: preencherCaminho(p.rota),
  comParametro: p.rota.includes(':'),
}));

await subirApiE2e({
  slug: 'e2e-render',
  nome: 'Comercial Tarumã Fictício Ltda',
  modulos: MANIFESTOS.map((m) => m.id),
  sa: { email: 'sa-e2e-render@exemplo.invalid' },
  adm: 'adm-e2e-render@exemplo.invalid',
  versao: 'api-render-telas',
  porta: '3202',
  extra: () => ({ paginasDoApp, telas }),
});
