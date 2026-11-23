/** Repositórios em memória: dublê das portas para os testes de rota (sem PostgreSQL). Não entra em produção. */
import { randomUUID } from 'node:crypto';
import { ErroApi, paginar, type Pagina } from '@macuxierp/platform-sdk';
import { classeForma, type EstoqueConsulta, type PrecoItem, type PrecoItemConsulta, type SaldoEstoqueItem } from '../contracts';
import { tabelaVigente } from '../domain';
import { agregadoPreco } from './uuid';
import type {
  ConsultaGravada, Dependencias, RepoChaves, TabelaChave, TabelaSubstituivel, FiltroLista, MovimentoGravado, PortaCertificados, RepoFilho, RepoSimples, Repositorios, TipoConsulta,
} from './portas';

/** Ordem estável por `id` e `id > cursor`, como o adaptador SQL (`.coord/contratos/listas.md`); devolve `limite + 1` linhas no máximo para `paginar`. */
const depoisDoCursor = <T extends { id: string }>(linhas: readonly T[], cursor?: string): T[] =>
  [...linhas].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((x) => !cursor || x.id > cursor);

type Reg = { id: string; inativo: boolean; external_id?: string | null } & Record<string, unknown>;

export class ColecaoMemoria<E extends { id: string }, D extends Record<string, unknown>> implements RepoSimples<E, D> {
  readonly linhas: Reg[] = [];
  constructor(
    private readonly opcoes: { unicos?: string[]; texto?: string[]; filtros?: Record<string, string>; padrao?: boolean; padroes?: Record<string, unknown> } = {},
  ) {}

  protected criar(dados: D): Reg {
    return { ...this.opcoes.padroes, ...dados, id: randomUUID(), inativo: false } as unknown as Reg;
  }

  async listar(q: FiltroLista): Promise<Pagina<E>> {
    const busca = q.busca?.toLowerCase();
    let l = this.linhas.filter((x) => q.inativos || !x.inativo);
    if (busca) l = l.filter((x) => (this.opcoes.texto ?? []).some((c) => String(x[c] ?? '').toLowerCase().includes(busca)));
    if (q.filial_id) l = l.filter((x) => x.filial_id === q.filial_id);
    if (q.vendedor_id) l = l.filter((x) => x.vendedor_id === q.vendedor_id);
    if (q.vendedor_ids) l = l.filter((x) => typeof x.vendedor_id === 'string' && q.vendedor_ids?.includes(x.vendedor_id));
    const pagina = paginar(depoisDoCursor(l, q.cursor), q.limite);
    return { itens: pagina.itens.map((x) => this.ler(x)), proximo_cursor: pagina.proximo_cursor };
  }
  protected ler(x: Reg): E {
    return structuredClone(x) as unknown as E;
  }
  async obter(id: string) {
    const x = this.linhas.find((l) => l.id === id);
    return x ? this.ler(x) : null;
  }
  async porExternalId(ext: string) {
    const x = this.linhas.find((l) => l.external_id === ext);
    return x ? this.ler(x) : null;
  }
  async porCampo(campo: string, valor: string) {
    const x = this.linhas.find((l) => l[campo] === valor);
    return x ? this.ler(x) : null;
  }
  async reativar(id: string): Promise<E | null> {
    const x = this.linhas.find((l) => l.id === id);
    if (!x) return null;
    x.inativo = false;
    return this.ler(x);
  }
  protected conferirUnico(novo: Record<string, unknown>, ignorar?: string): void {
    for (const campo of this.opcoes.unicos ?? []) {
      if (this.linhas.some((l) => l.id !== ignorar && !l.inativo && l[campo] === novo[campo])) throw new ErroApi(409, 'CONFLITO', `${campo} já cadastrado`);
    }
  }
  async inserir(dados: D): Promise<E> {
    this.conferirUnico(dados);
    const x = this.criar(dados);
    this.linhas.push(x);
    return this.ler(x);
  }
  async atualizar(id: string, parcial: Partial<D>): Promise<E | null> {
    const x = this.linhas.find((l) => l.id === id);
    if (!x) return null;
    this.conferirUnico({ ...x, ...parcial }, id);
    Object.assign(x, parcial);
    return this.ler(x);
  }
  async inativar(id: string): Promise<E | null> {
    const x = this.linhas.find((l) => l.id === id);
    if (!x) return null;
    x.inativo = true;
    return this.ler(x);
  }
  async paginaPorCursor(apos: string | null, limite: number): Promise<E[]> {
    return this.linhas.filter((l) => apos === null || l.id > apos).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, limite).map((x) => this.ler(x));
  }
  async idsAtivos(ids: readonly string[]): Promise<Set<string>> {
    return new Set(this.linhas.filter((l) => !l.inativo && ids.includes(l.id)).map((l) => l.id));
  }
  async desmarcarPadrao(exceto: string | null): Promise<void> {
    for (const l of this.linhas) if (l.id !== exceto) l.padrao = false;
  }
}

export class FilhosMemoria<E extends { id: string }, D extends Record<string, unknown>> implements RepoFilho<E, D> {
  readonly linhas: (Reg & { pai: string })[] = [];
  async listar(paiId: string) {
    return this.linhas.filter((l) => l.pai === paiId && !l.inativo).map((l) => structuredClone(l) as unknown as E);
  }
  async obter(paiId: string, id: string) {
    const l = this.linhas.find((x) => x.pai === paiId && x.id === id && !x.inativo);
    return l ? (structuredClone(l) as unknown as E) : null;
  }
  async inserir(paiId: string, dados: D) {
    const l = { ...dados, id: randomUUID(), pai: paiId, inativo: false } as unknown as Reg & { pai: string };
    this.linhas.push(l);
    return structuredClone(l) as unknown as E;
  }
  async atualizar(paiId: string, id: string, parcial: Partial<D>) {
    const l = this.linhas.find((x) => x.pai === paiId && x.id === id);
    if (!l) return null;
    Object.assign(l, parcial);
    return structuredClone(l) as unknown as E;
  }
  async inativar(paiId: string, id: string) {
    const l = this.linhas.find((x) => x.pai === paiId && x.id === id);
    if (!l) return null;
    l.inativo = true;
    return structuredClone(l) as unknown as E;
  }
}

export function repositoriosEmMemoria() {
  const enderecos = new FilhosMemoria<never, never>();
  const contatos = new FilhosMemoria<never, never>();
  const unidades = new FilhosMemoria<never, never>();

  /** Cliente em memória: o endereço mora na coleção filha e volta junto do cadastro. */
  class ClientesMemoria extends ColecaoMemoria<{ id: string }, Record<string, unknown>> {
    protected override ler(x: Reg) {
      return { ...super.ler(x), enderecos: enderecos.linhas.filter((e) => e.pai === x.id && !e.inativo).map((e) => structuredClone(e)) } as { id: string };
    }
    override async inserir(dados: Record<string, unknown>) {
      const { enderecos: ends, ...resto } = dados as { enderecos: Record<string, unknown>[] } & Record<string, unknown>;
      const c = await super.inserir(resto);
      for (const e of ends) await enderecos.inserir(c.id, e as never);
      return (await this.obter(c.id)) as { id: string };
    }
  }
  const baseCliente = new ClientesMemoria({ unicos: ['documento'], texto: ['razao_social', 'documento'] });

  const clientesRepo = Object.assign(baseCliente, {
    enderecos,
    contatos,
    async idsDaCarteira(vendedorId: string) {
      return baseCliente.linhas.filter((l) => l.vendedor_id === vendedorId && !l.inativo).map((l) => l.id);
    },
    async transferir(para: string, ids: readonly string[]) {
      for (const l of baseCliente.linhas) if (ids.includes(l.id)) l.vendedor_id = para;
    },
  });
  const produtosBase = new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ unicos: ['codigo'], texto: ['descricao', 'codigo'], padroes: { producao_propria: false } });
  const produtos = Object.assign(produtosBase, {
    unidades,
    async porIds(ids: readonly string[]) {
      return produtosBase.linhas.filter((l) => ids.includes(l.id)).map((l) => structuredClone(l) as unknown as { id: string });
    },
    async unidadesDe(ids: readonly string[]) {
      return unidades.linhas.filter((u) => ids.includes(u.pai as string) && !u.inativo).map((u) => ({ produto_id: u.pai as string, unidade: u.unidade as string, fator: u.fator as number }));
    },
  });
  const filiais = Object.assign(new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ unicos: ['cnpj'], texto: ['razao_social'], padroes: { industrial_ipi: false, regime_pis_cofins: null } }), {
    async padrao() {
      const f = filiais.linhas.find((l) => l.padrao === true && !l.inativo);
      return f ? (structuredClone(f) as unknown as { id: string }) : null;
    },
  });
  const itensPreco: (PrecoItem & { alterado?: boolean })[] = [];
  const tabelasPreco = Object.assign(new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ texto: ['nome'] }), {
    itensPreco,
    async itens(tabelaId: string, q: PrecoItemConsulta): Promise<Pagina<PrecoItem & { id: string }>> {
      const l = itensPreco
        .filter((i) => i.tabela_preco_id === tabelaId && (!q.filial_id || i.filial_id === q.filial_id) && (!q.produto_id || i.produto_id === q.produto_id))
        .map((i) => ({ ...i, id: agregadoPreco(i.tabela_preco_id, i.filial_id, i.produto_id) }));
      return paginar(depoisDoCursor(l, q.cursor), q.limite);
    },
    async itensDosProdutos(tabelaId: string, produtoIds: readonly string[], filialIds: readonly string[]) {
      return itensPreco.filter((i) => i.tabela_preco_id === tabelaId && produtoIds.includes(i.produto_id) && filialIds.includes(i.filial_id));
    },
    async padraoEm(data: string) {
      const t = tabelasPreco.linhas.find((l) => l.padrao === true && tabelaVigente({ vigencia_inicio: String(l.vigencia_inicio), vigencia_fim: l.vigencia_fim == null ? null : String(l.vigencia_fim), inativa: l.inativo === true }, data));
      return t ? (structuredClone(t) as unknown as { id: string }) : null;
    },
    async gravarLote(tabelaId: string, itens: readonly Omit<PrecoItem, 'tabela_preco_id'>[]) {
      const mudou: PrecoItem[] = [];
      for (const i of itens) {
        const atual = itensPreco.find((x) => x.tabela_preco_id === tabelaId && x.filial_id === i.filial_id && x.produto_id === i.produto_id);
        if (!atual) {
          const novo = { ...i, tabela_preco_id: tabelaId };
          itensPreco.push(novo);
          mudou.push(novo);
        } else if (atual.preco_centavos !== i.preco_centavos || atual.desconto_maximo_bp !== i.desconto_maximo_bp) {
          Object.assign(atual, i);
          mudou.push({ ...atual });
        }
      }
      return mudou;
    },
  });
  const saldos = new Map<string, number>();
  const idsSaldo = new Map<string, string>();
  const movimentos: MovimentoGravado[] = [];
  const repoEstoque = {
    movimentos,
    async saldos(q: { filial_id?: string; produto_id?: string }) {
      return [...saldos]
        .map(([k, quantidade]) => ({ filial_id: k.split('|')[0] as string, produto_id: k.split('|')[1] as string, quantidade }))
        .filter((s) => (!q.filial_id || s.filial_id === q.filial_id) && (!q.produto_id || s.produto_id === q.produto_id));
    },
    async saldosDe(filialId: string, produtoIds: readonly string[]) {
      return (await repoEstoque.saldos({ filial_id: filialId })).filter((s) => produtoIds.includes(s.produto_id));
    },
    async listar(q: EstoqueConsulta): Promise<Pagina<SaldoEstoqueItem>> {
      const busca = q.busca?.toLowerCase();
      const casa = (linhas: readonly Reg[], campos: string[], id: string) =>
        linhas.some((x) => x.id === id && campos.some((c) => String(x[c] ?? '').toLowerCase().includes(busca as string)));
      let l = (await repoEstoque.saldos(q)).map((s) => {
        const k = `${s.filial_id}|${s.produto_id}`;
        if (!idsSaldo.has(k)) idsSaldo.set(k, randomUUID());
        return { ...s, id: idsSaldo.get(k) as string };
      });
      if (busca) l = l.filter((s) => casa(produtos.linhas, ['codigo', 'descricao'], s.produto_id) || casa(filiais.linhas, ['razao_social', 'nome_fantasia'], s.filial_id));
      return paginar(depoisDoCursor(l, q.cursor), q.limite);
    },
    async paginaPorCursor(apos: { filial_id: string; produto_id: string } | null, limite: number) {
      const todos = (await repoEstoque.saldos({})).sort((a, b) => (`${a.produto_id}|${a.filial_id}` < `${b.produto_id}|${b.filial_id}` ? -1 : 1));
      const chave = apos ? `${apos.produto_id}|${apos.filial_id}` : null;
      return todos.filter((s) => chave === null || `${s.produto_id}|${s.filial_id}` > chave).slice(0, limite);
    },
    async saldoParaAtualizar(f: string, p: string) {
      return saldos.get(`${f}|${p}`) ?? 0;
    },
    async gravarMovimento(m: MovimentoGravado, saldoNovo: number) {
      saldos.set(`${m.filial_id}|${m.produto_id}`, saldoNovo);
      movimentos.push(m);
      return { id: randomUUID() };
    },
    async movimentoPorExternalId(ext: string) {
      const m = movimentos.find((x) => x.external_id === ext);
      return m ? { id: ext } : null;
    },
  };
  const condicoesPagamento = new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ unicos: ['codigo'], texto: ['descricao', 'codigo'] });
  const vendedores = Object.assign(new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ unicos: ['codigo'], texto: ['nome', 'codigo'] }), {
    async idsDoUsuario(usuarioId: string) {
      return vendedores.linhas.filter((l) => l.usuario_id === usuarioId && !l.inativo).map((l) => l.id);
    },
  });
  const consultas: ConsultaGravada[] = [];
  const consultaExterna = {
    consultas,
    async obter(tipo: TipoConsulta, chave: string) {
      return consultas.find((c) => c.tipo === tipo && c.chave === chave) ?? null;
    },
    async porExternalId(tipo: TipoConsulta, ext: string) {
      return consultas.find((c) => c.tipo === tipo && c.external_id === ext) ?? null;
    },
    async gravar(c: ConsultaGravada) {
      const i = consultas.findIndex((x) => x.tipo === c.tipo && x.chave === c.chave);
      if (i >= 0) consultas[i] = c;
      else consultas.push(c);
    },
  };
  const oficiais = {
    ncms: new Set<string>(),
    /** NCM → CESTs válidos para ele. */
    cests: new Map<string, string[]>(),
    todosCests: new Set<string>(),
    /** Municípios vigentes por UF (a carga resolve cidade → IBGE, RN-CAD-03). */
    municipiosPorUf: new Map<string, { ibge: string; nome: string }[]>(),
    async municipiosDaUf(uf: string) {
      return oficiais.municipiosPorUf.get(uf) ?? [];
    },
    /** código IBGE → nome. */
    municipios: new Map<string, string>(),
    async nomesMunicipios(codigos: readonly string[]) {
      return new Map(codigos.filter((c) => oficiais.municipios.has(c)).map((c) => [c, oficiais.municipios.get(c) as string]));
    },
    async listar() {
      return { itens: [], proximo_cursor: null };
    },
    async ncmVigente(ncm: string) {
      return oficiais.ncms.has(ncm);
    },
    async ncmExigeCest(ncm: string) {
      return (oficiais.cests.get(ncm) ?? []).length > 0;
    },
    async cestVigente(cest: string) {
      return oficiais.todosCests.has(cest);
    },
    async cestCombinaComNcm(cest: string, ncm: string) {
      return (oficiais.cests.get(ncm) ?? []).includes(cest);
    },
  };
  type Item = PrecoItem & { id: string; external_id: string | null; inativo: boolean };
  const itemDe = (i: Item) => ({ id: i.id, external_id: i.external_id, preco_centavos: i.preco_centavos, desconto_maximo_bp: i.desconto_maximo_bp, inativo: i.inativo });
  const filhasMem = { produto_unidade: { col: unidades, pai: 'produto_id' }, cliente_endereco: { col: enderecos, pai: 'cliente_id' } } as const;
  const carga = {
    falharProxima: null as null | (() => Error),
    async condicoesDaForma(ext: string) {
      return condicoesPagamento.linhas.filter((l) => l.forma_external_id === ext).map((l) => structuredClone(l) as never);
    },
    async condicoesAtivasDeFormaRecusada() {
      return condicoesPagamento.linhas.filter((l) => !l.inativo && classeForma(String(l.forma_tpag)) === null).map((l) => structuredClone(l) as never);
    },
    async condicoesAtivasCartaoSemParcelas() {
      return condicoesPagamento.linhas.filter((l) => !l.inativo && l.forma_tpag === '03' && (l.parcelas_cartao ?? null) === null).map((l) => structuredClone(l) as never);
    },
    async filhoPorExternalId(t: keyof typeof filhasMem, ext: string) {
      const l = filhasMem[t].col.linhas.find((x) => x.external_id === ext);
      return l ? { id: l.id, pai_id: l.pai, external_id: l.external_id ?? null, inativo: l.inativo, atual: structuredClone(l) } : null;
    },
    async unidadePorChave(produtoId: string, unidade: string) {
      const l = unidades.linhas.find((x) => x.pai === produtoId && x.unidade === unidade);
      return l ? { id: l.id, pai_id: l.pai, external_id: l.external_id ?? null, inativo: l.inativo, atual: structuredClone(l) } : null;
    },
    async reativarFilho(t: keyof typeof filhasMem, id: string) {
      const l = filhasMem[t].col.linhas.find((x) => x.id === id);
      if (l) l.inativo = false;
    },
    async itemPrecoPorExternalId(ext: string) {
      const i = (itensPreco as Item[]).find((x) => x.external_id === ext);
      return i ? itemDe(i) : null;
    },
    async itemPrecoPorChave(t: string, f: string, p: string) {
      const i = (itensPreco as Item[]).find((x) => x.tabela_preco_id === t && x.filial_id === f && x.produto_id === p);
      return i ? itemDe(i) : null;
    },
    async gravarItemPreco(p: { tabelaId: string; filialId: string; produtoId: string; preco_centavos: number; desconto_maximo_bp: number; externalId: string; inativo: boolean }) {
      let i = (itensPreco as Item[]).find((x) => x.tabela_preco_id === p.tabelaId && x.filial_id === p.filialId && x.produto_id === p.produtoId);
      if (!i) {
        i = { id: randomUUID(), tabela_preco_id: p.tabelaId, filial_id: p.filialId, produto_id: p.produtoId, preco_centavos: 0, desconto_maximo_bp: 0, external_id: null, inativo: false };
        itensPreco.push(i);
      }
      Object.assign(i, { preco_centavos: p.preco_centavos, desconto_maximo_bp: p.desconto_maximo_bp, external_id: p.externalId, inativo: p.inativo });
      return { tabela_preco_id: p.tabelaId, filial_id: p.filialId, produto_id: p.produtoId, preco_centavos: p.preco_centavos, desconto_maximo_bp: p.desconto_maximo_bp, external_id: p.externalId };
    },
    /** Sem transação: o dublê só repassa (o rollback de verdade é testado no PostgreSQL). */
    async comSavepoint<T>(fn: () => Promise<T>) {
      return fn();
    },
  };
  const colecaoDe = (t: TabelaChave): readonly Reg[] =>
    ({ cliente: baseCliente.linhas, vendedor: vendedores.linhas, filial: filiais.linhas, produto: produtos.linhas, condicao_pagamento: condicoesPagamento.linhas, cliente_endereco: enderecos.linhas, tabela_preco: tabelasPreco.linhas, produto_unidade: unidades.linhas, tabela_preco_item: itensPreco as unknown as Reg[] })[t];
  /** Sem `tenant_id` (um tenant por dublê) e sem filtro de inativo, como o adaptador SQL. */
  const chaves: RepoChaves = {
    async idsPorExternalId(t, ext, soAtivos = false) {
      return new Map(colecaoDe(t).filter((l) => l.external_id && ext.includes(l.external_id) && !(soAtivos && l.inativo)).map((l) => [l.external_id as string, l.id]));
    },
    async idsSemExternalId(t, ids) {
      return new Set(colecaoDe(t).filter((l) => !l.external_id && ids.includes(l.id)).map((l) => l.id));
    },
    async existeId(t, id) {
      return colecaoDe(t).some((l) => l.id === id);
    },
  };
  const colecaoSubst = (t: TabelaSubstituivel): { l: Reg[]; pai: string | null } =>
    ({
      filial: { l: filiais.linhas, pai: null }, vendedor: { l: vendedores.linhas, pai: null }, condicao_pagamento: { l: condicoesPagamento.linhas, pai: null },
      produto: { l: produtos.linhas, pai: null }, cliente: { l: baseCliente.linhas, pai: null },
      produto_unidade: { l: unidades.linhas, pai: 'pai' }, cliente_endereco: { l: enderecos.linhas, pai: 'pai' },
      tabela_preco_item: { l: itensPreco as unknown as Reg[], pai: 'tabela_preco_id' },
    } as unknown as Record<TabelaSubstituivel, { l: Reg[]; pai: string | null }>)[t];
  /** Dublê do "Substituir tudo": inativa marcando `inativo`, como o adaptador SQL marca `deleted_at`. */
  const substituicao = {
    async existentes(t: TabelaSubstituivel) {
      const { l, pai } = colecaoSubst(t);
      return l.map((x) => ({ id: x.id, external_id: x.external_id ?? null, inativo: x.inativo, pai_id: pai ? ((x[pai] as string | undefined) ?? null) : null }));
    },
    async temAtivos(t: TabelaSubstituivel) {
      return colecaoSubst(t).l.some((x) => !x.inativo);
    },
    async inativarEmLote(t: TabelaSubstituivel, ids: readonly string[]) {
      const feitos: string[] = [];
      for (const x of colecaoSubst(t).l) if (ids.includes(x.id) && !x.inativo) { x.inativo = true; feitos.push(x.id); }
      return feitos;
    },
    async itensPreco(ids: readonly string[]) {
      return (itensPreco as Item[]).filter((i) => ids.includes(i.id)).map((i) => ({ tabela_preco_id: i.tabela_preco_id, filial_id: i.filial_id, produto_id: i.produto_id, external_id: i.external_id, preco_centavos: i.preco_centavos, desconto_maximo_bp: i.desconto_maximo_bp }));
    },
  };
  const repos = { chaves, carga, substituicao, filiais, clientes: clientesRepo, produtos, tabelasPreco, estoque: repoEstoque, condicoesPagamento, vendedores, consultaExterna, oficiais };
  return repos as unknown as Repositorios & typeof repos;
}

export function dependenciasEmMemoria(p: Partial<Pick<Dependencias, 'fontes'>> & { certificado?: boolean } = {}) {
  const repos = repositoriosEmMemoria();
  const certificados: PortaCertificados & { chamadas: string[] } = {
    chamadas: [],
    async filialTemA1Valido(_tx, filialId) {
      certificados.chamadas.push(filialId);
      return p.certificado ?? false;
    },
  };
  const deps: Dependencias = { repositorios: () => repos, fontes: p.fontes ?? { cnpj: [], cep: [] }, certificados };
  return { deps, repos, certificados };
}
