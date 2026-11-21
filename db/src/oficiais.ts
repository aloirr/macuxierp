/**
 * Carga versionada das tabelas oficiais (D9, RF-CAD-10) a partir de db/tabelas-fiscais/fontes.json. As regras (fonte,
 * conferência, uma vez por versão, vigência e nada apagado) estão em docs/banco/tabelas-oficiais.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAVA_MIGRACAO, sha256Arquivo } from './comum.ts';
import { type Conexao, literal, rodarScript } from './psql.ts';

export const PASTA_OFICIAIS = fileURLToPath(new URL('../tabelas-fiscais/', import.meta.url));

/** Tabelas que a carga pode gravar (todas no tenant de referência, migração 0005). */
const TABELAS_OFICIAIS = [
  'uf',
  'municipio',
  'ncm',
  'cest',
  'cest_ncm',
  'cfop',
  'cst',
  'classificacao_tributaria',
] as const;
type TabelaOficial = (typeof TABELAS_OFICIAIS)[number];

export interface CargaOficial {
  /** Identificador estável da carga (uma tabela pode ter mais de uma carga, como a cst). */
  carga: string;
  tabela: TabelaOficial;
  versao: string;
  /** Caminho do CSV, relativo a db/tabelas-fiscais. */
  arquivo: string;
  /** Colunas que identificam a linha dentro da carga. */
  chave: string[];
  fonte: string;
  url: string;
  /** AAAA-MM-DD: data da fonte (publicação ou captura); vira vigencia_inicio quando o CSV não traz a vigência. */
  data_referencia: string;
  sha256: string;
  registros: number;
  observacao?: string;
}

const COLUNA = /^[a-z][a-z0-9_]*$/;

export function lerFontes(pasta = PASTA_OFICIAIS): CargaOficial[] {
  const dados = JSON.parse(readFileSync(join(pasta, 'fontes.json'), 'utf8')) as { cargas: CargaOficial[] };
  return dados.cargas;
}

/** Cabeçalho do CSV (as colunas da carga). */
function colunasDoCsv(caminho: string): string[] {
  const primeira = readFileSync(caminho, 'utf8').split('\n', 1)[0] ?? '';
  return primeira.trim().split(',');
}

/** Confere a carga antes de tocar no banco: tabela conhecida, colunas válidas, sha256 e registros do arquivo. */
export function conferirCarga(
  c: CargaOficial,
  pasta = PASTA_OFICIAIS,
): { caminho: string; colunas: string[] } {
  if (!(TABELAS_OFICIAIS as readonly string[]).includes(c.tabela))
    throw new Error(`tabela oficial desconhecida: ${c.tabela}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.data_referencia)) throw new Error(`${c.carga}: data_referencia inválida`);
  if (!c.fonte.trim() || !c.url.trim()) throw new Error(`${c.carga}: sem fonte ou url`);
  const caminho = join(pasta, c.arquivo);
  const sha = sha256Arquivo(caminho);
  if (sha !== c.sha256)
    throw new Error(`${c.carga}: sha256 do arquivo ${c.arquivo} é ${sha}, o fontes.json diz ${c.sha256}`);
  const colunas = colunasDoCsv(caminho);
  for (const col of [...colunas, ...c.chave]) {
    if (!COLUNA.test(col)) throw new Error(`${c.carga}: coluna inválida ${col}`);
  }
  if (!c.chave.every((k) => colunas.includes(k)))
    throw new Error(`${c.carga}: chave fora do cabeçalho do CSV`);
  return { caminho, colunas };
}

/** SQL da carga (psql, numa transação): staging tipada como a tabela, conferência, versão e mescla. */
function scriptDaCarga(c: CargaOficial, caminho: string, colunas: string[]): string {
  const t = `cadastros.${c.tabela}`;
  const daCarga = `a.versao_id IN (SELECT id FROM cadastros.tabela_oficial_versao WHERE carga = ${literal(c.carga)})`;
  const casa = c.chave.map((k) => `a.${k} IS NOT DISTINCT FROM s.${k}`).join(' AND ');
  const valores = colunas.filter((k) => !c.chave.includes(k));
  const temInicio = colunas.includes('vigencia_inicio');
  const temFim = colunas.includes('vigencia_fim');
  const atualiza = [
    ...valores.map((k) => `${k} = s.${k}`),
    ...(temFim ? [] : ['vigencia_fim = NULL']),
    `versao_id = :'versao_id'`,
  ];
  const cols = colunas.join(', ');
  const data = literal(c.data_referencia);
  return `SELECT pg_advisory_xact_lock(${TRAVA_MIGRACAO});
SELECT count(*) > 0 AS ja FROM cadastros.tabela_oficial_versao WHERE carga = ${literal(c.carga)} AND versao = ${literal(c.versao)} \\gset
\\if :ja
\\else
CREATE TEMP TABLE carga_oficial ON COMMIT DROP AS SELECT ${cols} FROM ${t} WITH NO DATA;
\\copy carga_oficial (${cols}) FROM ${literal(caminho)} WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
SELECT controle.falhar(format('carga ${c.carga}: %s registros no CSV, o fontes.json diz ${c.registros}', count(*)))
  FROM carga_oficial HAVING count(*) <> ${c.registros};
INSERT INTO cadastros.tabela_oficial_versao (tabela, carga, versao, fonte, url, data_referencia, arquivo, sha256, registros)
VALUES (${literal(c.tabela)}, ${literal(c.carga)}, ${literal(c.versao)}, ${literal(c.fonte)}, ${literal(c.url)}, ${data},
  ${literal(c.arquivo)}, ${literal(c.sha256)}, ${c.registros})
RETURNING id AS versao_id \\gset
UPDATE ${t} a SET vigencia_fim = ${data}
  WHERE a.vigencia_fim IS NULL AND ${daCarga} AND NOT EXISTS (SELECT 1 FROM carga_oficial s WHERE ${casa});
UPDATE ${t} a SET ${atualiza.join(', ')}
  FROM carga_oficial s WHERE ${casa} AND ${daCarga};
INSERT INTO ${t} (${cols}${temInicio ? '' : ', vigencia_inicio'}, versao_id)
  SELECT ${colunas.map((k) => `s.${k}`).join(', ')}${temInicio ? '' : `, ${data}`}, :'versao_id' FROM carga_oficial s
  WHERE NOT EXISTS (SELECT 1 FROM ${t} a WHERE ${casa} AND ${daCarga});
SELECT 'carregada';
\\endif
`;
}

/** Carrega as versões ainda não carregadas. Devolve "carga@versão" de cada uma carregada agora. */
export function carregarOficiais(conexao: Conexao, pasta = PASTA_OFICIAIS): string[] {
  const feitas: string[] = [];
  for (const c of lerFontes(pasta)) {
    const { caminho, colunas } = conferirCarga(c, pasta);
    const saida = rodarScript(conexao, scriptDaCarga(c, caminho, colunas), { transacao: true });
    if (saida.includes('carregada')) feitas.push(`${c.carga}@${c.versao}`);
  }
  return feitas;
}
