#!/usr/bin/env node
/**
 * Fumaça em produção, camada (b) da T-0065 (docs/testes/fumaca-publicar.md): depois de todo "producao — publicar",
 * faz login com o usuário `leitura` da empresa de teste, chama só os GET do BKO da lista commitada
 * (tests/integracao/rotas/fumaca-rotas.json, do SHA da tag) e encerra a sessão. Sem dependência: fetch nativo,
 * AbortSignal.timeout, node:fs.
 *
 * Entradas (env): FUMACA_BASE_URL (ex. https://erp.macuxifdv.com.br), FUMACA_EMAIL, FUMACA_SENHA, FUMACA_EMPRESA_ID
 * (o identificador da empresa no login do BKO: o campo `empresa` do POST /v1/auth/login), FUMACA_ROTAS_JSON (padrão
 * tests/integracao/rotas/fumaca-rotas.json), FUMACA_RELATORIO (markdown das rotas que caíram; opcional) e
 * FUMACA_TIMEOUT_MS (padrão 10000, por chamada).
 *
 * Sessão (a mesma do apps/web/src/lib/api.ts): POST /v1/auth/login {empresa, email, senha} → `token_acesso` (Bearer)
 * e o refresh no cookie `macuxierp_refresh`; ao fim, num finally, POST /v1/auth/sair com o Bearer e o cookie.
 *
 * Lista de rotas (formato 1 do `testes`): `{formato: 1, uuid_ficticio, rotas: [{metodo?, caminho, area, origem?}]}`;
 * `metodo` ausente = GET. `formato` maior que 1 = falha com mensagem clara (o script é mais velho que a lista). Sem
 * `formato` (lista de tag antiga): UUID_FICTICIO fixo e todo parâmetro fictício.
 *
 * Parâmetros (`:id` e qualquer `:param`), só em memória, pela `origem` da rota (só o primeiro parâmetro; o formato 1
 * tem no máximo um): `contexto` filial = `itens[0].id` de GET /v1/cadastros/filiais; `contexto` empresa = `empresa.id`
 * de GET /v1/auth/eu; `lista` = o `campo` (notação `a[0].b`) da lista `de`, chamada uma vez (cache por `de`);
 * `ficticio`, sem `origem`, lista vazia ou com erro = o `uuid_ficticio` do JSON (o 404 de regra passa).
 *
 * Critério: falha = 404 genérico (rota inexistente: mensagem "Rota não encontrada" do setNotFoundHandler do apps/api,
 * o 404 padrão do Fastify ou um 404 que nem é JSON da API), 5xx, 3xx, timeout ou erro de rede. Passam o 200 e os outros
 * 4xx, incluindo o 404 de regra (`NAO_ENCONTRADO` com "<objeto> não encontrado": o código é o MESMO do 404 genérico,
 * por isso a mensagem é que separa os dois). Diferença documentada com o critério do `testes`
 * (tests/integracao/rotas/fumaca-telas.db.test.ts): lá o 3xx passa; aqui é falha, porque a API não redireciona e um
 * 3xx em produção é proxy ou rota trocada.
 *
 * Log sem dado pessoal: uma linha por rota, `GET <caminho com :id> <status>` e o motivo curto se falhar. O corpo das
 * respostas é descartado (só o da lista é lido, em memória, para o id; só o do 404, para a mensagem).
 * Saída: 0 = ok ou secrets ausentes (aviso); 1 = alguma rota caiu, login falhou ou lista inválida.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UUID_FICTICIO = '00000000-0000-4000-8000-000000000000';
const ROTAS_PADRAO = 'tests/integracao/rotas/fumaca-rotas.json';
const COOKIE_REFRESH = 'macuxierp_refresh';
const TIMEOUT_PADRAO_MS = 10_000;
const SECRETS = ['FUMACA_EMAIL', 'FUMACA_SENHA', 'FUMACA_EMPRESA_ID'];

export const FORMATO_SUPORTADO = 1;

/** `origem: {tipo: 'contexto', nome}` → a lista GET e o campo de onde sai o id (só em memória). */
const CONTEXTO = {
  filial: { de: 'GET /v1/cadastros/filiais', campo: 'itens[0].id' },
  empresa: { de: 'GET /v1/auth/eu', campo: 'empresa.id' },
};

const PARAMETRO = /^:[A-Za-z_][A-Za-z0-9_]*$/;
// Só caminho relativo da API (nada de URL absoluta, que levaria o Bearer para outro host).
const CAMINHO_VALIDO = /^\/v1(\/[A-Za-z0-9_.:-]+)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENTO_CAMPO = /^([A-Za-z_][A-Za-z0-9_]*)?((?:\[\d+\])*)$/;

/** `a[0].b` → ['a', 0, 'b'] (função pura); null se a notação for outra. */
export function passosDoCampo(campo) {
  if (typeof campo !== 'string' || !campo) return null;
  const passos = [];
  for (const segmento of campo.split('.')) {
    const m = SEGMENTO_CAMPO.exec(segmento);
    if (!m || !segmento) return null;
    if (m[1]) passos.push(m[1]);
    for (const i of m[2].matchAll(/\[(\d+)\]/g)) passos.push(Number(i[1]));
  }
  return passos;
}

/** Valor de `campo` (notação `a[0].b`) num corpo JSON (função pura): string não vazia ou null. */
export function lerCampo(corpo, campo) {
  const passos = passosDoCampo(campo);
  if (!passos) return null;
  let valor = corpo;
  for (const p of passos) {
    if (
      typeof p === 'number'
        ? !Array.isArray(valor)
        : !valor || typeof valor !== 'object' || Array.isArray(valor)
    )
      return null;
    valor = valor[p];
  }
  return typeof valor === 'string' && valor ? valor : null;
}

/**
 * Normaliza a `origem` de uma rota (função pura) em `{de, campo}` (lista GET a chamar), `null` (fictício) ou
 * `{erro}` (recusa: tipo, nome, `de` ou `campo` desconhecidos fazem o passo falhar, nunca uma chamada fora de GET /v1).
 */
export function normalizarOrigem(origem) {
  if (origem === undefined || origem === null) return null;
  const tipo = origem?.tipo;
  if (tipo === 'ficticio') return null;
  let alvo = null;
  if (tipo === 'lista') alvo = origem;
  else if (tipo === 'contexto' && Object.hasOwn(CONTEXTO, String(origem.nome))) alvo = CONTEXTO[origem.nome];
  if (!alvo)
    return {
      erro: `origem desconhecida (${String(tipo)}${tipo === 'contexto' ? ` ${String(origem.nome)}` : ''})`,
    };
  const m = /^GET (\S+)$/.exec(String(alvo.de ?? ''));
  if (!m || !CAMINHO_VALIDO.test(m[1]) || m[1].split('/').some((s) => PARAMETRO.test(s)))
    return { erro: `origem com lista inválida (${String(alvo.de)})` };
  if (!passosDoCampo(alvo.campo)) return { erro: `origem com campo inválido (${String(alvo.campo)})` };
  return { de: m[1], campo: alvo.campo };
}

/**
 * Separa as rotas da fumaça (função pura): só `area === 'bko'` e GET (`metodo` ausente = GET). Qualquer rota com outro
 * método, caminho fora de /v1 ou `origem` inválida é recusada: o JSON da fumaça é só de leitura e a recusa faz o passo
 * falhar. `formato` maior que o suportado é erro; sem `formato` (tag antiga), todo parâmetro é fictício.
 * @returns {{ rotas: {metodo: string, caminho: string, origem: {de: string, campo: string} | null}[],
 *   recusadas: {metodo: string, caminho: string}[], erro: string | null, uuidFicticio: string }}
 */
export function filtrarRotas(json) {
  const vazio = { rotas: [], recusadas: [], uuidFicticio: UUID_FICTICIO };
  const formato = json?.formato;
  const legado = formato === undefined;
  if (!legado && !(Number.isInteger(formato) && formato >= 1))
    return { ...vazio, erro: `formato da lista de rotas inválido (${JSON.stringify(formato)})` };
  if (!legado && formato > FORMATO_SUPORTADO)
    return {
      ...vazio,
      erro: `lista de rotas no formato ${formato}, e este script só conhece até o formato ${FORMATO_SUPORTADO}: atualize .github/scripts/fumaca-producao.mjs`,
    };
  const todas = Array.isArray(json?.rotas) ? json.rotas : null;
  if (!todas) return { ...vazio, erro: 'JSON sem `rotas[]`' };
  const uuidFicticio =
    !legado && UUID.test(String(json.uuid_ficticio ?? '')) ? json.uuid_ficticio : UUID_FICTICIO;
  const recusadas = [];
  const rotas = [];
  for (const r of todas) {
    const metodo = String(r?.metodo ?? 'GET').toUpperCase();
    const caminho = String(r?.caminho ?? '');
    const origem = legado ? null : normalizarOrigem(r?.origem);
    if (metodo !== 'GET' || !CAMINHO_VALIDO.test(caminho) || origem?.erro) {
      recusadas.push({ metodo: metodo || '?', caminho, ...(origem?.erro ? { motivo: origem.erro } : {}) });
      continue;
    }
    if (r.area === 'bko') rotas.push({ metodo, caminho, origem });
  }
  return { rotas, recusadas, erro: null, uuidFicticio };
}

/**
 * Classifica uma resposta (função pura). `corpo` é o JSON já lido (só do 404) ou null.
 * @returns {{ ok: boolean, motivo: string | null }}
 */
export function classificarResposta({ status, corpo = null, erro = null }) {
  if (erro === 'timeout') return { ok: false, motivo: 'timeout' };
  if (erro) return { ok: false, motivo: 'erro de rede' };
  if (status >= 500) return { ok: false, motivo: '5xx' };
  if (status >= 300 && status < 400) return { ok: false, motivo: 'redirecionamento' };
  if (status === 404 && eh404Generico(corpo)) return { ok: false, motivo: '404 genérico' };
  if (status >= 200 && status < 500) return { ok: true, motivo: null };
  return { ok: false, motivo: `status ${status}` };
}

/** 404 de rota inexistente: o do apps/api ("Rota não encontrada"), o padrão do Fastify ou um 404 que não é JSON. */
function eh404Generico(corpo) {
  if (!corpo || typeof corpo !== 'object') return true;
  const mensagem = String(corpo.mensagem ?? corpo.message ?? '');
  if (mensagem === 'Rota não encontrada') return true;
  if (/^Route [A-Z]+:\S* not found$/.test(mensagem)) return true;
  return false;
}

/**
 * Resolve os `:param` de um caminho. O primeiro sai da `origem` normalizada (`ler(de, campo)` devolve o id ou null);
 * os demais, e o primeiro sem origem ou sem id, levam o `uuidFicticio`.
 * @returns {Promise<string>} o caminho concreto (nunca vai para log nem disco)
 */
export async function resolverParametros(caminho, { origem = null, uuidFicticio = UUID_FICTICIO, ler }) {
  const concretos = [];
  let primeiro = true;
  for (const s of caminho.split('/')) {
    if (!PARAMETRO.test(s)) {
      concretos.push(s);
      continue;
    }
    const id = primeiro && origem ? await ler(origem.de, origem.campo) : null;
    primeiro = false;
    concretos.push(encodeURIComponent(id ?? uuidFicticio));
  }
  return concretos.join('/');
}

/** Lista em markdown das rotas que caíram (função pura). */
export function relatorio(falhas, total) {
  const linhas = [`### Fumaça em produção: ${falhas.length} de ${total} rota(s) caíram`, ''];
  for (const f of falhas)
    linhas.push(`- \`${f.metodo} ${f.caminho}\` — ${f.status}${f.motivo ? ` (${f.motivo})` : ''}`);
  return `${linhas.join('\n')}\n`;
}

const ehTimeout = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';

/** Valor do cookie de refresh no Set-Cookie do login (só em memória). */
function lerCookieRefresh(resposta) {
  const lista =
    typeof resposta.headers.getSetCookie === 'function'
      ? resposta.headers.getSetCookie()
      : [resposta.headers.get('set-cookie') ?? ''];
  for (const c of lista) {
    const m = new RegExp(`(?:^|,\\s*)${COOKIE_REFRESH}=([^;,\\s]*)`).exec(c);
    if (m) return m[1];
  }
  return null;
}

async function descartar(resposta) {
  try {
    await resposta.body?.cancel();
  } catch {
    /* corpo já consumido ou conexão fechada: nada a guardar */
  }
}

/**
 * Executa a fumaça. Devolve o código de saída. `log` recebe as linhas (padrão console.log).
 */
async function main({ env = process.env, log = console.log, fetchFn = fetch } = {}) {
  const faltam = SECRETS.filter((n) => !String(env[n] ?? '').trim());
  if (faltam.length) {
    log('::warning::Fumaça em produção pulada: secrets FUMACA_* ausentes');
    return 0;
  }
  const base = String(env.FUMACA_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(base)) {
    log('::error::FUMACA_BASE_URL ausente ou inválida (só esquema e domínio)');
    return 1;
  }
  const timeoutMs = Number(env.FUMACA_TIMEOUT_MS) > 0 ? Number(env.FUMACA_TIMEOUT_MS) : TIMEOUT_PADRAO_MS;
  const arquivoRelatorio = String(env.FUMACA_RELATORIO ?? '').trim();
  const escreverRelatorio = (texto) => {
    if (arquivoRelatorio) writeFileSync(arquivoRelatorio, texto);
  };

  let json;
  try {
    json = JSON.parse(readFileSync(String(env.FUMACA_ROTAS_JSON || ROTAS_PADRAO), 'utf8'));
  } catch (e) {
    log(`::error::não consegui ler a lista de rotas: ${e?.code ?? e?.name ?? 'erro'}`);
    escreverRelatorio('### Fumaça em produção: lista de rotas ilegível\n');
    return 1;
  }
  const { rotas, recusadas, erro, uuidFicticio } = filtrarRotas(json);
  if (erro || recusadas.length) {
    const motivo =
      erro ??
      `só GET em /v1 com origem conhecida é aceito; recusadas: ${recusadas
        .map((r) => `${r.metodo} ${r.caminho}${r.motivo ? ` (${r.motivo})` : ''}`)
        .join(', ')}`;
    log(`::error::lista de rotas inválida: ${motivo}`);
    escreverRelatorio(`### Fumaça em produção: lista de rotas inválida\n\n${motivo}\n`);
    return 1;
  }

  const chamar = (caminho, init = {}) =>
    fetchFn(`${base}${caminho}`, { redirect: 'manual', ...init, signal: AbortSignal.timeout(timeoutMs) });

  // ---- login (o mesmo do BKO) ----
  let acesso = null;
  let refresh = null;
  try {
    const r = await chamar('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        empresa: env.FUMACA_EMPRESA_ID.trim(),
        email: env.FUMACA_EMAIL.trim(),
        senha: env.FUMACA_SENHA,
      }),
    });
    if (r.status === 200) {
      const corpo = await r.json().catch(() => null);
      acesso = typeof corpo?.token_acesso === 'string' ? corpo.token_acesso : null;
      refresh = lerCookieRefresh(r);
    } else await descartar(r);
    log(`POST /v1/auth/login ${r.status}${acesso ? '' : ' falhou'}`);
  } catch (e) {
    log(`POST /v1/auth/login ${ehTimeout(e) ? 'timeout' : 'erro de rede'} falhou`);
  }
  if (!acesso) {
    log('::error::Fumaça em produção: login da empresa de teste falhou');
    escreverRelatorio(
      '### Fumaça em produção: login da empresa de teste falhou\n\nNenhuma rota foi chamada.\n',
    );
    return 1;
  }

  const autorizacao = { authorization: `Bearer ${acesso}` };
  const falhas = [];
  try {
    // Cache por `de`: o corpo da lista fica só em memória e cada lista é chamada uma vez.
    const listas = new Map();
    const ler = async (de, campo) => {
      if (!listas.has(de)) {
        listas.set(
          de,
          chamar(de, { headers: autorizacao })
            .then(async (r) =>
              r.status === 200 ? await r.json().catch(() => null) : (await descartar(r), null),
            )
            .catch(() => null),
        );
      }
      return lerCampo(await listas.get(de), campo);
    };

    for (const rota of rotas) {
      const concreto = await resolverParametros(rota.caminho, { origem: rota.origem, uuidFicticio, ler });
      let status;
      let resultado;
      try {
        const r = await chamar(concreto, { headers: autorizacao });
        status = r.status;
        const corpo = r.status === 404 ? await r.json().catch(() => null) : (await descartar(r), null);
        resultado = classificarResposta({ status, corpo });
      } catch (e) {
        status = ehTimeout(e) ? 'timeout' : 'erro de rede';
        resultado = classificarResposta({ status: 0, erro: ehTimeout(e) ? 'timeout' : 'rede' });
      }
      log(
        `GET ${rota.caminho} ${status}${resultado.ok || resultado.motivo === status ? '' : ` ${resultado.motivo}`}`,
      );
      if (!resultado.ok)
        falhas.push({ metodo: 'GET', caminho: rota.caminho, status, motivo: resultado.motivo });
    }
  } finally {
    try {
      const headers = { ...autorizacao, ...(refresh ? { cookie: `${COOKIE_REFRESH}=${refresh}` } : {}) };
      const r = await chamar('/v1/auth/sair', { method: 'POST', headers });
      await descartar(r);
      log(`POST /v1/auth/sair ${r.status}`);
    } catch (e) {
      log(`::warning::POST /v1/auth/sair ${ehTimeout(e) ? 'timeout' : 'erro de rede'}`);
    }
  }

  if (falhas.length) {
    escreverRelatorio(relatorio(falhas, rotas.length));
    log(`::error::Fumaça em produção: ${falhas.length} de ${rotas.length} rota(s) caíram`);
    return 1;
  }
  log(`${rotas.length} rotas ok`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (codigo) => process.exit(codigo),
    (e) => {
      console.log(`::error::fumaça em produção: ${e?.name ?? 'erro'}`);
      process.exit(1);
    },
  );
}
