/**
 * SQL do cadastro de regras (T-0127): `fiscal.regra_tributaria` do tenant (RLS por `app.tenant_id`; nada de `tenant_id` de parâmetro) e o catálogo
 * `fiscal.regra_base` (regras-modelo globais, só leitura). `ajustar_mva` sai e entra como veio: nulo = "não informado" (migração 0082 do banco-dados).
 * Os campos da regra vêm das chaves do schema `CamposRegra`: coluna nova no contrato entra aqui sem outro ajuste.
 */
import { erros, type Transacao } from '@macuxierp/platform-sdk';
import { CamposRegra, RegraDetalhe, CatalogoRegra, type RegraEntrada, type RegraLinha } from '../contracts';
import { situacaoDaRegra } from '../domain';
import type { FiltroListaRegras, RepositorioCatalogo, RepositorioRegras } from './regras-portas';

const ISO = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const D = (c: string) => `to_char(${c}, 'YYYY-MM-DD')`;

/** Campos que o banco guarda com outro nome ou tipo; o resto tem a coluna com o mesmo nome do campo. */
const ESPECIAIS = new Set(['id', 'fonte', 'vigencia_inicio', 'vigencia_fim']);
const CAMPOS = Object.keys(CamposRegra.shape).filter((k) => !ESPECIAIS.has(k));
const FLOAT8 = new Set(['valor_unidade_ipi', 'valor_unidade_pis', 'valor_unidade_cofins', 'valor_unidade_is']);
const INT = new Set(['crt', 'mod_bc', 'mod_bc_st']);
/** Colunas gravadas, na ordem dos parâmetros $1... */
const ESCRITA = [...CAMPOS, 'fonte_tipo', 'fonte_referencia', 'vigencia_inicio', 'vigencia_fim'];

const SELECAO = [
  'id',
  ...CAMPOS.map((c) => (FLOAT8.has(c) ? `${c}::float8 AS ${c}` : INT.has(c) ? `${c}::int AS ${c}` : c)),
  'fonte_tipo', 'fonte_referencia', `${D('vigencia_inicio')} AS vigencia_inicio`, `${D('vigencia_fim')} AS vigencia_fim`, `${ISO('updated_at')} AS updated_at`,
].join(', ');

type Linha = Record<string, unknown>;

function valorDe(r: RegraEntrada, coluna: string): unknown {
  if (coluna === 'fonte_tipo') return r.fonte?.tipo ?? null;
  if (coluna === 'fonte_referencia') return r.fonte?.referencia ?? null;
  return (r as Record<string, unknown>)[coluna] ?? null;
}

function detalheDe(l: Linha, hoje: string): RegraDetalhe {
  const { fonte_tipo, fonte_referencia, ...resto } = l;
  const fonte = fonte_tipo && fonte_referencia ? { tipo: fonte_tipo, referencia: fonte_referencia } : null;
  const base = RegraDetalhe.parse({ ...resto, fonte, situacao: 'vigente' });
  return { ...base, situacao: situacaoDaRegra(base, hoje) };
}

function linhaDe(d: RegraDetalhe): RegraLinha {
  return {
    id: d.id, tributo: d.tributo, ncm_prefixo: d.ncm_prefixo, uf_origem: d.uf_origem, uf_destino: d.uf_destino, tipo_cliente: d.tipo_cliente, crt: d.crt, cfop: d.cfop,
    codigo: d.codigo, aliquota_icms: d.aliquota_icms, mva_original: d.mva_original, ajustar_mva: d.ajustar_mva, fonte: d.fonte, versao: d.versao,
    vigencia_inicio: d.vigencia_inicio, vigencia_fim: d.vigencia_fim, situacao: d.situacao, updated_at: d.updated_at,
  };
}

/** Violação de constraint vira erro de negócio, sem eco de valor do Postgres. */
async function executar<L = Linha>(tx: Transacao, sql: string, p: readonly unknown[]): Promise<L[]> {
  try {
    return await tx.consultar<L>(sql, p);
  } catch (e) {
    const pg = e as { code?: string };
    if (pg.code === '23505') throw erros.conflito('Já existe uma regra com os mesmos filtros e o mesmo início de vigência');
    if (pg.code === '23514') throw erros.regra('RN-FIS-01', 'A regra não passou nas conferências do banco: confira os campos do tributo e o CST/CSOSN do CRT.');
    throw e;
  }
}

/** WHERE comum da lista e do CSV. `$1` = hoje (data civil do tenant). */
function filtrar(f: Omit<FiltroListaRegras, 'limite'>): { where: string; params: unknown[] } {
  const params: unknown[] = [f.hoje];
  // `$1::date IS NOT NULL` mantém o parâmetro usado (e tipado) mesmo sem filtro de situação.
  const w: string[] = ['deleted_at IS NULL', '$1::date IS NOT NULL'];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    w.push(sql.replace('$#', `$${params.length}`));
  };
  if (f.tributo) add('tributo = $#', f.tributo);
  if (f.uf_origem) add('uf_origem = $#', f.uf_origem);
  if (f.uf_destino) add('uf_destino = $#', f.uf_destino);
  if (f.crt) add('crt = $#::smallint', Number(f.crt));
  if (f.situacao === 'vigente') w.push('vigencia_inicio <= $1::date AND (vigencia_fim IS NULL OR vigencia_fim >= $1::date)');
  if (f.situacao === 'futura') w.push('vigencia_inicio > $1::date');
  if (f.situacao === 'encerrada') w.push('vigencia_fim IS NOT NULL AND vigencia_fim < $1::date');
  if (f.busca) {
    params.push(f.busca);
    const n = `$${params.length}`;
    w.push(`(starts_with(coalesce(ncm_prefixo, ''), ${n}) OR codigo = ${n} OR cfop = ${n} OR strpos(lower(fonte_referencia), lower(${n})) > 0)`);
  }
  if (f.cursor) add('id > $#::uuid', f.cursor);
  return { where: w.join(' AND '), params };
}

export function repositorioRegrasSql(tx: Transacao): RepositorioRegras {
  const lerUma = async (id: string, hoje: string): Promise<RegraDetalhe | null> => {
    const l = await executar(tx, `SELECT ${SELECAO} FROM fiscal.regra_tributaria WHERE id = $1::uuid AND deleted_at IS NULL`, [id]);
    return l[0] ? detalheDe(l[0], hoje) : null;
  };
  const colunas = ESCRITA.join(', ');
  const marcas = (de: number) => ESCRITA.map((c, i) => `$${i + de}${c.startsWith('vigencia') ? '::date' : ''}`);
  return {
    async listar(f) {
      const { where, params } = filtrar(f);
      const l = await executar(tx, `SELECT ${SELECAO} FROM fiscal.regra_tributaria WHERE ${where} ORDER BY id LIMIT ${Math.trunc(f.limite) + 1}`, params);
      return l.map((x) => linhaDe(detalheDe(x, f.hoje)));
    },
    async listarTodos(f, maximo) {
      const { where, params } = filtrar({ ...f, cursor: undefined });
      const l = await executar(tx, `SELECT ${SELECAO} FROM fiscal.regra_tributaria WHERE ${where} ORDER BY id LIMIT ${Math.trunc(maximo)}`, params);
      return l.map((x) => linhaDe(detalheDe(x, f.hoje)));
    },
    obter: lerUma,
    async inserir(r, hoje) {
      const l = await executar(tx, `INSERT INTO fiscal.regra_tributaria (tenant_id, ${colunas}) VALUES (plataforma.tenant_atual(), ${marcas(1).join(', ')}) RETURNING ${SELECAO}`, ESCRITA.map((c) => valorDe(r, c)));
      return detalheDe(l[0] as Linha, hoje);
    },
    async atualizar(id, r, ifMatch, hoje) {
      const sets = ESCRITA.map((c, i) => `${c} = ${marcas(3)[i]}`).join(', ');
      const l = await executar(
        tx,
        `UPDATE fiscal.regra_tributaria SET ${sets}, updated_at = now()
          WHERE id = $1::uuid AND deleted_at IS NULL AND date_trunc('milliseconds', updated_at) = $2::timestamptz RETURNING ${SELECAO}`,
        [id, ifMatch, ...ESCRITA.map((c) => valorDe(r, c))],
      );
      if (l[0]) return detalheDe(l[0], hoje);
      return (await lerUma(id, hoje)) ? 'conflito' : null;
    },
    async excluir(id, hoje) {
      const atual = await lerUma(id, hoje);
      if (!atual) return null;
      await executar(tx, `UPDATE fiscal.regra_tributaria SET deleted_at = now(), updated_at = now() WHERE id = $1::uuid AND deleted_at IS NULL`, [id]);
      return atual;
    },
  };
}

// ---- Catálogo (`fiscal.regra_base`): colunas = as da regra, sem tenant e sem vigência, mais chave, descricao e validada_em (desenho do banco-dados, 0082) ----

const SELECAO_CATALOGO = [
  'id',
  ...CAMPOS.map((c) => (FLOAT8.has(c) ? `${c}::float8 AS ${c}` : INT.has(c) ? `${c}::int AS ${c}` : c)),
  'fonte_tipo', 'fonte_referencia', 'versao', 'chave', 'descricao', `${ISO('validada_em')} AS validada_em`,
].join(', ');

function catalogoDe(l: Linha): CatalogoRegra {
  const { fonte_tipo, fonte_referencia, ...resto } = l;
  return CatalogoRegra.parse({ ...resto, fonte: fonte_tipo && fonte_referencia ? { tipo: fonte_tipo, referencia: fonte_referencia } : null });
}

export function repositorioCatalogoSql(tx: Transacao): RepositorioCatalogo {
  return {
    async listar(f) {
      const params: unknown[] = [];
      const w: string[] = ['deleted_at IS NULL'];
      if (f.tributo) { params.push(f.tributo); w.push(`tributo = $${params.length}`); }
      if (f.busca) { params.push(f.busca); w.push(`(strpos(lower(chave), lower($${params.length})) > 0 OR strpos(lower(descricao), lower($${params.length})) > 0)`); }
      if (f.cursor) { params.push(f.cursor); w.push(`id > $${params.length}::uuid`); }
      const l = await executar(tx, `SELECT ${SELECAO_CATALOGO} FROM fiscal.regra_base WHERE ${w.join(' AND ')} ORDER BY id LIMIT ${Math.trunc(f.limite) + 1}`, params);
      return l.map(catalogoDe);
    },
    async obter(id) {
      const l = await executar(tx, `SELECT ${SELECAO_CATALOGO} FROM fiscal.regra_base WHERE id = $1::uuid AND deleted_at IS NULL`, [id]);
      return l[0] ? catalogoDe(l[0]) : null;
    },
  };
}
