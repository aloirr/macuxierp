/**
 * v0.3.15 (T-0101 R-3 e T-0093): sobe a API de produção (`appPgDeTeste` com os módulos do `main.ts`) num banco efêmero do
 * Postgres local, com três empresas FICTÍCIAS para os prints do /config (aba Empresa, Zerar por cadastro, Zerar pedidos e
 * Substituir tudo). Fora do vitest. Uso: `bash tests/e2e/rodar-prints.sh v0315 docs/testes/prints/v0.3.15`. Grava `--pronto <arquivo>` (JSON
 * com a massa) quando está ouvindo; no SIGTERM fecha e apaga o banco.
 *
 * Massa (sem pessoa real; CNPJ das fixtures de teste, e-mail e telefone fictícios, senhas só deste banco efêmero):
 * - "Comercial Tarumã Fictício Ltda": ficha da Receita completa (gravada direto no banco, sem fonte externa), três pedidos
 *   aprovados sem nota (um do FDV), credencial e cursores da Integração FDV e carga de filial e vendedor (fixtures);
 * - "Mercearia Sem Ficha Fictícia": só razão social e CNPJ, sem pedidos (prévia com N = 0);
 * - "Padaria Consultada Fictícia": consultada na Receita, sem dados.
 * Nenhuma chamada ao Hub nem à Receita: sem worker de pé e sem o "Atualizar pela Receita".
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CABECALHO_CSRF_CONFIG, CAMINHOS_CARGAS_PLATAFORMA, CAMPO_ARQUIVO_CARGA_PORTAL, COOKIE_CONFIG, PREFIXO_PLATAFORMA } from '../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant } from '../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, inserirFilialDeTeste } from '../../apps/api/src/apoio-teste';
import { formulario } from '../../apps/api/src/apoio-multipart';
import { CHAVE_MESTRA, criarCredencial, cursorEntidade } from '../../modules/integracao-fdv/api/apoio-conector-teste';
import { sqlDePedido } from '../../db/testes/fixture';
import { atalhosPortal, inserirSuperadmin, SENHA_SA } from '../apoio/portal-pg';
import { argumento as arg } from './apoio-e2e.mjs';

const PORTA = Number(arg('porta', '3203'));
const PRONTO = arg('pronto', '');
const SA = 'sa-prints-v0315@exemplo.invalid';
const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'integracao-fdv'];

const b = await criarBancoEfemero();
await inserirSuperadmin(b, SA);
async function empresa(slug: string, nome: string, cnpj: string): Promise<string> {
  const t = await criarTenant(b.admin, slug, MODULOS);
  await b.admin.query('UPDATE plataforma.tenant SET nome = $2 WHERE id = $1', [t, nome]);
  await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [t, nome, cnpj]);
  await inserirFilialDeTeste(b.admin, t, { id: randomUUID(), cnpj, nome: 'Matriz Manaus' });
  return t;
}
const comFicha = await empresa('prints-v0315-ficha', 'Comercial Tarumã Fictício Ltda', '11222333000181');
const semFicha = await empresa('prints-v0315-sem', 'Mercearia Sem Ficha Fictícia', '11444777000161');
const consultada = await empresa('prints-v0315-consultada', 'Padaria Consultada Fictícia', '12345678000195');

// Ficha da Receita fictícia (sem consulta externa); a "consultada sem dados" só tem a data e a fonte.
await b.admin.query(
  `UPDATE core.empresa SET nome_fantasia = 'Tarumã Fictício', logradouro = 'Rua Fictícia das Flores', numero = '100', bairro = 'Centro',
     cep = '69005000', municipio_ibge = '1302603', uf = 'AM', email = 'contato@exemplo.invalid', telefone = '9230000000',
     cnae_principal = '4639701', cnae_secundarios = '["4637107", "4691500"]'::jsonb, regime_receita = 'simples',
     situacao_cadastral = 'Ativa', situacao_cadastral_data = '2015-03-10', data_abertura = '2015-03-10',
     natureza_juridica = 'Sociedade Empresária Limitada', porte = 'Empresa de Pequeno Porte',
     receita_fonte = 'brasilapi', receita_consultada_em = now() - interval '2 hours'
   WHERE tenant_id = $1`,
  [comFicha],
);
// Só a data: a tela trata a ficha como vazia quando nenhum campo além da data tem valor (`fichaVazia`, inclui a fonte).
await b.admin.query("UPDATE core.empresa SET receita_consultada_em = now() - interval '1 day' WHERE tenant_id = $1", [consultada]);

// Três pedidos aprovados, sem nota e sem título (um do FDV): a prévia do Zerar pedidos mostra N = 3.
const s = sqlDePedido(comFicha, 1);
const ids = [randomUUID(), randomUUID(), randomUUID()];
await b.admin.query(`
${s.pedidoSql({ id: ids[0] })} ${s.itemSql(ids[0]!, 1)}
${s.pedidoSql({ id: ids[1] })} ${s.itemSql(ids[1]!, 1)}
${s.pedidoSql({ id: ids[2], origem: 'fdv', externalId: randomUUID() })} ${s.itemSql(ids[2]!, 1)}
UPDATE pedido.pedido SET status = 'aprovado' WHERE tenant_id = '${comFicha}';`);

// Integração FDV da empresa com ficha: credencial e cursores (as linhas de cadastro com o menu Ações e o Zerar).
const cred = await criarCredencial(b.admin, comFicha, { conector: 'erp-taruma-ficticio', chave: `mxc_${randomBytes(24).toString('base64url')}` });
const haMin = (m: number) => new Date(Date.now() - m * 60_000);
await b.admin.query('INSERT INTO integracao_fdv.sinal (tenant_id, ultimo_envio_em, ultimo_aceito_em) VALUES ($1, $2, $2)', [comFicha, haMin(1)]);
for (const e of ['produto', 'cliente', 'vendedor', 'filial']) await cursorEntidade(b.admin, comFicha, e, { credencialId: cred, cursor: { em: haMin(60), id: 'EX-000' }, proximoEm: haMin(-5) });

const { app } = await appPgDeTeste({ b, versao: 'v0315-prints', modulos: 'producao', chaveIntegracao: CHAVE_MESTRA });

// Carga de filial e vendedor pelo portal (fixtures fictícias do cadastros): o Substituir tudo tem o que comparar.
const portal = atalhosPortal(app);
const token = await portal.sessao(SA);
const PASTA_CSV = join(import.meta.dirname, '..', '..', 'modules', 'cadastros', 'domain', 'carga', '__fixtures__');
for (const cadastro of ['filial', 'vendedor']) {
  const f = formulario({}, [{ campo: CAMPO_ARQUIVO_CARGA_PORTAL, conteudo: readFileSync(join(PASTA_CSV, `${cadastro}.csv`), 'utf8'), nome: `${cadastro}.csv`, tipo: 'text/csv' }]);
  const r = await app.inject({
    method: 'POST',
    url: `${PREFIXO_PLATAFORMA}${CAMINHOS_CARGAS_PLATAFORMA.gravar.replace(':id', comFicha).replace(':cadastro', cadastro)}`,
    payload: f.payload,
    cookies: { [COOKIE_CONFIG]: token },
    headers: { ...f.headers, [CABECALHO_CSRF_CONFIG]: '1', 'idempotency-key': randomUUID() },
  });
  if (r.statusCode >= 300) throw new Error(`carga ${cadastro}: ${r.statusCode} ${r.body}`);
}

await app.listen({ port: PORTA, host: '127.0.0.1' });
const url = `http://127.0.0.1:${PORTA}`;
const pronto = {
  url,
  superadmin: { email: SA, senha: SENHA_SA },
  empresas: { comFicha, semFicha, consultada },
  csvFilial: join(PASTA_CSV, 'filial.csv'),
};
if (PRONTO) writeFileSync(PRONTO, JSON.stringify(pronto));
const pulso = setInterval(() => {
  void b.admin.query('UPDATE integracao_fdv.sinal SET ultimo_envio_em = now(), ultimo_aceito_em = now() WHERE tenant_id = $1', [comFicha]).catch(() => undefined);
}, 20_000);
console.error(`[api-prints-v0315] ouvindo em ${url} (banco ${b.nome})`);
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    clearInterval(pulso);
    void app
      .close()
      .then(() => b.remover())
      .then(() => console.error('[api-prints-v0315] banco efêmero apagado'))
      .finally(() => process.exit(0));
  });
}
