#!/usr/bin/env node
/**
 * Licença de módulo por tenant — script do operador (desenho T-0002, D12; RN-CORE-02). O tenant só LÊ a licença
 * (`GET /v1/core/licencas`); ligar, desligar ou mudar o prazo é só por aqui, sempre com auditoria
 * (`plataforma.auditoria`, usuario_id nulo, ação de licença da ADR 0012 §4, com operador e motivo).
 *
 * Uso (sem --confirmar só mostra o plano; nada muda):
 *   node scripts/plataforma/licenca.mjs listar  --empresa <slug>
 *   node scripts/plataforma/licenca.mjs ativar  --empresa <slug> --modulo <id> [--ate AAAA-MM-DD] --operador <nome> --motivo "<texto>" [--confirmar]
 *   node scripts/plataforma/licenca.mjs desativar --empresa <slug> --modulo <id> --operador <nome> --motivo "<texto>" [--confirmar]
 * Conexão: MACUXIERP_DATABASE_URL_OPERADOR (no .env do servidor; nunca em recado nem no repositório).
 * `--ate` vale até o fim do dia no horário de Manaus (UTC−4): grava `valido_ate` = dia seguinte 04:00 UTC.
 *
 * Depende do schema `plataforma` da T-0003: `tenant`, `tenant_modulo` (único por tenant e módulo) e `auditoria`.
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { abrirTenant, conectarOperador, ErroUso, lerOpcoes, PADRAO_OPERADOR, PADRAO_SLUG } from './comum.mjs';

// Cópia de `MODULOS` (packages/platform-sdk/src/modulo.ts) e `MODULOS_BASE` (acesso.ts): o Node do servidor não
// importa o TS do SDK. O licenca.test.mjs falha se as listas divergirem.
export const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'];
export const MODULOS_BASE = ['core'];
const COMANDOS = ['listar', 'ativar', 'desativar'];
const OPCOES = ['--empresa', '--modulo', '--ate', '--operador', '--motivo'];

/** Lê e valida os argumentos. Lança ErroUso com a explicação. */
export function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  if (!COMANDOS.includes(comando)) throw new ErroUso(`comando deve ser ${COMANDOS.join(', ')}`);
  const op = { comando, ...lerOpcoes(resto, OPCOES) };
  if (!op.empresa || !PADRAO_SLUG.test(op.empresa)) throw new ErroUso('--empresa exige o slug da empresa');
  if (comando === 'listar') return op;
  if (!MODULOS.includes(op.modulo)) throw new ErroUso(`--modulo deve ser ${MODULOS.join(', ')}`);
  if (MODULOS_BASE.includes(op.modulo)) throw new ErroUso(`o ${op.modulo} é a base do tenant e é sempre licenciado`);
  if (!op.operador || !PADRAO_OPERADOR.test(op.operador)) throw new ErroUso('--operador exige o nome de quem executa (ex.: alexandre)');
  if (!op.motivo || op.motivo.trim().length < 5) throw new ErroUso('--motivo exige o motivo (mínimo 5 caracteres), que vai para a auditoria');
  if (op.ate !== undefined) {
    if (comando !== 'ativar') throw new ErroUso('--ate só vale para ativar');
    op.validoAte = fimDoDiaManaus(op.ate);
  }
  return op;
}

/** `AAAA-MM-DD` → instante UTC do fim do dia em Manaus (dia seguinte 00:00 em UTC−4 = 04:00 UTC). */
export function fimDoDiaManaus(data) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const [a, mes, dia] = m ? m.slice(1).map(Number) : [];
  const d = m ? new Date(Date.UTC(a, mes - 1, dia)) : null;
  if (!d || d.getUTCFullYear() !== a || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new ErroUso(`--ate inválido: ${data} (use AAAA-MM-DD)`);
  }
  return new Date(Date.UTC(a, mes - 1, dia + 1, 4));
}

/** Estado novo da licença a partir do atual (pura). */
export function planejar(atual, op) {
  const antes = atual ? { ativo: atual.ativo, valido_ate: atual.valido_ate ? new Date(atual.valido_ate).toISOString() : null } : null;
  const depois = op.comando === 'ativar' ? { ativo: true, valido_ate: op.validoAte ? op.validoAte.toISOString() : null } : { ativo: false, valido_ate: antes?.valido_ate ?? null };
  const muda = !antes || antes.ativo !== depois.ativo || antes.valido_ate !== depois.valido_ate;
  return { antes, depois, muda };
}

/**
 * Executa com um cliente pg já conectado (`query(sql, params)`), numa transação: acha o tenant, liga a RLS dele,
 * aplica o upsert e grava a auditoria. Sem `confirmar`, desfaz no fim (simulação).
 */
export async function executar(cliente, op, agora) {
  await cliente.query('begin');
  try {
    const tenant = await abrirTenant(cliente, op.empresa);
    if (op.comando === 'listar') {
      const r = await cliente.query('select modulo, ativo, valido_ate from plataforma.tenant_modulo where tenant_id = $1 and deleted_at is null order by modulo', [tenant.id]);
      await cliente.query('rollback');
      return { tenant, licencas: r.rows };
    }
    const r = await cliente.query('select id, ativo, valido_ate from plataforma.tenant_modulo where tenant_id = $1 and modulo = $2 and deleted_at is null for update', [tenant.id, op.modulo]);
    const plano = planejar(r.rows[0], op);
    if (plano.muda) {
      const gravada = await cliente.query(
        `insert into plataforma.tenant_modulo (id, tenant_id, modulo, ativo, valido_ate, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $6)
         on conflict (tenant_id, modulo) where deleted_at is null
         do update set ativo = excluded.ativo, valido_ate = excluded.valido_ate, updated_at = excluded.updated_at
         returning id`,
        [r.rows[0]?.id ?? randomUUID(), tenant.id, op.modulo, plano.depois.ativo, plano.depois.valido_ate, agora.toISOString()],
      );
      await cliente.query(
        `insert into plataforma.auditoria (id, tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id, ocorrido_em, created_at, updated_at)
         values ($1, $2, null, 'plataforma.modulos.alterar', 'tenant_modulo', $3, $4, $5, $6, $7, $7, $7)`,
        [randomUUID(), tenant.id, gravada.rows[0].id, JSON.stringify(plano.antes), JSON.stringify({ ...plano.depois, modulo: op.modulo, operador: op.operador, motivo: op.motivo }), `operador-${randomUUID()}`, agora.toISOString()],
      );
    }
    await cliente.query(op.confirmar ? 'commit' : 'rollback');
    return { tenant, ...plano, aplicado: op.confirmar && plano.muda };
  } catch (e) {
    await cliente.query('rollback').catch(() => undefined);
    throw e;
  }
}

async function main(argv) {
  let op;
  try {
    op = lerArgumentos(argv);
  } catch (e) {
    console.error(`licenca: ${e.message}\n(veja o cabeçalho de scripts/plataforma/licenca.mjs)`);
    return 2;
  }
  let cliente;
  try {
    cliente = await conectarOperador();
  } catch (e) {
    console.error(`licenca: ${e instanceof ErroUso ? e.message : `falhou ao conectar (${[e.name, e.code].filter(Boolean).join(' ')})`}`);
    return e instanceof ErroUso ? 2 : 1;
  }
  try {
    const r = await executar(cliente, op, new Date());
    if (op.comando === 'listar') {
      console.log(`${op.empresa} (${r.tenant.id}): core sempre licenciado`);
      for (const l of r.licencas) console.log(`  ${l.modulo}: ${l.ativo ? 'ativo' : 'inativo'}${l.valido_ate ? ` até ${new Date(l.valido_ate).toISOString()}` : ''}`);
    } else {
      console.log(JSON.stringify({ empresa: op.empresa, modulo: op.modulo, antes: r.antes, depois: r.depois }, null, 2));
      console.log(!r.muda ? 'nada a mudar.' : r.aplicado ? 'aplicado e auditado.' : 'SIMULAÇÃO: nada gravado. Repita com --confirmar para aplicar.');
    }
    return 0;
  } catch (e) {
    console.error(`licenca: ${e instanceof ErroUso ? e.message : `falhou (${e.name})`}`);
    return 1;
  } finally {
    await cliente.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
