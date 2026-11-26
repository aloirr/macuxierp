/**
 * v0.3.12 (I-9 e C-5 do docs/testes/plano-v0.3.12.md, regra 3 / X-4): sobe a API de produção (`appPgDeTeste` com os módulos
 * do `main.ts`) num banco efêmero do Postgres local, com uma empresa FICTÍCIA montada para os prints do /config (abas
 * Integração e Dados) e das telas do core no BKO (Usuários, Perfis e permissões, Licenças, Auditoria). Fora do vitest.
 * Uso: `bash tests/e2e/rodar-prints.sh v0312 docs/testes/prints` (com `MACUXI_DB_MIGRACOES` exportado). Grava `--pronto <arquivo>`
 * (JSON com a massa) quando está ouvindo; no SIGTERM fecha e apaga o banco.
 *
 * Massa (sem pessoa real; CNPJ das fixtures de teste, e-mails @exemplo.com.br, senhas só deste banco efêmero):
 * - "Comercial Tarumã Fictício Ltda" (slug `prints-v0312`), módulos core, cadastros, pedido, faturamento, fiscal e
 *   integracao-fdv; filiais "Matriz Manaus" e "Filial Itacoatiara"; usuários de seis perfis (um inativo);
 * - Integração FDV: credencial fictícia, último sinal há 1 min, lotes de produto e cliente (ciclo e reprocessar) com erros
 *   por linha (códigos do catálogo), registros pendentes na fila;
 * - carga CSV de filial e vendedor pelo portal (fixtures do cadastros) e ações do administrador na API, que geram auditoria.
 * Nenhuma chamada ao Hub: sem worker de pé, nada sai para o FDV.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { criarBancoEfemero, criarTenant } from '../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, ARGON2_RAPIDO, inserirFilialDeTeste, SENHA_DE_TESTE } from '../../apps/api/src/apoio-teste';
import { gerarHashSenha } from '../../apps/api/src/auth/senha';
import { carregarCsvsPortal, manterSinalEEncerrar } from './apoio-api';
import { CHAVE_MESTRA, criarCredencial, cursorEntidade, espelho, payloadProduto } from '../../modules/integracao-fdv/api/apoio-conector-teste';
import { atalhosPortal, inserirSuperadmin, SENHA_SA } from '../apoio/portal-pg';
import { argumento as arg } from './apoio-e2e.mjs';

const PORTA = Number(arg('porta', '3202'));
const PRONTO = arg('pronto', '');

const EMPRESA = { slug: 'prints-v0312', nome: 'Comercial Tarumã Fictício Ltda' };
const SA = 'sa-prints@exemplo.com.br';
const ADM = 'administracao@exemplo.com.br';
const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'];

const b = await criarBancoEfemero();
await inserirSuperadmin(b, SA);
const tenant = await criarTenant(b.admin, EMPRESA.slug, MODULOS);
await b.admin.query('UPDATE plataforma.tenant SET nome = $2 WHERE id = $1', [tenant, EMPRESA.nome]);
await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [tenant, EMPRESA.nome, '11222333000181']);
const matriz = randomUUID();
const itacoatiara = randomUUID();
await inserirFilialDeTeste(b.admin, tenant, { id: matriz, cnpj: '11222333000181', nome: 'Matriz Manaus' });
await inserirFilialDeTeste(b.admin, tenant, { id: itacoatiara, cnpj: '11444777000161', nome: 'Filial Itacoatiara' });

// Usuários de perfis variados (nomes inventados). A senha é a de teste, só deste banco efêmero.
const hash = await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO);
const USUARIOS = [
  { email: ADM, nome: 'Administração Tarumã', perfil: 'administrador', filiais: [matriz, itacoatiara], ativo: true },
  { email: 'gerencia@exemplo.com.br', nome: 'Gerência Comercial Fictícia', perfil: 'gerente', filiais: [matriz, itacoatiara], ativo: true },
  { email: 'faturamento@exemplo.com.br', nome: 'Faturamento Fictício', perfil: 'faturista', filiais: [matriz], ativo: true },
  { email: 'fiscal@exemplo.com.br', nome: 'Setor Fiscal Fictício', perfil: 'fiscal', filiais: [matriz], ativo: true },
  { email: 'vendas.itacoatiara@exemplo.com.br', nome: 'Vendas Itacoatiara', perfil: 'vendedor', filiais: [itacoatiara], ativo: true },
  { email: 'consulta@exemplo.com.br', nome: 'Consulta Fictícia', perfil: 'leitura', filiais: [matriz], ativo: true },
  { email: 'antigo.estoque@exemplo.com.br', nome: 'Estoque Antigo Fictício', perfil: 'leitura', filiais: [matriz], ativo: false },
] as const;
for (const u of USUARIOS) {
  await b.admin.query(
    `INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8)`,
    [randomUUID(), tenant, u.email, u.nome, hash, u.perfil, u.filiais, u.ativo],
  );
}

// ---- Integração FDV: credencial, sinal, cursores, espelho com pendentes e lotes com erros por linha ----
const cred = await criarCredencial(b.admin, tenant, { conector: 'erp-taruma-ficticio', chave: `mxc_${randomBytes(24).toString('base64url')}` });
const agora = Date.now();
const haMin = (m: number) => new Date(agora - m * 60_000);
await b.admin.query('INSERT INTO integracao_fdv.sinal (tenant_id, ultimo_envio_em, ultimo_aceito_em) VALUES ($1, $2, $2)', [tenant, haMin(1)]);
for (const e of ['produto', 'cliente', 'vendedor', 'filial']) await cursorEntidade(b.admin, tenant, e, { credencialId: cred, cursor: { em: haMin(60), id: 'EX-000' }, proximoEm: haMin(-5) });
for (let i = 1; i <= 6; i++) await espelho(b.admin, tenant, 'produto', payloadProduto(`P-EX-${String(i).padStart(3, '0')}`), { confirmado: true, pendente: false, alterado: haMin(90 + i) });
for (let i = 7; i <= 9; i++) await espelho(b.admin, tenant, 'produto', payloadProduto(`P-EX-${String(i).padStart(3, '0')}`), { pendente: true, alterado: haMin(10 + i) });

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
let seq = 0;
/** Lote final (sem corpo), com a origem e o resultado do Hub (`contagens.hub`: recebidas e com_erro) e os erros por linha (só código e campo, sem valor). */
async function lote(entidade: string, o: { estado: string; minutos: number; registros: number; origem: string; erros?: Array<[string, string, string | null]> }): Promise<void> {
  const [l] = (
    await b.admin.query(
      `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, hub_lote_id, enviado_em, concluido_em, contagens, tentativas, created_at)
       VALUES ($1, $2, $3, 'delta', $4, $5, gen_random_uuid(), $6, $6, $7::jsonb, 1, $6) RETURNING id`,
      [tenant, entidade, cred, hex(`lote-${seq++}`), o.estado, haMin(o.minutos), JSON.stringify({ registros: o.registros, origem: o.origem, hub: { recebidas: o.registros, com_erro: o.erros?.length ?? 0 } })],
    )
  ).rows as Array<{ id: string }>;
  for (const [i, [ext, codigo, campo]] of (o.erros ?? []).entries()) {
    await b.admin.query(
      "INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo) VALUES ($1, $2, $3, 'hub', $4, $5, $6, $7)",
      [tenant, l!.id, i, entidade, ext, codigo, campo],
    );
  }
}
await lote('produto', { estado: 'concluido', minutos: 240, registros: 120, origem: 'ciclo' });
await lote('produto', { estado: 'concluido_com_erros', minutos: 95, registros: 40, origem: 'ciclo', erros: [['P-EX-007', 'campo_invalido', 'ncm'], ['P-EX-008', 'campo_invalido', 'ncm'], ['P-EX-009', 'campo_obrigatorio', 'unidade']] });
await lote('produto', { estado: 'concluido', minutos: 30, registros: 6, origem: 'reprocessar' });
await lote('cliente', { estado: 'concluido_com_erros', minutos: 50, registros: 85, origem: 'ciclo', erros: [['C-EX-0101', 'campo_obrigatorio', 'documento'], ['C-EX-0102', 'campo_obrigatorio', 'documento'], ['C-EX-0103', 'campo_invalido', 'cep'], ['C-EX-0104', 'referencia_ausente', 'vendedor_external_id']] });
await lote('vendedor', { estado: 'concluido', minutos: 45, registros: 12, origem: 'ciclo' });
await lote('filial', { estado: 'concluido', minutos: 45, registros: 2, origem: 'ciclo' });

const { app } = await appPgDeTeste({ b, versao: 'v0312-prints', modulos: 'producao', chaveIntegracao: CHAVE_MESTRA });

// ---- Carga CSV pelo portal (aba Dados): filial e vendedor das fixtures fictícias do cadastros ----
const portal = atalhosPortal(app);
const token = await portal.sessao(SA);
await carregarCsvsPortal(app, tenant, token, ['filial', 'vendedor']);

// ---- Ações do administrador pela API (geram a auditoria do core) ----
const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: EMPRESA.slug, email: ADM, senha: SENHA_DE_TESTE } });
if (login.statusCode !== 200) throw new Error(`login do administrador: ${login.statusCode} ${login.body}`);
const { token_acesso } = login.json<{ token_acesso: string }>();
const bko = async (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${token_acesso}`, 'idempotency-key': randomUUID() }, ...(payload ? { payload } : {}) });
  if (r.statusCode >= 300) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
  return r;
};
const novo = await bko('POST', '/v1/core/usuarios', { nome: 'Expedição Fictícia', email: 'expedicao@exemplo.com.br', perfil: 'leitura', filial_ids: [matriz] });
const idNovo = novo.json<{ id: string }>().id;
await bko('POST', `/v1/core/usuarios/${idNovo}/redefinir-senha`);
await bko('POST', '/v1/core/usuarios', { nome: 'Compras Fictícia', email: 'compras@exemplo.com.br', perfil: 'gerente', filial_ids: [matriz] }).then((r) =>
  bko('DELETE', `/v1/core/usuarios/${r.json<{ id: string }>().id}`),
);

await app.listen({ port: PORTA, host: '127.0.0.1' });
const url = `http://127.0.0.1:${PORTA}`;
const pronto = {
  url,
  empresa: { id: tenant, ...EMPRESA },
  superadmin: { email: SA, senha: SENHA_SA },
  administrador: { empresa: EMPRESA.slug, email: ADM, senha: SENHA_DE_TESTE },
  usuarioSenha: 'Expedição Fictícia',
};
if (PRONTO) writeFileSync(PRONTO, JSON.stringify(pronto));
manterSinalEEncerrar({ app, b, tenant, rotulo: 'api-prints-v0312' });
console.error(`[api-prints-v0312] ouvindo em ${url} (banco ${b.nome})`);
