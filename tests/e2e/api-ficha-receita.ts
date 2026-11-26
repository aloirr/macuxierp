/**
 * T-0101, R-2 do plano da v0.3.13 (e2e da tela): a API de produção do portal /config (`montarDependenciasProducao` →
 * `pluginsPlataforma`, como o `empresa-ficha-producao.db.test.ts`), com um único dublê: o `fetch` das fontes HTTP de
 * produção (`fontesHttp`). Cada empresa tem um CNPJ fictício que escolhe a resposta da fonte: ok, tempo esgotado, 404,
 * 503 ou 200 fora do formato. Nunca a rede. Uso: `bash tests/e2e/rodar-ficha-receita.sh`. No SIGTERM apaga o banco.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { CODIGO_SUPERADMIN_LOGIN } from '../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant } from '../../packages/platform-sdk/src/pg-testes';
import { RepositorioCoreSql } from '../../modules/core/api/index';
import { fontesHttp } from '../../modules/cadastros/api/index';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE } from '../../apps/api/src/apoio-teste';
import { criarApp } from '../../apps/api/src/app';
import { dependenciasCadastros, montarDependenciasProducao, pluginsPlataforma } from '../../apps/api/src/modulos';
import { brutaBrasilApi, CNPJ_FICHA } from '../apoio/ficha-receita';
import { inserirSuperadmin, SENHA_SA, semearMunicipioManaus } from '../apoio/portal-pg';
import { argumento } from './apoio-e2e.mjs';

/** CNPJ fictício (DV válido) → resposta da fonte. */
const CASOS = {
  ok: CNPJ_FICHA,
  tempo: '11444777000161',
  nao_encontrado: '12345678000195',
  erro_5xx: '11333444000165',
  fora_do_formato: '22444555000165',
} as const;
type Caso = keyof typeof CASOS;
const casoDoCnpj = new Map<string, Caso>(Object.entries(CASOS).map(([k, v]) => [v, k as Caso]));
/** Marca que só existe no corpo da fonte: a tela nunca pode mostrá-la. */
const MARCA_DO_CORPO = 'CORPO-DA-FONTE-FICTICIO';

const buscar = async (url: string) => {
  const caso = casoDoCnpj.get(url.split('/').at(-1)!);
  if (caso === 'tempo') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (caso === 'nao_encontrado') return { ok: false, status: 404, json: async () => ({ message: MARCA_DO_CORPO }) };
  if (caso === 'erro_5xx') return { ok: false, status: 503, json: async () => ({ message: MARCA_DO_CORPO }) };
  if (caso === 'fora_do_formato') return { ok: true, status: 200, json: async () => ({ inesperado: MARCA_DO_CORPO }) };
  return { ok: true, status: 200, json: async () => brutaBrasilApi() };
};

const b = await criarBancoEfemero();
await semearMunicipioManaus(b);
const EMAIL_SA = 'sa-e2e-ficha@exemplo.invalid';
await inserirSuperadmin(b, EMAIL_SA);
const empresas: Record<string, string> = {};
for (const [caso, cnpj] of Object.entries(CASOS)) {
  const id = await criarTenant(b.admin, `e2e-ficha-${caso.replace(/_/g, '-')}-${randomUUID().slice(0, 4)}`, ['core', 'cadastros']);
  await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [id, `Empresa Fictícia ${caso}`, cnpj]);
  empresas[caso] = id;
}
const producao = montarDependenciasProducao({
  banco: b.banco('macuxierp_app'),
  chaveA1: Buffer.alloc(32, 1),
  config: { versao: 'api-ficha-receita', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
});
const cadastros = dependenciasCadastros(new RepositorioCoreSql(), { fontes: fontesHttp(buscar as never) });
const plugins = pluginsPlataforma(producao.modulos, { chaveIntegracao: null, cadastros });
const app = await criarApp({ ...producao, auth: { ...producao.auth, argon2: ARGON2_RAPIDO }, plataforma: { ...producao.plataforma!, plugins }, logger: false });
const porta = Number(argumento('porta', '3203'));
await app.listen({ port: porta, host: '127.0.0.1' });
const pronto = argumento('pronto', '');
if (pronto) {
  writeFileSync(pronto, JSON.stringify({ superadmin: { empresa: CODIGO_SUPERADMIN_LOGIN, email: EMAIL_SA, senha: SENHA_SA }, empresas, cnpjs: CASOS, marcaDoCorpo: MARCA_DO_CORPO }));
}
console.error(`[api-ficha-receita] ouvindo na porta ${porta} (banco ${b.nome})`);
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    void app.close().then(() => b.remover()).finally(() => process.exit(0));
  });
}
