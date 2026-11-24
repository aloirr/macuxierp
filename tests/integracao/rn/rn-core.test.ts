/**
 * T-0008 (a): RN do core de ponta a ponta na API real (`criarApp` + plugins de core e cadastros, repositório em memória).
 * Só o que os testes do dono não cobrem pelo HTTP: o log da API sem dado pessoal (RN-CORE-07, inclusive na rota de
 * cadastros), o instante e o ETag em ISO-8601 UTC (RN-CORE-04) e a lista dos perfis (RN-CORE-01 e RN-CORE-09).
 * O resto das RN do core está em modules/core/api/rotas.test.ts e modules/core/domain/regras.test.ts; o dinheiro
 * (RN-CORE-03), em packages/platform-sdk/src/dinheiro.test.ts (ver docs/testes/T-0008.md).
 */
import { describe, expect, it } from 'vitest';
import { PERFIS } from '../../../packages/platform-sdk/src/index';
import { FILIAL_A, usarApiMemoria } from '../../apoio/api-memoria';

const api = usarApiMemoria();
const SEIS = ['administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura'];

describe('RN-CORE-01: perfis da v1', () => {
  /** GET /v1/core/perfis é da ação core.usuario.gerir (RN-CORE-09): só o administrador lê; o leitura recebe 403. */
  const listar = async () => {
    const a = await api();
    const negado = await a.app.inject({ method: 'GET', url: '/v1/core/perfis', headers: a.auth('leitura') });
    expect(negado.statusCode).toBe(403);
    const r = await a.app.inject({ method: 'GET', url: '/v1/core/perfis', headers: a.auth('administrador') });
    expect(r.statusCode).toBe(200);
    return r.json().itens.map((p: { perfil: string }) => p.perfil) as string[];
  };
  it('RN-CORE-01: GET /v1/core/perfis lista exatamente os PERFIS do SDK, com os 6 da v1 primeiro, na ordem do doc 03', async () => {
    const perfis = await listar();
    expect(perfis).toEqual([...PERFIS]);
    expect(perfis.slice(0, 6)).toEqual(SEIS);
  });
  it('RN-CORE-09: com o analista_implantacao, são 7 perfis e ele fica no fim', async () => {
    const perfis = await listar();
    expect(perfis).toEqual([...SEIS, 'analista_implantacao']);
  });
});

describe('RN-CORE-04: datas em UTC na API', () => {
  it('RN-CORE-04: instantes da API saem em ISO-8601 UTC (sufixo Z) e o ETag também', async () => {
    const a = await api();
    const r = await a.app.inject({ method: 'GET', url: '/v1/core/empresa', headers: a.auth() });
    expect(r.json().updated_at).toBe('2026-11-21T15:00:00.000Z');
    expect(r.headers.etag).toBe('2026-11-21T15:00:00.000Z');
    expect(r.json().fuso).toBe('America/Manaus');
  });
});

describe('RN-CORE-07: LGPD, sem dado pessoal em log', () => {
  it('RN-CORE-07: nome, e-mail, CPF e a busca da query não aparecem no log da API', async () => {
    const logs: string[] = [];
    const a = await api({ logs });
    const pessoa = { nome: 'Fulana Detalhe Sigilosa', email: 'fulana.sigilosa@exemplo.teste' };
    await a.app.inject({ method: 'POST', url: '/v1/core/usuarios', headers: a.auth(), payload: { ...pessoa, perfil: 'leitura', filial_ids: [FILIAL_A] } });
    await a.app.inject({ method: 'GET', url: '/v1/core/usuarios?busca=fulana.sigilosa%40exemplo.teste', headers: a.auth() });
    await a.app.inject({ method: 'GET', url: '/v1/cadastros/clientes?busca=52998224725', headers: a.auth() });
    await a.app.inject({ method: 'POST', url: '/v1/cadastros/clientes', headers: a.auth(), payload: { tipo_pessoa: 'PF', documento: '52998224725', razao_social: pessoa.nome } });
    const texto = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    for (const proibido of [pessoa.nome, pessoa.email, 'fulana.sigilosa', '52998224725', 'authorization', 'Bearer']) expect(texto).not.toContain(proibido);
  });
});
