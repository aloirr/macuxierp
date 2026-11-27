/**
 * v0.3.24, migração 0077 (RN-CORE-16): Ficha da Receita editável no /config. empresa_salvar_ficha (fonte 'manual' ou a
 * da consulta), empresa_trocar_cnpj (DV, MXC05 com NF-e de produção, MXC06 igual ao atual), interna cnpj_valido,
 * 'manual' no CHECK da fonte e faturamento.tem_nfe_autorizada_producao (só boolean). Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { chaveAcesso, cnfDe, fixtureModulos, fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0077_plataforma_ficha_editavel.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const SALVAR = 'plataforma.empresa_salvar_ficha(uuid, jsonb, text)';
const TROCAR = 'plataforma.empresa_trocar_cnpj(uuid, text, text)';
const DV = 'plataforma.cnpj_valido(text)';
const TEM_NFE = 'faturamento.tem_nfe_autorizada_producao(uuid)';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000077';
const CNPJ_MASSA = '12345678000195';
const CNPJ_NOVO = '11222333000181';
const EMAIL = 'contato.ficticio@empresa-a.teste';
const TELEFONE = '92987651234';
const ACAO_SALVAR = 'plataforma.empresa.salvar_ficha';
const ACAO_TROCAR = 'plataforma.empresa.trocar_cnpj';

/** A: ficha; C: só plataforma (sem core.empresa); D: NF-e de produção; E: homologação e rascunho de produção. */
const A = novoTenant('ficha-0077-a');
const C = novoTenant('ficha-0077-c');
const D = novoTenant('ficha-0077-d');
const E = novoTenant('ficha-0077-e');

/** STATUS_NFE_QUE_TRAVA_TROCA_CNPJ (modules/faturamento/domain/nfe-producao.ts): bloqueiam a troca; os outros não. */
const BLOQUEIAM = [
  'autorizada',
  'autorizada_guarda_pendente',
  'cancelada',
  'em_autorizacao',
  'emitida_contingencia',
] as const;
const NAO_BLOQUEIAM = ['rascunho', 'rejeitada', 'denegada', 'inutilizada'] as const;
type Status = (typeof BLOQUEIAM)[number] | (typeof NAO_BLOQUEIAM)[number];

/** Nota direto na tabela (status já final), coerente com os CHECKs da 0013; as triggers ficam desligadas no script. */
function notaSql(t: Tenant, ambiente: 'homologacao' | 'producao', status: Status, numero: number): string {
  const contingencia = status === 'emitida_contingencia';
  const tipo = contingencia ? 6 : 1;
  const cnf = (parseInt(t.id.slice(0, 6), 16) + numero) % 100000000;
  const numerada = status !== 'rascunho';
  const comChave = numerada && status !== 'inutilizada';
  const protocolada = ['autorizada_guarda_pendente', 'autorizada', 'cancelada', 'denegada'].includes(status);
  const v = (cond: boolean, valor: string): string => (cond ? valor : 'NULL');
  return `INSERT INTO faturamento.nota (tenant_id, filial_id, cliente_id, ambiente, serie, numero, chave_acesso, c_nf,
  tipo_emissao, status, natureza_operacao, idempotencia_chave, protocolo, autorizada_em, cancelada_em, contingencia_em,
  contingencia_justificativa)
  VALUES ('${t.id}', '${t.filial}', '${t.cliente}', '${ambiente}', 7, ${v(numerada, String(numero))},
    ${v(comChave, `'${chaveAcesso(7, numero, cnf, tipo)}'`)}, ${v(comChave, `'${cnfDe(cnf)}'`)}, ${tipo}, '${status}',
    'Venda', '${randomUUID()}', ${v(protocolada, "'113260000000077'")}, ${v(protocolada, 'now()')},
    ${v(status === 'cancelada', 'now()')}, ${v(contingencia, 'now()')},
    ${v(contingencia, "'SEFAZ-AM fora do ar na massa 0077'")});`;
}

/** Script do dono com as triggers da nota desligadas só dentro da transação. */
const semTriggers = (corpo: string): string => `ALTER TABLE faturamento.nota DISABLE TRIGGER USER;
${corpo}
ALTER TABLE faturamento.nota ENABLE TRIGGER USER;`;

interface Troca {
  cnpj: string;
  event_id: string;
}

interface Salvamento {
  ficha: Record<string, unknown>;
  alterados: string[];
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — ficha editável e troca de CNPJ (v0.3.24, 0077, RN-CORE-16)',
  () => {
    let banco: BancoDeTeste;

    const comoConfig = (sessao: string | null, sql: string): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
    const sqlSalvar = (tenant: string, ficha: unknown, req: string | null): string =>
      `SELECT plataforma.empresa_salvar_ficha('${tenant}', '${JSON.stringify(ficha)}'::jsonb, ${
        req === null ? 'NULL' : `'${req}'`
      });`;
    const sqlTrocar = (tenant: string, cnpj: string, req: string | null): string =>
      `SELECT plataforma.empresa_trocar_cnpj('${tenant}', '${cnpj}', ${req === null ? 'NULL' : `'${req}'`});`;
    const salvar = (sessao: string, tenant: string, ficha: unknown, req: string | null): Salvamento =>
      JSON.parse(comoConfig(sessao, sqlSalvar(tenant, ficha, req))[0] ?? 'null') as Salvamento;
    const trocar = (sessao: string, tenant: string, cnpj: string, req: string | null): Troca =>
      JSON.parse(comoConfig(sessao, sqlTrocar(tenant, cnpj, req))[0] ?? 'null') as Troca;
    const eventos = (filtro = 'true'): Record<string, unknown>[] =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT id, tenant_id, agregado_id, versao::int AS versao, payload,
         ocorrido_em = proximo_em AS proximo_igual, publicado_em IS NULL AS pendente
       FROM plataforma.evento WHERE nome = 'core.empresa.cnpj_alterado@1' AND ${filtro} ORDER BY ocorrido_em, id`,
      );
    const recusaConfig = (sessao: string | null, sql: string, codigo: string, padrao: RegExp): void =>
      recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });
    const novaSessao = (): string => {
      const id = randomUUID();
      executar(
        banco.conexao,
        // hora-fixa-ok: a sessão só precisa estar válida agora; o instante fixo é o consultado_em no futuro (recusa).
        `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ('${id}', '${SA}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
      return id;
    };
    const auditoria = (acao: string, tenant?: string): Record<string, unknown>[] =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT tenant_id, superadmin_id, entidade, request_id, antes, depois FROM plataforma.auditoria
       WHERE acao = '${acao}'${tenant ? ` AND tenant_id = '${tenant}'` : ''} ORDER BY ocorrido_em, id`,
      );
    const empresaDe = (tenant: string): Record<string, unknown> =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        // hora-fixa-ok: só confere que o consultado_em é de agora (fonte manual sem data).
        `SELECT cnpj, razao_social, ie, email, telefone, cep, uf, cnae_principal, cnae_secundarios, receita_fonte,
         receita_consultada_em > now() - interval '1 minute' AS consultada_agora, updated_at::text AS updated_at
       FROM core.empresa WHERE tenant_id = '${tenant}'`,
      )[0] ?? {};
    const temNfe = (tenant: string): boolean =>
      consultar<{ v: boolean }>(
        banco.conexao,
        `SELECT faturamento.tem_nfe_autorizada_producao('${tenant}') AS v`,
      )[0]?.v ?? false;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        `${fixturePlataforma(A)}${fixtureModulos(A)}${fixturePlataforma(C)}${fixturePlataforma(D)}${fixtureModulos(D)}
${fixturePlataforma(E)}${fixtureModulos(E)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0077@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
UPDATE core.empresa SET email = '${EMAIL}', telefone = '${TELEFONE}' WHERE tenant_id = '${A.id}';`,
      );
      rodarScript(
        banco.conexao,
        semTriggers(`${notaSql(D, 'producao', 'autorizada', 1)}
${notaSql(E, 'homologacao', 'autorizada', 1)}
${notaSql(E, 'producao', 'rascunho', 2)}`),
        { transacao: true },
      );
    });

    afterAll(() => banco?.remover());

    it('privilégios: salvar e trocar só do config; cnpj_valido e tem_nfe sem EXECUTE para PUBLIC, app e config', () => {
      for (const f of [SALVAR, TROCAR, DV, TEM_NFE]) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
           has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
           has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker,
           has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
        );
        expect({ f, ...r }).toEqual({
          f,
          definer: true,
          cfg: 'search_path=pg_catalog, pg_temp',
          comentado: true,
          publico: false,
          app: false,
          worker: false,
          leitura: false,
          config: f === SALVAR || f === TROCAR,
        });
      }
    });

    it("CHECK da fonte: aceita 'manual' e as da consulta; outra = 23514", () => {
      executar(
        banco.conexao,
        `UPDATE core.empresa SET receita_fonte = 'manual' WHERE tenant_id = '${C.id}';`,
      );
      recusaDetalhada(
        banco.conexao,
        `UPDATE core.empresa SET receita_fonte = 'outra' WHERE tenant_id = '${A.id}';`,
        '23514',
        /empresa_receita_fonte_check/,
      );
      const [r] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'core.empresa'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%receita_fonte%'`,
      );
      expect(r?.n).toBe(1);
    });

    it('cnpj_valido: DV numérico e alfanumérico; DV errado, formato errado e todos iguais = false', () => {
      const [r] = consultar<Record<string, boolean>>(
        banco.conexao,
        `SELECT plataforma.cnpj_valido('${CNPJ_MASSA}') AS a, plataforma.cnpj_valido('${CNPJ_NOVO}') AS b,
         plataforma.cnpj_valido('12ABC34501DE35') AS alfa, plataforma.cnpj_valido('11222333000182') AS dv,
         plataforma.cnpj_valido('1122233300018') AS curto, plataforma.cnpj_valido('11111111111111') AS iguais,
         coalesce(plataforma.cnpj_valido(NULL), false) AS nulo`,
      );
      expect(r).toEqual({
        a: true,
        b: true,
        alfa: true,
        dv: false,
        curto: false,
        iguais: false,
        nulo: false,
      });
    });

    it('salvar manual: normaliza, grava fonte manual e consultado_em = now(), devolve {ficha, alterados} e audita só nomes e contagem', () => {
      const s = novaSessao();
      const r = salvar(
        s,
        A.id,
        {
          razao_social: '  Empresa   Ficticia A  LTDA ',
          ie: '04.123.456-7',
          cep: '69.005-000',
          uf: 'am',
          cnae_principal: '4713-0/02',
          cnae_secundarios: ['4713002', 111302, '0111302'],
          fonte: 'manual',
        },
        'req-salvar-1',
      );
      expect(r.alterados).toEqual(['cep', 'cnae_principal', 'cnae_secundarios', 'ie', 'razao_social', 'uf']);
      expect(r.ficha).toMatchObject({ ie: '041234567', cep: '69005000', uf: 'AM', receita_fonte: 'manual' });
      expect(empresaDe(A.id)).toMatchObject({
        razao_social: 'Empresa Ficticia A LTDA',
        cnae_principal: '4713002',
        cnae_secundarios: ['4713002', '0111302'],
        receita_fonte: 'manual',
        consultada_agora: true,
        // email e telefone ausentes: mantém o que está salvo.
        email: EMAIL,
        telefone: TELEFONE,
        cnpj: CNPJ_MASSA,
      });
      const aud = auditoria(ACAO_SALVAR, A.id);
      expect(aud).toEqual([
        {
          tenant_id: A.id,
          superadmin_id: SA,
          entidade: 'empresa',
          request_id: 'req-salvar-1',
          antes: null,
          depois: { campos: r.alterados, quantidade: 6 },
        },
      ]);
      // consultado_em explícito com 'manual' é aceito sem consulta anterior.
      expect(
        // hora-fixa-ok: o instante só precisa ser "agora", nunca é comparado.
        salvar(s, A.id, { fonte: 'manual', consultado_em: new Date().toISOString() }, null).alterados,
      ).toEqual([]);
    });

    it('salvar é idempotente pelo request_id e, sem mudança, devolve alterados=[] sem auditar nem tocar a linha', () => {
      const s = novaSessao();
      const antes = empresaDe(A.id);
      const n = auditoria(ACAO_SALVAR).length;
      // Mesmo request_id com outra ficha: nada muda, devolve o que a primeira gravou.
      const rep = salvar(s, A.id, { bairro: 'Outro', fonte: 'manual' }, 'req-salvar-1');
      expect(rep.alterados).toEqual([
        'cep',
        'cnae_principal',
        'cnae_secundarios',
        'ie',
        'razao_social',
        'uf',
      ]);
      const igual = salvar(s, A.id, { cep: '69005000', uf: 'AM', fonte: 'brasilapi' }, 'req-salvar-2');
      expect(igual.alterados).toEqual([]);
      expect(empresaDe(A.id)).toEqual(antes);
      expect(auditoria(ACAO_SALVAR)).toHaveLength(n);
    });

    it('salvar: email e telefone presentes gravam; null apaga; razão social é obrigatória', () => {
      const s = novaSessao();
      expect(
        salvar(s, A.id, { email: ' Novo.Ficticio@Empresa-A.teste ', telefone: null, fonte: 'manual' }, null)
          .alterados,
      ).toEqual(['email', 'telefone']);
      expect(empresaDe(A.id)).toMatchObject({ email: 'novo.ficticio@empresa-a.teste', telefone: null });
      recusaConfig(
        s,
        sqlSalvar(A.id, { razao_social: ' ', fonte: 'manual' }, null),
        '23514',
        /obrigatório: razao_social/,
      );
      salvar(s, A.id, { email: EMAIL, telefone: TELEFONE, fonte: 'manual' }, null);
    });

    it('salvar recusa: 23514 fora da lista (cnpj inclusive), inválido só com o nome do campo; 55000; P0002; MXS01; sem auditoria', () => {
      const s = novaSessao();
      const n = auditoria(ACAO_SALVAR).length;
      recusaConfig(
        s,
        sqlSalvar(A.id, { fonte: 'manual', cnpj: CNPJ_NOVO }, null),
        '23514',
        /fora da lista fechada da ficha: cnpj/,
      );
      recusaConfig(
        s,
        sqlSalvar(A.id, { fonte: 'manual', ambiente: 'producao' }, null),
        '23514',
        /fora da lista.*ambiente/,
      );
      recusaConfig(s, sqlSalvar(A.id, { email: EMAIL }, null), '23514', /fonte inválida/);
      recusaConfig(s, sqlSalvar(A.id, { fonte: 'outra' }, null), '23514', /fonte inválida/);
      recusaConfig(
        s,
        sqlSalvar(A.id, { fonte: 'manual', consultado_em: '2999-01-01T00:00:00Z' }, null),
        '23514',
        /futuro/,
      );
      for (const [campo, valor] of [
        ['cep', 'abc'],
        ['municipio_ibge', '123'],
        ['uf', 'XX'],
        ['email', 'sem-arroba'],
        ['telefone', '123'],
        ['cnae_principal', '12'],
        ['regime_receita', 'lucro'],
        ['data_abertura', '2026-02-31'],
        ['ie', 'ABC'],
        ['cnae_secundarios', ['4713002', 'x']],
        ['logradouro', 'x'.repeat(121)],
      ] as const) {
        recusaConfig(
          s,
          sqlSalvar(A.id, { fonte: 'manual', [campo]: valor }, null),
          '23514',
          new RegExp(`: ${campo}$`, 'm'),
        );
      }
      const e = (() => {
        try {
          comoConfig(s, sqlSalvar(A.id, { fonte: 'manual', email: 'valor-secreto' }, null));
          return '';
        } catch (x) {
          return String((x as Error).message);
        }
      })();
      expect(e).not.toContain('valor-secreto');
      recusaConfig(s, sqlSalvar(C.id, { fonte: 'manual' }, null), '55000', /não tem cadastro/);
      recusaConfig(s, sqlSalvar(randomUUID(), { fonte: 'manual' }, null), 'P0002', /não encontrada/);
      recusaConfig(null, sqlSalvar(A.id, { fonte: 'manual' }, null), 'MXS01', /inválida/);
      expect(auditoria(ACAO_SALVAR)).toHaveLength(n);
    });

    it('tem_nfe_autorizada_producao: true só com os 5 status de STATUS_NFE_QUE_TRAVA_TROCA_CNPJ em produção, não excluída', () => {
      expect(temNfe(D.id)).toBe(true);
      expect(temNfe(E.id)).toBe(false);
      expect(temNfe(A.id)).toBe(false);
      const caso = (
        status: Status,
        ambiente: 'homologacao' | 'producao',
        numero: number,
        excluida = false,
      ): boolean =>
        linhas(
          rodarScript(
            banco.conexao,
            semTriggers(`${notaSql(A, ambiente, status, numero)}
${excluida ? `UPDATE faturamento.nota SET deleted_at = '2026-11-01T00:00:00Z' WHERE tenant_id = '${A.id}';` : ''}
SELECT faturamento.tem_nfe_autorizada_producao('${A.id}');
DELETE FROM faturamento.nota WHERE tenant_id = '${A.id}';`),
            { transacao: true },
          ),
        ).includes('t');
      let numero = 100;
      for (const status of BLOQUEIAM) {
        expect({ status, producao: caso(status, 'producao', numero++) }).toEqual({ status, producao: true });
        expect({ status, homologacao: caso(status, 'homologacao', numero++) }).toEqual({
          status,
          homologacao: false,
        });
        expect({ status, excluida: caso(status, 'producao', numero++, true) }).toEqual({
          status,
          excluida: false,
        });
      }
      for (const status of NAO_BLOQUEIAM) {
        expect({ status, producao: caso(status, 'producao', numero++) }).toEqual({ status, producao: false });
      }
      expect(temNfe(A.id)).toBe(false);
    });

    it('trocar: valida o DV (23514), MXC05 com NF-e de produção, MXC06 igual ao atual; 55000, P0002, MXS01; nada auditado', () => {
      const s = novaSessao();
      recusaConfig(s, sqlTrocar(A.id, '11222333000182', null), '23514', /CNPJ inválido/);
      recusaConfig(s, sqlTrocar(A.id, 'abc', null), '23514', /CNPJ inválido/);
      recusaConfig(s, sqlTrocar(D.id, CNPJ_NOVO, null), 'MXC05', /NF-e autorizada em produção/);
      recusaConfig(s, sqlTrocar(A.id, '12.345.678/0001-95', null), 'MXC06', /igual ao atual/);
      recusaConfig(s, sqlTrocar(C.id, CNPJ_NOVO, null), '55000', /não tem cadastro/);
      recusaConfig(s, sqlTrocar(randomUUID(), CNPJ_NOVO, null), 'P0002', /não encontrada/);
      recusaConfig(null, sqlTrocar(A.id, CNPJ_NOVO, null), 'MXS01', /inválida/);
      expect(empresaDe(D.id)).toMatchObject({ cnpj: CNPJ_MASSA });
      expect(auditoria(ACAO_TROCAR)).toEqual([]);
      expect(eventos()).toEqual([]);
    });

    it('trocar: grava só core.empresa (filial intacta), 1 evento no outbox do tenant, auditoria sem CNPJ e idempotente', () => {
      const s = novaSessao();
      // Mesma transação: se ela cai depois da troca, nem o UPDATE nem o evento nem a auditoria ficam.
      recusaConfig(
        s,
        `${sqlTrocar(E.id, CNPJ_NOVO, 'req-rollback')}\nSELECT 1 / 0;`,
        '22012',
        /division by zero/,
      );
      expect(empresaDe(E.id)).toMatchObject({ cnpj: CNPJ_MASSA });
      expect(eventos()).toEqual([]);
      expect(auditoria(ACAO_TROCAR)).toEqual([]);
      // E tem NF-e autorizada só em homologação e um rascunho de produção: a troca é liberada.
      const r = trocar(s, E.id, '11.222.333/0001-81', 'req-troca-1');
      expect(r).toEqual({ cnpj: CNPJ_NOVO, event_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      expect(empresaDe(E.id)).toMatchObject({ cnpj: CNPJ_NOVO });
      const [f] = consultar<{ cnpj: string }>(
        banco.conexao,
        `SELECT cnpj FROM cadastros.filial WHERE id = '${E.filial}'`,
      );
      expect(f?.cnpj).toBe(CNPJ_MASSA);
      const [empresa] = consultar<{ id: string }>(
        banco.conexao,
        `SELECT id FROM core.empresa WHERE tenant_id = '${E.id}'`,
      );
      const ev = eventos();
      expect(ev).toEqual([
        {
          id: r.event_id,
          tenant_id: E.id,
          agregado_id: empresa?.id,
          versao: 1,
          proximo_igual: true,
          pendente: true,
          payload: {
            ator: 'sistema',
            request_id: 'req-troca-1',
            payload: {
              tenant_id: E.id,
              empresa_id: empresa?.id,
              cnpj_novo: CNPJ_NOVO,
              request_id: 'req-troca-1',
              alterado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
            },
          },
        },
      ]);
      // Repetição: o mesmo event_id, sem outro evento nem outra auditoria.
      expect(trocar(s, E.id, '12ABC34501DE35', 'req-troca-1')).toEqual(r);
      expect(eventos()).toHaveLength(1);
      const aud = auditoria(ACAO_TROCAR);
      expect(aud).toEqual([
        {
          tenant_id: E.id,
          superadmin_id: SA,
          entidade: 'empresa',
          request_id: 'req-troca-1',
          antes: null,
          depois: { event_id: r.event_id },
        },
      ]);
      const todas = JSON.stringify(auditoria(ACAO_TROCAR).concat(auditoria(ACAO_SALVAR)));
      for (const valor of [CNPJ_MASSA, CNPJ_NOVO, EMAIL, TELEFONE, '69005000'])
        expect(todas).not.toContain(valor);
    });

    it('carga da 0077: um evento por core.empresa viva com CNPJ; excluída não entra; rodar de novo não duplica', () => {
      executar(banco.conexao, `UPDATE core.empresa SET deleted_at = '2026-11-01T00:00:00Z' WHERE tenant_id = '${D.id}';`);
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      const vivas = consultar<{ id: string; tenant_id: string; cnpj: string }>(
        banco.conexao,
        `SELECT id, tenant_id, cnpj FROM core.empresa WHERE deleted_at IS NULL ORDER BY id`,
      );
      const carga = (): Record<string, unknown>[] =>
        eventos(`payload ->> 'request_id' LIKE 'migracao-0077:%'`);
      const primeira = carga();
      expect(primeira.map((e) => e.agregado_id).sort()).toEqual(vivas.map((v) => v.id));
      for (const v of vivas) {
        const e = primeira.find((x) => x.agregado_id === v.id);
        expect(e).toMatchObject({
          tenant_id: v.tenant_id,
          payload: {
            ator: 'sistema',
            request_id: `migracao-0077:${v.id}`,
            payload: {
              tenant_id: v.tenant_id,
              empresa_id: v.id,
              cnpj_novo: v.cnpj,
              request_id: `migracao-0077:${v.id}`,
            },
          },
        });
      }
      // E já tinha o evento da troca (versão 1): o da carga é a versão 2 do mesmo agregado.
      expect(primeira.find((x) => x.tenant_id === E.id)).toMatchObject({ versao: 2 });
      expect(primeira.some((x) => x.tenant_id === D.id)).toBe(false);
      rodarScript(banco.conexao, sql, { transacao: true });
      expect(carga()).toEqual(primeira);
      executar(banco.conexao, `UPDATE core.empresa SET deleted_at = NULL WHERE tenant_id = '${D.id}';`);
    });

    it('a 0077 reexecuta duas vezes sem erro, sem CHECK duplicado e com os mesmos privilégios', () => {
      const contar = (): Record<string, unknown> | undefined =>
        consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'core.empresa'::regclass AND contype = 'c') AS checks,
           has_function_privilege('${CONFIG}', '${SALVAR}', 'EXECUTE') AS salvar,
           has_function_privilege('${CONFIG}', '${TROCAR}', 'EXECUTE') AS trocar,
           has_function_privilege('macuxierp_app', '${TEM_NFE}', 'EXECUTE') AS app`,
        )[0];
      const antes = contar();
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      expect(contar()).toEqual(antes);
      expect(empresaDe(E.id)).toMatchObject({ cnpj: CNPJ_NOVO });
      expect(eventos(`tenant_id = '${D.id}'`)).toHaveLength(1);
    });
  },
);
