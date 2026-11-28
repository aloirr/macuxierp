import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ArmazenamentoMemoria,
  armazenamentoIndisponivel,
  type Armazenamento,
  ArquivoRecebido,
  auditar,
  criarEvento,
  erros,
  ErroApi,
  executarAutorizado,
  pode,
  PERFIS,
  type ContextoRota,
  type Perfil,
  type RespostaRota,
} from '@macuxierp/platform-sdk';
import { BancoMemoria, AuditoriaMemoria, FilaDeTrabalhosMemoria, OutboxMemoria } from '@macuxierp/platform-sdk/testes';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirColunasA1 } from './colunas-a1';
import { lerChaveA1 } from './index';
import { LeitorPfxTls } from './leitor-pfx';
import { PfxInvalido, type DadosPfx, type LeitorPfx, type LinhaAmbiente } from './portas';
import { RepositorioCoreMemoria } from './repositorio-memoria';
import { criarPluginCore } from './rotas';

const TENANT = '3f2c2d8e-5a64-4f0d-9c53-0a6d7d2b1e11';
const ADM_ID = '11111111-1111-4111-8111-111111111111';
const FILIAL = '22222222-2222-4222-8222-222222222222';
const AGORA = new Date('2026-11-21T15:00:00Z');
const CHAVE_HEX = randomBytes(32).toString('hex');
const CNPJ_EMPRESA = '11222333000181';

class LeitorFalso implements LeitorPfx {
  dados: DadosPfx | null = null;
  async abrir(): Promise<DadosPfx> {
    if (!this.dados) throw new PfxInvalido('x');
    return this.dados;
  }
}

function montar(leitor: LeitorPfx = new LeitorFalso(), armazenamentoDoTeste?: Armazenamento) {
  const repo = new RepositorioCoreMemoria();
  repo.empresaLinha = { id: TENANT, razao_social: 'Empresa Piloto LTDA', nome_fantasia: null, cnpj: CNPJ_EMPRESA, ie: null, fuso: 'America/Manaus', updated_at: AGORA };
  repo.usuarios.push({ id: ADM_ID, nome: 'Admin', email: 'admin@piloto.test', perfil: 'administrador', filial_ids: [FILIAL], ativo: true, external_id: null, ultimo_acesso_em: null, updated_at: AGORA, senha_hash: 'h' });
  const auditoria = new AuditoriaMemoria();
  const outbox = new OutboxMemoria();
  const fila = new FilaDeTrabalhosMemoria();
  const armazenamento = armazenamentoDoTeste ?? new ArmazenamentoMemoria();
  let seq = 0;
  const plugin = criarPluginCore({
    repo,
    hashSenha: async (s) => `$argon2id$teste$${s.length}$${s.split('').reverse().join('')}`,
    leitorPfx: leitor,
    chaveA1: lerChaveA1(CHAVE_HEX),
    armazenamento,
    novoId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`,
  });

  async function chamar(
    metodo: string,
    caminho: string,
    o: { perfil?: Perfil; corpo?: unknown; consulta?: unknown; params?: Record<string, string>; arquivos?: Record<string, ArquivoRecebido>; agora?: Date } = {},
  ): Promise<RespostaRota> {
    const rota = plugin.rotas.find((r) => r.metodo === metodo && r.caminho === caminho);
    if (!rota) throw new Error(`rota inexistente ${metodo} ${caminho}`);
    const perfil = o.perfil ?? 'administrador';
    if (!pode(perfil, rota.acao)) throw erros.perfilSemPermissao();
    const agora = o.agora ?? AGORA;
    const tx = { consultar: async () => [] };
    const c: ContextoRota = {
      sessao: { usuario_id: ADM_ID, tenant_id: TENANT, perfil, filial_ids: [FILIAL] },
      tx,
      request_id: 'req-1',
      agora,
      publicar: async (e) => {
        const ev = criarEvento({ ...e, tenant_id: TENANT, ator: ADM_ID, request_id: 'req-1' }, agora);
        await outbox.gravar(tx, ev);
        return ev;
      },
      auditar: async (d) => {
        await auditar(auditoria, tx, { tenant_id: TENANT, usuario_id: ADM_ID, request_id: 'req-1' }, d, agora);
      },
      enfileirar: (p) => fila.enfileirar(tx, { ...p, tenant_id: TENANT }),
    };
    const corpo = rota.corpo ? rota.corpo.parse(o.corpo) : undefined;
    const consulta = rota.consulta ? rota.consulta.parse(o.consulta ?? {}) : undefined;
    return rota.executar(c, { corpo, consulta, params: o.params ?? {}, cabecalhos: {}, arquivos: o.arquivos ?? {} });
  }

  return { repo, auditoria, outbox, fila, armazenamento, chamar, plugin };
}

const regra = async (p: Promise<unknown>, codigo: string) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroApi);
  expect((e as ErroApi).status).toBe(422);
  expect((e as ErroApi).codigo).toBe(codigo);
  return e as ErroApi;
};

/** O corpo do 409 do SDK (`erros.emailEmUso()`), sem repetir o texto. */
const corpoEmailEmUso = (): object => {
  const e = erros.emailEmUso();
  return { status: e.status, codigo: e.codigo, message: e.message, campos: e.campos, detalhes: e.detalhes };
};

describe('permissões por ação (RN-CORE-02, matriz do doc 03)', () => {
  it('RN-CORE-02: só o administrador edita empresa, gere usuários e troca ambiente; fiscal e faturista só veem o ambiente', async () => {
    const t = montar();
    await expect(t.chamar('PATCH', '/empresa', { perfil: 'gerente', corpo: { razao_social: 'X Y', nome_fantasia: null, ie: null, fuso: 'America/Manaus' } })).rejects.toMatchObject({ codigo: 'PERFIL_SEM_PERMISSAO' });
    await expect(t.chamar('GET', '/usuarios', { perfil: 'vendedor' })).rejects.toMatchObject({ status: 403 });
    await expect(t.chamar('PUT', '/ambientes-fiscais/:filial_id', { perfil: 'fiscal', params: { filial_id: FILIAL }, corpo: { ambiente: 'homologacao' } })).rejects.toMatchObject({ status: 403 });
    await expect(t.chamar('GET', '/ambientes-fiscais', { perfil: 'fiscal' })).resolves.toBeTruthy();
    await expect(t.chamar('GET', '/empresa', { perfil: 'leitura' })).resolves.toBeTruthy();
    await expect(t.chamar('GET', '/certificados', { perfil: 'faturista' })).rejects.toMatchObject({ status: 403 });
  });

  it('T-0088, RN-CORE-02: a tela de empresa e ambiente fiscal lê só pelas rotas GET; ambiente é de administrador, fiscal e faturista', async () => {
    const t = montar();
    for (const perfil of ['administrador', 'faturista'] as const) await expect(t.chamar('GET', '/ambientes-fiscais', { perfil })).resolves.toBeTruthy();
    for (const perfil of ['gerente', 'vendedor', 'leitura'] as const) await expect(t.chamar('GET', '/ambientes-fiscais', { perfil })).rejects.toMatchObject({ status: 403 });
    // a empresa (cabeçalho da tela) todos leem, e a leitura devolve só o tenant da sessão
    const r = (await t.chamar('GET', '/empresa', { perfil: 'fiscal' })).corpo as { id: string; cnpj: string };
    expect(r).toMatchObject({ id: TENANT, cnpj: CNPJ_EMPRESA });
    // o quadro não ganha rota de escrita: a única do ambiente continua sendo a da troca da T-0030
    const escritas = t.plugin.rotas.filter((x) => x.caminho.startsWith('/ambientes-fiscais') && x.metodo !== 'GET');
    expect(escritas.map((x) => `${x.metodo} ${x.caminho}`)).toEqual(['PUT /ambientes-fiscais/:filial_id']);
  });

  it('RF-CORE-03: perfis só leitura devolve a matriz; leitura não tem ação de gestão', async () => {
    const t = montar();
    const r = (await t.chamar('GET', '/perfis')).corpo as { itens: { perfil: string; acoes: string[] }[] };
    expect(r.itens.map((i) => i.perfil)).toHaveLength(PERFIS.length);
    expect(r.itens.find((i) => i.perfil === 'administrador')?.acoes).toContain('core.usuario.gerir');
    expect(r.itens.find((i) => i.perfil === 'leitura')?.acoes).not.toContain('core.usuario.gerir');
  });

  it('RF-CORE-03 (D12): o tenant só lê as licenças; não há rota de escrita', async () => {
    const t = montar();
    t.repo.licencasLinhas = [{ modulo: 'cadastros', ativo: true, valido_ate: null }];
    expect((await t.chamar('GET', '/licencas')).corpo).toEqual({ itens: [{ modulo: 'cadastros', ativo: true, valido_ate: null }], proximo_cursor: null });
    expect(t.plugin.rotas.filter((r) => r.caminho.startsWith('/licencas') && r.metodo !== 'GET')).toHaveLength(0);
  });
});

describe('RF-CORE-01: empresa', () => {
  it('RF-CORE-01: PATCH grava, audita, publica core.empresa.alterada@1 e rejeita token vencido (409)', async () => {
    const t = montar();
    const lido = (await t.chamar('GET', '/empresa')).cabecalhos?.ETag;
    expect(lido).toBe(AGORA.toISOString());
    const dep = new Date('2026-11-21T16:00:00Z');
    const r = await t.chamar('PATCH', '/empresa', { agora: dep, corpo: { razao_social: 'Empresa Nova LTDA', nome_fantasia: 'Nova', ie: '123', fuso: 'America/Manaus', updated_at: lido } });
    expect((r.corpo as { razao_social: string }).razao_social).toBe('Empresa Nova LTDA');
    expect(t.auditoria.registros[0]).toMatchObject({ acao: 'core.empresa.alterada', entidade: 'empresa' });
    expect(t.outbox.eventos[0]).toMatchObject({ nome: 'core.empresa.alterada@1', agregado_id: TENANT });
    await expect(t.chamar('PATCH', '/empresa', { corpo: { razao_social: 'Outra', nome_fantasia: null, ie: null, fuso: 'America/Manaus', updated_at: lido } })).rejects.toMatchObject({ status: 409 });
  });

  it('RF-CORE-01: fuso inexistente é 400', async () => {
    const t = montar();
    await expect(t.chamar('PATCH', '/empresa', { corpo: { razao_social: 'Empresa X', nome_fantasia: null, ie: null, fuso: 'Marte/Olimpo' } })).rejects.toMatchObject({ status: 400 });
  });
});

describe('RF-CORE-02: usuários', () => {
  const novo = { nome: 'Maria Souza', email: '  Maria@Piloto.TEST ', perfil: 'faturista', filial_ids: [FILIAL] };

  it('RF-CORE-02: cria com senha provisória exibida uma vez; só o hash fica; auditoria e evento sem nome nem e-mail', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/usuarios', { corpo: novo });
    const c = r.corpo as { senha_provisoria: string; email: string; id: string };
    expect(r.status).toBe(201);
    expect(r.cabecalhos).toMatchObject({ 'cache-control': 'no-store' }); // devolve senha_provisoria
    expect(c.email).toBe('maria@piloto.test');
    expect(c.senha_provisoria).toHaveLength(18);
    const guardado = t.repo.usuarios.find((u) => u.id === c.id);
    expect(guardado?.senha_hash.startsWith('$argon2id$')).toBe(true);
    expect(JSON.stringify(guardado)).not.toContain(c.senha_provisoria);
    const rastro = JSON.stringify([t.auditoria.registros, t.outbox.eventos]);
    expect(rastro).not.toContain('maria@piloto.test');
    expect(rastro).not.toContain('Maria');
    expect(rastro).not.toContain(c.senha_provisoria);
    expect(t.outbox.eventos[0]).toMatchObject({ nome: 'core.usuario.alterado@1', payload: { perfil: 'faturista', ativo: true } });
    const lida = await t.chamar('GET', '/usuarios/:id', { params: { id: c.id } });
    expect(JSON.stringify(lida.corpo)).not.toContain('senha');
  });

  it('RN-CORE-05: reenvio com o mesmo external_id não duplica nem gera senha nova; e-mail repetido é 409', async () => {
    const t = montar();
    const a = await t.chamar('POST', '/usuarios', { corpo: { ...novo, external_id: 'ext-1' } });
    const b = await t.chamar('POST', '/usuarios', { corpo: { ...novo, email: 'outro@piloto.test', external_id: 'ext-1' } });
    expect(b.status).toBe(200);
    expect((b.corpo as { id: string }).id).toBe((a.corpo as { id: string }).id);
    expect(b.corpo).not.toHaveProperty('senha_provisoria');
    expect(t.repo.usuarios).toHaveLength(2);
    await expect(t.chamar('POST', '/usuarios', { corpo: { ...novo, email: 'MARIA@piloto.test' } })).rejects.toMatchObject({ status: 409 });
  });

  it('RN-CORE-05: reenvio com o external_id de usuário excluído é 409 (não 500) e não reativa nem duplica', async () => {
    const t = montar();
    const a = await t.chamar('POST', '/usuarios', { corpo: { ...novo, external_id: 'ext-9' } });
    await t.chamar('POST', '/usuarios/:id/excluir', { params: { id: (a.corpo as { id: string }).id } });
    const antes = t.repo.usuarios.length;
    await expect(t.chamar('POST', '/usuarios', { corpo: { ...novo, email: 'volta@piloto.test', external_id: 'ext-9' } })).rejects.toMatchObject({ status: 409 });
    expect(t.repo.usuarios).toHaveLength(antes);
  });

  it('RN-CORE-18: e-mail vivo em outra empresa é recusado com 409 email_em_uso e nada é gravado', async () => {
    const t = montar();
    t.repo.emailsEmOutrasContas.add('rita@outra.test');
    const antes = t.repo.usuarios.length;
    await expect(t.chamar('POST', '/usuarios', { corpo: { ...novo, email: ' RITA@Outra.test ' } })).rejects.toMatchObject(corpoEmailEmUso());
    expect(t.repo.usuarios).toHaveLength(antes);
  });

  it('RN-CORE-01: um perfil por usuário e ao menos uma filial (400)', async () => {
    const t = montar();
    await expect(t.chamar('POST', '/usuarios', { corpo: { ...novo, perfil: 'dono' } })).rejects.toThrow();
    await expect(t.chamar('POST', '/usuarios', { corpo: { ...novo, filial_ids: [] } })).rejects.toThrow();
  });

  it('RN-CORE-01: não inativa, exclui nem rebaixa o último administrador ativo (422)', async () => {
    const t = montar();
    await regra(t.chamar('PATCH', '/usuarios/:id', { params: { id: ADM_ID }, corpo: { ativo: false } }), 'RN-CORE-01');
    await regra(t.chamar('PATCH', '/usuarios/:id', { params: { id: ADM_ID }, corpo: { perfil: 'gerente' } }), 'RN-CORE-01');
    await regra(t.chamar('DELETE', '/usuarios/:id', { params: { id: ADM_ID } }), 'RN-CORE-01');
    const c = (await t.chamar('POST', '/usuarios', { corpo: { ...novo, perfil: 'administrador' } })).corpo as { id: string };
    expect((await t.chamar('PATCH', '/usuarios/:id', { params: { id: ADM_ID }, corpo: { ativo: false } })).corpo).toMatchObject({ ativo: false });
    await regra(t.chamar('DELETE', '/usuarios/:id', { params: { id: c.id } }), 'RN-CORE-01');
  });

  it('RN-CORE-01: a alteração trava os administradores ativos antes de contar (serializa PATCH e DELETE simultâneos)', async () => {
    const t = montar();
    const c = (await t.chamar('POST', '/usuarios', { corpo: { ...novo, perfil: 'administrador' } })).corpo as { id: string };
    t.repo.chamadasAdministradores.length = 0;
    await t.chamar('PATCH', '/usuarios/:id', { params: { id: c.id }, corpo: { ativo: false } });
    expect(t.repo.chamadasAdministradores).toEqual(['travar', 'contar']);
    t.repo.chamadasAdministradores.length = 0;
    await regra(t.chamar('DELETE', '/usuarios/:id', { params: { id: ADM_ID } }), 'RN-CORE-01');
    expect(t.repo.chamadasAdministradores).toEqual(['travar', 'contar']);
  });

  it('RF-CORE-02: PATCH de usuário com token vencido é 409 atômico (o UPDATE não afeta linha) e sem token segue', async () => {
    const t = montar();
    const c = (await t.chamar('POST', '/usuarios', { corpo: novo })).corpo as { id: string };
    const lido = ((await t.chamar('GET', '/usuarios/:id', { params: { id: c.id } })).cabecalhos as { ETag: string }).ETag;
    await t.chamar('PATCH', '/usuarios/:id', { params: { id: c.id }, agora: new Date('2026-11-21T16:00:00Z'), corpo: { nome: 'Novo Nome', updated_at: lido } });
    const aud = t.auditoria.registros.length;
    await expect(t.chamar('PATCH', '/usuarios/:id', { params: { id: c.id }, corpo: { nome: 'Outro', updated_at: lido } })).rejects.toMatchObject({ status: 409 });
    expect(t.auditoria.registros).toHaveLength(aud);
    expect((await t.chamar('PATCH', '/usuarios/:id', { params: { id: c.id }, corpo: { nome: 'Sem Token' } })).corpo).toMatchObject({ nome: 'Sem Token' });
  });

  it('RN-CORE-17: POST inativar é reversível (situação inativo, segue na lista com inativos) e reativar volta a ativo', async () => {
    const t = montar();
    const c = (await t.chamar('POST', '/usuarios', { corpo: novo })).corpo as { id: string };
    const ina = await t.chamar('POST', '/usuarios/:id/inativar', { params: { id: c.id } });
    expect(ina.corpo).toMatchObject({ id: c.id, ativo: false, situacao: 'inativo' });
    expect(t.repo.usuarios.find((u) => u.id === c.id)?.deleted_at ?? null).toBeNull();
    const todos = (await t.chamar('GET', '/usuarios', { consulta: { inativos: 'true' } })).corpo as { itens: unknown[] };
    expect(todos.itens).toHaveLength(2);
    // O e-mail do inativo continua reservado.
    await expect(t.chamar('POST', '/usuarios', { corpo: novo })).rejects.toMatchObject({ status: 409 });
    const rea = await t.chamar('POST', '/usuarios/:id/reativar', { params: { id: c.id } });
    expect(rea.corpo).toMatchObject({ ativo: true, situacao: 'ativo' });
    expect(t.auditoria.registros.map((a) => (a as { acao: string }).acao).slice(-2)).toEqual(['core.usuario.inativado', 'core.usuario.reativado']);
  });

  it('RN-CORE-17: excluir grava deleted_at, some da lista e do GET (404) e libera o e-mail; RN-CORE-01 trava o último admin', async () => {
    const t = montar();
    const c = (await t.chamar('POST', '/usuarios', { corpo: novo })).corpo as { id: string };
    const r = await t.chamar('POST', '/usuarios/:id/excluir', { params: { id: c.id } });
    expect(r.corpo).toEqual({ id: c.id, situacao: 'excluido' });
    expect(t.repo.usuarios.find((u) => u.id === c.id)?.deleted_at).toEqual(AGORA);
    const todos = (await t.chamar('GET', '/usuarios', { consulta: { inativos: 'true' } })).corpo as { itens: { id: string }[] };
    expect(todos.itens.map((u) => u.id)).toEqual([ADM_ID]);
    await expect(t.chamar('GET', '/usuarios/:id', { params: { id: c.id } })).rejects.toMatchObject({ status: 404 });
    await expect(t.chamar('POST', '/usuarios/:id/excluir', { params: { id: c.id } })).rejects.toMatchObject({ status: 404 });
    expect((await t.chamar('POST', '/usuarios', { corpo: novo })).status).toBe(201);
    expect(t.auditoria.registros.some((a) => (a as { acao: string }).acao === 'core.usuario.excluido')).toBe(true);
    expect(t.outbox.eventos.some((e) => (e.payload as { id: string; ativo: boolean }).id === c.id && !(e.payload as { ativo: boolean }).ativo)).toBe(true);
    await regra(t.chamar('POST', '/usuarios/:id/excluir', { params: { id: ADM_ID } }), 'RN-CORE-01');
  });

  it('RF-CORE-02: DELETE inativa, publica ativo=false e a lista esconde inativos por padrão; PATCH exige algo para alterar', async () => {
    const t = montar();
    const c = (await t.chamar('POST', '/usuarios', { corpo: novo })).corpo as { id: string };
    expect((await t.chamar('DELETE', '/usuarios/:id', { params: { id: c.id } })).status).toBe(204);
    expect(t.outbox.eventos.at(-1)?.payload).toMatchObject({ id: c.id, ativo: false });
    const ativos = (await t.chamar('GET', '/usuarios')).corpo as { itens: unknown[] };
    expect(ativos.itens).toHaveLength(1);
    const todos = (await t.chamar('GET', '/usuarios', { consulta: { inativos: 'true' } })).corpo as { itens: unknown[] };
    expect(todos.itens).toHaveLength(2);
    await expect(t.chamar('PATCH', '/usuarios/:id', { params: { id: c.id }, corpo: {} })).rejects.toThrow();
    await expect(t.chamar('GET', '/usuarios/:id', { params: { id: 'nao-uuid' } })).rejects.toMatchObject({ status: 400 });
    await expect(t.chamar('GET', '/usuarios/:id', { params: { id: FILIAL } })).rejects.toMatchObject({ status: 404 });
  });

  it('RF-CORE-02: lista pagina por id com proximo_cursor', async () => {
    const t = montar();
    for (const n of ['a', 'b', 'c']) await t.chamar('POST', '/usuarios', { corpo: { ...novo, email: `${n}@piloto.test` } });
    const p1 = (await t.chamar('GET', '/usuarios', { consulta: { limite: '2' } })).corpo as { itens: { id: string }[]; proximo_cursor: string | null };
    expect(p1.itens).toHaveLength(2);
    expect(p1.proximo_cursor).toBe(p1.itens[1]?.id);
    const p2 = (await t.chamar('GET', '/usuarios', { consulta: { limite: '2', cursor: p1.proximo_cursor } })).corpo as { itens: unknown[]; proximo_cursor: string | null };
    expect(p2.itens).toHaveLength(2);
    expect(p2.proximo_cursor).toBeNull();
  });

  it('RF-CORE-02: redefinir senha dá outra provisória, sem cache, e a auditoria não a guarda', async () => {
    const t = montar();
    const antes = t.repo.usuarios[0]?.senha_hash;
    const r = await t.chamar('POST', '/usuarios/:id/redefinir-senha', { params: { id: ADM_ID } });
    const { senha_provisoria } = r.corpo as { senha_provisoria: string };
    expect(senha_provisoria).toHaveLength(18);
    expect(r.cabecalhos?.['cache-control']).toBe('no-store');
    expect(t.repo.usuarios[0]?.senha_hash).not.toBe(antes);
    expect(JSON.stringify(t.auditoria.registros)).not.toContain(senha_provisoria);
    expect(t.auditoria.registros[0]).toMatchObject({ acao: 'core.usuario.senha_redefinida', entidade_id: ADM_ID });
  });
});

describe('RN-CORE-08: ambiente fiscal por filial', () => {
  it('RN-CORE-08: sem linha vale homologação', async () => {
    const t = montar();
    const r = await t.chamar('GET', '/ambientes-fiscais', { consulta: { filial_id: FILIAL } });
    expect(r.corpo).toEqual({ itens: [{ filial_id: FILIAL, ambiente: 'homologacao', recado_aprovacao: null }] });
  });

  const RECADO = 'R-20261121-153000-alexandre';
  const corpos: [string, Record<string, unknown>][] = [
    ['produção', { ambiente: 'producao' }],
    ['produção com recado', { ambiente: 'producao', recado_aprovacao: RECADO }],
    ['homologação', { ambiente: 'homologacao' }],
    ['homologação com recado', { ambiente: 'homologacao', recado_aprovacao: RECADO }],
  ];
  const atuais: [string, LinhaAmbiente | null][] = [
    ['sem linha', null],
    ['homologação', { filial_id: FILIAL, ambiente: 'homologacao', recado_aprovacao: null }],
    ['produção', { filial_id: FILIAL, ambiente: 'producao', recado_aprovacao: RECADO }],
  ];

  for (const [nomeAtual, atual] of atuais) {
    for (const [nomeCorpo, corpo] of corpos) {
      it(`RN-CORE-08: atual ${nomeAtual} x corpo ${nomeCorpo}`, async () => {
        const t = montar();
        if (atual) t.repo.ambientesLinhas.push({ ...atual });
        const antes = JSON.parse(JSON.stringify(t.repo.ambientesLinhas));
        const r = t.chamar('PUT', '/ambientes-fiscais/:filial_id', { params: { filial_id: FILIAL }, corpo });
        const semEfeito = corpo.ambiente === 'producao' || atual?.ambiente === 'homologacao';
        if (corpo.ambiente === 'producao') await regra(r, 'RN-CORE-08');
        else expect((await r).corpo).toEqual({ filial_id: FILIAL, ambiente: 'homologacao', recado_aprovacao: null });
        if (semEfeito) {
          expect(JSON.parse(JSON.stringify(t.repo.ambientesLinhas))).toEqual(antes);
          expect(t.auditoria.registros).toHaveLength(0);
          expect(t.outbox.eventos).toHaveLength(0);
          return;
        }
        expect(t.repo.ambientesLinhas).toHaveLength(1);
        expect(t.repo.ambientesLinhas[0]).toMatchObject({ ambiente: 'homologacao', recado_aprovacao: null, alterado_por: ADM_ID });
        expect(t.auditoria.registros).toHaveLength(1);
        expect(t.auditoria.registros[0]).toMatchObject({
          acao: 'core.ambiente.trocado',
          entidade_id: FILIAL,
          antes: { ambiente: atual?.ambiente ?? 'homologacao', recado_aprovacao: atual?.recado_aprovacao ?? null },
          depois: { filial_id: FILIAL, ambiente: 'homologacao', recado_aprovacao: null, origem: 'api' },
        });
        expect(t.outbox.eventos).toHaveLength(1);
        expect(t.outbox.eventos[0]).toMatchObject({ nome: 'core.ambiente_fiscal.alterado@1', agregado_id: FILIAL });
      });
    }
  }

  it('RN-CORE-08: o repositório em memória recusa produção, como a RLS (o core nunca tenta)', async () => {
    const t = montar();
    const tx = { consultar: async () => [] };
    await expect(t.repo.gravarAmbiente(tx, { filial_id: FILIAL, ambiente: 'producao' as never, recado_aprovacao: RECADO, alterado_por: ADM_ID })).rejects.toThrow(/RLS/);
  });

  it('RN-CORE-08: fiscal, faturista e gerente não trocam o ambiente (403)', async () => {
    const t = montar();
    for (const perfil of ['fiscal', 'faturista', 'gerente'] as const) {
      await expect(t.chamar('PUT', '/ambientes-fiscais/:filial_id', { perfil, params: { filial_id: FILIAL }, corpo: { ambiente: 'homologacao' } })).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('RF-CORE-04: certificado A1 (ADR 0005)', () => {
  const dados = (o: Partial<DadosPfx> = {}): DadosPfx => ({
    titular: 'EMPRESA PILOTO LTDA',
    cnpj: '11222333000262',
    valido_de: new Date('2026-01-10T00:00:00Z'),
    valido_ate: new Date('2027-01-10T00:00:00Z'),
    impressao_digital: 'ab'.repeat(32),
    ...o,
  });
  /** POST /certificados é multipart: campos de texto em `corpo` e o `.pfx` em `arquivos.arquivo`. */
  const envio = (pfx: Buffer, senha = 'senha-do-teste') => ({ corpo: { filial_id: FILIAL, senha }, arquivos: { arquivo: new ArquivoRecebido('arquivo', 'a1.pfx', 'application/x-pkcs12', pfx) } });

  it('RF-CORE-04: grava cifrado, devolve só o resumo e nada de .pfx ou senha em resposta, auditoria ou evento', async () => {
    const leitor = new LeitorFalso();
    leitor.dados = dados();
    const t = montar(leitor);
    const pfx = randomBytes(900);
    const r = await t.chamar('POST', '/certificados', envio(pfx));
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ filial_id: FILIAL, cnpj: '11222333000262', dias_para_vencer: 49, alerta_vencimento: false, ativo: true, origem: 'upload' });
    const guardado = t.repo.certificadosLinhas[0];
    expect(guardado?.pfx_cifrado?.includes(pfx.subarray(0, 32))).toBe(false);
    const volta = abrirColunasA1({ chave: lerChaveA1(CHAVE_HEX), tenantId: TENANT, pfx_cifrado: guardado?.pfx_cifrado as Buffer, pfx_nonce: guardado?.pfx_nonce as Buffer, senha_cifrada: guardado?.senha_cifrada as Buffer, senha_nonce: guardado?.senha_nonce as Buffer });
    expect(volta.pfx.equals(pfx)).toBe(true);
    expect(volta.senha).toBe('senha-do-teste');
    const rastro = JSON.stringify([r.corpo, t.auditoria.registros, t.outbox.eventos]);
    expect(rastro).not.toContain('senha-do-teste');
    expect(rastro).not.toContain(pfx.toString('base64').slice(0, 40));
    expect(rastro).not.toMatch(/pfx|cifrad|nonce/i);
    expect(t.outbox.eventos[0]).toMatchObject({ nome: 'core.certificado.alterado@1' });
    const lista = JSON.stringify((await t.chamar('GET', '/certificados', { consulta: { filial_id: FILIAL } })).corpo);
    expect(lista).not.toMatch(/pfx|senha|cifrad|nonce/i);
    expect(lista).toContain('"origem":"upload"');
    t.repo.certificadosLinhas[0]!.origem = 'teste';
    expect(JSON.stringify((await t.chamar('GET', '/certificados', {})).corpo)).toContain('"origem":"teste"');
  });

  it('RN-CORE-06: vencido é 422 com "Certificado vencido em DD/MM/AAAA: envie o novo"', async () => {
    const leitor = new LeitorFalso();
    leitor.dados = dados({ valido_ate: new Date('2026-11-01T03:00:00Z') });
    const t = montar(leitor);
    const e = await regra(t.chamar('POST', '/certificados', envio(randomBytes(100))), 'RN-CORE-06');
    expect(e.message).toBe('Certificado vencido em 31/10/2026: envie o novo');
    expect(t.repo.certificadosLinhas).toHaveLength(0);
  });

  it('RN-CORE-06: outra raiz de CNPJ e senha errada são 422 e nada é gravado', async () => {
    const leitor = new LeitorFalso();
    leitor.dados = dados({ cnpj: '99888777000155' });
    const t = montar(leitor);
    await regra(t.chamar('POST', '/certificados', envio(randomBytes(100))), 'RN-CORE-06');
    leitor.dados = null; // o leitor falha como falha com senha errada
    const e = await regra(t.chamar('POST', '/certificados', envio(randomBytes(100), 'senha-errada')), 'RN-CORE-06');
    expect(e.message).not.toContain('senha-errada');
    expect(t.repo.certificadosLinhas).toHaveLength(0);
  });

  it('ADR 0005: .pfx vazio é 400 (o limite de 50 KB é do multipart); novo certificado substitui o ativo da filial', async () => {
    const leitor = new LeitorFalso();
    leitor.dados = dados();
    const t = montar(leitor);
    await expect(t.chamar('POST', '/certificados', envio(Buffer.alloc(0)))).rejects.toMatchObject({ status: 400 });
    await t.chamar('POST', '/certificados', envio(randomBytes(100)));
    await t.chamar('POST', '/certificados', envio(randomBytes(100)));
    expect(t.repo.certificadosLinhas.map((c) => c.ativo)).toEqual([false, true]);
  });

  it('RF-CORE-04: a rota declara multipart com o campo arquivo até 50 KB e sem arquivo_base64', () => {
    const rota = montar(new LeitorFalso()).plugin.rotas.find((r) => r.metodo === 'POST' && r.caminho === '/certificados');
    expect(rota?.multipart).toEqual({ arquivos: [{ campo: 'arquivo', tamanhoMaximo: 50 * 1024 }] });
    expect(JSON.stringify(rota?.corpo?.safeParse({ filial_id: FILIAL, senha: 'x' }))).not.toContain('arquivo');
  });

  it('RN-CORE-06: sem o campo arquivo, 400', async () => {
    const t = montar(new LeitorFalso());
    await expect(t.chamar('POST', '/certificados', { corpo: { filial_id: FILIAL, senha: 'x' } })).rejects.toMatchObject({ status: 400 });
  });

  it('RF-CORE-04: o resumo marca alerta a 30 dias ou menos de vencer', async () => {
    const leitor = new LeitorFalso();
    leitor.dados = dados({ valido_ate: new Date('2026-12-10T12:00:00Z') });
    const t = montar(leitor);
    const r = await t.chamar('POST', '/certificados', envio(randomBytes(100)));
    expect(r.corpo).toMatchObject({ dias_para_vencer: 18, alerta_vencimento: true });
  });
  it('RN-CORE-08: erro MXA01 do banco no envio do A1 vira 422 com o detalhe; outro erro pg continua subindo', async () => {
    const leitor = new LeitorFalso();
    leitor.dados = dados();
    const t = montar(leitor);
    const falha = (e: object) => vi.spyOn(t.repo, 'substituirCertificado').mockRejectedValueOnce(e);
    falha({ code: 'MXA01', detail: 'a1_de_teste_em_producao', message: 'certificado A1 de teste não pode ser usado em filial em produção; envie o certificado real' });
    const e = (await regra(t.chamar('POST', '/certificados', envio(randomBytes(100))), 'RN-CORE-08')) as ErroApi;
    expect(e.detalhes).toEqual({ motivo: 'a1_de_teste_em_producao' });
    expect(e.message).toContain('envie o certificado real');
    falha({ code: '23505', message: 'x' });
    await expect(t.chamar('POST', '/certificados', envio(randomBytes(100)))).rejects.toMatchObject({ code: '23505' });
  });

});

describe('RF-CORE-04: leitura real do .pfx (certificado de teste gerado no próprio teste)', () => {
  const temOpenssl = (() => {
    try {
      execFileSync('openssl', ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  function gerarPfx(cn: string, senha: string, cnpjNoSan?: string): Buffer {
    const dir = mkdtempSync(join(tmpdir(), 'pfx-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-subj', `/CN=${cn}`, ...(cnpjNoSan ? ['-addext', `subjectAltName=otherName:2.16.76.1.3.3;UTF8:${cnpjNoSan}`] : []), '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
      execFileSync('openssl', ['pkcs12', '-export', '-inkey', join(dir, 'k.pem'), '-in', join(dir, 'c.pem'), '-out', join(dir, 'a.pfx'), '-passout', `pass:${senha}`], { stdio: 'ignore' });
      return readFileSync(join(dir, 'a.pfx'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // A geração de chave RSA pelo openssl é a parte lenta: gera os três A1 uma vez por arquivo, fora do tempo dos testes.
  let pfx: Buffer;
  let pfxOutraRaiz: Buffer;
  let pfxSanDivergente: Buffer;
  beforeAll(() => {
    if (!temOpenssl) return;
    pfx = gerarPfx('EMPRESA PILOTO LTDA:11222333000262', 'senha-gerada-no-teste');
    pfxOutraRaiz = gerarPfx('OUTRA EMPRESA SA:11444777000161', 'x-teste');
    pfxSanDivergente = gerarPfx('EMPRESA PILOTO LTDA:11222333000262', 'x-teste', '11444777000161');
  }, 60_000);

  it.skipIf(!temOpenssl)('RN-CORE-06: lê titular, CNPJ, validade e impressão digital; senha errada falha sem vazar', async () => {
    const leitor = new LeitorPfxTls();
    const d = await leitor.abrir(pfx, 'senha-gerada-no-teste');
    expect(d.cnpj).toBe('11222333000262');
    expect(d.titular).toBe('EMPRESA PILOTO LTDA');
    expect(d.impressao_digital).toMatch(/^[0-9a-f]{64}$/);
    expect(d.valido_ate.getTime()).toBeGreaterThan(d.valido_de.getTime());
    const e = await leitor.abrir(pfx, 'errada').then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(PfxInvalido);
    expect(String((e as Error).message)).not.toContain('errada');
    await expect(leitor.abrir(Buffer.from('lixo'), 'x')).rejects.toBeInstanceOf(PfxInvalido);
  });

  it.skipIf(!temOpenssl)('RN-CORE-06: de ponta a ponta, o A1 real da mesma raiz entra e, depois da validade, é recusado', async () => {
    const t = montar(new LeitorPfxTls());
    const dados = await new LeitorPfxTls().abrir(pfx, 'senha-gerada-no-teste');
    const envio = { corpo: { filial_id: FILIAL, senha: 'senha-gerada-no-teste' }, arquivos: { arquivo: new ArquivoRecebido('arquivo', 'a1.pfx', 'application/x-pkcs12', pfx) } };
    const dentro = new Date(dados.valido_de.getTime() + 86_400_000);
    expect((await t.chamar('POST', '/certificados', { ...envio, agora: dentro })).status).toBe(201);
    const depois = new Date(dados.valido_ate.getTime() + 86_400_000);
    await regra(t.chamar('POST', '/certificados', { ...envio, agora: depois }), 'RN-CORE-06');
  });

  it.skipIf(!temOpenssl)('RN-CORE-06: upload com SAN divergente é 422 com a mensagem fixa e sem o CNPJ na resposta', async () => {
    const t = montar(new LeitorPfxTls());
    const e = await regra(t.chamar('POST', '/certificados', { corpo: { filial_id: FILIAL, senha: 'x-teste' }, arquivos: { arquivo: new ArquivoRecebido('arquivo', 'a1.pfx', 'application/x-pkcs12', pfxSanDivergente) } }), 'RN-CORE-06');
    const texto = e.message + JSON.stringify(e);
    expect(texto).toContain('o CNPJ do SAN difere do CNPJ do CN');
    expect(texto).not.toMatch(/11222333000262|11444777000161|x-teste/);
  });

  it.skipIf(!temOpenssl)('RN-CORE-06: A1 de outra raiz de CNPJ é recusado com o arquivo real', async () => {
    const t = montar(new LeitorPfxTls());
    const d = await new LeitorPfxTls().abrir(pfxOutraRaiz, 'x-teste');
    await regra(t.chamar('POST', '/certificados', { corpo: { filial_id: FILIAL, senha: 'x-teste' }, arquivos: { arquivo: new ArquivoRecebido('arquivo', 'a1.pfx', 'application/x-pkcs12', pfxOutraRaiz) }, agora: new Date(d.valido_de.getTime() + 86_400_000) }), 'RN-CORE-06');
  });
});

describe('RF-CORE-05 e RF-CORE-06: auditoria, exportação e parâmetros', () => {
  it('RF-CORE-06: pedir exportação responde 202, enfileira o trabalho do worker e audita; consulta devolve link assinado só quando pronta', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/exportacoes');
    expect(r.status).toBe(202);
    const { id } = r.corpo as { id: string; estado: string; url: string | null };
    expect(r.corpo).toMatchObject({ estado: 'pendente', url: null });
    expect(t.fila.pedidos[0]).toMatchObject({ tipo: 'core.exportar_dados', tenant_id: TENANT, payload: { exportacao_id: id } });
    expect(t.auditoria.registros[0]).toMatchObject({ acao: 'core.exportacao.pedida' });
    expect((await t.chamar('GET', '/exportacoes/:id', { params: { id } })).corpo).toMatchObject({ estado: 'pendente', url: null });
    const e = t.repo.exportacoes[0];
    if (e) Object.assign(e, { estado: 'pronta', arquivo_id: FILIAL });
    t.repo.arquivos.set(FILIAL, `macuxierp/${TENANT}/exportacoes/x.zip`);
    const pronta = (await t.chamar('GET', '/exportacoes/:id', { params: { id } })).corpo as { url: string };
    expect(pronta.url).toContain(`macuxierp/${TENANT}/exportacoes/x.zip`);
    await expect(t.chamar('GET', '/exportacoes/:id', { params: { id: ADM_ID } })).rejects.toMatchObject({ status: 404 });
  });

  it('T-0124 / RN-CORE-07: sem o armazenamento S3 (secrets MACUXI_S3_*) a exportação não é pedida, não grava, não enfileira e a tela fica oculta', async () => {
    const t = montar(undefined, armazenamentoIndisponivel);
    expect((await t.chamar('GET', '/exportacoes/disponibilidade')).corpo).toEqual({ disponivel: false });
    await expect(t.chamar('POST', '/exportacoes')).rejects.toMatchObject({ status: 503 });
    expect(t.repo.exportacoes).toHaveLength(0);
    expect(t.fila.pedidos).toHaveLength(0);
  });

  it('T-0124: com o armazenamento a exportação está disponível e a auditoria leva só o id da exportação (sem dado pessoal)', async () => {
    const t = montar();
    expect((await t.chamar('GET', '/exportacoes/disponibilidade')).corpo).toEqual({ disponivel: true });
    await t.chamar('POST', '/exportacoes');
    const reg = JSON.stringify(t.auditoria.registros[0]);
    expect(reg).not.toMatch(/admin@piloto|Admin|11222333000181|Empresa Piloto/);
    await expect(t.chamar('GET', '/exportacoes/disponibilidade', { perfil: 'vendedor' })).rejects.toMatchObject({ status: 403 });
  });

  it('RF-CORE-05: a consulta da auditoria filtra por entidade e período e é só do administrador', async () => {
    const t = montar();
    t.repo.auditoriaLinhas = [
      { id: '00000000-0000-4000-8000-000000000001', usuario_id: ADM_ID, acao: 'a', entidade: 'usuario', entidade_id: null, antes: null, depois: null, ocorrido_em: new Date('2026-11-01T00:00:00Z') },
      { id: '00000000-0000-4000-8000-000000000002', usuario_id: ADM_ID, acao: 'b', entidade: 'empresa', entidade_id: null, antes: null, depois: null, ocorrido_em: new Date('2026-11-10T00:00:00Z') },
    ];
    const r = (await t.chamar('GET', '/auditoria', { consulta: { entidade: 'empresa', de: '2026-11-05T00:00:00Z' } })).corpo as { itens: { acao: string }[] };
    expect(r.itens.map((i) => i.acao)).toEqual(['b']);
    await expect(t.chamar('GET', '/auditoria', { perfil: 'gerente' })).rejects.toMatchObject({ status: 403 });
  });

  it('RF-CORE-01: parâmetro grava, audita antes e depois e recusa chave inválida', async () => {
    const t = montar();
    await t.chamar('PUT', '/parametros/:chave', { params: { chave: 'fuso.padrao' }, corpo: { valor: 'America/Manaus' } });
    await t.chamar('PUT', '/parametros/:chave', { params: { chave: 'fuso.padrao' }, corpo: { valor: 'America/Sao_Paulo' } });
    expect(t.auditoria.registros[1]).toMatchObject({ antes: 'America/Manaus', depois: 'America/Sao_Paulo' });
    expect((await t.chamar('GET', '/parametros')).corpo).toEqual({ itens: [{ chave: 'fuso.padrao', valor: 'America/Sao_Paulo' }] });
    await expect(t.chamar('PUT', '/parametros/:chave', { params: { chave: 'Chave Ruim' }, corpo: { valor: 1 } })).rejects.toMatchObject({ status: 400 });
  });
});

describe('RD-0005: parâmetros de rota', () => {
  it('RD-0005: id que não é UUID responde 400 em usuário, ambiente e exportação', async () => {
    const t = montar();
    await expect(t.chamar('GET', '/usuarios/:id', { params: { id: 'x' } })).rejects.toMatchObject({ status: 400 });
    await expect(t.chamar('PUT', '/ambientes-fiscais/:filial_id', { params: { filial_id: 'x' }, corpo: { ambiente: 'homologacao' } })).rejects.toMatchObject({ status: 400 });
    await expect(t.chamar('GET', '/exportacoes/:id', { params: { id: 'x' } })).rejects.toMatchObject({ status: 400 });
  });
});

describe('T-0087 (RF-CORE-02/03/05): telas de usuários, perfis, licenças e auditoria', () => {
  const ROTAS_DA_TELA = [
    ['GET', '/usuarios'], ['GET', '/usuarios/exportar'], ['POST', '/usuarios'], ['PATCH', '/usuarios/:id'], ['DELETE', '/usuarios/:id'],
    ['POST', '/usuarios/:id/redefinir-senha'], ['GET', '/perfis'], ['GET', '/licencas'], ['GET', '/licencas/exportar'],
    ['GET', '/auditoria'], ['GET', '/auditoria/exportar'],
  ] as const;
  const SESSAO = (perfil: Perfil, tenant = TENANT) => ({ usuario_id: ADM_ID, tenant_id: tenant, perfil, filial_ids: [FILIAL] });

  it('RN-CORE-09: sessão, perfil, tenant e licença do core em toda rota da tela: sem sessão 401, fora do administrador 403, o core é módulo base e a transação abre no tenant da sessão', async () => {
    const t = montar();
    const licencas = (ativas: boolean) => ({ ler: async () => [{ modulo: 'core' as const, ativo: ativas, valido_ate: null }] });
    for (const [metodo, caminho] of ROTAS_DA_TELA) {
      const rota = t.plugin.rotas.find((r) => r.metodo === metodo && r.caminho === caminho);
      if (!rota) throw new Error(`rota inexistente ${metodo} ${caminho}`);
      const rodar = (sessao: ReturnType<typeof SESSAO> | null, ativa = true, banco = new BancoMemoria()) =>
        executarAutorizado({ sessao, acao: rota.acao, agora: AGORA, banco, licencas: licencas(ativa), executar: async () => 'ok' });
      await expect(rodar(null)).rejects.toMatchObject({ status: 401 });
      for (const perfil of PERFIS.filter((p) => p !== 'administrador')) await expect(rodar(SESSAO(perfil))).rejects.toMatchObject({ status: 403, codigo: 'PERFIL_SEM_PERMISSAO' });
      // O core é o módulo base (MODULOS_BASE): sem linha de licença ativa o administrador ainda entra, para ver as licenças e pedir a regularização.
      await expect(rodar(SESSAO('administrador'), false)).resolves.toBe('ok');
      const banco = new BancoMemoria();
      await expect(rodar(SESSAO('administrador'), true, banco)).resolves.toBe('ok');
      expect(banco.aberturas).toEqual([TENANT]); // a transação abre no tenant da sessão, não em outro
    }
  });

  it('RF-CORE-05: a auditoria filtra pelo usuário, não leva antes/depois na lista nem no CSV e o CSV segue os mesmos filtros', async () => {
    const t = montar();
    const OUTRO = '99999999-9999-4999-8999-999999999999';
    t.repo.auditoriaLinhas = [
      { id: '00000000-0000-4000-8000-000000000001', usuario_id: ADM_ID, acao: 'core.usuario.criado', entidade: 'usuario', entidade_id: null, antes: { nome: 'Fulano Real' }, depois: { nome: 'Fulano Real' }, ocorrido_em: new Date('2026-11-10T00:00:00Z') },
      { id: '00000000-0000-4000-8000-000000000002', usuario_id: OUTRO, acao: 'core.empresa.alterada', entidade: 'empresa', entidade_id: null, antes: null, depois: null, ocorrido_em: new Date('2026-11-11T00:00:00Z') },
    ];
    const lista = (await t.chamar('GET', '/auditoria', { consulta: { usuario_id: OUTRO } })).corpo as { itens: Record<string, unknown>[] };
    expect(lista.itens.map((i) => i.acao)).toEqual(['core.empresa.alterada']);
    const todos = (await t.chamar('GET', '/auditoria')).corpo as { itens: Record<string, unknown>[] };
    expect(todos.itens.every((i) => !('antes' in i) && !('depois' in i))).toBe(true);
    const csv = await t.chamar('GET', '/auditoria/exportar', { consulta: { usuario_id: ADM_ID, de: '2026-11-01T00:00:00Z', ate: '2026-11-30T00:00:00Z' } });
    expect(String(csv.corpo)).toContain('Usuário criado');
    expect(String(csv.corpo)).not.toContain('Empresa alterada');
    expect(String(csv.corpo)).not.toContain('Fulano Real');
    await expect(t.chamar('GET', '/auditoria', { consulta: { usuario_id: 'nao-uuid' } })).rejects.toThrow();
  });

  it('RF-CORE-02: o CSV de usuários e o de licenças saem só para o administrador, com cabeçalho e respeitando a busca', async () => {
    const t = montar();
    t.repo.licencasLinhas = [{ modulo: 'cadastros', ativo: true, valido_ate: null }];
    await t.chamar('POST', '/usuarios', { corpo: { nome: 'Maria Teste', email: 'maria@piloto.test', perfil: 'leitura', filial_ids: [FILIAL] } });
    const csv = String((await t.chamar('GET', '/usuarios/exportar', { consulta: { busca: 'maria' } })).corpo);
    expect(csv).toContain('Maria Teste');
    expect(csv).not.toContain('admin@piloto.test');
    expect(csv).not.toContain('senha');
    expect(csv).toContain(';Leitura;Ativo;');
    expect(String((await t.chamar('GET', '/licencas/exportar')).corpo)).toContain('Cadastros;sim;Sem prazo');
  });
});
