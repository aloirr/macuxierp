/**
 * Rotas do portal (`validar` e `gravar`, `por_etapa`) sobre o dublê em memória: a ordem das etapas (iniciar → tenant →
 * concluir), o concluir `falhou` quando o tenant falha, estoque 400 e frase 422. O banco real é o `carga-portal-rotas.db.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, CAMINHOS_CARGAS_PLATAFORMA, ErroApi, type ContextoPlataformaPorEtapa, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarPluginPlataformaCadastros } from './carga-portal-rotas';
import { dependenciasEmMemoria } from './memoria';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const csv = (nome: string) => readFileSync(join(pasta, `${nome}.csv`));
const TENANT = '11111111-1111-4111-8111-111111111111';
const EXEC = '33333333-3333-4333-8333-333333333333';
const FRASE = 'autorizo substituir tudo';

function montar() {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.ncms.add('21069030');
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  const passos: string[] = [];
  const sqls: { sql: string; p: readonly unknown[] }[] = [];
  const eventos: string[] = [];
  const tx = (): Transacao => ({
    consultar: (async (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      if (sql.includes('portal_carga_iniciar')) return [{ id: EXEC }];
      if (sql.includes('portal_carga_situacao')) return [{ ok: true }];
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
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'concluida', 1, 0, null, 'req-1']);
    expect(t.eventos).toContain('cadastros.filial.alterada@1');
  });

  it('RN-CAD-10: se a etapa do tenant falha, o concluir "falhou" roda e o erro original sobe', async () => {
    const t = montar();
    const e = await falha(t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'filial', { arquivo: Buffer.from('coluna_errada\nx\n') }));
    expect(e).toMatchObject({ status: 409, detalhes: { codigo: 'nada_a_gravar' } });
    expect(t.passos).toEqual(['plataforma', `tenant:${TENANT}`, 'plataforma']);
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'falhou', 0, 0, null, 'req-1']);
  });

  it('RN-CAD-10: substituir_tudo concluído leva as inativadas ao concluir', async () => {
    const t = montar();
    const r = await t.chamar(CAMINHOS_CARGAS_PLATAFORMA.gravar, 'filial', { modo: 'substituir_tudo', frase: FRASE, arquivo: csv('filial') });
    expect(r.corpo).toMatchObject({ modo: 'substituir_tudo', inativadas: 0 });
    expect(concluirDe(t)[0]!.p).toEqual([TENANT, EXEC, 'concluida', 1, 0, 0, 'req-1']);
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
});
