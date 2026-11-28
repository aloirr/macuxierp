import { describe, expect, it } from 'vitest';
import { ErroApi, pode, type ContextoRota, type Transacao } from '@macuxierp/platform-sdk';
import { regra } from '../domain/fixtures';
import { RegraAlteradaV1, type CatalogoRegra, type RegraDetalhe, type RegraEntrada } from '../contracts';
import { situacaoDaRegra } from '../domain';
import { manifest } from '../manifest';
import { criarPluginFiscal } from './plugin';
import { hojeNoFuso } from './regras';
import type { DependenciasRegras, RepositorioCatalogo, RepositorioRegras } from './regras-portas';

const tx = {} as Transacao;
const HOJE = '2026-11-28';

function memoria(inicial: RegraDetalhe[] = [], modelos: CatalogoRegra[] = []) {
  const itens = new Map(inicial.map((r) => [r.id, r]));
  let n = 100;
  const detalhe = (e: RegraEntrada, id: string, versao: number): RegraDetalhe => ({ ...e, id, updated_at: `2026-11-28T10:00:00.${String(versao).padStart(3, '0')}Z`, situacao: situacaoDaRegra(e, HOJE) });
  const regras: RepositorioRegras = {
    async listar(f) { return [...itens.values()].filter((r) => !f.tributo || r.tributo === f.tributo).sort((a, b) => a.id.localeCompare(b.id)).filter((r) => !f.cursor || r.id > f.cursor).slice(0, f.limite + 1); },
    async listarTodos(f) { return [...itens.values()].filter((r) => !f.tributo || r.tributo === f.tributo); },
    async obter(id) { return itens.get(id) ?? null; },
    async inserir(e) { n += 1; const d = detalhe(e, `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, 1); itens.set(d.id, d); return d; },
    async atualizar(id, e, ifMatch) {
      const atual = itens.get(id);
      if (!atual) return null;
      if (atual.updated_at !== ifMatch) return 'conflito';
      const d = detalhe(e, id, 2);
      itens.set(id, d);
      return d;
    },
    async excluir(id) { const a = itens.get(id) ?? null; itens.delete(id); return a; },
  };
  const catalogo: RepositorioCatalogo = {
    async listar() { return modelos; },
    async obter(id) { return modelos.find((m) => m.id === id) ?? null; },
  };
  const deps: DependenciasRegras = { regras: () => regras, catalogo: () => catalogo, candidatas: async () => [...itens.values()] };
  return { deps, itens };
}

function ctx(perfil = 'fiscal') {
  const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
  const auditoria: { acao: string }[] = [];
  const c = {
    sessao: { perfil, tenant_id: 't', usuario_id: 'u' }, tx, request_id: 'r', agora: new Date('2026-11-28T14:00:00Z'), fuso: 'America/Manaus',
    async publicar(e: { nome: string; agregado_id: string; payload: Record<string, unknown> }) { eventos.push(e); return { id: 'ev' }; },
    async auditar(d: { acao: string }) { auditoria.push(d); },
    async enfileirar() { return { id: 'j' }; },
  } as unknown as ContextoRota;
  return { c, eventos, auditoria };
}

const corpoBase = (p: Partial<RegraEntrada> = {}): RegraEntrada => {
  const { id: _id, ...r } = regra();
  return { ...r, ...p };
};
const detalheDe = (p: Partial<RegraEntrada> = {}, id = '00000000-0000-4000-8000-00000000aa01'): RegraDetalhe => ({ ...corpoBase(p), id, updated_at: '2026-11-28T10:00:00.001Z', situacao: 'vigente' });

async function chamar(deps: DependenciasRegras, metodo: string, caminho: string, o: { c: ContextoRota; corpo?: unknown; consulta?: unknown; params?: Record<string, string>; cabecalhos?: Record<string, string> }) {
  const rota = criarPluginFiscal(deps).rotas.find((r) => r.metodo === metodo && r.caminho === caminho);
  if (!rota) throw new Error(`sem rota ${metodo} ${caminho}`);
  const corpo = rota.corpo ? rota.corpo.parse(o.corpo) : undefined;
  const consulta = rota.consulta ? rota.consulta.parse(o.consulta ?? {}) : undefined;
  return rota.executar(o.c, { corpo, consulta, params: o.params ?? {}, cabecalhos: o.cabecalhos ?? {}, arquivos: {}, todosArquivos: {} } as never);
}
const falha = async (p: Promise<unknown>): Promise<ErroApi> => {
  try { await p; } catch (e) { return e as ErroApi; }
  throw new Error('devia falhar');
};

describe('rotas /v1/fiscal/regras: perfil e licença', () => {
  it('RN-CORE-02: cada rota exige fiscal.ver (leitura) ou fiscal.regra.editar (escrita); leitura não edita; o módulo é o fiscal', () => {
    const p = criarPluginFiscal(memoria().deps);
    expect(p.manifesto.id).toBe('fiscal');
    for (const r of p.rotas) expect(r.acao).toBe(r.metodo === 'GET' ? 'fiscal.ver' : 'fiscal.regra.editar');
    expect(pode('leitura', 'fiscal.ver')).toBe(true);
    expect(pode('leitura', 'fiscal.regra.editar')).toBe(false);
    expect(pode('fiscal', 'fiscal.regra.editar')).toBe(true);
    expect(pode('vendedor', 'fiscal.regra.editar')).toBe(false);
  });
  it('RN-FIS-04: o manifesto publica fiscal.regra.alterada@1 e declara o menu das regras', () => {
    expect(manifest.publica).toContain('fiscal.regra.alterada@1');
    expect(manifest.web?.menus).toContain('Regras fiscais');
  });
});

describe('POST /regras', () => {
  it('RN-FIS-04: grava, devolve 201 com ETag e publica fiscal.regra.alterada@1 e a auditoria na mesma transação', async () => {
    const { deps } = memoria();
    const { c, eventos, auditoria } = ctx();
    const r = await chamar(deps, 'POST', '/regras', { c, corpo: corpoBase({ ncm_prefixo: '2202' }) });
    expect(r.status).toBe(201);
    expect(r.cabecalhos?.etag).toMatch(/^"2026-/);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.nome).toBe('fiscal.regra.alterada');
    expect(RegraAlteradaV1.parse(eventos[0]?.payload)).toMatchObject({ acao: 'criada', tributo: 'icms', ncm_prefixo: '2202', catalogo_id: null });
    expect(auditoria[0]?.acao).toBe('fiscal.regra.criada');
  });
  it('RN-FIS-05: ST interestadual com ajustar_mva nulo é 422 e nada é gravado nem publicado', async () => {
    const { deps, itens } = memoria();
    const { c, eventos } = ctx();
    const e = await falha(chamar(deps, 'POST', '/regras', { c, corpo: corpoBase({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000, uf_origem: 'AM', uf_destino: 'SP', ajustar_mva: null }) }));
    expect(e).toMatchObject({ status: 422, codigo: 'RN-FIS-05' });
    expect(itens.size).toBe(0);
    expect(eventos).toHaveLength(0);
  });
  it('RN-FIS-04: sem ajustar_mva no corpo o contrato recusa (sem default); sem fonte a API recusa (422)', async () => {
    const { deps } = memoria();
    const { ajustar_mva: _a, ...semAjuste } = corpoBase();
    await expect(chamar(deps, 'POST', '/regras', { c: ctx().c, corpo: semAjuste })).rejects.toThrow();
    const e = await falha(chamar(deps, 'POST', '/regras', { c: ctx().c, corpo: corpoBase({ fonte: null }) }));
    expect(e).toMatchObject({ status: 422, codigo: 'RN-FIS-04' });
  });
});

describe('PUT e DELETE /regras/:id', () => {
  it('RN-FIS-04: altera com If-Match certo, publica "alterada" e responde 409 com If-Match velho', async () => {
    const antiga = detalheDe();
    const { deps } = memoria([antiga]);
    const { c, eventos } = ctx();
    const ok = await chamar(deps, 'PUT', '/regras/:id', { c, params: { id: antiga.id }, cabecalhos: { 'if-match': `"${antiga.updated_at}"` }, corpo: corpoBase({ versao: '2026.2' }) });
    expect((ok.corpo as RegraDetalhe).versao).toBe('2026.2');
    expect(RegraAlteradaV1.parse(eventos[0]?.payload)).toMatchObject({ acao: 'alterada', versao: '2026.2' });
    const velho = await falha(chamar(deps, 'PUT', '/regras/:id', { c, params: { id: antiga.id }, cabecalhos: { 'if-match': antiga.updated_at }, corpo: corpoBase() }));
    expect(velho.status).toBe(409);
    const sem = await falha(chamar(deps, 'PUT', '/regras/:id', { c, params: { id: antiga.id }, corpo: corpoBase() }));
    expect(sem.status).toBe(400);
  });
  it('RN-FIS-04: regra inexistente é 404; excluir publica "excluida" e some da lista', async () => {
    const r = detalheDe();
    const { deps, itens } = memoria([r]);
    const { c, eventos } = ctx();
    expect((await falha(chamar(deps, 'GET', '/regras/:id', { c, params: { id: '00000000-0000-4000-8000-0000000000ff' } }))).status).toBe(404);
    expect((await falha(chamar(deps, 'GET', '/regras/:id', { c, params: { id: 'x' } }))).status).toBe(404);
    expect((await chamar(deps, 'DELETE', '/regras/:id', { c, params: { id: r.id } })).status).toBe(204);
    expect(itens.size).toBe(0);
    expect(RegraAlteradaV1.parse(eventos[0]?.payload)).toMatchObject({ acao: 'excluida', regra_id: r.id });
    expect((await falha(chamar(deps, 'DELETE', '/regras/:id', { c, params: { id: r.id } }))).status).toBe(404);
  });
});

describe('lista, CSV e resolução', () => {
  it('RN-FIS-01: lista paginada por cursor e CSV com as colunas da tela', async () => {
    const regs = [1, 2, 3].map((i) => detalheDe({ ncm_prefixo: `220${i}` }, `00000000-0000-4000-8000-00000000aa0${i}`));
    const { deps } = memoria(regs);
    const { c } = ctx('leitura');
    const p = await chamar(deps, 'GET', '/regras', { c, consulta: { limite: '2' } });
    expect((p.corpo as { itens: unknown[]; proximo_cursor: string | null }).itens).toHaveLength(2);
    expect((p.corpo as { proximo_cursor: string | null }).proximo_cursor).toBe(regs[1]?.id);
    const csv = await chamar(deps, 'GET', '/regras/exportar', { c, consulta: {} });
    expect(String(csv.corpo)).toContain('Tributo');
    expect(String(csv.corpo)).toContain('2201');
  });
  it('RN-FIS-01: resolver devolve a regra mais específica por tributo e o erro tipado onde falta', async () => {
    const geral = detalheDe({ codigo: '00' }, '00000000-0000-4000-8000-00000000aa01');
    const fina = detalheDe({ codigo: '20', ncm_prefixo: '2202' }, '00000000-0000-4000-8000-00000000aa02');
    const { deps } = memoria([geral, fina]);
    const r = await chamar(deps, 'GET', '/regras/resolver', { c: ctx('leitura').c, consulta: { ncm: '22021000', cfop: '5102', uf_origem: 'AM', uf_destino: 'SP', tipo_cliente: 'contribuinte', crt: '3', data_emissao: '2026-06-10' } });
    const corpo = r.corpo as { icms: { ok: boolean; regra_id: string }; ipi: { ok: boolean; erros: { codigo: string }[] } };
    expect(corpo.icms).toMatchObject({ ok: true, regra_id: fina.id });
    expect(corpo.ipi).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA' }] });
  });
  it('RN-CORE-04: a data civil de hoje vem do fuso do tenant (Manaus, UTC-4)', () => {
    expect(hojeNoFuso(new Date('2026-11-29T02:00:00Z'), 'America/Manaus')).toBe('2026-11-28');
  });
});

describe('catálogo base: o fiscal valida e o administrador aplica', () => {
  const { id: _i, vigencia_inicio: _a, vigencia_fim: _b, ...campos } = regra({ ncm_prefixo: '2202' });
  const modelo = (p: Partial<CatalogoRegra> = {}): CatalogoRegra => ({ ...campos, id: '00000000-0000-4000-8000-0000000000c1', chave: 'icms-2202', descricao: 'ICMS 18% bebidas', validada_em: '2026-11-27T12:00:00Z', ...p });
  const corpoAplicar = { vigencia_inicio: '2026-12-01', vigencia_fim: null, confirmo: true };

  it('RN-FIS-04: aplicar copia o modelo com a vigência escolhida, publica "aplicada_do_catalogo" com o id do modelo; listar nunca grava', async () => {
    const m = modelo();
    const { deps, itens } = memoria([], [m]);
    const { c, eventos } = ctx('administrador');
    await chamar(deps, 'GET', '/catalogo', { c, consulta: {} });
    expect(itens.size).toBe(0);
    const r = await chamar(deps, 'POST', '/catalogo/:id/aplicar', { c, params: { id: m.id }, corpo: corpoAplicar });
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ ncm_prefixo: '2202', vigencia_inicio: '2026-12-01', situacao: 'futura' });
    expect(RegraAlteradaV1.parse(eventos[0]?.payload)).toMatchObject({ acao: 'aplicada_do_catalogo', catalogo_id: m.id });
  });
  it('RN-FIS-04: sem "confirmo" o corpo é recusado; modelo não validado pelo fiscal é 422', async () => {
    const m = modelo({ validada_em: null });
    const { deps } = memoria([], [m]);
    const { c } = ctx('administrador');
    await expect(chamar(deps, 'POST', '/catalogo/:id/aplicar', { c, params: { id: m.id }, corpo: { ...corpoAplicar, confirmo: false } })).rejects.toThrow();
    expect(await falha(chamar(deps, 'POST', '/catalogo/:id/aplicar', { c, params: { id: m.id }, corpo: corpoAplicar }))).toMatchObject({ status: 422, codigo: 'RN-FIS-04' });
  });
  it('RN-FIS-05: o catálogo não aplica regra de ST interestadual (lista como bloqueada, aplicar dá 422)', async () => {
    const m = modelo({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000, uf_origem: 'AM', uf_destino: 'SP', ajustar_mva: true });
    const { deps, itens } = memoria([], [m]);
    const { c } = ctx('administrador');
    const lista = await chamar(deps, 'GET', '/catalogo', { c, consulta: {} });
    expect((lista.corpo as { itens: { aplicavel: boolean; motivo_nao_aplicavel: string }[] }).itens[0]).toMatchObject({ aplicavel: false });
    expect(await falha(chamar(deps, 'POST', '/catalogo/:id/aplicar', { c, params: { id: m.id }, corpo: corpoAplicar }))).toMatchObject({ status: 422, codigo: 'RN-FIS-05' });
    expect(itens.size).toBe(0);
  });
  it('RN-FIS-04: modelo inexistente é 404', async () => {
    const { deps } = memoria();
    expect((await falha(chamar(deps, 'POST', '/catalogo/:id/aplicar', { c: ctx().c, params: { id: '00000000-0000-4000-8000-0000000000c9' }, corpo: corpoAplicar }))).status).toBe(404);
  });
});
