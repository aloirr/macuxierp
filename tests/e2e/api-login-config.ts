/**
 * R-20261127-061730 (v0.3.20; ADR 0021 na v0.3.30): a API de produção (`subirApiE2e`, `tests/e2e/apoio-api.ts`) para os e2e
 * `tests/e2e/login-config.mjs` e `tests/e2e/login-sem-empresa.test.ts`, com o "Esqueci a senha" ligado (e-mail em memória).
 * Massa fictícia:
 * - a administradora da empresa ativa é também superadmin, com o MESMO e-mail (o caso do defeito; opção A: vai ao BKO);
 * - um superadmin só (vai ao /config);
 * - a administradora de uma empresa suspensa (403 EMPRESA_SUSPENSA com a senha certa).
 * Só dado fictício; nada sai da sessão. Uso: `bash tests/e2e/rodar-login-config.sh` ou `bash tests/e2e/rodar-login-sem-empresa.sh`.
 */
import { randomUUID } from 'node:crypto';
import { criarTenant } from '../../packages/platform-sdk/src/pg-testes';
import { inserirAdministradorDeTeste, SENHA_DE_TESTE } from '../../apps/api/src/apoio-teste';
import { inserirSuperadmin, SENHA_SA } from '../apoio/portal-pg';
import { subirApiE2e } from './apoio-api';

const EMAIL = 'pessoa-e2e-login@exemplo.invalid';
const EMAIL_SO_SUPERADMIN = 'superadmin-e2e-login@exemplo.invalid';
const EMAIL_SUSPENSA = 'suspensa-e2e-login@exemplo.invalid';

await subirApiE2e({
  slug: 'am9104',
  nome: 'Distribuidora Tarumã Fictícia Ltda',
  modulos: ['core', 'cadastros'],
  sa: { email: EMAIL_SO_SUPERADMIN },
  adm: EMAIL,
  versao: 'api-login-config',
  porta: '3204',
  esqueci: true,
  extra: async ({ b }) => {
    // §7: o mesmo e-mail da administradora também é superadmin (fora da unicidade do e-mail)
    await inserirSuperadmin(b, EMAIL);
    const suspensa = await criarTenant(b.admin, 'am9105', ['core', 'cadastros']);
    await inserirAdministradorDeTeste(b.admin, suspensa, { id: randomUUID(), email: EMAIL_SUSPENSA, nome: 'Administração Fictícia Suspensa', filialIds: [] });
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [suspensa]);
    return { mesmoEmail: { email: EMAIL, senhaSuperadmin: SENHA_SA }, suspensa: { email: EMAIL_SUSPENSA, senha: SENHA_DE_TESTE } };
  },
});
