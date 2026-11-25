/**
 * Porta `CriadorClienteFdv` (T-0059 §4) contra o PostgreSQL real, no papel macuxierp_app e com RLS. Sem Postgres o teste pula
 * (`bash db/scripts/pg-local.sh`).
 */
import type { ClienteParaErpFdv } from '@macuxierp/platform-sdk';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { AuditoriaPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENSAGENS_PRE_CADASTRO_FDV, type CodigoPreCadastroFdv } from '../domain';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { criarCriadorClienteFdv } from './criador-cliente-fdv';
import { CNPJ_A, CNPJ_B, filialValida } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const AGORA = new Date('2026-11-24T14:00:00Z');
const adm = sessaoDe('administrador');
const pre = (o: Partial<ClienteParaErpFdv> = {}): ClienteParaErpFdv => ({
  cliente_uuid: '44444444-4444-4444-8444-444444444444', recebido_em: '2026-11-24T10:00:00-04:00', razao_social: 'Mercadinho Central Ltda',
  documento: '11.444.777/0001-61', inscricao_estadual: '012345679', logradouro: 'Av. Djalma Batista', numero: '100', bairro: 'Chapada',
  cidade: 'MANAUS', uf: 'am', cep: '69050-010', codigo_fdv: '12345', ...o,
});

describe.skipIf(!PG_DISPONIVEL)('CriadorClienteFdv (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let filialA: string;
  // falso do espelho do vendedor do integracao-fdv (contrato real ainda não chegou): V-ATIVO / V-INATIVO apontam para vendedores do tenant A
  const espelho: Record<string, { vendedor_id: string | null; ativo: boolean }> = {};
  const criador = criarCriadorClienteFdv({
    repositorios: repositoriosSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA),
    consultaVendedorFdv: { vendedorPorExternalId: async (_tx, _tenant, ext) => espelho[ext] ?? null },
  });
  const decidir = (tenant: string, p: ClienteParaErpFdv) => app.comTenant(tenant, (tx) => criador.decidir(tx, tenant, p));
  const plugin = () => criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } });
  const amb = (tenant: string) => criarAmbiente(plugin(), AGORA, transacaoDe(app, tenant));
  const admin = async <L>(sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows as L[];

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'criador-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'criador-b', ['cadastros']);
    const f = await amb(A).chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_A, external_id: 'F01' }) });
    expect(f.status).toBe(201);
    filialA = (f.corpo as { id: string }).id;
    expect((await amb(B).chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() })).status).toBe(201);
  });
  afterAll(async () => { await efemero?.remover(); });

  it('RN-CAD-01/02/03: aceito cria o cliente, devolve o UUID como chave do Hub e grava evento e auditoria', async () => {
    const d = await decidir(A, pre());
    expect(d).toMatchObject({ status: 'vinculado' });
    if (d.status !== 'vinculado') return;
    expect(d.external_id).toBe(d.cliente_id); // sem external_id no cadastro, a chave é o UUID (ADR 0010); o codigo_fdv não vira external_id
    const [c] = await admin<Record<string, unknown>>('SELECT * FROM cadastros.cliente WHERE id = $1', [d.cliente_id]);
    expect(c).toMatchObject({ tenant_id: A, documento: '11444777000161', tipo_pessoa: 'PJ', ind_ie_dest: '1', ie: '012345679', limite_credito_centavos: '0', vendedor_id: null, filial_id: filialA, external_id: null });
    const ev = await admin<{ nome: string; payload: Record<string, unknown> }>("SELECT nome, payload FROM plataforma.evento WHERE agregado_id = $1", [d.cliente_id]);
    expect(ev.map((e) => e.nome)).toEqual(['cadastros.cliente.alterado@1']);
    const aud = await admin<{ acao: string; usuario_id: string | null; depois: Record<string, unknown> }>('SELECT acao, usuario_id, depois FROM plataforma.auditoria WHERE entidade_id = $1', [d.cliente_id]);
    expect(aud).toEqual([{ acao: 'cliente.criar', usuario_id: null, depois: expect.objectContaining({ origem: 'fdv_pre_cadastro', limite_credito_centavos: 0 }) }]);
    expect(JSON.stringify(aud)).not.toMatch(/11444777|Mercadinho/); // LGPD: sem documento nem nome na auditoria
    const [end] = await admin<Record<string, unknown>>('SELECT municipio_ibge, uf, cep, tipo FROM cadastros.cliente_endereco WHERE cliente_id = $1', [d.cliente_id]);
    expect(end).toMatchObject({ municipio_ibge: '1302603', uf: 'AM', cep: '69050010', tipo: 'principal' });
    // o mesmo cliente que o POST do BKO criaria: aparece na lista e a filial padrão vale sem filial_external_id
    const r = await amb(A).chamar('GET', '/clientes', { sessao: adm, consulta: {} });
    expect((r.corpo as { itens: { documento: string; filial_id: string }[] }).itens).toEqual([expect.objectContaining({ documento: '11444777000161', filial_id: filialA })]);
  });

  it('RN-CAD-01: documento já cadastrado e ativo recusa, sem gravar nada e sem o documento na mensagem', async () => {
    const antes = await admin<{ n: string }>('SELECT count(*)::text AS n FROM plataforma.evento WHERE tenant_id = $1', [A]);
    const d = await decidir(A, pre({ cliente_uuid: '55555555-5555-4555-8555-555555555555' }));
    expect(d).toMatchObject({ status: 'rejeitado_erp', erros: [{ campo: 'documento', codigo: 'documento_ja_cadastrado' }] });
    if (d.status === 'rejeitado_erp') {
      expect(d.motivo).not.toMatch(/11444777/);
      expect(JSON.stringify(d.erros)).not.toMatch(/11444777/);
    }
    expect((await admin<{ n: string }>('SELECT count(*)::text AS n FROM plataforma.evento WHERE tenant_id = $1', [A]))[0]).toEqual(antes[0]);
    expect((await admin<{ n: string }>('SELECT count(*)::text AS n FROM cadastros.cliente WHERE tenant_id = $1', [A]))[0]?.n).toBe('1');
  });

  it('recusado junta todas as recusas e não grava cliente, evento nem auditoria', async () => {
    const conta = async () => (await admin<{ n: string }>("SELECT (SELECT count(*) FROM cadastros.cliente WHERE tenant_id = $1)::text || '/' || (SELECT count(*) FROM plataforma.evento WHERE tenant_id = $1) || '/' || (SELECT count(*) FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'cliente.criar') AS n", [A]))[0]?.n;
    const antes = await conta();
    const d = await decidir(A, pre({ documento: '123', cidade: 'Atlantida', cep: '1', filial_external_id: 'F99', razao_social: 'X'.repeat(61), numero: '9'.repeat(61) }));
    expect(d.status).toBe('rejeitado_erp');
    if (d.status !== 'rejeitado_erp') return;
    expect(d.erros.map((e) => e.codigo)).toEqual(['documento_invalido', 'municipio_nao_encontrado', 'cep_invalido', 'tamanho_maximo', 'tamanho_maximo', 'filial_nao_encontrada']);
    expect(d.motivo.length).toBeLessThanOrEqual(300);
    expect(await conta()).toBe(antes);
  });

  it('cliente inativo com o mesmo documento não bloqueia: o pré-cadastro cria um novo (índice único só nos ativos)', async () => {
    const outro = pre({ documento: CNPJ_B, cliente_uuid: '66666666-6666-4666-8666-666666666666' });
    const primeiro = await decidir(A, outro);
    expect(primeiro).toMatchObject({ status: 'rejeitado_erp' }); // CNPJ_B = 11444777000161: já ativo no tenant A
    const c = await amb(A).chamar('GET', '/clientes', { sessao: adm, consulta: {} });
    const id = (c.corpo as { itens: { id: string }[] }).itens[0]!.id;
    expect((await amb(A).chamar('DELETE', `/clientes/${id}`, { sessao: adm })).status).toBeLessThan(300);
    const segundo = await decidir(A, outro);
    expect(segundo).toMatchObject({ status: 'vinculado' });
  });

  it('multi-tenant: o mesmo documento no tenant B é aceito, e a filial por external_id é a do próprio tenant', async () => {
    const d = await decidir(B, pre({ cliente_uuid: '77777777-7777-4777-8777-777777777777' }));
    expect(d).toMatchObject({ status: 'vinculado' });
    const f = await decidir(B, pre({ documento: '529.982.247-25', inscricao_estadual: '', filial_external_id: 'F01' }));
    expect(f).toMatchObject({ status: 'rejeitado_erp', erros: [{ codigo: 'filial_nao_encontrada' }] }); // F01 é do tenant A
    const doB = await admin<{ tenant_id: string }>('SELECT tenant_id FROM cadastros.cliente WHERE id = $1', [(d as { cliente_id: string }).cliente_id]);
    expect(doB[0]?.tenant_id).toBe(B);
  });

  it('RN-CAD-02: IE vazia vira ind_ie_dest 9 e ISENTO vira 2; filial_external_id F01 resolve para a filial do tenant', async () => {
    const a = await decidir(A, pre({ documento: '529.982.247-25', inscricao_estadual: '', filial_external_id: 'F01', cliente_uuid: '88888888-8888-4888-8888-888888888888' }));
    const b = await decidir(A, pre({ documento: '12.ABC.345/01DE-35', inscricao_estadual: 'ISENTO', cliente_uuid: '99999999-9999-4999-8999-999999999999' }));
    expect(a).toMatchObject({ status: 'vinculado' });
    expect(b).toMatchObject({ status: 'vinculado' });
    const l = await admin<{ documento: string; ind_ie_dest: string; tipo_pessoa: string; filial_id: string }>("SELECT documento, ind_ie_dest, tipo_pessoa, filial_id FROM cadastros.cliente WHERE tenant_id = $1 AND documento IN ('52998224725','12ABC34501DE35') ORDER BY documento", [A]);
    expect(l).toEqual([{ documento: '12ABC34501DE35', ind_ie_dest: '2', tipo_pessoa: 'PJ', filial_id: filialA }, { documento: '52998224725', ind_ie_dest: '9', tipo_pessoa: 'PF', filial_id: filialA }]);
  });

  it('RN-INF-08: o telefone do pré-cadastro é gravado como contato do cliente, junto com ele', async () => {
    const d = await decidir(B, pre({ documento: '529.982.247-25', inscricao_estadual: '', telefone: '(92) 3333-4444', cliente_uuid: '88888888-8888-4888-8888-888888888888' }));
    expect(d).toMatchObject({ status: 'vinculado' });
    if (d.status !== 'vinculado') return;
    const cs = await admin<Record<string, unknown>>('SELECT tenant_id, nome, telefone, email FROM cadastros.cliente_contato WHERE cliente_id = $1', [d.cliente_id]);
    expect(cs).toEqual([{ tenant_id: B, nome: 'Contato do FDV', telefone: '9233334444', email: null }]);
    const sem = await decidir(B, pre({ documento: '168.995.350-09', inscricao_estadual: '', telefone: null, cliente_uuid: '99999999-9999-4999-8999-999999999999' }));
    expect(sem).toMatchObject({ status: 'vinculado' });
    expect(await admin('SELECT 1 FROM cadastros.cliente_contato WHERE cliente_id = $1', [(sem as { cliente_id: string }).cliente_id])).toHaveLength(0);
  });

  const localizacao = (id: string) => admin<{ latitude: number | null; longitude: number | null }>('SELECT latitude::float8 AS latitude, longitude::float8 AS longitude FROM cadastros.cliente_endereco WHERE cliente_id = $1 AND deleted_at IS NULL ORDER BY created_at', [id]);
  const novoPre = (cpf: string, uuid: string, o: Partial<ClienteParaErpFdv>) => decidir(B, pre({ documento: cpf, inscricao_estadual: '', cliente_uuid: uuid, ...o }));

  it('T-0096: a conversão do pré-cadastro grava a localização no endereço e o evento a traz', async () => {
    const d = await novoPre('111.444.777-35', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { latitude: -3.119, longitude: -60.0217 });
    expect(d).toMatchObject({ status: 'vinculado' });
    if (d.status !== 'vinculado') return;
    expect(await localizacao(d.cliente_id)).toEqual([{ latitude: -3.119, longitude: -60.0217 }]);
    const ev = await admin<{ payload: unknown }>('SELECT payload FROM plataforma.evento WHERE agregado_id = $1', [d.cliente_id]);
    expect(JSON.stringify(ev[0]?.payload)).toMatch(/"latitude":-3\.119,"longitude":-60\.0217/);
  });
  it('T-0096: pré-cadastro fora da faixa grava nulo e não recusa', async () => {
    const d = await novoPre('123.456.789-09', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { latitude: 95, longitude: -60 });
    expect(d).toMatchObject({ status: 'vinculado' });
    if (d.status === 'vinculado') expect(await localizacao(d.cliente_id)).toEqual([{ latitude: null, longitude: null }]);
  });
  it('T-0096: POST e PATCH do endereço do cliente gravam e leem', async () => {
    const d = await novoPre('808.527.150-80', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {});
    if (d.status !== 'vinculado') throw new Error(`pré-cadastro recusado: ${JSON.stringify(d)}`);
    const t = amb(B);
    const base = `/clientes/${d.cliente_id}/enderecos`;
    const corpo = { tipo: 'entrega', logradouro: 'Rua B', numero: '2', bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000000' };
    const ok = await t.chamar('POST', base, { sessao: adm, corpo: { ...corpo, latitude: -3.1, longitude: -60.02 } });
    expect(ok.status).toBe(201);
    expect(ok.corpo).toMatchObject({ latitude: -3.1, longitude: -60.02 });
    const id = (ok.corpo as { id: string }).id;
    const lido = await t.chamar('GET', base, { sessao: adm });
    expect((lido.corpo as { itens: Record<string, unknown>[] }).itens.find((e) => e.id === id)).toMatchObject({ latitude: -3.1, longitude: -60.02 });
    const novo = await t.chamar('PATCH', `${base}/${id}`, { sessao: adm, corpo: { latitude: -10.5, longitude: -50.25 } });
    expect(novo.corpo).toMatchObject({ latitude: -10.5, longitude: -50.25 });
  });
  it('T-0096: a filial ignora a localização (a 0061 só cobre o endereço do cliente)', async () => {
    const f = await amb(B).chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_B, external_id: 'F-LOC', endereco: { ...filialValida().endereco, latitude: -3.1, longitude: -60.02 } }) });
    expect(f.status).toBe(201);
    expect(f.corpo.endereco).not.toHaveProperty('latitude');
  });

  describe('T-0105 item 2: vendedor do FDV na carteira', () => {
    let vendedorId: string;
    let vendedorInativoId: string;
    beforeAll(async () => {
      const g = sessaoDe('gerente');
      const v = async (codigo: string) => {
        const r = await amb(A).chamar('POST', '/vendedores', { sessao: g, corpo: { codigo, nome: codigo, filial_id: filialA, usuario_id: null } });
        expect(r.status).toBe(201);
        return (r.corpo as { id: string }).id;
      };
      vendedorId = await v('VF1');
      vendedorInativoId = await v('VF2');
      expect((await amb(A).chamar('DELETE', `/vendedores/${vendedorInativoId}`, { sessao: g })).status).toBeLessThan(300);
      espelho['V-ATIVO'] = { vendedor_id: vendedorId, ativo: true };
      espelho['V-INATIVO'] = { vendedor_id: vendedorInativoId, ativo: true }; // o espelho acha ativo, mas o ERP já inativou: vale o ERP
      espelho['V-ESPELHO-INATIVO'] = { vendedor_id: vendedorId, ativo: false };
    });
    const novo = (n: number, o: Partial<ClienteParaErpFdv>) => pre({ cliente_uuid: `aaaaaaaa-0000-4000-8000-00000000000${n}`, documento: ['', '70.201.306/0001-91', '51.250.470/0001-44', '03.778.130/0001-48', '67.040.890/0001-36'][n], inscricao_estadual: '', ...o });
    const doCliente = async (id: string) => (await admin<{ vendedor_id: string | null }>('SELECT vendedor_id FROM cadastros.cliente WHERE id = $1', [id]))[0]?.vendedor_id;

    it('RN-INT-23 (T-0105): vendedor ativo entra na carteira; a auditoria não leva o código', async () => {
      const d = await decidir(A, novo(1, { vendedor_external_id: 'V-ATIVO' }));
      expect(d).toMatchObject({ status: 'vinculado' });
      if (d.status !== 'vinculado') return;
      expect(await doCliente(d.cliente_id)).toBe(vendedorId);
      const aud = await admin<{ depois: Record<string, unknown> }>("SELECT depois FROM plataforma.auditoria WHERE entidade_id = $1", [d.cliente_id]);
      expect(aud[0]?.depois).toMatchObject({ vendedor_vinculado: true });
      expect(JSON.stringify(aud)).not.toMatch(/V-ATIVO/);
    });
    it('RN-INT-23 (T-0105): vendedor inexistente ou inativo recusa o pré-cadastro e nenhum cliente é gravado', async () => {
      const casos: Array<[number, string, string]> = [
        [3, 'V-ESPELHO-INATIVO', 'vendedor_fdv_inativo'],
        [4, 'V-INATIVO', 'vendedor_fdv_inativo'], // existe, mas inativo no ERP
        [3, 'V-NAO-EXISTE', 'vendedor_fdv_nao_encontrado'],
      ];
      for (const [n, ext, codigo] of casos) {
        const pre1 = novo(n, { vendedor_external_id: ext });
        const d = await decidir(A, pre1);
        expect(d).toMatchObject({ status: 'rejeitado_erp', erros: [{ campo: 'vendedor_external_id', codigo, mensagem: MENSAGENS_PRE_CADASTRO_FDV[codigo as CodigoPreCadastroFdv] }] });
        expect(await admin('SELECT id FROM cadastros.cliente WHERE documento = $1', [(pre1.documento ?? '').replace(/\D/g, '')])).toHaveLength(0);
        expect(JSON.stringify(d)).not.toContain(ext);
      }
    });
    it('RN-INT-23 (T-0105): sem a porta ligada o comportamento é o de antes: cliente sem carteira e sem recusa', async () => {
      const semPorta = criarCriadorClienteFdv({ repositorios: repositoriosSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
      const d = await app.comTenant(A, (tx) => semPorta.decidir(tx, A, novo(2, { vendedor_external_id: 'V-ATIVO' })));
      expect(d).toMatchObject({ status: 'vinculado' });
      if (d.status !== 'vinculado') return;
      expect(await doCliente(d.cliente_id)).toBeNull();
      const aud = await admin<{ depois: Record<string, unknown> }>('SELECT depois FROM plataforma.auditoria WHERE entidade_id = $1', [d.cliente_id]);
      expect(aud[0]?.depois).toMatchObject({ vendedor_vinculado: false });
    });
  });
});
