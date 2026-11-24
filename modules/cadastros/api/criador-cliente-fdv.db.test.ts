/**
 * Porta `CriadorClienteFdv` (T-0059 §4) contra o PostgreSQL real, no papel macuxierp_app e com RLS. Sem Postgres o teste pula
 * (`bash db/scripts/pg-local.sh`).
 */
import type { ClienteParaErpFdv } from '@macuxierp/platform-sdk';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { AuditoriaPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  const criador = criarCriadorClienteFdv({ repositorios: repositoriosSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
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
  });

  it('o cliente criado é o mesmo que o POST do BKO criaria (aparece na lista e a filial padrão vale sem filial_external_id)', async () => {
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
    const d = await decidir(A, pre({ documento: '123', cidade: 'Atlantida', cep: '1', filial_external_id: 'F99', razao_social: 'X'.repeat(61) }));
    expect(d.status).toBe('rejeitado_erp');
    if (d.status !== 'rejeitado_erp') return;
    expect(d.erros.map((e) => e.codigo)).toEqual(['documento_invalido', 'municipio_nao_encontrado', 'cep_invalido', 'tamanho_maximo', 'filial_nao_encontrada']);
    expect(d.motivo.length).toBeLessThanOrEqual(300);
    expect((await admin<{ n: string }>('SELECT count(*)::text AS n FROM cadastros.cliente WHERE tenant_id = $1', [A]))[0]?.n).toBe('1');
    expect((await admin<{ n: string }>("SELECT count(*)::text AS n FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'cliente.criar'", [A]))[0]?.n).toBe('1');
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

  it('filial_external_id existente no tenant usa essa filial; IE vazia vira ind_ie_dest 9 e ISENTO vira 2', async () => {
    const a = await decidir(A, pre({ documento: '529.982.247-25', inscricao_estadual: '', filial_external_id: 'F01', cliente_uuid: '88888888-8888-4888-8888-888888888888' }));
    const b = await decidir(A, pre({ documento: '12.ABC.345/01DE-35', inscricao_estadual: 'ISENTO', cliente_uuid: '99999999-9999-4999-8999-999999999999' }));
    expect(a).toMatchObject({ status: 'vinculado' });
    expect(b).toMatchObject({ status: 'vinculado' });
    const l = await admin<{ documento: string; ind_ie_dest: string; tipo_pessoa: string }>("SELECT documento, ind_ie_dest, tipo_pessoa FROM cadastros.cliente WHERE tenant_id = $1 AND documento IN ('52998224725','12ABC34501DE35') ORDER BY documento", [A]);
    expect(l).toEqual([{ documento: '12ABC34501DE35', ind_ie_dest: '2', tipo_pessoa: 'PJ' }, { documento: '52998224725', ind_ie_dest: '9', tipo_pessoa: 'PF' }]);
  });
});
