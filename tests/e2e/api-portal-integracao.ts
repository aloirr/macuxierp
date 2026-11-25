/**
 * T-0056 (E3): a API de produção (`subirApiE2e`, `tests/e2e/apoio-api.ts`: módulos do `main.ts`, plugin de plataforma do
 * portal /config e a chave mestra do conector) para o e2e `tests/e2e/portal-integracao.mjs` rodar as telas reais do /config
 * e do BKO contra ela (`MACUXIERP_API_URL`). Uso: `bash tests/e2e/rodar-portal-integracao.sh`. O superadmin entra com a
 * senha provisória e troca. Nenhuma chamada ao Hub: sem worker de pé, nada sai para o FDV (o "Testar conexão" só registra o pedido).
 */
import { CAMINHOS_INTEGRACAO_FDV_PLATAFORMA as C, CABECALHO_CSRF_CONFIG, COOKIE_CONFIG, PREFIXO_PLATAFORMA } from '../../packages/platform-sdk/src/index';
import { subirApiE2e } from './apoio-api';

await subirApiE2e({
  slug: 'e2e-ifdv',
  nome: 'Comercial Igarapé Fictício Ltda',
  modulos: ['core', 'cadastros', 'integracao-fdv'],
  sa: { email: 'sa-e2e-ifdv@exemplo.invalid', deveTrocar: true },
  adm: 'adm-e2e-ifdv@exemplo.invalid',
  versao: 'api-portal-integracao',
  porta: '3201',
  extra: ({ tenant }) => ({
    portal: { prefixo: PREFIXO_PLATAFORMA, cookie: COOKIE_CONFIG, csrf: CABECALHO_CSRF_CONFIG, ler: `${PREFIXO_PLATAFORMA}${C.ler.replace(':id', tenant)}` },
  }),
});
