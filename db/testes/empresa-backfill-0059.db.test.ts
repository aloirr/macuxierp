/**
 * T-0100, migração 0059 (RN-CORE-14): backfill da core.empresa a partir da filial padrão viva com razão social e
 * CNPJ preenchidos. Banco até a 0058 com a massa legada,
 * depois a 0059; reexecução idempotente e NOTICE só com contagens. Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { ErroPsql } from '../src/psql.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  executar,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  rodarScript,
} from './apoio.ts';

const MIGRACAO = '0059_core_empresa_backfill.sql';
const CAMINHO = fileURLToPath(new URL(`../migrations/${MIGRACAO}`, import.meta.url));

/** L: legado (filial padrão, sem empresa); N: novo (já tem empresa); S: sem filial; P: só filial não padrão;
 *  E: empresa excluída; X: tenant excluído com filial padrão; B: filial padrão com razão social em branco (RN-CORE-14). */
const B = randomUUID();
const L = randomUUID();
const N = randomUUID();
const S = randomUUID();
const P = randomUUID();
const E = randomUUID();
const X = randomUUID();
const CNPJ_L = '11222333000181';
const CNPJ_N = '12345678000195';

interface Empresa {
  tenant_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  ie: string | null;
  fuso: string;
  updated_at: string;
  excluida: boolean;
}

const tenant = (id: string, slug: string, extra = ''): string =>
  `INSERT INTO plataforma.tenant (id, tenant_id, slug, nome, fuso, deleted_at)
   VALUES ('${id}', '${id}', '${slug}', 'Empresa Ficticia', 'America/Boa_Vista', ${extra || 'NULL'});`;
const filial = (
  t: string,
  cnpj: string,
  razao: string,
  padrao: boolean,
  opcoes: { fantasia?: string; ie?: string; excluida?: boolean } = {},
): string =>
  `INSERT INTO cadastros.filial (tenant_id, cnpj, ie, razao_social, nome_fantasia, crt, logradouro, numero, bairro,
     municipio_ibge, uf, cep, padrao, deleted_at)
   VALUES ('${t}', '${cnpj}', ${opcoes.ie ? `'${opcoes.ie}'` : 'NULL'}, '${razao}',
     ${opcoes.fantasia ? `'${opcoes.fantasia}'` : 'NULL'}, '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000',
     ${padrao}, ${opcoes.excluida ? 'now()' : 'NULL'});`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — backfill da core.empresa pela filial padrão (T-0100, 0059)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  let antesDaN: Empresa | undefined;
  let aviso = '';

  const empresas = (): Empresa[] =>
    consultar<Empresa>(
      banco.conexao,
      `SELECT tenant_id, razao_social, nome_fantasia, cnpj::text AS cnpj, ie, fuso, updated_at::text AS updated_at,
              deleted_at IS NOT NULL AS excluida
         FROM core.empresa ORDER BY tenant_id`,
    );
  const de = (id: string): Empresa | undefined => empresas().find((e) => e.tenant_id === id);
  /** stderr da 0059 (NOTICE): o psql só o devolve no erro, então um erro no fim desfaz tudo e traz a saída. */
  const avisosDaMigracao = (): string => {
    try {
      rodarScript(banco.conexao, `${readFileSync(CAMINHO, 'utf8')}\nSELECT 1 / 0;`, { transacao: true });
    } catch (e) {
      if (e instanceof ErroPsql) return e.saida;
      throw e;
    }
    throw new Error('a 0059 com 1/0 no fim deveria falhar');
  };

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0059');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    executar(
      banco.conexao,
      `${tenant(L, 'backfill-0059-l')}
${filial(L, CNPJ_N, 'Filial Secundaria Ficticia', false)}
${filial(L, CNPJ_L, 'Filial Antiga Ficticia', true, { excluida: true })}
${filial(L, CNPJ_L, 'Comercio Ficticio Ltda', true, { fantasia: 'Loja Ficticia', ie: '041234567' })}
${tenant(N, 'backfill-0059-n')}
INSERT INTO core.empresa (tenant_id, razao_social, cnpj, fuso) VALUES ('${N}', 'Empresa Ja Cadastrada', '${CNPJ_N}', 'America/Manaus');
${filial(N, CNPJ_L, 'Outra Razao Ficticia', true, { fantasia: 'Outra', ie: '049999999' })}
${tenant(S, 'backfill-0059-s')}
${tenant(P, 'backfill-0059-p')}
${filial(P, CNPJ_L, 'Filial Nao Padrao Ficticia', false)}
${tenant(E, 'backfill-0059-e')}
INSERT INTO core.empresa (tenant_id, razao_social, cnpj, deleted_at) VALUES ('${E}', 'Empresa Excluida', '${CNPJ_N}', now());
${filial(E, CNPJ_L, 'Filial da Excluida', true)}
${tenant(X, 'backfill-0059-x', 'now()')}
${filial(X, CNPJ_L, 'Filial do Tenant Excluido', true)}
${tenant(B, 'backfill-0059-b')}
${filial(B, CNPJ_L, '  ', true, { fantasia: 'Fantasia Ficticia' })}`,
    );
    antesDaN = de(N);
    aviso = avisosDaMigracao();
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('tenant legado com filial padrão e sem empresa: a linha nasce com os dados da filial padrão não excluída', () => {
    expect(de(L)).toMatchObject({
      razao_social: 'Comercio Ficticio Ltda',
      nome_fantasia: 'Loja Ficticia',
      cnpj: CNPJ_L,
      ie: '041234567',
      fuso: 'America/Boa_Vista',
      excluida: false,
    });
  });

  it('tenant que já tem empresa (mesmo excluída) não muda', () => {
    expect(de(N)).toEqual(antesDaN);
    expect(de(E)).toMatchObject({ razao_social: 'Empresa Excluida', excluida: true });
  });

  it('tenant sem filial, só com filial não padrão ou excluído: nada é criado', () => {
    expect(de(S)).toBeUndefined();
    expect(de(P)).toBeUndefined();
    expect(de(X)).toBeUndefined();
    expect(empresas()).toHaveLength(3);
  });

  it('RN-CORE-14: filial padrão viva sem razão social preenchida não cria a empresa e conta em sem_dados_minimos', () => {
    expect(de(B)).toBeUndefined();
    expect(aviso).toMatch(/sem_dados_minimos=1/);
  });

  it('a empresa_json passa a trazer a razão social e o CNPJ do legado, sem mudar o formato', () => {
    const [r] = consultar<{ j: { razao_social: string; cnpj: string } }>(
      banco.conexao,
      `SELECT plataforma.empresa_json('${L}') AS j`,
    );
    expect(r?.j).toMatchObject({ razao_social: 'Comercio Ficticio Ltda', cnpj: CNPJ_L });
  });

  it('NOTICE só com contagens, sem CNPJ, razão social, nome fantasia, IE nem id de tenant', () => {
    expect(aviso).toMatch(/0059: core\.empresa criadas=1, ja_existentes=2, sem_filial_padrao=2, sem_dados_minimos=1/);
    for (const proibido of [CNPJ_L, CNPJ_N, 'Ficticio', 'Ficticia', 'Loja', '041234567', L, N, S, P, E, X, B])
      expect(aviso).not.toContain(proibido);
  });

  it('a 0059 é reexecutável: nada é criado nem alterado', () => {
    const antes = empresas();
    const segundo = avisosDaMigracao();
    expect(segundo).toMatch(/criadas=0, ja_existentes=3, sem_filial_padrao=2, sem_dados_minimos=1/);
    rodarScript(banco.conexao, readFileSync(CAMINHO, 'utf8'), { transacao: true });
    expect(empresas()).toEqual(antes);
  });
});
