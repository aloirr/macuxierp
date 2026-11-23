/**
 * T-0056 (E3): sobe a API de produção (`appPgDeTeste` com os módulos do `main.ts`, o plugin de plataforma do portal /config
 * e a chave mestra do conector) num banco efêmero do Postgres local, para o e2e `tests/e2e/portal-integracao.mjs` rodar as
 * telas reais do /config e do BKO contra ela (`MACUXIERP_API_URL`). Fora do vitest. Uso: `bash tests/e2e/rodar-portal-integracao.sh`,
 * com `MACUXI_DB_MIGRACOES` exportado. Grava `<arquivo>` (JSON com a massa fictícia) quando está ouvindo; no SIGTERM fecha e apaga o banco.
 * Nenhuma chamada ao Hub: sem worker de pé, nada sai para o FDV (o "Testar conexão" só registra o pedido).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { CAMINHOS_INTEGRACAO_FDV_PLATAFORMA as C, CABECALHO_CSRF_CONFIG, COOKIE_CONFIG, PREFIXO_PLATAFORMA } from '../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant } from '../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from '../../apps/api/src/apoio-teste';
import { inserirSuperadmin, SENHA_SA } from '../apoio/portal-pg';
import { argumento as arg } from './apoio-e2e.mjs';

const PORTA = Number(arg('porta', '3201'));
const PRONTO = arg('pronto', '');

const EMPRESA = { slug: 'e2e-ifdv', nome: 'Comercial Igarapé Fictício Ltda' };
const SA = 'sa-e2e-ifdv@exemplo.invalid';
const ADM = 'adm-e2e-ifdv@exemplo.invalid';

const b = await criarBancoEfemero();
await inserirSuperadmin(b, SA, { deveTrocar: true });
const tenant = await criarTenant(b.admin, EMPRESA.slug, ['core', 'cadastros', 'integracao-fdv']);
await b.admin.query('UPDATE plataforma.tenant SET nome = $2 WHERE id = $1', [tenant, EMPRESA.nome]);
await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [tenant, EMPRESA.nome, '11222333000181']);
const filial = randomUUID();
await inserirFilialDeTeste(b.admin, tenant, { id: filial, cnpj: '11222333000181', nome: 'Matriz Manaus' });
await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email: ADM, nome: 'Administração Fictícia', filialIds: [filial] });

// Chave mestra do conector gerada a cada execução: nenhum segredo fixo.
const { app } = await appPgDeTeste({ b, versao: 't0056-e2e', modulos: 'producao', chaveIntegracao: randomBytes(32) });
await app.listen({ port: PORTA, host: '127.0.0.1' });

const url = `http://127.0.0.1:${PORTA}`;
const pronto = {
  url,
  empresa: { id: tenant, ...EMPRESA },
  superadmin: { email: SA, senhaProvisoria: SENHA_SA },
  administrador: { empresa: EMPRESA.slug, email: ADM, senha: SENHA_DE_TESTE },
  portal: { prefixo: PREFIXO_PLATAFORMA, cookie: COOKIE_CONFIG, csrf: CABECALHO_CSRF_CONFIG, ler: `${PREFIXO_PLATAFORMA}${C.ler.replace(':id', tenant)}` },
};
if (PRONTO) writeFileSync(PRONTO, JSON.stringify(pronto));
console.error(`[api-portal-integracao] ouvindo em ${url} (banco ${b.nome})`);

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    void app
      .close()
      .then(() => b.remover())
      .then(() => console.error('[api-portal-integracao] banco efêmero apagado'))
      .finally(() => process.exit(0));
  });
}
