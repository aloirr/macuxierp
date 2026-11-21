/**
 * T-0003, lote 2: core e cadastros — vazamento entre tenants em todas as tabelas, FKs compostas presas ao tenant,
 * certificado A1 (só o worker lê o cifrado; a leitura não vê a tabela), produção fiscal só com aprovação (RN-CORE-08),
 * movimento de estoque só de inserção e D8 (a filial guarda só série e número inicial).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  falha,
  executar,
  PG_DISPONIVEL,
  permitirSetRole,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const A = novoTenant('modulos-a');
const B = novoTenant('modulos-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — core e cadastros (T-0003, lote 2)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('não vaza entre tenants em nenhuma tabela de core e cadastros, para nenhum papel', () => {
    expect(verificarVazamento(banco.conexao, ['core', 'cadastros'], A.id, B.id)).toEqual([]);
  });

  it('cadastro não aponta para cadastro de outro tenant (FK com tenant_id)', () => {
    const erro = falha(() =>
      executar(
        banco.conexao,
        `INSERT INTO cadastros.cliente_contato (tenant_id, cliente_id, nome) VALUES ('${A.id}', '${B.cliente}', 'X');`,
        APP_A,
      ),
    );
    expect(erro).toMatch(/foreign key/);
  });

  it('certificado A1: o app grava e lê só o resumo; o worker lê o cifrado; a leitura não vê a tabela', () => {
    expect(consultar(banco.conexao, 'SELECT titular, ativo FROM core.certificado', APP_A)).toEqual([
      { titular: 'TITULAR FICTICIO', ativo: true },
    ]);
    expect(falha(() => consultar(banco.conexao, 'SELECT pfx_cifrado FROM core.certificado', APP_A))).toMatch(
      /permission denied/,
    );
    expect(falha(() => consultar(banco.conexao, 'SELECT * FROM core.certificado', APP_A))).toMatch(
      /permission denied/,
    );
    expect(
      falha(() => executar(banco.conexao, `UPDATE core.certificado SET pfx_cifrado = '\\x01';`, APP_A)),
    ).toMatch(/permission denied/);
    const [cifrado] = consultar<{ n: number }>(
      banco.conexao,
      'SELECT length(pfx_cifrado) AS n FROM core.certificado',
      { papel: 'macuxierp_worker', tenant: A.id },
    );
    expect(cifrado?.n).toBe(1);
    expect(
      falha(() =>
        consultar(banco.conexao, 'SELECT titular FROM core.certificado', {
          papel: 'macuxierp_leitura',
          tenant: A.id,
        }),
      ),
    ).toMatch(/permission denied/);
  });

  it('certificado A1: o worker atualiza só as colunas de controle, nunca o cifrado', () => {
    const worker = { papel: 'macuxierp_worker', tenant: B.id };
    expect(
      falha(() => executar(banco.conexao, `UPDATE core.certificado SET pfx_cifrado = '\\x01';`, worker)),
    ).toMatch(/permission denied/);
    expect(
      falha(() => executar(banco.conexao, `UPDATE core.certificado SET senha_cifrada = '\\x01';`, worker)),
    ).toMatch(/permission denied/);
    executar(
      banco.conexao,
      'UPDATE core.certificado SET ativo = ativo, substituido_em = substituido_em;',
      worker,
    );
  });

  it('filial_resumo (filiaisPorIds, T-0004): id, nome e CNPJ só do próprio tenant, sem a excluída', () => {
    const sql = `SELECT id, tenant_id, nome, cnpj FROM cadastros.filial_resumo WHERE id IN ('${A.filial}', '${B.filial}')`;
    expect(consultar(banco.conexao, sql, APP_A)).toEqual([
      { id: A.filial, tenant_id: A.id, nome: 'Filial modulos-a', cnpj: '12345678000195' },
    ]);
    expect(consultar(banco.conexao, sql, { papel: 'macuxierp_app' })).toEqual([]);
    expect(falha(() => consultar(banco.conexao, sql, { papel: 'macuxierp_leitura', tenant: A.id }))).toMatch(
      /permission denied/,
    );
  });

  it('documento PJ do cliente segue o plataforma.cnpj; PF, 11 dígitos', () => {
    const inserir = (tipo: string, doc: string) =>
      `INSERT INTO cadastros.cliente (tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, filial_id)
       VALUES ('${A.id}', '${tipo}', '${doc}', '9', 'Outro cliente', '${A.filial}');`;
    expect(falha(() => executar(banco.conexao, inserir('PJ', '12345678901'), APP_A))).toMatch(
      /cliente_documento_formato/,
    );
    expect(falha(() => executar(banco.conexao, inserir('PF', '12345678000195'), APP_A))).toMatch(
      /cliente_documento_formato/,
    );
    executar(banco.conexao, inserir('PF', '12345678909'), APP_A);
    executar(banco.conexao, inserir('PJ', '12ABC34501DE35'), APP_A);
  });

  it('um certificado ativo por filial', () => {
    const novo = `INSERT INTO core.certificado (tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital,
      pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce) VALUES ('${A.id}', '${A.filial}', 'NOVO', '12345678000195', now(),
      now() + interval '1 year', repeat('f', 64), '\\x00', decode(repeat('03', 12), 'hex'), '\\x00', decode(repeat('04', 12), 'hex'));`;
    expect(falha(() => executar(banco.conexao, novo, APP_A))).toMatch(/duplicate key/);
    executar(
      banco.conexao,
      `UPDATE core.certificado SET ativo = false, substituido_em = now() WHERE ativo;\n${novo}`,
      APP_A,
    );
  });

  it('produção fiscal só com o recado de aprovação do Alexandre (RN-CORE-08, regra 7)', () => {
    expect(
      falha(() => executar(banco.conexao, `UPDATE core.ambiente_fiscal SET ambiente = 'producao';`, APP_A)),
    ).toMatch(/ambiente_producao_aprovada/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE core.ambiente_fiscal SET ambiente = 'producao', recado_aprovacao = 'R-20261121-120000-gerente';`,
          APP_A,
        ),
      ),
    ).toMatch(/ambiente_producao_aprovada/);
    executar(
      banco.conexao,
      `UPDATE core.ambiente_fiscal SET ambiente = 'producao', recado_aprovacao = 'R-20261121-120000-alexandre';`,
      APP_A,
    );
  });

  it('movimento de estoque é só de inserção; o app não apaga cadastro (exclusão = deleted_at)', () => {
    expect(
      falha(() => executar(banco.conexao, 'UPDATE cadastros.estoque_movimento SET motivo = motivo;')),
    ).toMatch(/só de inserção/);
    expect(falha(() => executar(banco.conexao, 'DELETE FROM cadastros.cliente;', APP_A))).toMatch(
      /permission denied/,
    );
    executar(
      banco.conexao,
      `UPDATE cadastros.cliente SET deleted_at = now() WHERE id = '${A.cliente}';`,
      APP_A,
    );
  });

  it('D8: a filial guarda só série e número inicial da NF-e (a numeração é do faturamento)', () => {
    const colunas = consultar<{ c: string }>(
      banco.conexao,
      `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'cadastros' AND table_name = 'filial'
       AND column_name LIKE 'nfe%' ORDER BY 1`,
    ).map((r) => r.c);
    expect(colunas).toEqual(['nfe_numero_inicial', 'nfe_serie']);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE cadastros.filial SET nfe_serie = 1000 WHERE id = '${A.filial}';`,
          APP_A,
        ),
      ),
    ).toMatch(/check constraint/);
  });

  it('uma filial padrão e uma tabela de preço padrão por tenant; preço em centavos não negativo', () => {
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO cadastros.tabela_preco (tenant_id, nome, vigencia_inicio, padrao) VALUES ('${A.id}', 'Outra', '2026-01-01', true);`,
          APP_A,
        ),
      ),
    ).toMatch(/duplicate key/);
    expect(
      falha(() =>
        executar(banco.conexao, `UPDATE cadastros.tabela_preco_item SET preco_centavos = -1;`, APP_A),
      ),
    ).toMatch(/check constraint/);
  });

  it('o cache de consulta externa nunca guarda CPF', () => {
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO cadastros.consulta_externa (tenant_id, tipo, chave, resposta, fonte)
           VALUES ('${A.id}', 'cnpj', '12345678901', '{}', 'brasilapi');`,
          APP_A,
        ),
      ),
    ).toMatch(/consulta_externa_chave/);
  });
});
