/**
 * Migrações do banco macuxierp: os .sql de db/migrations em ordem, cada um numa transação, registrados em
 * controle.migracao com o sha256. Migração aplicada não muda (sha diferente = erro): a correção vem numa migração nova
 * e aditiva (a versão anterior da API roda sobre o esquema novo). Depois das migrações, a carga versionada das tabelas
 * oficiais (oficiais.ts). Roda como o admin do DBaaS, sem superusuário.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAVA_MIGRACAO, sha256Arquivo } from './comum.ts';
import { carregarOficiais } from './oficiais.ts';
import { type Conexao, consultar, literal, rodarScript } from './psql.ts';

const PASTA_MIGRACOES = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface Migracao {
  nome: string;
  caminho: string;
  sha256: string;
}

export function listarMigracoes(pasta = PASTA_MIGRACOES): Migracao[] {
  return readdirSync(pasta)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((nome) => ({ nome, caminho: join(pasta, nome), sha256: sha256Arquivo(join(pasta, nome)) }));
}

const REGISTRO = `
CREATE SCHEMA IF NOT EXISTS controle;
REVOKE ALL ON SCHEMA controle FROM PUBLIC;
CREATE TABLE IF NOT EXISTS controle.migracao (
  nome text PRIMARY KEY,
  sha256 text NOT NULL,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);`;

/** Aplica as migrações pendentes e a carga das tabelas oficiais. Devolve o que foi aplicado agora. */
export function migrar(c: Conexao, opcoes: { pasta?: string; oficiais?: boolean } = {}): string[] {
  rodarScript(c, `SELECT pg_advisory_xact_lock(${TRAVA_MIGRACAO});\n${REGISTRO}`, { transacao: true });
  const aplicadas = new Map(
    consultar<{ nome: string; sha256: string }>(c, 'SELECT nome, sha256 FROM controle.migracao').map((m) => [
      m.nome,
      m.sha256,
    ]),
  );
  const feitas: string[] = [];
  for (const m of listarMigracoes(opcoes.pasta)) {
    const sha = aplicadas.get(m.nome);
    if (sha !== undefined) {
      if (sha !== m.sha256) {
        throw new Error(
          `a migração ${m.nome} mudou depois de aplicada (sha ${sha} ≠ ${m.sha256}): crie uma nova`,
        );
      }
      continue;
    }
    // A conferência de novo dentro da trava cobre duas execuções ao mesmo tempo.
    const saida = rodarScript(
      c,
      `SELECT pg_advisory_xact_lock(${TRAVA_MIGRACAO});
SELECT count(*) > 0 AS ja FROM controle.migracao WHERE nome = ${literal(m.nome)} \\gset
\\if :ja
\\else
\\i ${literal(m.caminho)}
INSERT INTO controle.migracao (nome, sha256) VALUES (${literal(m.nome)}, ${literal(m.sha256)});
SELECT 'aplicada';
\\endif
`,
      { transacao: true },
    );
    if (saida.includes('aplicada')) feitas.push(m.nome);
  }
  if (opcoes.oficiais !== false) feitas.push(...carregarOficiais(c));
  return feitas;
}
