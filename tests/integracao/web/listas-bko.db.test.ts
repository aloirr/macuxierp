/**
 * T-0008, parte 2: as listas do BKO como os módulos as descrevem para o shell (`modules/cadastros/web/paginas.ts` e
 * `modules/core/web/paginas.ts`: colunas, filtros na URL, CSV e botões por perfil) contra a API de produção
 * (`montarModulos` com os adaptadores SQL do main.ts, `tests/apoio/api-pg.ts`), no Postgres e na RLS.
 * O shell do main ainda não desenha as listas (a página de módulo mostra "Esta tela ainda não foi construída"): o que
 * a tela vai pedir e mostrar fica provado aqui, onde os dois lados se encontram. Os testes de cada dono olham um lado
 * só (paginas.test.ts e web.test.ts sem API; rotas.test.ts sem as páginas).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paraQuery, pode, PERFIS, type Perfil, type RotaModulo } from '../../../packages/platform-sdk/src/index';
import { clienteValido, filialValida, produtoValido } from '../../../modules/cadastros/api/fixtures-teste';
import { acoesDaPagina, consultaDaUrl, csvDaPagina, PAGINAS, type PaginaCadastros } from '../../../modules/cadastros/web/index';
import { PAGINAS_CORE } from '../../../modules/core/web/index';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { montarApiPg } from '../../apoio/api-pg';

/** Rota GET do plugin que atende o caminho (`/v1/cadastros/oficiais/ncm` → `/oficiais/:tabela`). */
function rotaGet(rotas: readonly RotaModulo[], modulo: string, caminho: string): RotaModulo | undefined {
  return rotas.find((r) => r.metodo === 'GET' && new RegExp(`^/v1/${modulo}${r.caminho.replace(/:[a-z_]+/g, '[^/]+')}$`).test(caminho));
}
/** Chaves que a consulta (Zod) da rota aceita; chave fora daqui o Zod descarta calado. */
function chavesDaConsulta(r: RotaModulo): string[] {
  let s = r.consulta as unknown as { shape?: Record<string, unknown>; _def?: { schema?: unknown } } | undefined;
  while (s && !s.shape && s._def?.schema) s = s._def.schema as typeof s;
  return Object.keys(s?.shape ?? {});
}

describe.skipIf(!PG_DISPONIVEL)('listas do BKO × API de produção (Postgres, papel macuxierp_app)', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'A'>>>;
  const ids: Record<string, string> = {};
  const get = (url: string, perfil: Perfil = 'administrador') => api.chamar('A', 'GET', url, undefined, perfil);
  const post = async (url: string, corpo: object) => {
    const r = await api.chamar('A', 'POST', url, corpo);
    expect(r.statusCode, `${url}: ${r.body}`).toBeLessThan(300);
    return r.json() as Record<string, unknown> & { id: string };
  };
  const plugin = (id: string) => api.modulos.find((m) => m.manifesto.id === id)!.rotas;

  beforeAll(async () => {
    api = await montarApiPg({ A: ['cadastros'] });
    ids.filial = (await post('/v1/cadastros/filiais', filialValida())).id;
    ids.cliente = (await post('/v1/cadastros/clientes', clienteValido(ids.filial))).id;
    // 2202.10.00 tem ST na tabela oficial real: CEST obrigatório (RN-CAD-04).
    ids.produto = (await post('/v1/cadastros/produtos', produtoValido({ cest: '0300700', custo_centavos: 450 }))).id;
    ids.tabela = (await post('/v1/cadastros/tabelas-preco', { nome: 'Varejo', vigencia_inicio: '2026-01-01' })).id;
    await post('/v1/cadastros/estoque/movimentos', { filial_id: ids.filial, produto_id: ids.produto, tipo: 'entrada', quantidade: 10_0000, motivo: 'Inventário' });
    ids.condicao = (await post('/v1/cadastros/condicoes-pagamento', { codigo: '30/60', descricao: '30 e 60 dias', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 })).id;
    ids.vendedor = (await post('/v1/cadastros/vendedores', { codigo: 'V1', nome: 'Vendedor Um', filial_id: ids.filial })).id;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  describe.each(PAGINAS.map((p) => ({ ...p, nome: `${p.titulo} (${p.api})` })))('cadastros › $nome', (p: PaginaCadastros) => {
    it('toda coluna da página vem no item da API (a tabela e o CSV não saem com coluna vazia)', async () => {
      const r = await get(p.api);
      expect(r.statusCode).toBe(200);
      const item = (r.json().itens as Record<string, unknown>[])[0];
      expect(item, 'a lista veio vazia').toBeDefined();
      for (const c of p.colunas) expect(item, `${p.id}.${c.chave}`).toHaveProperty(c.chave);
    });

    // D-05, corrigido no #71: o estoque segue o contrato de listas.
    it('todo filtro da URL da página (os dela, busca, cursor e limite; inativos onde há a coluna Situação) é aceito pela consulta da rota', () => {
      const rota = rotaGet(plugin('cadastros'), 'cadastros', p.api);
      expect(rota, p.api).toBeDefined();
      const aceitas = chavesDaConsulta(rota!);
      const comuns = ['busca', 'cursor', 'limite', ...(p.colunas.some((c) => c.chave === 'inativo') ? ['inativos'] : [])];
      // limite=100: o 50 (LIMITE_PADRAO) não vai para a URL.
      const url = new URLSearchParams([...p.filtros.map((f): [string, string] => [f, 'x']), ['busca', 'x'], ['cursor', 'x'], ['limite', '100'], ['inativos', 'true']]);
      const daTela = new URLSearchParams(paraQuery(consultaDaUrl(p, url)));
      const pedidas = [...daTela.keys()].filter((k) => p.filtros.includes(k) || comuns.includes(k));
      expect(pedidas, 'a tela pede busca, cursor e limite').toEqual(expect.arrayContaining(['busca', 'cursor', 'limite']));
      expect(pedidas.filter((k) => !aceitas.includes(k)), `chaves da tela que a API ignora em ${p.api}`).toEqual([]);
    });
    it('a resposta segue o contrato de listas do SDK: { itens, proximo_cursor } (P-02, #44)', async () => {
      const r = await get(p.api);
      expect(Object.keys(r.json()).sort()).toEqual(['itens', 'proximo_cursor']);
    });

    if (p.editar) it(`o botão de editar segue a ação da rota POST da API (${p.editar}): some para quem a API recusa`, () => {
      const base = p.api.replace('/v1/cadastros', '');
      const escrita = plugin('cadastros').find((r) => r.metodo === 'POST' && (r.caminho === base || r.caminho === `${base}/movimentos`));
      expect(escrita?.acao).toBe(p.editar);
      for (const perfil of PERFIS) expect(acoesDaPagina(perfil, p).editar, perfil).toBe(pode(perfil, escrita!.acao));
    });
  });

  const outro = '9f000000-0000-4000-8000-000000000009';
  const filtra = async (url: string, filtro: string, valor: string) => {
    expect((await get(`${url}?${filtro}=${valor}`)).json().itens, `${url} ${filtro}`).toHaveLength(1);
    expect((await get(`${url}?${filtro}=${outro}`)).json().itens, `${url} ${filtro} de outro`).toHaveLength(0);
  };
  // D-06, corrigido no #71: o SQL dos vendedores filtra por filial.
  it('filtros na URL filtram de verdade no Postgres: filial do cliente, do estoque e dos vendedores; produto do estoque', async () => {
    await filtra('/v1/cadastros/clientes', 'filial_id', ids.filial!);
    await filtra('/v1/cadastros/vendedores', 'filial_id', ids.filial!);
    await filtra('/v1/cadastros/estoque', 'filial_id', ids.filial!);
    await filtra('/v1/cadastros/estoque', 'produto_id', ids.produto!);
  });

  it('CSV dos produtos: custo some da coluna e do arquivo para vendedor e leitura; aparece para quem edita produto', async () => {
    const produtos = PAGINAS.find((p) => p.id === 'produtos')!;
    for (const perfil of PERFIS) {
      const r = await get('/v1/cadastros/produtos', perfil);
      expect(acoesDaPagina(perfil, produtos).exportar).toBe(true);
      const csv = csvDaPagina(produtos, perfil, r.json().itens);
      const [cabecalho, linha] = csv.slice(1).split('\r\n');
      const vePeloPerfil = pode(perfil, 'cadastros.produto.editar');
      expect(cabecalho!.split(';').includes('Custo'), perfil).toBe(vePeloPerfil);
      expect(linha!.replace(/\u00a0/g, ' ').includes('R$ 4,50'), perfil).toBe(vePeloPerfil);
      expect(r.json().itens[0].custo_centavos, perfil).toBe(vePeloPerfil ? 450 : null); // a API esconde também
    }
  });

  it('core: as páginas com lista pedem filtros que a rota GET aceita e são liberadas pela mesma ação da rota', () => {
    const API_CORE: Record<string, string> = { usuarios: '/v1/core/usuarios', licencas: '/v1/core/licencas', auditoria: '/v1/core/auditoria', certificado: '/v1/core/certificados', ambiente: '/v1/core/ambientes-fiscais' };
    const comLista = PAGINAS_CORE.filter((x) => x.filtros.length || x.exportaCsv);
    expect(comLista.map((x) => x.id).sort()).toEqual(Object.keys(API_CORE).sort());
    for (const p of comLista) {
      const rota = rotaGet(plugin('core'), 'core', API_CORE[p.id]!);
      expect(rota, p.id).toBeDefined();
      expect(rota!.acao, p.id).toBe(p.ver);
      expect(p.filtros.filter((f) => !chavesDaConsulta(rota!).includes(f)), p.id).toEqual([]);
    }
  });

  /*
   * P-02 (corrigido no #44, a57cb80): o cadastros segue o contrato comum de listas do SDK (`.coord/contratos/listas.md`):
   * `?limite=` e `?cursor=`, resposta `{ itens, proximo_cursor }`, sem `pagina`, `por_pagina` nem `total`.
   */
  describe('P-02 (dois clientes na lista)', () => {
    beforeAll(async () => {
      const r = await api.chamar('A', 'POST', '/v1/cadastros/clientes', clienteValido(ids.filial!, { documento: '71888999000103', razao_social: 'Segundo Cliente Ltda', ie: null, ind_ie_dest: '9' }));
      expect(r.statusCode, r.body).toBe(201);
    });
    it('P-02: ?limite=1 devolve 1 item e proximo_cursor; o cursor traz o outro e fecha com proximo_cursor nulo', async () => {
      const r1 = await get('/v1/cadastros/clientes?limite=1');
      expect(r1.statusCode).toBe(200);
      expect(r1.json().itens).toHaveLength(1);
      expect(r1.json().proximo_cursor).toBe(r1.json().itens[0].id);
      const r2 = await get(`/v1/cadastros/clientes?limite=1&cursor=${r1.json().proximo_cursor}`);
      expect(r2.statusCode).toBe(200);
      expect(r2.json().itens).toHaveLength(1);
      expect(r2.json().itens[0].id).not.toBe(r1.json().itens[0].id);
      expect(r2.json().proximo_cursor).toBeNull();
    });
  });
});
