/**
 * Rotas do portal (`validar` e `gravar`, `por_etapa`) sobre o dublê em memória: a ordem das etapas (iniciar → tenant →
 * concluir), o concluir `falhou` quando o tenant falha, estoque 400 e frase 422. O banco real é o `carga-portal-rotas.db.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, CAMINHOS_CARGAS_PLATAFORMA, ENTIDADES_CARGA_PORTAL, ErroApi, TIPO_CSV, type ContextoPlataformaPorEtapa, type SituacaoCargasPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarPluginPlataformaCadastros, situacaoDaAba } from './carga-portal-rotas';
import { dependenciasEmMemoria } from './memoria';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const csv = (nome: string) => readFileSync(join(pasta, `${nome}.csv`));
const TENANT = '11111111-1111-4111-8111-111111111111';
const EXEC = '33333333-3333-4333-8333-333333333333';
const FRASE = 'autorizo substituir tudo';
const SITUACAO = {
  empresa_id: TENANT, modulo_licenciado: true,
  cadastros: ENTIDADES_CARGA_PORTAL.map((cadastro) => ({ cadastro, ativos: cadastro === 'filial' ? 2 : 0, erros: 0, ultima_carga: null })),
};

function montar() {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.ncms.add('21069030');
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  m.repos.oficiais.municipiosPorUf.set('SP', [{ ibge: '3550308', nome: 'São Paulo' }]);
  const passos: string[] = [];
  const sqls: { sql: string; p: readonly unknown[] }[] = [];
  const eventos: string[] = [];
  const tx = (): Transacao => ({
    consultar: (async (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      if (sql.includes('portal_carga_iniciar')) return [{ id: EXEC }];
      if (sql.includes('portal_carga_situacao')) return [{ ok: true, situacao: SITUACAO }];
      return [];
    }) as Transacao['consultar'],
  });
  const c = {
    sessao: { superadmin_id: '44444444-4444-4444-8444-444444444444', sessao_id: 's' }, request_id: 'req-1', agora: new Date('2026-11-23T15:00:00Z'),
    comPlataforma: async <R>(f: (t: Transacao) => Promise<R>) => { passos.push('plataforma'); return f(tx()); },
    comTenant: async <R>(id: string, f: (t: Transacao) => Promise<R>) => { passos.push(`tenant:${id}`); return f(tx()); },
  } as ContextoPlataformaPorEtapa;
  const plugin = criarPluginPlataformaCadastros({
    deps: m.deps,
    outbox: { gravar: async (_t, e) => { eventos.push(e.nome); return 1; } },
  });
  const rota = (caminho: string) => plugin.rotas.find((r) => r.caminho === caminho)!;
  const chamar = (caminho: string, cadastro: string, o: { modo?: string; frase?: string; arquivo?: Buffer }) =>
    rota(caminho).executar(c, {
      corpo: o.frase === undefined ? {} : { frase: o.frase }, consulta: { modo: o.modo ?? 'adicionar' }, params: { id: TENANT, cadastro },
      cabecalhos: {}, arquivos: {}, todosArquivos: o.arquivo ? { arquivo: [new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', o.arquivo)] } : {},
    });
  return { m, passos, sqls, eventos, plugin, chamar };
}
const falha = async (p: Promise<unknown>): Promise<ErroApi> => {
  try { await p; } catch (e) { if (e instanceof ErroApi) return e; throw e; }
  throw new Error('devia falhar');
};
const concluirDe = (t: ReturnType<typeof montar>) => t.sqls.filter((s) => s.sql.includes('portal_carga_concluir'));

describe('rotas da carga no /config (por etapa)', () => {
  it('RN-CAD-10: as duas rotas são por_etapa, sem idempotência, na ação plataforma.cadastros.carga', () => {
    const { plugin } = montar();
    expect(plugin.rotas.map((r) => [r.caminho, r.transacoes, r.idempotencia, r.acao])).toEqual([
      [CAMINHOS_CARGAS_PLATAFORMA.situacao, 'por_etapa', undefined, 'plataforma.cadastros.carga'],
      [CAMINHOS_CARGAS_PLATAFORMA.modelo, 'por_etapa', undefined, 'plataforma.cadastros.carga'],
      [CAMINHOS_CARGAS_PLATAFORMA.erros, 'por_etapa', undefined, 'plataforma.cadastros.carga'],
      [CAMINHOS_CARGAS_PLATAFORMA.validar, 'por_etapa', undefined, 'plataforma.cadastros.carga'],
      [CAMINHOS_CARGAS_PLATAFORMA.gravar, 'por_etapa', undefined, 'plataforma.cadastros.carga'],
    ]);
  });

  it('RN-CAD-10: gravar roda iniciar (plataforma) → tenant → concluir (plataforma) e conclui "concluida" com as contagens', async () => {
    const t = montar();
    const r = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'filial', { arquivo: csv('filial') });
    expect(r.corpo).toEqual({ cadastro: 'filial', modo: 'adicionar', gravadas: 1, com_erro: 0 });
    expect(t.passos).toEqual(['plataforma', `tenant:${TENANT}`, 'plataforma']);
    expect(t.sqls[0]!.p).toEqual([TENANT, 'filial', 'adicionar', 'req-1']);
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'concluida', 1, 0, null, 'req-1', null]);
    expect(t.eventos).toContain('cadastros.filial.alterada@1');
  });

  it('RN-CAD-10: se a etapa do tenant falha, o concluir "falhou" roda e o erro original sobe', async () => {
    const t = montar();
    const e = await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'filial', { arquivo: Buffer.from('coluna_errada\nx\n') }));
    expect(e).toMatchObject({ status: 409, detalhes: { codigo: 'nada_a_gravar' } });
    expect(t.passos).toEqual(['plataforma', `tenant:${TENANT}`, 'plataforma']);
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'falhou', 0, 0, null, 'req-1', null]);
  });

  it('RN-CAD-10: substituir_tudo concluído leva as inativadas ao concluir', async () => {
    const t = montar();
    const r = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'filial', { modo: 'substituir_tudo', frase: FRASE, arquivo: csv('filial') });
    expect(r.corpo).toMatchObject({ modo: 'substituir_tudo', inativadas: 0 });
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'concluida', 1, 0, 0, 'req-1', null]);
  });

  it('RN-CAD-10: a auditoria do gravar é a do concluir: o cliente leva o 8º argumento com os endereços inativados e os outros cadastros, null', async () => {
    const t = montar();
    for (const dep of ['filial', 'vendedor', 'condicoes_pagamento', 'produto', 'preco', 'cliente'] as const) {
      await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, dep === 'condicoes_pagamento' ? 'condicao_pagamento' : dep, { arquivo: csv(dep) });
    }
    t.sqls.length = 0;
    const so1 = Buffer.from(csv('cliente').toString().split('\n').slice(0, 2).join('\n')); // só a linha principal do C-EX-01
    await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'cliente', { modo: 'substituir_tudo', frase: FRASE, arquivo: so1 });
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'concluida', 1, 0, 1, 'req-1', 2]);
    await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', { modo: 'substituir_tudo', frase: FRASE, arquivo: csv('produto') });
    expect(concluirDe(t)[1]!.p.at(-1)).toBeNull();
  });

  it('RN-CAD-10: estoque com substituir_tudo é 400 VALIDACAO no campo modo, sem abrir execução (gravar e validar)', async () => {
    const t = montar();
    for (const caminho of [CAMINHOS_CARGAS_PLATAFORMA.gravar, CAMINHOS_CARGAS_PLATAFORMA.validar]) {
      const e = await falha(t.chamar(caminho, 'estoque', { modo: 'substituir_tudo', frase: FRASE, arquivo: csv('estoque') }));
      expect(e).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
      expect(JSON.stringify(e.campos)).toContain('modo');
    }
    expect(t.passos).toEqual([]);
  });

  it('RN-CAD-10: frase errada ou ausente no substituir_tudo é 422 e nada é aberto', async () => {
    const t = montar();
    for (const frase of [undefined, 'qualquer coisa']) {
      const e = await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', { modo: 'substituir_tudo', ...(frase ? { frase } : {}), arquivo: csv('produto') }));
      expect(e).toMatchObject({ status: 422, codigo: 'RN-CAD-10' });
    }
    expect(t.passos).toEqual([]);
  });

  it('RN-CAD-10: cadastro desconhecido e arquivo ausente são 400', async () => {
    const t = montar();
    expect((await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'titulo', { arquivo: csv('titulo') }))).status).toBe(400);
    expect((await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'filial', {}))).status).toBe(400);
    expect(t.passos).toEqual([]);
  });

  it('RN-CAD-10: validar lê a situação (plataforma), roda no tenant e não abre execução nem grava', async () => {
    const t = montar();
    const r = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.validar, 'filial', { arquivo: csv('filial') });
    expect(r.corpo).toMatchObject({ cadastro: 'filial', modo: 'adicionar', prontas: 1, com_erro: 0 });
    expect(t.passos).toEqual(['plataforma', `tenant:${TENANT}`]);
    expect(t.sqls.some((s) => s.sql.includes('portal_carga_iniciar'))).toBe(false);
    expect(t.eventos).toHaveLength(0);
  });

  it('RF-CAD-11: GET situacao roda uma só transação de plataforma, com o id da empresa, e responde no formato do SDK', async () => {
    const t = montar();
    const r = await t.plugin.rotas.find((x) => x.caminho === CAMINHOS_CARGAS_PLATAFORMA.situacao)!.executar(
      { sessao: { superadmin_id: 's', sessao_id: 's' }, request_id: 'req-1', agora: new Date(), comPlataforma: async (f: (x: Transacao) => Promise<unknown>) => { t.passos.push('plataforma'); return f({ consultar: (async (sql: string, p: readonly unknown[] = []) => { t.sqls.push({ sql, p }); return [{ situacao: SITUACAO }]; }) as Transacao['consultar'] }); } } as unknown as ContextoPlataformaPorEtapa,
      { corpo: undefined, consulta: undefined, params: { id: TENANT } });
    const s = r.corpo as SituacaoCargasPlataforma;
    expect(s.cadastros).toHaveLength(8);
    expect(s.cadastros[0]).toMatchObject({ cadastro: 'filial', numero: 1, situacao: 'manual', liberado: true });
    expect(s.cadastros.find((x) => x.cadastro === 'vendedor')).toMatchObject({ situacao: 'nao_carregado' });
    expect(t.passos).toEqual(['plataforma']);
    expect(t.sqls[0]).toMatchObject({ p: [TENANT] });
    expect(t.sqls[0]!.sql).toContain('cadastros.portal_carga_situacao($1)');
  });

  it('RF-CAD-11: situacaoDaAba mapeia pelo nome do cadastro (retorno do banco fora de ordem) e devolve liberado true (sem depende_de)', () => {
    const crua = ENTIDADES_CARGA_PORTAL.map((cadastro) => ({ cadastro, ativos: cadastro === 'produto' ? 3 : 0, erros: 0, ultima_carga: null }));
    const s = situacaoDaAba({ empresa_id: TENANT, modulo_licenciado: true, cadastros: [...crua].reverse() });
    expect(s.cadastros.map((x) => x.cadastro)).toEqual([...ENTIDADES_CARGA_PORTAL]);
    expect(s.cadastros.find((x) => x.cadastro === 'produto')).toMatchObject({ numero: 4, situacao: 'manual' });
    expect(s.cadastros.find((x) => x.cadastro === 'filial')).toMatchObject({ numero: 1, situacao: 'nao_carregado' });
    expect(s.cadastros.every((x) => x.liberado && !('depende_de' in x))).toBe(true);
    expect(() => situacaoDaAba({ empresa_id: TENANT, modulo_licenciado: true, cadastros: crua.slice(1) })).toThrow(/filial/);
    const comData = crua.map((x) => (x.cadastro === 'produto' ? { ...x, ultima_carga: { em: '2026-11-23T15:00:00.000Z', quantidade: 3 } } : x));
    expect(situacaoDaAba({ empresa_id: TENANT, modulo_licenciado: true, cadastros: comData }).cadastros.find((x) => x.cadastro === 'produto')).toMatchObject({ situacao: 'carregado' });
  });

  it('RF-CAD-11: GET modelo devolve o CSV modelo do cadastro com o nome do SDK; cadastro desconhecido é 404', async () => {
    const t = montar();
    const r = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.modelo, 'filial', {});
    expect(r.cabecalhos).toMatchObject({ 'content-type': TIPO_CSV, 'content-disposition': 'attachment; filename="modelo-filial.csv"' });
    expect(String(r.corpo).startsWith('\uFEFF')).toBe(true);
    expect(String(r.corpo).split('\r\n')[0]).toContain(';');
    expect((await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.modelo, 'titulo', {}))).status).toBe(404);
  });

  it('RF-CAD-11: POST erros devolve o CSV com linha, campo, codigo e motivo, sem o valor da célula', async () => {
    const t = montar();
    const base = csv('filial').toString('utf8').trim().split(/\r?\n/);
    const ruim = [base[0], base[1]!.replace(/[^;]+/, 'VALOR-SECRETO-123')].join('\n') + '\n';
    const r = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.erros, 'filial', { arquivo: Buffer.from('coluna_errada\nx\n') });
    const linhas = String(r.corpo).replace('\uFEFF', '').trim().split('\r\n');
    expect(linhas[0]).toBe('linha;campo;codigo;motivo');
    expect(linhas.length).toBeGreaterThan(1);
    expect(r.cabecalhos).toMatchObject({ 'content-type': TIPO_CSV, 'content-disposition': 'attachment; filename="erros-filial.csv"' });
    expect(t.passos).toEqual(['plataforma', `tenant:${TENANT}`]);
    expect(t.eventos).toHaveLength(0);
    const r2 = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.erros, 'filial', { arquivo: Buffer.from(ruim) });
    expect(String(r2.corpo)).not.toContain('VALOR-SECRETO-123');
    expect((await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.erros, 'titulo', { arquivo: csv('filial') }))).status).toBe(400);
  });
});
