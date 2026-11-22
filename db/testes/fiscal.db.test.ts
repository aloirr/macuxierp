/**
 * T-0019 (F4), alinhado à T-0020: schema fiscal (migração 0013) — vazamento entre tenants, privilégios (sem DELETE),
 * CST ou CSOSN pelo CRT (RN-FIS-02), cadastro repetido recusado (RN-FIS-01), fonte e vigência obrigatórias
 * (RN-FIS-04), linhas por tributo (lote 2) e carga aproximada geral (tenant de referência) lida por todos os tenants
 * e gravada só pelo dono.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  PAPEIS_APP,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
} from './apoio.ts';
import {
  fixtureCargaGeral,
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  novoTenant,
  regraTributaria,
} from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const A = novoTenant('fiscal-a');
const B = novoTenant('fiscal-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const APP_B = { papel: 'macuxierp_app', tenant: B.id };

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — fiscal (T-0019, T-0020)', () => {
  let banco: BancoDeTeste;
  let REFERENCIA = '';

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t)).join('\n') +
        fixtureCargaGeral(),
    );
    REFERENCIA =
      consultar<{ r: string }>(banco.conexao, 'SELECT plataforma.tenant_referencia() AS r')[0]?.r ?? '';
  });

  afterAll(() => banco?.remover());

  it('não vaza entre tenants no schema fiscal, para nenhum papel', () => {
    expect(verificarVazamento(banco.conexao, ['fiscal'], A.id, B.id)).toEqual([]);
  });

  it('privilégios: app lê, cria e altera (sem DELETE); leitura só lê; o worker não acessa', () => {
    const esperado: Record<string, string> = {
      macuxierp_app: 'SIU',
      macuxierp_worker: '-',
      macuxierp_leitura: 'S',
    };
    for (const tabela of ['fiscal.regra_tributaria', 'fiscal.carga_aproximada']) {
      for (const papel of PAPEIS_APP) {
        expect({ papel, tabela, p: privilegiosDe(banco.conexao, papel, tabela) }).toEqual({
          papel,
          tabela,
          p: esperado[papel],
        });
      }
    }
    expect(
      falha(() => executar(banco.conexao, regraTributaria(), { papel: 'macuxierp_worker', tenant: A.id })),
    ).toMatch(/permission denied/);
  });

  it('o app grava a regra só no próprio tenant', () => {
    executar(banco.conexao, regraTributaria(), APP_A);
    expect(falha(() => executar(banco.conexao, regraTributaria({ tenant_id: `'${B.id}'` }), APP_A))).toMatch(
      /row-level security/,
    );
  });

  it('RN-FIS-02: CSOSN (3 dígitos) no Simples e no MEI, CST (2) no regime normal', () => {
    expect(falha(() => executar(banco.conexao, regraTributaria({ crt: '1', uf_destino: `'RR'` }), APP_A))).toMatch(
      /regra_tributaria_cst_ou_csosn/,
    );
    executar(
      banco.conexao,
      regraTributaria({ crt: '1', uf_destino: `'RR'`, codigo: `'102'`, aliquota_icms: 'NULL', p_cred_sn: '125000' }),
      APP_A,
    );
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ crt: '2', uf_destino: `'RR'`, codigo: `'102'` }), APP_A)),
    ).toMatch(/regra_tributaria_cst_ou_csosn/);
    expect(falha(() => executar(banco.conexao, regraTributaria({ crt: '5', uf_destino: `'RO'` }), APP_A))).toMatch(
      /check constraint/,
    );
  });

  it('RN-FIS-01: mesmos filtros e mesmo início de vigência é cadastro repetido; outra vigência passa', () => {
    const filtros = { uf_destino: `'AC'`, ncm_prefixo: `'2202'`, tipo_cliente: `'contribuinte'` };
    executar(banco.conexao, regraTributaria(filtros), APP_A);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ ...filtros, aliquota_icms: '70000' }), APP_A)),
    ).toMatch(/regra_tributaria_filtros_uq/);
    executar(banco.conexao, regraTributaria({ ...filtros, vigencia_inicio: `'2027-01-01'` }), APP_A);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ uf_destino: `'AC'`, ncm_prefixo: `'2'` }), APP_A)),
    ).toMatch(/check constraint/);
  });

  it('RN-FIS-03 e 04: IBS/CBS com CST e cClassTrib juntos; fonte e vigência obrigatórias e coerentes', () => {
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ uf_destino: `'AP'`, cst_ibs_cbs: `'000'` }), APP_A)),
    ).toMatch(/regra_tributaria_ibs_cbs_par/);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ uf_destino: `'AP'`, fonte_referencia: 'OMITIR' }), APP_A)),
    ).toMatch(/null value/);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ uf_destino: `'AP'`, fonte_tipo: `'portaria'` }), APP_A)),
    ).toMatch(/check constraint/);
    expect(
      falha(() =>
        executar(banco.conexao, regraTributaria({ uf_destino: `'AP'`, vigencia_fim: `'2025-12-31'` }), APP_A),
      ),
    ).toMatch(/regra_tributaria_vigencia/);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ uf_destino: `'AP'`, aliquota_icms: '1000001' }), APP_A)),
    ).toMatch(/check constraint/);
  });

  it('lote 2: a linha do ICMS exige o código; as de IPI, PIS e COFINS usam só o próprio tributo', () => {
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ uf_destino: `'SE'`, codigo: 'NULL' }), APP_A)),
    ).toMatch(/regra_tributaria_icms_com_codigo/);
    const ipi = {
      tributo: `'ipi'`,
      uf_destino: `'SE'`,
      codigo: 'OMITIR',
      aliquota_icms: 'OMITIR',
      cst_pis: 'OMITIR',
      cst_cofins: 'OMITIR',
      cst_ipi: `'50'`,
      aliquota_ipi: '65000',
    };
    executar(banco.conexao, regraTributaria(ipi), APP_A);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ ...ipi, uf_destino: `'SP'`, cst_pis: `'01'` }), APP_A)),
    ).toMatch(/regra_tributaria_so_o_tributo/);
    expect(
      falha(() => executar(banco.conexao, regraTributaria({ ...ipi, uf_destino: `'SP'`, codigo: `'00'` }), APP_A)),
    ).toMatch(/regra_tributaria_so_o_tributo/);
    executar(
      banco.conexao,
      regraTributaria({
        tributo: `'pis'`,
        uf_destino: `'SE'`,
        codigo: 'OMITIR',
        aliquota_icms: 'OMITIR',
        cst_cofins: 'OMITIR',
        cst_pis: `'03'`,
        valor_unidade_pis: '1411', // R$ 0,1411 por unidade: escala 4 (décimos de milésimo de real), não centavos
      }),
      APP_A,
    );
    executar(banco.conexao, regraTributaria({ uf_destino: `'MG'`, excluir_icms_bc: 'true' }), APP_A);
    expect(
      consultar(
        banco.conexao,
        `SELECT column_name AS c, column_default AS d FROM information_schema.columns
         WHERE table_schema = 'cadastros' AND table_name = 'filial' AND column_name = 'industrial_ipi'`,
      ),
    ).toEqual([{ c: 'industrial_ipi', d: 'false' }]);
  });

  it('IBS/CBS e IS em linhas dedicadas; campo de IS ou IBS/CBS fora da própria linha é recusado', () => {
    const dedicada = {
      uf_destino: `'BA'`,
      codigo: 'OMITIR',
      aliquota_icms: 'OMITIR',
      cst_pis: 'OMITIR',
      cst_cofins: 'OMITIR',
    };
    executar(
      banco.conexao,
      regraTributaria({
        ...dedicada,
        tributo: `'ibs_cbs'`,
        cst_ibs_cbs: `'000'`,
        c_class_trib: `'000001'`,
        p_cbs: '9000',
      }),
      APP_A,
    );
    executar(
      banco.conexao,
      regraTributaria({
        ...dedicada,
        tributo: `'is'`,
        cst_is: `'000'`,
        c_class_trib_is: `'000001'`,
        p_is: '100000',
        valor_unidade_is: '1411',
      }),
      APP_A,
    );
    expect(
      consultar(
        banco.conexao,
        `SELECT tributo, p_is, valor_unidade_is AS v, pg_typeof(valor_unidade_is)::text AS t
         FROM fiscal.regra_tributaria WHERE uf_destino = 'BA' AND tributo = 'is'`,
        APP_A,
      ),
    ).toEqual([{ tributo: 'is', p_is: 100000, v: 1411, t: 'bigint' }]);
    const pis = { ...dedicada, uf_destino: `'PE'`, tributo: `'pis'`, cst_pis: `'01'`, aliquota_pis: '16500' };
    expect(falha(() => executar(banco.conexao, regraTributaria({ ...pis, p_is: '100000' }), APP_A))).toMatch(
      /regra_tributaria_so_o_tributo/,
    );
    expect(falha(() => executar(banco.conexao, regraTributaria({ ...pis, valor_unidade_is: '1411' }), APP_A))).toMatch(
      /regra_tributaria_so_o_tributo/,
    );
    expect(
      falha(() =>
        executar(banco.conexao, regraTributaria({ ...pis, cst_ibs_cbs: `'000'`, c_class_trib: `'000001'` }), APP_A),
      ),
    ).toMatch(/regra_tributaria_so_o_tributo/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          regraTributaria({ ...dedicada, uf_destino: `'PE'`, tributo: `'is'`, p_cbs: '9000' }),
          APP_A,
        ),
      ),
    ).toMatch(/regra_tributaria_so_o_tributo/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          regraTributaria({ ...dedicada, uf_destino: `'PE'`, tributo: `'is'`, cst_is: `'000'` }),
          APP_A,
        ),
      ),
    ).toMatch(/regra_tributaria_is_par/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          regraTributaria({
            ...dedicada,
            uf_destino: `'PE'`,
            tributo: `'is'`,
            cst_is: `'00'`,
            c_class_trib_is: `'000001'`,
          }),
          APP_A,
        ),
      ),
    ).toMatch(/check constraint/);
    // Linha única do ICMS (CRT 3, com PIS e COFINS) pode trazer IBS/CBS e IS juntos.
    executar(
      banco.conexao,
      regraTributaria({
        uf_destino: `'PE'`,
        cst_ibs_cbs: `'000'`,
        c_class_trib: `'000001'`,
        cst_is: `'000'`,
        c_class_trib_is: `'000001'`,
        valor_unidade_is: '500',
      }),
      APP_A,
    );
    expect(
      falha(() =>
        executar(banco.conexao, regraTributaria({ ...dedicada, uf_destino: `'PE'`, tributo: `'iss'` }), APP_A),
      ),
    ).toMatch(/check constraint/);
  });

  describe('carga aproximada (IBPT)', () => {
    const sqlCarga = (tenant: string, uf = 'AM') =>
      `INSERT INTO fiscal.carga_aproximada (tenant_id, ncm, uf, aliquota_federal_nacional, vigencia_inicio, versao,
         fonte) VALUES (${tenant}, '22030000', '${uf}', 100000, '2026-01-01', '26.1.A', 'IBPT');`;

    it('a linha geral (tenant de referência) é lida pelos dois tenants, ao lado da própria; sem tenant, nada', () => {
      const ler = (ctx: { papel: string; tenant: string | null }) =>
        consultar<{ dono: string; federal: number }>(
          banco.conexao,
          `SELECT CASE WHEN tenant_id = plataforma.tenant_referencia() THEN 'geral' ELSE 'proprio' END AS dono,
             aliquota_federal_nacional AS federal FROM fiscal.carga_aproximada
           WHERE ncm = '22021000' AND uf = 'AM' AND vigencia_inicio <= '2026-11-21' ORDER BY 1`,
          ctx,
        );
      expect(ler(APP_A)).toEqual([
        { dono: 'geral', federal: 130000 },
        { dono: 'proprio', federal: 150000 },
      ]);
      expect(ler(APP_B)).toEqual([
        { dono: 'geral', federal: 130000 },
        { dono: 'proprio', federal: 150000 },
      ]);
      expect(ler({ papel: 'macuxierp_leitura', tenant: B.id })).toHaveLength(2);
      expect(ler({ papel: 'macuxierp_app', tenant: null })).toEqual([]);
      expect(
        consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM fiscal.carga_aproximada WHERE tenant_id = '${B.id}'`,
          APP_A,
        ),
      ).toEqual([{ n: 0 }]);
    });

    it('o app grava só no próprio tenant; a linha geral só o dono grava e altera', () => {
      executar(banco.conexao, sqlCarga('plataforma.tenant_atual()'), APP_A);
      expect(falha(() => executar(banco.conexao, sqlCarga(`'${REFERENCIA}'`, 'PA'), APP_A))).toMatch(
        /row-level security/,
      );
      // Nem com o tenant da sessão igual ao de referência.
      expect(
        falha(() =>
          executar(banco.conexao, sqlCarga(`'${REFERENCIA}'`, 'PA'), {
            papel: 'macuxierp_app',
            tenant: REFERENCIA,
          }),
        ),
      ).toMatch(/row-level security/);
      executar(
        banco.conexao,
        `UPDATE fiscal.carga_aproximada SET aliquota_estadual = 1 WHERE tenant_id = '${REFERENCIA}';`,
        APP_A,
      );
      expect(
        consultar(
          banco.conexao,
          `SELECT aliquota_estadual AS e FROM fiscal.carga_aproximada WHERE tenant_id = '${REFERENCIA}'`,
        ),
      ).toEqual([{ e: 200000 }]);
      executar(banco.conexao, sqlCarga(`'${REFERENCIA}'`, 'PA'));
      expect(falha(() => executar(banco.conexao, sqlCarga('plataforma.tenant_atual()'), APP_A))).toMatch(
        /carga_aproximada_chave_uq/,
      );
    });
  });
});
