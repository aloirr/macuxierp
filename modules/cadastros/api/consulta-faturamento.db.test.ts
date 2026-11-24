/**
 * Consulta de cadastros para o faturamento (T-0021) contra o PostgreSQL real: cada método da porta, o inativo, a série
 * diferente, o município do endereço e a RLS entre dois tenants. Mesmo banco efêmero do `sql.db.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { criarConsultaParaFaturamento } from './consulta-faturamento';
import { CNPJ_A, CNPJ_B, ENDERECO_AM, clienteValido, filialValida } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('consulta de cadastros para o faturamento (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const consulta = criarConsultaParaFaturamento(repositoriosSql);
  const adm = sessaoDe('administrador');
  const gerente = sessaoDe('gerente');
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'empresa-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'empresa-b', ['cadastros']);
    const a = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }), new Date('2026-11-21T15:00:00Z'), transacaoDe(app, A));
    const post = async (rota: string, corpo: unknown, sessao = adm) => {
      const r = await a.chamar('POST', rota, { sessao, corpo });
      expect(r.status, rota).toBe(201);
      return r.corpo as { id: string };
    };
    ids.filial = (await post('/filiais', filialValida({ nfe_serie: 2, nfe_numero_inicial: 150 }))).id;
    ids.filialSemSerie = (await post('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false, nfe_serie: null, nfe_numero_inicial: null }))).id;
    ids.condicao = (await post('/condicoes-pagamento', { codigo: '30D', descricao: '30 dias', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 }, gerente)).id;
    ids.cartao = (await post('/condicoes-pagamento', { codigo: 'CC3', descricao: 'Cartão 3x', forma_tpag: '03', prazos_dias: [30, 60, 90], prazo_medio_dias: 60 }, gerente)).id;
    ids.cliente = (await post('/clientes', clienteValido(ids.filial, {
      email_nfe: 'nfe@cliente.com.br', ind_ie_dest: '9', ie: null,
      enderecos: [{ ...ENDERECO_AM, tipo: 'entrega', numero: '1' }, { ...ENDERECO_AM, tipo: 'principal', numero: '2' }],
    }))).id;
    ids.clienteSemEmail = (await post('/clientes', clienteValido(ids.filial, { documento: CNPJ_A }))).id;
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  const txA = () => transacaoDe(app, A);
  const txB = () => transacaoDe(app, B);

  it('filial: dados da nota com CRT numérico e endereço com o nome do município', async () => {
    expect(await consulta.filial(txA(), ids.filial as string)).toEqual({
      id: ids.filial, cnpj: CNPJ_A, razao_social: 'Thathyany Comercio Ltda', nome_fantasia: 'Thathyany', ie: '012345679', crt: 1, emissora: true, nfe_serie: 2, industrial_ipi: false, regime_pis_cofins: null,
      endereco: { logradouro: 'Av. Djalma Batista', numero: '100', complemento: null, bairro: 'Chapada', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69050010' },
    });
    expect(await consulta.filial(txA(), randomUUID())).toBeNull();
  });

  it('filial inativa também volta', async () => {
    await admin("UPDATE cadastros.filial SET deleted_at = '2026-11-21T15:00:00Z' WHERE id = $1", [ids.filialSemSerie]);
    expect(await consulta.filial(txA(), ids.filialSemSerie as string)).toMatchObject({ id: ids.filialSemSerie, nfe_serie: null });
  });

  it('cliente: endereço principal (não o primeiro), município, indIEDest numérico e e-mail da NF-e; inativo volta', async () => {
    const c = await consulta.cliente(txA(), ids.cliente as string);
    expect(c).toMatchObject({ id: ids.cliente, documento: CNPJ_B, nome: 'Cliente Exemplo Ltda', ind_ie_dest: 9, ie: null, email: 'nfe@cliente.com.br' });
    expect(c?.endereco).toMatchObject({ numero: '2', municipio_ibge: '1302603', municipio_nome: 'Manaus' });
    expect(Object.keys(c as object).sort()).toEqual(['documento', 'email', 'endereco', 'id', 'ie', 'ind_ie_dest', 'nome']);
    expect(await consulta.cliente(txA(), randomUUID())).toBeNull();
    await admin("UPDATE cadastros.cliente SET deleted_at = '2026-11-21T15:00:00Z' WHERE id = $1", [ids.clienteSemEmail]);
    expect(await consulta.cliente(txA(), ids.clienteSemEmail as string)).toMatchObject({ id: ids.clienteSemEmail, ind_ie_dest: 1, email: null });
  });

  it('condicao: tPag, prazos, parcelas do cartão e classe', async () => {
    expect(await consulta.condicao(txA(), ids.condicao as string)).toEqual({ forma_tpag: '15', prazos_dias: [30, 60], parcelas_cartao: null, classe: 'boleto' });
    expect(await consulta.condicao(txA(), ids.cartao as string)).toEqual({ forma_tpag: '03', prazos_dias: [30, 60, 90], parcelas_cartao: 3, classe: 'cartao' });
    expect(await consulta.condicao(txA(), randomUUID())).toBeNull();
  });

  it('numeroInicial: série igual dá o número; série diferente, sem série ou inexistente dá null', async () => {
    expect(await consulta.numeroInicial(txA(), ids.filial as string, 2)).toBe(150);
    expect(await consulta.numeroInicial(txA(), ids.filial as string, 1)).toBeNull();
    expect(await consulta.numeroInicial(txA(), ids.filialSemSerie as string, 1)).toBeNull();
    expect(await consulta.numeroInicial(txA(), randomUUID(), 2)).toBeNull();
  });

  it('RLS: o tenant B não enxerga filial, cliente, condição nem número inicial do A', async () => {
    const tx = txB();
    expect(await consulta.filial(tx, ids.filial as string)).toBeNull();
    expect(await consulta.cliente(tx, ids.cliente as string)).toBeNull();
    expect(await consulta.condicao(tx, ids.condicao as string)).toBeNull();
    expect(await consulta.numeroInicial(tx, ids.filial as string, 2)).toBeNull();
  });
});
