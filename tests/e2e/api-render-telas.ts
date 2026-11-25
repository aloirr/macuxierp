/**
 * X-6 da v0.3.12 (T-0089): sobe a API de produção (`appPgDeTeste` com `modulos: 'producao'`, plugin de plataforma do portal
 * /config e a chave do conector) num banco efêmero do Postgres local, para o e2e `tests/e2e/render-telas.mjs` abrir TODAS as
 * telas do web (next build + servidor standalone) contra ela. Fora do vitest. Uso: `bash tests/e2e/rodar-render-telas.sh`.
 *
 * A lista de telas NÃO é escrita à mão: sai de `PAGINAS_REGISTRADAS` (apps/web/src/lib/paginas.ts), a mesma fonte do menu e da
 * rota `[modulo]/[...pagina]` do shell, e vai no JSON de pronto. Rota com `:param` leva um UUID fictício (o registro não existe).
 *
 * Massa fictícia (sem pessoa real): um tenant com TODOS os módulos dos manifestos do web, uma filial, um administrador e um
 * superadmin (sem troca de senha). Nenhuma chamada ao Hub: sem worker de pé, nada sai para o FDV.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { CODIGO_SUPERADMIN_LOGIN } from '../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant } from '../../packages/platform-sdk/src/pg-testes';
import {
  appPgDeTeste,
  inserirAdministradorDeTeste,
  inserirFilialDeTeste,
  SENHA_DE_TESTE,
} from '../../apps/api/src/apoio-teste';
import { PAGINAS_REGISTRADAS } from '../../apps/web/src/lib/paginas';
import { MANIFESTOS } from '../../apps/web/src/lib/manifestos';
import { inserirSuperadmin, SENHA_SA } from '../apoio/portal-pg';
import { argumento as arg } from './apoio-e2e.mjs';

const PORTA = Number(arg('porta', '3202'));
const PRONTO = arg('pronto', '');
/** Id de registro inexistente para as rotas com parâmetro (`/pedido/pedidos/:id`): a tela tem de responder sem erro de render. */
const UUID_FICTICIO = '00000000-0000-4000-8000-0000000000e6';

const EMPRESA = { slug: 'e2e-render', nome: 'Comercial Tarumã Fictício Ltda' };
const SA = 'sa-e2e-render@exemplo.invalid';
const ADM = 'adm-e2e-render@exemplo.invalid';

const b = await criarBancoEfemero();
await inserirSuperadmin(b, SA);
const tenant = await criarTenant(
  b.admin,
  EMPRESA.slug,
  MANIFESTOS.map((m) => m.id),
);
await b.admin.query('UPDATE plataforma.tenant SET nome = $2 WHERE id = $1', [tenant, EMPRESA.nome]);
await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [
  tenant,
  EMPRESA.nome,
  '11222333000181',
]);
const filial = randomUUID();
await inserirFilialDeTeste(b.admin, tenant, { id: filial, cnpj: '11222333000181', nome: 'Matriz Manaus' });
await inserirAdministradorDeTeste(b.admin, tenant, {
  id: randomUUID(),
  email: ADM,
  nome: 'Administração Fictícia',
  filialIds: [filial],
});

// Chave mestra do conector gerada a cada execução: nenhum segredo fixo.
const { app } = await appPgDeTeste({
  b,
  versao: 'x6-render',
  modulos: 'producao',
  chaveIntegracao: randomBytes(32),
});
await app.listen({ port: PORTA, host: '127.0.0.1' });

const telas = PAGINAS_REGISTRADAS.map((p) => ({
  modulo: p.modulo,
  titulo: p.titulo,
  rota: p.rota,
  url: p.rota.replace(/:[a-z_]+/gi, UUID_FICTICIO),
  comParametro: p.rota.includes(':'),
}));
const url = `http://127.0.0.1:${PORTA}`;
const pronto = {
  url,
  empresa: { id: tenant, ...EMPRESA },
  superadmin: { empresa: CODIGO_SUPERADMIN_LOGIN, email: SA, senha: SENHA_SA },
  administrador: { empresa: EMPRESA.slug, email: ADM, senha: SENHA_DE_TESTE },
  telas,
};
if (PRONTO) writeFileSync(PRONTO, JSON.stringify(pronto));
console.error(`[api-render-telas] ouvindo em ${url} (banco ${b.nome}, ${telas.length} telas do BKO)`);

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    void app
      .close()
      .then(() => b.remover())
      .then(() => console.error('[api-render-telas] banco efêmero apagado'))
      .finally(() => process.exit(0));
  });
}
