/**
 * `ResolvedorChaveErp` (ADR 0010, item 2) e guarda do `external_id` (RD-0317) contra o PostgreSQL real, no papel
 * macuxierp_app e com RLS. Mesmo banco efêmero do `sql.db.test.ts`; sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { randomUUID } from 'node:crypto';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { CNPJ_B, clienteValido, filialValida, produtoValido } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { criarResolvedorChaveErp } from './resolvedor-chave';
import { repositoriosSql } from './sql';

const adm = sessaoDe('administrador');
const gerente = sessaoDe('gerente');

describe.skipIf(!PG_DISPONIVEL)('resolvedor de chave do Hub e guarda do external_id (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const resolvedor = criarResolvedorChaveErp(repositoriosSql);
  const resolver = (tenant: string, entidade: string, chaves: string[]) => app.comTenant(tenant, (tx) => resolvedor.resolver(tx, entidade, chaves));
  const plugin = () => criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } });
  const amb = (tenant: string) => criarAmbiente(plugin(), new Date('2026-11-21T15:00:00Z'), transacaoDe(app, tenant));
  // Cada entidade: um registro COM external_id do kit, um SEM external_id (nasceu no ERP) e um inativo.
  const ids: Record<string, { kit: string; erp: string; inativo: string }> = {};
  const kit = { cliente: 'C000123', vendedor: 'V01', filial: 'F01', produto: 'P0001', prazo_pagamento: 'PZ30', cliente_endereco: 'E0001' };
  const inativoKit = { cliente: 'C000999', vendedor: 'V99', filial: 'F99', produto: 'P9999', prazo_pagamento: 'PZ99', cliente_endereco: 'E9999' };
  let a: ReturnType<typeof amb>;

  async function criar(rota: string, corpo: unknown, sessao = adm) {
    const r = await a.chamar('POST', rota, { sessao, corpo });
    expect(r.status, `${rota} ${JSON.stringify(r.corpo)}`).toBe(201);
    return r.corpo as { id: string };
  }
  const inativar = async (rota: string) => expect((await a.chamar('DELETE', rota, { sessao: adm })).status).toBeLessThan(300);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'resolvedor-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'resolvedor-b', ['cadastros']);
    a = amb(A);
    const f0 = await criar('/filiais', filialValida({ external_id: kit.filial }));
    const f1 = await criar('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false }));
    const f2 = await criar('/filiais', filialValida({ cnpj: '11222333000262', padrao: false, emissora: false, external_id: inativoKit.filial }));
    await inativar(`/filiais/${f2.id}`);
    ids.filial = { kit: f0.id, erp: f1.id, inativo: f2.id };
    const v = (codigo: string, extra: object) => criar('/vendedores', { codigo, nome: codigo, filial_id: f0.id, usuario_id: null, ...extra }, gerente);
    const v0 = await v('V1', { external_id: kit.vendedor });
    const v1 = await v('V2', {});
    const v2 = await v('V3', { external_id: inativoKit.vendedor });
    await inativar(`/vendedores/${v2.id}`);
    ids.vendedor = { kit: v0.id, erp: v1.id, inativo: v2.id };
    const c = (codigo: string, extra: object) => criar('/condicoes-pagamento', { codigo, descricao: codigo, forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30, ...extra }, gerente);
    const c0 = await c('C1', { external_id: kit.prazo_pagamento });
    const c1 = await c('C2', {});
    const c2 = await c('C3', { external_id: inativoKit.prazo_pagamento });
    await inativar(`/condicoes-pagamento/${c2.id}`);
    ids.prazo_pagamento = { kit: c0.id, erp: c1.id, inativo: c2.id };
    const p = (codigo: string, extra: object) => criar('/produtos', produtoValido({ codigo, cest: '0300700', ...extra }));
    const p0 = await p('P1', { external_id: kit.produto });
    const p1 = await p('P2', {});
    const p2 = await p('P3', { external_id: inativoKit.produto });
    await inativar(`/produtos/${p2.id}`);
    ids.produto = { kit: p0.id, erp: p1.id, inativo: p2.id };
    const cl = (doc: string, extra: object) => criar('/clientes', clienteValido(f0.id, { documento: doc, ...extra }));
    const cl0 = await cl('11444777000161', { external_id: kit.cliente });
    const cl1 = await cl('11222333000181', {});
    const cl2 = await cl('11222333000262', { external_id: inativoKit.cliente });
    await inativar(`/clientes/${cl2.id}`);
    ids.cliente = { kit: cl0.id, erp: cl1.id, inativo: cl2.id };
    // O contrato da API de endereço não tem external_id (só a carga o grava): o teste o grava direto no banco.
    const e0 = await criar(`/clientes/${cl0.id}/enderecos`, { tipo: 'entrega', logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69050010', pais_bacen: '1058' });
    const e1 = await criar(`/clientes/${cl0.id}/enderecos`, { tipo: 'entrega', logradouro: 'Rua B', numero: '2', bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69050010', pais_bacen: '1058' });
    const e2 = await criar(`/clientes/${cl0.id}/enderecos`, { tipo: 'entrega', logradouro: 'Rua C', numero: '3', bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69050010', pais_bacen: '1058' });
    await efemero.admin.query('UPDATE cadastros.cliente_endereco SET external_id = $2 WHERE id = $1', [e0.id, kit.cliente_endereco]);
    await efemero.admin.query('UPDATE cadastros.cliente_endereco SET external_id = $2 WHERE id = $1', [e2.id, inativoKit.cliente_endereco]);
    await inativar(`/clientes/${cl0.id}/enderecos/${e2.id}`);
    ids.cliente_endereco = { kit: e0.id, erp: e1.id, inativo: e2.id };
  }, 180_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  describe.each(Object.keys(kit) as (keyof typeof kit)[])('entidade %s', (entidade) => {
    it('external_id acha; o inativo também; chave desconhecida fica fora', async () => {
      const m = await resolver(A, entidade, [kit[entidade], inativoKit[entidade], 'NAO-EXISTE']);
      expect(Object.fromEntries(m)).toEqual({ [kit[entidade]]: ids[entidade]!.kit, [inativoKit[entidade]]: ids[entidade]!.inativo });
    });
    it('UUID canônico de registro sem external_id acha pelo id', async () => {
      expect(Object.fromEntries(await resolver(A, entidade, [ids[entidade]!.erp]))).toEqual({ [ids[entidade]!.erp]: ids[entidade]!.erp });
    });
    it('UUID de registro que TEM external_id não acha pelo id', async () => {
      expect((await resolver(A, entidade, [ids[entidade]!.kit, ids[entidade]!.inativo])).size).toBe(0);
    });
    it('RLS: a chave do tenant A não resolve no B', async () => {
      expect((await resolver(B, entidade, [kit[entidade], inativoKit[entidade], ids[entidade]!.erp])).size).toBe(0);
    });
  });

  it('chaves repetidas e lista vazia', async () => {
    expect([...(await resolver(A, 'cliente', [kit.cliente, kit.cliente, kit.cliente])).keys()]).toEqual([kit.cliente]);
    expect((await resolver(A, 'cliente', [])).size).toBe(0);
  });
  it('mistura de chave do kit e UUID do ERP no mesmo lote resolve com 2 consultas no máximo', async () => {
    const consultas: string[] = [];
    const m = await app.comTenant(A, (tx) => resolvedor.resolver({ consultar: (sql, p) => (consultas.push(sql), tx.consultar(sql, p)) }, 'produto', [kit.produto, ids.produto!.erp, 'X', randomUUID()]));
    expect(Object.fromEntries(m)).toEqual({ [kit.produto]: ids.produto!.kit, [ids.produto!.erp]: ids.produto!.erp });
    expect(consultas.length).toBeLessThanOrEqual(2);
    consultas.length = 0;
    await app.comTenant(A, (tx) => resolvedor.resolver({ consultar: (sql, p) => (consultas.push(sql), tx.consultar(sql, p)) }, 'produto', [kit.produto]));
    expect(consultas.length).toBe(1);
  });

  describe('guarda da RD-0317 na API (422 RN-CORE-05)', () => {
    it('POST com external_id igual ao id de outro registro (inclusive inativo) é recusado', async () => {
      for (const alvo of [ids.produto!.erp, ids.produto!.kit, ids.produto!.inativo]) {
        const r = await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ codigo: `G${alvo.slice(0, 6)}`, cest: '0300700', external_id: alvo }) });
        expect(r.status).toBe(422);
        expect(r.corpo.codigo).toBe('RN-CORE-05');
      }
    });
    it('PATCH com external_id igual ao id de outro registro é recusado; a chave do kit passa', async () => {
      const r = await a.chamar('PATCH', `/produtos/${ids.produto!.erp}`, { sessao: adm, corpo: { external_id: ids.produto!.kit } });
      expect(r.status).toBe(422);
      expect(r.corpo.codigo).toBe('RN-CORE-05');
      const proprio = await a.chamar('PATCH', `/produtos/${ids.produto!.erp}`, { sessao: adm, corpo: { external_id: ids.produto!.erp } });
      expect([proprio.status, proprio.corpo.codigo]).toEqual([422, 'RN-CORE-05']);
      expect((await a.chamar('PATCH', `/produtos/${ids.produto!.erp}`, { sessao: adm, corpo: { external_id: 'KIT-NOVO' } })).status).toBe(200);
    });
    it('o mesmo UUID, no outro tenant, não é id de ninguém: passa', async () => {
      const r = await amb(B).chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300700', external_id: ids.produto!.erp }) });
      expect(r.status).toBe(201);
    });
  });

  describe('guarda da RD-0317 na carga (CARGA_CONFLITO)', () => {
    const csv = (ext: string) => `external_id;codigo;nome;ativo;cidade;uf;cnpj;logradouro;numero;bairro;cep;telefone;crt;ie;regime_pis_cofins\n${ext};09;Filial Carga;sim;Manaus;AM;99.000.001/0001-01;Rua Exemplo;100;Centro;69000-000;0000000000;3;012300004;cumulativo\n`;
    const carregar = (ext: string) =>
      app.comTenant(A, async (tx) => {
        const x = criarAmbiente(plugin(), new Date('2026-11-21T15:00:00Z'), tx);
        return x.chamar('POST', '/cargas', { sessao: adm, corpo: { modo: 'gravar' }, arquivos: [{ nome: 'filial.csv', conteudo: csv(ext) }] });
      });
    it('external_id canônico que é o id de outra filial vira erro de linha CARGA_CONFLITO e nada é gravado', async () => {
      const r = await carregar(ids.filial!.erp);
      expect(r.status).toBe(200);
      expect(r.corpo.erros).toEqual([expect.objectContaining({ linha: 2, codigo: 'CARGA_CONFLITO', campo: 'external_id' })]);
      expect(await efemero.admin.query("SELECT 1 FROM cadastros.filial WHERE tenant_id = $1 AND cnpj = '99000001000101'", [A]).then((q) => q.rowCount)).toBe(0);
    });
    it('a tabela de preço que a carga cria leva a guarda: tabela_external_id igual ao id de uma tabela vira CARGA_CONFLITO', async () => {
      const t = await criar('/tabelas-preco', { nome: 'Tabela existente', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: false });
      const preco = `external_id;tabela_external_id;tabela_nome;vigencia_inicio;produto_external_id;preco_cents\nPR-G1;${t.id};Tabela nova;2026-01-01;${kit.produto};1000\n`;
      const r = await app.comTenant(A, async (tx) => criarAmbiente(plugin(), new Date('2026-11-21T15:00:00Z'), tx).chamar('POST', '/cargas', { sessao: adm, corpo: { modo: 'gravar' }, arquivos: [{ nome: 'preco.csv', conteudo: preco }] }));
      expect(r.corpo.erros).toEqual([expect.objectContaining({ linha: 2, codigo: 'CARGA_CONFLITO' })]);
      expect(await efemero.admin.query("SELECT 1 FROM cadastros.tabela_preco WHERE tenant_id = $1 AND external_id = $2", [A, t.id]).then((q) => q.rowCount)).toBe(0);
    });
    it('chave do kit segue o caminho normal', async () => {
      const r = await carregar('F-CARGA-1');
      expect(r.corpo.erros.filter((e: { codigo: string }) => e.codigo === 'CARGA_CONFLITO')).toEqual([]);
    });
  });
});
