/** Repositórios em memória: dublê das portas para os testes de rota (sem PostgreSQL). Não entra em produção. */
import { randomUUID } from 'node:crypto';
import { ErroApi, paginar, type Pagina } from '@macuxierp/platform-sdk';
import type { PrecoItem, PrecoItemConsulta } from '../contracts';
import { agregadoPreco } from './uuid';
import type {
  ConsultaGravada, Dependencias, FiltroLista, MovimentoGravado, PortaCertificados, RepoFilho, RepoSimples, Repositorios, TipoConsulta,
} from './portas';

/** Ordem estável por `id` e `id > cursor`, como o adaptador SQL (`.coord/contratos/listas.md`); devolve `limite + 1` linhas no máximo para `paginar`. */
const depoisDoCursor = <T extends { id: string }>(linhas: readonly T[], cursor?: string): T[] =>
  [...linhas].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((x) => !cursor || x.id > cursor);

type Reg = { id: string; inativo: boolean; external_id?: string | null } & Record<string, unknown>;

export class ColecaoMemoria<E extends { id: string }, D extends Record<string, unknown>> implements RepoSimples<E, D> {
  readonly linhas: Reg[] = [];
  constructor(
    private readonly opcoes: { unicos?: string[]; texto?: string[]; filtros?: Record<string, string>; padrao?: boolean } = {},
  ) {}

  protected criar(dados: D): Reg {
    return { ...dados, id: randomUUID(), inativo: false } as unknown as Reg;
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
  const produtos = Object.assign(new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ unicos: ['codigo'], texto: ['descricao', 'codigo'] }), { unidades });
  const filiais = Object.assign(new ColecaoMemoria<{ id: string }, Record<string, unknown>>({ unicos: ['cnpj'], texto: ['razao_social'] }), {
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
    async itensDoProduto(tabelaId: string, produtoId: string, filialIds: readonly string[]) {
      return itensPreco.filter((i) => i.tabela_preco_id === tabelaId && i.produto_id === produtoId && filialIds.includes(i.filial_id));
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
  const movimentos: MovimentoGravado[] = [];
  const repoEstoque = {
    movimentos,
    async saldos(q: { filial_id?: string; produto_id?: string }) {
      return [...saldos]
        .map(([k, quantidade]) => ({ filial_id: k.split('|')[0] as string, produto_id: k.split('|')[1] as string, quantidade }))
        .filter((s) => (!q.filial_id || s.filial_id === q.filial_id) && (!q.produto_id || s.produto_id === q.produto_id));
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
  const repos = { filiais, clientes: clientesRepo, produtos, tabelasPreco, estoque: repoEstoque, condicoesPagamento, vendedores, consultaExterna, oficiais };
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
