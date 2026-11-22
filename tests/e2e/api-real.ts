/**
 * T-0008, parte 2: sobe a API de produção (`montarModulos` com os adaptadores SQL do main.ts, `tests/apoio/api-pg.ts`)
 * num banco efêmero do Postgres local, com DOIS tenants, para o e2e do shell (`tests/e2e/bko-cadastro.mjs`) rodar contra
 * a API real (`MACUXIERP_API_URL`). Fora do vitest. Uso, com o `pg-local.sh` de pé:
 *   node node_modules/.pnpm/vite-node@<versão>/node_modules/vite-node/vite-node.mjs tests/e2e/api-real.ts -- --porta 3200 --pronto <arquivo>
 * Grava `<arquivo>` (JSON com as credenciais fictícias de teste) quando está ouvindo; no SIGTERM fecha e apaga o banco.
 *
 * Massa (fictícia, sem pessoa real; senhas só deste banco efêmero):
 * - loja-a "Comercial Rio Negro Ltda": cadastros, pedido e faturamento; filiais "Matriz Manaus" e "Filial Parintins";
 *   administrador nas duas filiais e vendedor só na Matriz;
 * - loja-b "Distribuidora Monte Roraima Ltda": só cadastros; filial "Loja Boa Vista"; administrador.
 */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { filialValida } from '../../modules/cadastros/api/fixtures-teste';
import { gerarHashSenha } from '../../apps/api/src/auth/senha';
import { montarApiPg } from '../apoio/api-pg';

const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : padrao;
};
const PORTA = Number(arg('porta', '3200'));
const PRONTO = arg('pronto', '');

const api = await montarApiPg({ A: ['cadastros', 'pedido', 'faturamento'], B: ['cadastros'] });
const EMPRESAS = { A: { slug: 'loja-a', nome: 'Comercial Rio Negro Ltda' }, B: { slug: 'loja-b', nome: 'Distribuidora Monte Roraima Ltda' } } as const;
for (const k of ['A', 'B'] as const) await api.b.admin.query('UPDATE plataforma.tenant SET slug = $2, nome = $3 WHERE id = $1', [api.t[k], EMPRESAS[k].slug, EMPRESAS[k].nome]);

async function filial(k: 'A' | 'B', nome: string, cnpj: string, padrao: boolean): Promise<string> {
  const r = await api.chamar(k, 'POST', '/v1/cadastros/filiais', filialValida({ cnpj, razao_social: `${nome} Ltda`, nome_fantasia: nome, padrao, emissora: padrao }));
  if (r.statusCode !== 201) throw new Error(`filial ${nome}: ${r.statusCode} ${r.body}`);
  return r.json().id as string;
}
const fA1 = await filial('A', 'Matriz Manaus', '11222333000181', true);
const fA2 = await filial('A', 'Filial Parintins', '11444777000161', false);
const fB1 = await filial('B', 'Loja Boa Vista', '11222333000181', true);

const senha = `e2e-${randomUUID()}`;
const hash = await gerarHashSenha(senha);
const usuarios = [
  { k: 'A', email: 'adm@loja-a.invalid', nome: 'Administração A', perfil: 'administrador', filiais: [fA1, fA2] },
  { k: 'A', email: 'vendas@loja-a.invalid', nome: 'Vendas A', perfil: 'vendedor', filiais: [fA1] },
  { k: 'B', email: 'adm@loja-b.invalid', nome: 'Administração B', perfil: 'administrador', filiais: [fB1] },
] as const;
for (const u of usuarios) {
  await api.b.admin.query('INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil, filial_ids) VALUES ($1, $2, $3, $4, $5, $6)', [api.t[u.k], u.email, u.nome, hash, u.perfil, u.filiais]);
}

await api.app.listen({ port: PORTA, host: '127.0.0.1' });
const pronto = { url: `http://127.0.0.1:${PORTA}`, senha, empresas: EMPRESAS, usuarios: usuarios.map((u) => ({ empresa: EMPRESAS[u.k].slug, email: u.email, perfil: u.perfil })) };
if (PRONTO) writeFileSync(PRONTO, JSON.stringify(pronto));
console.error(`[api-real] ouvindo em ${pronto.url} (banco ${api.b.nome})`);

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    void api
      .fechar()
      .then(() => console.error('[api-real] banco efêmero apagado'))
      .finally(() => process.exit(0));
  });
}
