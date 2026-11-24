#!/usr/bin/env node
/**
 * Ambiente fiscal da filial emissora — script do operador (regra 7, RN-CORE-08, ADR 0006, desenho T-0030 seção 4).
 * Pela API, o tenant só volta a filial para homologação; a ida para produção é só por aqui, com o arquivo do recado
 * "aprovo produção fiscal <empresa>" do Alexandre conferido (autor, id, texto e empresa). Tudo auditado
 * (`plataforma.auditoria`, acao `core.ambiente.trocado`, origem `script`) e com o evento `core.ambiente_fiscal.alterado@1`.
 *
 * Uso (sem --confirmar só mostra o plano; a transação é desfeita e nada muda):
 *   node scripts/plataforma/ambiente-fiscal.mjs listar      --empresa <slug>
 *   node scripts/plataforma/ambiente-fiscal.mjs producao    --empresa <slug> --filial <uuid> --recado <R-…-alexandre> --arquivo-recado <caminho .md> --operador <nome> [--motivo "<texto>"] [--confirmar]
 *   node scripts/plataforma/ambiente-fiscal.mjs homologacao --empresa <slug> --filial <uuid> --operador <nome> --motivo "<texto>" [--confirmar]
 * O arquivo do recado vem do repositório de recados, baixado onde o operador tiver acesso, por exemplo:
 *   gh api repos/aloirr/macuxierp-recados/contents/recados/<destino>/<id>.md -H "Accept: application/vnd.github.raw" > <id>.md
 * Conexão: MACUXIERP_DATABASE_URL_OPERADOR (no .env do servidor; nunca em recado nem no repositório). É o dono das
 * tabelas, sem FORCE RLS; a política `app_so_homologacao_*` (0008) barra o papel do app.
 * Saída: 0 deu certo, 1 falha, 2 uso. O texto do recado nunca vai ao terminal: só o id e o SHA-256.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirTenant, conectarOperador, ErroUso, lerOpcoes, PADRAO_OPERADOR, PADRAO_SLUG } from './comum.mjs';

/** Mesma regex do CHECK `ambiente_producao_aprovada` (db/migrations/0003_core.sql); o teste compara as duas. */
export const PADRAO_RECADO = /^R-\d{8}-\d{6}(-\d+)?-alexandre$/;
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMANDOS = ['listar', 'producao', 'homologacao'];
const OPCOES = ['--empresa', '--filial', '--recado', '--arquivo-recado', '--operador', '--motivo'];
const EVENTO = 'core.ambiente_fiscal.alterado@1';
/** Recusa do gatilho `ambiente_fiscal_a1_real` (db/migrations/0047): filial com A1 de teste ativo indo para produção. */
const SQLSTATE_A1_TESTE = 'MXA01';
const MENSAGEM_A1_TESTE = 'certificado A1 de teste não pode ir para produção; envie o certificado real';

/** Lê e valida os argumentos. Lança ErroUso com a explicação. */
export function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  if (!COMANDOS.includes(comando)) throw new ErroUso(`comando deve ser ${COMANDOS.join(', ')}`);
  const op = { comando, ...lerOpcoes(resto, OPCOES) };
  if (!op.empresa || !PADRAO_SLUG.test(op.empresa)) throw new ErroUso('--empresa exige o slug da empresa');
  if (comando === 'listar') return op;
  if (!op.filial || !PADRAO_UUID.test(op.filial)) throw new ErroUso('--filial exige o UUID da filial emissora');
  op.filial = op.filial.toLowerCase();
  if (!op.operador || !PADRAO_OPERADOR.test(op.operador)) throw new ErroUso('--operador exige o nome de quem executa (ex.: alexandre)');
  // Na volta para homologação o motivo é obrigatório; na ida para produção, opcional, mas, se vier, com 5 caracteres ou mais.
  if (op.motivo === undefined ? comando === 'homologacao' : op.motivo.trim().length < 5) {
    throw new ErroUso('--motivo exige o motivo (mínimo 5 caracteres), que vai para a auditoria');
  }
  if (comando === 'homologacao') {
    if (op.recado !== undefined || op.arquivoRecado !== undefined) throw new ErroUso('--recado e --arquivo-recado só valem para producao');
    return op;
  }
  if (!op.recado || !PADRAO_RECADO.test(op.recado)) throw new ErroUso('--recado exige o id do recado de aprovação do Alexandre (R-AAAAMMDD-HHMMSS-alexandre)');
  if (!op.arquivoRecado) throw new ErroUso('--arquivo-recado exige o caminho do arquivo .md do recado, baixado do repositório de recados');
  return op;
}

/** Sem acentos (NFD), minúsculas e espaços colapsados. */
export function normalizar(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Tamanho do maior nome (slug ou nome normalizado) do tenant com que `depois` começa, ou 0. O nome precisa terminar no
 * fim do texto, em espaço ou em pontuação que não seja `-` (o `-` continua um slug: `thathyany-manaus`).
 */
function casamento(depois, tenant) {
  return [tenant.slug, normalizar(tenant.nome ?? '')]
    .filter(Boolean)
    .filter((c) => new RegExp(`^${escaparRegex(c)}(?=$|\\s|(?!-)\\p{P})`, 'u').test(depois))
    .reduce((maior, c) => Math.max(maior, c.length), 0);
}

/**
 * Confere o arquivo do recado de aprovação (pura). Lança ErroUso com o motivo; devolve o SHA-256 do texto, que vai
 * para a auditoria. Nunca devolve nem cita o texto do recado. A empresa aprovada é conferida contra todos os tenants
 * ativos (`ativos`, que inclui o próprio): vale só se o casamento mais longo for deste tenant, para que "Thathyany
 * Manaus Ltda" ou `thathyany-manaus` não aprovem o tenant `thathyany`.
 */
export function conferirRecado(texto, nomeArquivo, op, tenant, ativos = [tenant]) {
  const arquivo = basename(String(nomeArquivo));
  if (arquivo !== `${op.recado}.md`) throw new ErroUso(`o nome do arquivo deve ser ${op.recado}.md (veio ${arquivo})`);
  const cabecalho = String(texto).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!cabecalho) throw new ErroUso('o arquivo não tem o cabeçalho (---) de um recado');
  const campo = (nome) => cabecalho[1].match(new RegExp(`^${nome}:[ \\t]*["']?([^"'\\r\\n]*?)["']?[ \\t]*$`, 'im'))?.[1].trim();
  if (campo('id') !== op.recado) throw new ErroUso(`o id do cabeçalho do recado não é ${op.recado}`);
  if (campo('de')?.toLowerCase() !== 'alexandre') throw new ErroUso('o recado não é do Alexandre (o cabeçalho precisa de "de: alexandre")');
  const corpo = normalizar(texto);
  const frase = 'aprovo producao fiscal ';
  const pos = corpo.indexOf(frase);
  if (pos < 0) throw new ErroUso('o recado não contém "aprovo produção fiscal <empresa>"');
  if (/\bnao $/.test(corpo.slice(Math.max(0, pos - 4), pos))) throw new ErroUso('o recado traz negação antes de "aprovo produção fiscal"');
  const depois = corpo.slice(pos + frase.length);
  const deste = casamento(depois, tenant);
  const outro = ativos.filter((t) => t.id !== tenant.id).reduce((maior, t) => Math.max(maior, casamento(depois, t)), 0);
  if (deste === 0 || outro >= deste) throw new ErroUso(`o recado não aprova ${tenant.slug}`);
  return { recado_sha256: createHash('sha256').update(texto).digest('hex') };
}

/** Estado novo do ambiente a partir da linha atual (pura). Linha excluída (deleted_at) vale como sem linha. */
export function planejar(atual, op) {
  const antes = atual && !atual.deleted_at ? { ambiente: atual.ambiente, recado_aprovacao: atual.recado_aprovacao ?? null } : null;
  if (op.comando === 'producao') {
    return { antes, depois: { ambiente: 'producao', recado_aprovacao: op.recado }, muda: antes?.ambiente !== 'producao' };
  }
  return { antes, depois: { ambiente: 'homologacao', recado_aprovacao: null }, muda: antes?.ambiente === 'producao' };
}

/** Certificado da filial como aviso (a emissão já barra A1 ausente ou vencido, RN-CORE-06). */
function avisosDoCertificado(cert, agora) {
  if (!cert) return ['filial sem certificado A1 ativo: a emissão em produção fica barrada até o envio (RN-CORE-06)'];
  if (new Date(cert.valido_ate) <= agora) return [`certificado A1 vencido em ${new Date(cert.valido_ate).toISOString()}: a emissão fica barrada (RN-CORE-06)`];
  return [];
}

/**
 * Executa com um cliente pg já conectado (`query(sql, params)`), numa transação: acha o tenant e liga a RLS dele,
 * confere o recado contra os tenants ativos, confere a filial, trava a linha e aplica upsert, auditoria e evento. Sem `confirmar`, desfaz
 * no fim (simulação). Em produção, `op.textoRecado` traz o conteúdo do arquivo (lido pelo main).
 */
export async function executar(cliente, op, agora) {
  await cliente.query('begin');
  try {
    const tenant = await abrirTenant(cliente, op.empresa);
    let conferido = null;
    if (op.comando === 'producao') {
      const ativos = await cliente.query("select id, slug, nome from plataforma.tenant where situacao = 'ativo' and deleted_at is null");
      conferido = conferirRecado(op.textoRecado ?? '', op.arquivoRecado, op, tenant, ativos.rows);
    }
    if (op.comando === 'listar') {
      const r = await cliente.query(
        `select f.id as filial_id, f.nome, coalesce(a.ambiente, 'homologacao') as ambiente, a.recado_aprovacao
         from cadastros.filial_resumo f
         left join core.ambiente_fiscal a on a.tenant_id = f.tenant_id and a.filial_id = f.id and a.deleted_at is null
         where f.tenant_id = $1 order by f.nome`,
        [tenant.id],
      );
      await cliente.query('rollback');
      return { tenant, filiais: r.rows };
    }
    const f = await cliente.query('select id, nome from cadastros.filial_resumo where tenant_id = $1 and id = $2', [tenant.id, op.filial]);
    if (!f.rows[0]) throw new ErroUso(`filial não encontrada nesta empresa: ${op.filial}`);
    let avisos = [];
    if (op.comando === 'producao') {
      const cert = await cliente.query('select valido_ate from core.certificado where tenant_id = $1 and filial_id = $2 and ativo and deleted_at is null', [tenant.id, op.filial]);
      avisos = avisosDoCertificado(cert.rows[0], agora);
    }
    const r = await cliente.query('select id, ambiente, recado_aprovacao, deleted_at from core.ambiente_fiscal where tenant_id = $1 and filial_id = $2 for update', [tenant.id, op.filial]);
    const plano = planejar(r.rows[0], op);
    if (plano.muda) {
      const instante = agora.toISOString();
      const requestId = `operador-${randomUUID()}`;
      await cliente.query(
        `insert into core.ambiente_fiscal (id, tenant_id, filial_id, ambiente, recado_aprovacao, alterado_por, created_at, updated_at, deleted_at)
         values ($1, $2, $3, $4, $5, null, $6, $6, null)
         on conflict (tenant_id, filial_id) do update set ambiente = excluded.ambiente, recado_aprovacao = excluded.recado_aprovacao,
         alterado_por = null, updated_at = excluded.updated_at, deleted_at = null`,
        [r.rows[0]?.id ?? randomUUID(), tenant.id, op.filial, plano.depois.ambiente, plano.depois.recado_aprovacao, instante],
      );
      const payload = { filial_id: op.filial, ...plano.depois };
      const depois = { ...payload, origem: 'script', operador: op.operador };
      if (op.motivo !== undefined) depois.motivo = op.motivo.trim();
      if (conferido) depois.recado_sha256 = conferido.recado_sha256;
      await cliente.query(
        `insert into plataforma.auditoria (id, tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id, ocorrido_em, created_at, updated_at)
         values ($1, $2, null, 'core.ambiente.trocado', 'ambiente_fiscal', $3, $4, $5, $6, $7, $7, $7)`,
        [randomUUID(), tenant.id, op.filial, JSON.stringify(plano.antes ?? { ambiente: 'homologacao', recado_aprovacao: null }), JSON.stringify(depois), requestId, instante],
      );
      // Mesmo formato do OutboxPg (packages/platform-sdk/src/pg.ts): a coluna payload guarda o envelope { ator, request_id, payload }.
      await cliente.query(
        `insert into plataforma.evento (id, tenant_id, nome, agregado_id, versao, ocorrido_em, proximo_em, payload)
         values ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [randomUUID(), tenant.id, EVENTO, op.filial, agora.getTime(), instante, JSON.stringify({ ator: 'sistema', request_id: requestId, payload })],
      );
    }
    await cliente.query(op.confirmar ? 'commit' : 'rollback');
    return { tenant, ...plano, avisos, recado_sha256: conferido?.recado_sha256, aplicado: op.confirmar && plano.muda };
  } catch (e) {
    await cliente.query('rollback').catch(() => undefined);
    // Mascarado como os demais: só a mensagem curta vai ao terminal (o main sai com 1, sem stack nem texto do banco).
    if (e?.code === SQLSTATE_A1_TESTE) throw new ErroUso(MENSAGEM_A1_TESTE);
    throw e;
  }
}

async function main(argv) {
  let op;
  try {
    op = lerArgumentos(argv);
    if (op.comando === 'producao') {
      try {
        op.textoRecado = readFileSync(op.arquivoRecado, 'utf8');
      } catch (e) {
        throw new ErroUso(`não foi possível ler --arquivo-recado (${e.code ?? e.name})`);
      }
    }
  } catch (e) {
    console.error(`ambiente-fiscal: ${e.message}\n(veja o cabeçalho de scripts/plataforma/ambiente-fiscal.mjs)`);
    return 2;
  }
  let cliente;
  try {
    cliente = await conectarOperador();
  } catch (e) {
    console.error(`ambiente-fiscal: ${e instanceof ErroUso ? e.message : `falhou ao conectar (${[e.name, e.code].filter(Boolean).join(' ')})`}`);
    return e instanceof ErroUso ? 2 : 1;
  }
  try {
    const r = await executar(cliente, op, new Date());
    if (op.comando === 'listar') {
      console.log(`${op.empresa} (${r.tenant.id}): sem linha = homologação`);
      for (const l of r.filiais) console.log(`  ${l.filial_id} ${l.nome}: ${l.ambiente}${l.recado_aprovacao ? ` (recado ${l.recado_aprovacao})` : ''}`);
    } else {
      const plano = { empresa: op.empresa, filial: op.filial, antes: r.antes, depois: r.depois, avisos: r.avisos };
      if (r.recado_sha256) plano.recado = { id: op.recado, sha256: r.recado_sha256 };
      console.log(JSON.stringify(plano, null, 2));
      console.log(!r.muda ? 'nada a mudar.' : r.aplicado ? 'aplicado e auditado.' : 'SIMULAÇÃO: nada gravado. Repita com --confirmar para aplicar.');
    }
    return 0;
  } catch (e) {
    console.error(`ambiente-fiscal: ${e instanceof ErroUso ? e.message : `falhou (${[e.name, e.code].filter(Boolean).join(' ')})`}`);
    return 1;
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
