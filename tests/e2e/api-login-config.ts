/**
 * R-20261127-061730 (v0.3.20): a API de produção (`subirApiE2e`, `tests/e2e/apoio-api.ts`) para o e2e
 * `tests/e2e/login-config.mjs`. A mesma pessoa é administradora de uma empresa fictícia e superadmin do portal /config (o
 * mesmo e-mail nos dois cadastros, como no defeito). Só dado fictício; nada sai da sessão. Uso: `bash tests/e2e/rodar-login-config.sh`.
 */
import { subirApiE2e } from './apoio-api';

const EMAIL = 'pessoa-e2e-login@exemplo.invalid';

await subirApiE2e({
  slug: 'am9104',
  nome: 'Distribuidora Tarumã Fictícia Ltda',
  modulos: ['core', 'cadastros'],
  sa: { email: EMAIL },
  adm: EMAIL,
  versao: 'api-login-config',
  porta: '3204',
});
