/**
 * Adaptador PostgreSQL das portas do cadastros. Roda na transação do tenant (`comTenant`: RLS por `app.tenant_id`);
 * por isso nenhum SQL repete `tenant_id` no WHERE, e o INSERT usa `plataforma.tenant_atual()`. Exclusão = `deleted_at`
 * (RN-CAD-08). bigint volta como `float8` (centavos e quantidade × 10^4 cabem em 2^53).
 */
import { erros, paginar, type Pagina, type Transacao } from '@macuxierp/platform-sdk';
import type {
  Cliente, ClienteDados, Contato, ContatoItem, EnderecoCliente, EnderecoClienteItem, Filial, FilialDados, PrecoItem, PrecoItemConsulta, PrecoItemLista, Produto,
  ProdutoDados, UnidadeDados, UnidadeItem,
} from '../contracts';
import type {
  ConsultaGravada, FiltroLista, MovimentoGravado, RepoFilho, RepoOficiais, RepoSimples, Repositorios, TipoConsulta,
} from './portas';

type Dict = Record<string, unknown>;
const DATA = (c: string) => `to_char(${c}, 'YYYY-MM-DD') AS ${c}`;
const N = (c: string) => `${c}::float8 AS ${c}`;

async function executar<L = Dict>(tx: Transacao, sql: string, p: readonly unknown[] = []): Promise<L[]> {
  try {
    return await tx.consultar<L>(sql, p);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw erros.conflito('Já existe um cadastro com esse documento, código ou identificador externo');
    if ((e as { code?: string }).code === '23503') throw erros.validacao({ referencia: 'Cadastro referenciado inexistente' });
    throw e;
  }
}

interface Mapa<E, D> {
  tabela: string;
  /** Colunas escalares lidas como estão. */
  colunas: readonly string[];
  /** Expressões de SELECT que precisam de conversão (data, bigint). */
  expressoes?: readonly string[];
  busca: readonly string[];
  filtros?: { filial?: boolean; vendedor?: boolean };
  paraLinha(d: Partial<D>): Dict;
  deLinha(l: Dict): E;
}

const selecionar = (m: Pick<Mapa<unknown, unknown>, 'colunas' | 'expressoes'>) =>
  ['id', 'external_id', '(deleted_at IS NOT NULL) AS inativo', ...m.colunas, ...(m.expressoes ?? [])].join(', ');

const definidos = (o: Dict) => Object.entries(o).filter(([, v]) => v !== undefined);

class RepoTabela<E extends { id: string }, D> implements RepoSimples<E, D> {
  constructor(protected readonly tx: Transacao, protected readonly m: Mapa<E, D>) {}

  protected async hidratar(itens: E[]): Promise<E[]> {
    return itens;
  }

  async listar(q: FiltroLista): Promise<Pagina<E>> {
    const p: unknown[] = [];
    const w: string[] = [];
    const par = (v: unknown) => `$${p.push(v)}`;
    if (!q.inativos) w.push('deleted_at IS NULL');
    if (q.busca) w.push(`(${this.m.busca.map((c) => `${c} ILIKE ${par(`%${q.busca}%`)}`).join(' OR ')})`);
    if (q.filial_id && this.m.filtros?.filial) w.push(`filial_id = ${par(q.filial_id)}`);
    if (q.vendedor_id && this.m.filtros?.vendedor) w.push(`vendedor_id = ${par(q.vendedor_id)}`);
    if (q.vendedor_ids && this.m.filtros?.vendedor) w.push(`vendedor_id = ANY(${par([...q.vendedor_ids])}::uuid[])`);
    if (q.cursor) w.push(`id > ${par(q.cursor)}`);
    const onde = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const linhas = await executar(
      this.tx,
      `SELECT ${selecionar(this.m)} FROM ${this.m.tabela} ${onde} ORDER BY id LIMIT ${par(q.limite + 1)}`,
      p,
    );
    const pagina = paginar(linhas.map((l) => this.m.deLinha(l)), q.limite);
    return { itens: await this.hidratar(pagina.itens), proximo_cursor: pagina.proximo_cursor };
  }

  private async um(onde: string, valor: string): Promise<E | null> {
    const l = await executar(this.tx, `SELECT ${selecionar(this.m)} FROM ${this.m.tabela} WHERE ${onde} LIMIT 1`, [valor]);
    const [e] = l.length ? await this.hidratar(l.map((x) => this.m.deLinha(x))) : [];
    return e ?? null;
  }
  obter(id: string) {
    return this.um('id = $1', id);
  }
  porExternalId(ext: string) {
    return this.um('external_id = $1', ext);
  }

  async inserir(dados: D): Promise<E> {
    const campos = definidos(this.m.paraLinha(dados));
    const r = await executar<{ id: string }>(
      this.tx,
      `INSERT INTO ${this.m.tabela} (tenant_id, ${campos.map(([c]) => c).join(', ')}) VALUES (plataforma.tenant_atual(), ${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      campos.map(([, v]) => v),
    );
    await this.aposInserir(r[0]?.id as string, dados);
    return (await this.obter(r[0]?.id as string)) as E;
  }
  protected async aposInserir(_id: string, _dados: D): Promise<void> {}

  async atualizar(id: string, parcial: Partial<D>): Promise<E | null> {
    const campos = definidos(this.m.paraLinha(parcial));
    if (campos.length > 0) {
      await executar(this.tx, `UPDATE ${this.m.tabela} SET ${campos.map(([c], i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${campos.length + 1}`, [...campos.map(([, v]) => v), id]);
    }
    return this.obter(id);
  }

  async inativar(id: string): Promise<E | null> {
    await executar(this.tx, `UPDATE ${this.m.tabela} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return this.obter(id);
  }

  async paginaPorCursor(apos: string | null, limite: number): Promise<E[]> {
    const l = await executar(this.tx, `SELECT ${selecionar(this.m)} FROM ${this.m.tabela} WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`, [apos, limite]);
    return this.hidratar(l.map((x) => this.m.deLinha(x)));
  }

  async idsAtivos(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const l = await executar<{ id: string }>(this.tx, `SELECT id FROM ${this.m.tabela} WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [[...ids]]);
    return new Set(l.map((x) => x.id));
  }

  async desmarcarPadrao(exceto: string | null): Promise<void> {
    await executar(this.tx, `UPDATE ${this.m.tabela} SET padrao = false WHERE padrao AND deleted_at IS NULL AND ($1::uuid IS NULL OR id <> $1::uuid)`, [exceto]);
  }
}

class RepoFilhoSql<E extends { id: string }, D> implements RepoFilho<E, D> {
  constructor(private readonly tx: Transacao, private readonly m: Mapa<E, D> & { pai: string }) {}
  async listar(paiId: string) {
    const l = await executar(this.tx, `SELECT ${selecionar(this.m)} FROM ${this.m.tabela} WHERE ${this.m.pai} = $1 AND deleted_at IS NULL ORDER BY created_at, id`, [paiId]);
    return l.map((x) => this.m.deLinha(x));
  }
  async obter(paiId: string, id: string) {
    const l = await executar(this.tx, `SELECT ${selecionar(this.m)} FROM ${this.m.tabela} WHERE ${this.m.pai} = $1 AND id = $2 AND deleted_at IS NULL`, [paiId, id]);
    return l[0] ? this.m.deLinha(l[0]) : null;
  }
  async inserir(paiId: string, dados: D) {
    const campos = definidos({ ...this.m.paraLinha(dados), [this.m.pai]: paiId });
    const r = await executar<{ id: string }>(
      this.tx,
      `INSERT INTO ${this.m.tabela} (tenant_id, ${campos.map(([c]) => c).join(', ')}) VALUES (plataforma.tenant_atual(), ${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      campos.map(([, v]) => v),
    );
    return (await this.obter(paiId, r[0]?.id as string)) as E;
  }
  async atualizar(paiId: string, id: string, parcial: Partial<D>) {
    const campos = definidos(this.m.paraLinha(parcial));
    if (campos.length > 0) {
      await executar(this.tx, `UPDATE ${this.m.tabela} SET ${campos.map(([c], i) => `${c} = $${i + 1}`).join(', ')} WHERE ${this.m.pai} = $${campos.length + 1} AND id = $${campos.length + 2}`, [...campos.map(([, v]) => v), paiId, id]);
    }
    return this.obter(paiId, id);
  }
  async inativar(paiId: string, id: string) {
    const antes = await this.obter(paiId, id);
    if (!antes) return null;
    await executar(this.tx, `UPDATE ${this.m.tabela} SET deleted_at = now() WHERE ${this.m.pai} = $1 AND id = $2`, [paiId, id]);
    return antes;
  }
}

const ENDERECO = ['logradouro', 'numero', 'complemento', 'bairro', 'municipio_ibge', 'uf', 'cep', 'pais_bacen'] as const;
const pegar = (o: Dict, cols: readonly string[]) => Object.fromEntries(cols.filter((c) => c in o).map((c) => [c, o[c]]));
const semExterno = (d: Dict) => ({ ...d });

const mapaFilial: Mapa<Filial, FilialDados> = {
  tabela: 'cadastros.filial',
  colunas: ['cnpj', 'ie', 'razao_social', 'nome_fantasia', 'crt', ...ENDERECO, 'padrao', 'emissora', 'nfe_serie', 'nfe_numero_inicial'],
  busca: ['razao_social', 'nome_fantasia', 'cnpj'],
  paraLinha: (d) => {
    const { endereco, ...resto } = d as Dict & { endereco?: Dict };
    return { ...resto, ...(endereco ?? {}) };
  },
  deLinha: (l) => ({
    ...pegar(l, ['id', 'external_id', 'inativo', 'cnpj', 'ie', 'razao_social', 'nome_fantasia', 'crt', 'padrao', 'emissora', 'nfe_serie', 'nfe_numero_inicial']),
    endereco: pegar(l, ENDERECO),
  }) as unknown as Filial,
};

const mapaCliente: Mapa<Cliente, ClienteDados> = {
  tabela: 'cadastros.cliente',
  colunas: ['tipo_pessoa', 'documento', 'ie', 'ind_ie_dest', 'razao_social', 'nome_fantasia', 'email_nfe', 'condicao_pagamento_id', 'tabela_preco_id', 'filial_id', 'vendedor_id'],
  expressoes: [N('limite_credito_centavos')],
  busca: ['razao_social', 'nome_fantasia', 'documento'],
  filtros: { filial: true, vendedor: true },
  paraLinha: (d) => {
    const { enderecos: _e, ...resto } = d as Dict;
    return semExterno(resto);
  },
  deLinha: (l) => ({ ...l, enderecos: [] }) as unknown as Cliente,
};

const mapaEndereco: Mapa<EnderecoClienteItem, EnderecoCliente> & { pai: string } = {
  tabela: 'cadastros.cliente_endereco', pai: 'cliente_id', colunas: ['tipo', ...ENDERECO], busca: [],
  paraLinha: (d) => ({ ...d }), deLinha: (l) => pegar(l, ['id', 'tipo', ...ENDERECO]) as unknown as EnderecoClienteItem,
};
const mapaContato: Mapa<ContatoItem, Contato> & { pai: string } = {
  tabela: 'cadastros.cliente_contato', pai: 'cliente_id', colunas: ['nome', 'email', 'telefone', 'papel'], busca: [],
  paraLinha: (d) => ({ ...d }), deLinha: (l) => pegar(l, ['id', 'nome', 'email', 'telefone', 'papel']) as unknown as ContatoItem,
};
const mapaUnidade: Mapa<UnidadeItem, UnidadeDados> & { pai: string } = {
  tabela: 'cadastros.produto_unidade', pai: 'produto_id', colunas: ['unidade', 'ean'], expressoes: [N('fator')], busca: [],
  paraLinha: (d) => ({ ...d }), deLinha: (l) => pegar(l, ['id', 'unidade', 'fator', 'ean']) as unknown as UnidadeItem,
};

class RepoClientesSql extends RepoTabela<Cliente, ClienteDados> {
  readonly enderecos: RepoFilho<EnderecoClienteItem, EnderecoCliente>;
  readonly contatos: RepoFilho<ContatoItem, Contato>;
  constructor(tx: Transacao) {
    super(tx, mapaCliente);
    this.enderecos = new RepoFilhoSql(tx, mapaEndereco);
    this.contatos = new RepoFilhoSql(tx, mapaContato);
  }
  protected override async hidratar(itens: Cliente[]): Promise<Cliente[]> {
    if (itens.length === 0) return itens;
    const l = await executar(this.tx, `SELECT cliente_id, ${selecionar(mapaEndereco)} FROM cadastros.cliente_endereco WHERE cliente_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY created_at, id`, [itens.map((i) => i.id)]);
    return itens.map((c) => ({ ...c, enderecos: l.filter((x) => x.cliente_id === c.id).map((x) => mapaEndereco.deLinha(x)) }));
  }
  protected override async aposInserir(id: string, dados: ClienteDados): Promise<void> {
    for (const e of dados.enderecos) await this.enderecos.inserir(id, e);
  }
  async idsDaCarteira(vendedorId: string) {
    return (await executar<{ id: string }>(this.tx, 'SELECT id FROM cadastros.cliente WHERE vendedor_id = $1 AND deleted_at IS NULL', [vendedorId])).map((r) => r.id);
  }
  async transferir(para: string, ids: readonly string[]) {
    await executar(this.tx, 'UPDATE cadastros.cliente SET vendedor_id = $1 WHERE id = ANY($2::uuid[])', [para, [...ids]]);
  }
}

const mapaProduto: Mapa<Produto, ProdutoDados> = {
  tabela: 'cadastros.produto',
  colunas: ['codigo', 'descricao', 'ncm', 'cest', 'unidade_comercial', 'unidade_tributavel', 'ean', 'marca', 'origem', 'grupo_tributacao'],
  expressoes: [N('fator_tributavel'), N('custo_centavos')],
  busca: ['codigo', 'descricao', 'ean', 'marca'],
  paraLinha: (d) => ({ ...d }),
  deLinha: (l) => l as unknown as Produto,
};

export function repositoriosSql(tx: Transacao): Repositorios {
  const tabela = <E extends { id: string }, D>(m: Mapa<E, D>) => new RepoTabela<E, D>(tx, m);
  const simples = (t: string, colunas: string[], busca: string[], expressoes: string[] = []) =>
    tabela({ tabela: t, colunas, expressoes, busca, paraLinha: (d: Dict) => ({ ...d }), deLinha: (l: Dict) => l as never });

  const produtos = Object.assign(tabela(mapaProduto), { unidades: new RepoFilhoSql(tx, mapaUnidade) });
  const tabelasPreco = Object.assign(
    simples('cadastros.tabela_preco', ['nome', 'padrao'], ['nome'], [DATA('vigencia_inicio'), DATA('vigencia_fim')]),
    {
      async itens(tabelaId: string, q: PrecoItemConsulta): Promise<Pagina<PrecoItemLista>> {
        const p: unknown[] = [tabelaId];
        const w = ['tabela_preco_id = $1', 'deleted_at IS NULL'];
        if (q.filial_id) w.push(`filial_id = $${p.push(q.filial_id)}`);
        if (q.produto_id) w.push(`produto_id = $${p.push(q.produto_id)}`);
        if (q.cursor) w.push(`id > $${p.push(q.cursor)}`);
        const linhas = await executar<PrecoItemLista>(
          tx,
          `SELECT id, tabela_preco_id, filial_id, produto_id, ${N('preco_centavos')}, desconto_maximo_bp FROM cadastros.tabela_preco_item WHERE ${w.join(' AND ')} ORDER BY id LIMIT $${p.push(q.limite + 1)}`,
          p,
        );
        return paginar(linhas, q.limite);
      },
      itensDoProduto: (tabelaId: string, produtoId: string, filialIds: readonly string[]) =>
        executar<PrecoItem>(
          tx,
          `SELECT tabela_preco_id, filial_id, produto_id, ${N('preco_centavos')}, desconto_maximo_bp FROM cadastros.tabela_preco_item WHERE tabela_preco_id = $1 AND produto_id = $2 AND filial_id = ANY($3::uuid[]) AND deleted_at IS NULL`,
          [tabelaId, produtoId, [...filialIds]],
        ),
      /** Um comando só para até 5.000 itens; devolve só o que mudou (evento por item alterado). */
      gravarLote: (tabelaId: string, itens: readonly Omit<PrecoItem, 'tabela_preco_id'>[]) =>
        executar<PrecoItem>(
          tx,
          `INSERT INTO cadastros.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos, desconto_maximo_bp)
           SELECT plataforma.tenant_atual(), $1, f, p, pr, d FROM unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::int[]) AS t(f, p, pr, d)
           ON CONFLICT (tenant_id, tabela_preco_id, filial_id, produto_id) DO UPDATE
             SET preco_centavos = EXCLUDED.preco_centavos, desconto_maximo_bp = EXCLUDED.desconto_maximo_bp, deleted_at = NULL
             WHERE cadastros.tabela_preco_item.preco_centavos IS DISTINCT FROM EXCLUDED.preco_centavos
                OR cadastros.tabela_preco_item.desconto_maximo_bp IS DISTINCT FROM EXCLUDED.desconto_maximo_bp
                OR cadastros.tabela_preco_item.deleted_at IS NOT NULL
           RETURNING tabela_preco_id, filial_id, produto_id, ${N('preco_centavos')}, desconto_maximo_bp`,
          [tabelaId, itens.map((i) => i.filial_id), itens.map((i) => i.produto_id), itens.map((i) => i.preco_centavos), itens.map((i) => i.desconto_maximo_bp)],
        ),
    },
  );

  const estoque = {
    saldos: (q: { filial_id?: string; produto_id?: string }) => {
      const p: unknown[] = [];
      const w = ['deleted_at IS NULL'];
      if (q.filial_id) w.push(`filial_id = $${p.push(q.filial_id)}`);
      if (q.produto_id) w.push(`produto_id = $${p.push(q.produto_id)}`);
      return executar<{ filial_id: string; produto_id: string; quantidade: number }>(tx, `SELECT filial_id, produto_id, ${N('quantidade')} FROM cadastros.estoque_saldo WHERE ${w.join(' AND ')} ORDER BY produto_id, filial_id`, p);
    },
    // Sem `inativo` no saldo: o evento não expressa saldo apagado, por isso o cursor (diferente das demais entidades) pula `deleted_at`.
    paginaPorCursor: (apos: { filial_id: string; produto_id: string } | null, limite: number) =>
      executar<{ filial_id: string; produto_id: string; quantidade: number }>(
        tx,
        `SELECT filial_id, produto_id, ${N('quantidade')} FROM cadastros.estoque_saldo WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR (produto_id, filial_id) > ($1::uuid, $2::uuid)) ORDER BY produto_id, filial_id LIMIT $3`,
        [apos?.produto_id ?? null, apos?.filial_id ?? null, limite],
      ),
    async saldoParaAtualizar(filialId: string, produtoId: string) {
      await executar(tx, 'INSERT INTO cadastros.estoque_saldo (tenant_id, filial_id, produto_id, quantidade) VALUES (plataforma.tenant_atual(), $1, $2, 0) ON CONFLICT (tenant_id, filial_id, produto_id) DO NOTHING', [filialId, produtoId]);
      const r = await executar<{ quantidade: number }>(tx, `SELECT ${N('quantidade')} FROM cadastros.estoque_saldo WHERE filial_id = $1 AND produto_id = $2 FOR UPDATE`, [filialId, produtoId]);
      return r[0]?.quantidade ?? 0;
    },
    async gravarMovimento(m: MovimentoGravado, saldoNovo: number) {
      const r = await executar<{ id: string }>(
        tx,
        `INSERT INTO cadastros.estoque_movimento (tenant_id, filial_id, produto_id, tipo, quantidade, motivo, usuario_id, external_id)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [m.filial_id, m.produto_id, m.tipo, m.quantidade, m.motivo, m.usuario_id, m.external_id ?? null],
      );
      await executar(tx, 'UPDATE cadastros.estoque_saldo SET quantidade = $3 WHERE filial_id = $1 AND produto_id = $2', [m.filial_id, m.produto_id, saldoNovo]);
      return { id: r[0]?.id as string };
    },
    async movimentoPorExternalId(ext: string) {
      const r = await executar<{ id: string }>(tx, 'SELECT id FROM cadastros.estoque_movimento WHERE external_id = $1', [ext]);
      return r[0] ?? null;
    },
  };

  const vendedores = Object.assign(simples('cadastros.vendedor', ['codigo', 'nome', 'filial_id', 'usuario_id'], ['codigo', 'nome']), {
    async idsDoUsuario(usuarioId: string) {
      return (await executar<{ id: string }>(tx, 'SELECT id FROM cadastros.vendedor WHERE usuario_id = $1 AND deleted_at IS NULL', [usuarioId])).map((r) => r.id);
    },
  });

  const lerConsulta = (l: Dict): ConsultaGravada => l as unknown as ConsultaGravada;
  const consultaExterna = {
    async obter(tipo: TipoConsulta, chave: string) {
      const r = await executar(tx, 'SELECT tipo, chave, resposta, fonte, consultado_em, expira_em, external_id FROM cadastros.consulta_externa WHERE tipo = $1 AND chave = $2 AND deleted_at IS NULL', [tipo, chave]);
      return r[0] ? lerConsulta(r[0]) : null;
    },
    async porExternalId(tipo: TipoConsulta, ext: string) {
      const r = await executar(tx, 'SELECT tipo, chave, resposta, fonte, consultado_em, expira_em, external_id FROM cadastros.consulta_externa WHERE tipo = $1 AND external_id = $2 AND deleted_at IS NULL', [tipo, ext]);
      return r[0] ? lerConsulta(r[0]) : null;
    },
    async gravar(c: ConsultaGravada) {
      await executar(
        tx,
        `INSERT INTO cadastros.consulta_externa (tenant_id, tipo, chave, resposta, fonte, consultado_em, expira_em, external_id)
         VALUES (plataforma.tenant_atual(), $1, $2, $3::jsonb, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, tipo, chave) DO UPDATE
           SET resposta = EXCLUDED.resposta, fonte = EXCLUDED.fonte, consultado_em = EXCLUDED.consultado_em,
               expira_em = EXCLUDED.expira_em, external_id = EXCLUDED.external_id, deleted_at = NULL`,
        [c.tipo, c.chave, JSON.stringify(c.resposta), c.fonte, c.consultado_em, c.expira_em, c.external_id],
      );
    },
  };

  return {
    filiais: Object.assign(tabela(mapaFilial), {
      async padrao() {
        const r = await executar(tx, `SELECT ${selecionar(mapaFilial)} FROM cadastros.filial WHERE padrao AND deleted_at IS NULL`);
        return r[0] ? mapaFilial.deLinha(r[0]) : null;
      },
    }),
    clientes: new RepoClientesSql(tx),
    produtos,
    tabelasPreco: tabelasPreco as unknown as Repositorios['tabelasPreco'],
    estoque,
    condicoesPagamento: simples('cadastros.condicao_pagamento', ['codigo', 'descricao', 'forma_tpag', 'prazos_dias'], ['codigo', 'descricao']) as never,
    vendedores: vendedores as unknown as Repositorios['vendedores'],
    consultaExterna,
    oficiais: oficiaisSql(tx),
  };
}

const VIGENTE = (a: string) => `${a}.vigencia_inicio <= $D::date AND (${a}.vigencia_fim IS NULL OR ${a}.vigencia_fim >= $D::date) AND ${a}.deleted_at IS NULL`;

const OFICIAIS: Record<string, { tabela: string; colunas: string; busca: string[]; uf?: string; tipo?: boolean }> = {
  ncm: { tabela: 'cadastros.ncm', colunas: 'codigo, descricao', busca: ['codigo', 'descricao'] },
  cest: { tabela: 'cadastros.cest', colunas: 'codigo, descricao, segmento', busca: ['codigo', 'descricao'] },
  cfop: { tabela: 'cadastros.cfop', colunas: 'codigo, descricao', busca: ['codigo', 'descricao'] },
  cst: { tabela: 'cadastros.cst', colunas: 'tipo, codigo, descricao', busca: ['codigo', 'descricao'], tipo: true },
  municipios: { tabela: 'cadastros.municipio', colunas: 'codigo, nome, uf', busca: ['codigo', 'nome'], uf: 'uf' },
  'classificacao-tributaria': { tabela: 'cadastros.classificacao_tributaria', colunas: 'tipo, codigo, cst, nome, descricao, tipo_aliquota', busca: ['codigo', 'nome', 'descricao'], tipo: true },
};

function oficiaisSql(tx: Transacao): RepoOficiais {
  const existe = async (sql: string, p: unknown[], data: string) =>
    (await executar<{ ok: boolean }>(tx, `SELECT EXISTS (${sql.replaceAll('$D', `$${p.length + 1}`)}) AS ok`, [...p, data]))[0]?.ok === true;
  return {
    async listar(tabela, q) {
      const cfg = OFICIAIS[tabela];
      if (!cfg) return { itens: [], proximo_cursor: null };
      const data = q.data ?? new Date().toISOString().slice(0, 10);
      const p: unknown[] = [data];
      const w = [VIGENTE('o').replaceAll('$D', '$1')];
      if (q.busca) w.push(`(${cfg.busca.map((c) => `o.${c} ILIKE $${p.push(`%${q.busca}%`)}`).join(' OR ')})`);
      if (q.uf && cfg.uf) w.push(`o.${cfg.uf} = $${p.push(q.uf)}`);
      if (q.tipo && cfg.tipo) w.push(`o.tipo = $${p.push(q.tipo)}`);
      if (q.cursor) w.push(`o.id > $${p.push(q.cursor)}`);
      const linhas = await executar<{ id: string } & Dict>(
        tx,
        `SELECT o.id, ${cfg.colunas.split(', ').map((c) => `o.${c}`).join(', ')}, to_char(o.vigencia_inicio, 'YYYY-MM-DD') AS vigencia_inicio, to_char(o.vigencia_fim, 'YYYY-MM-DD') AS vigencia_fim FROM ${cfg.tabela} o WHERE ${w.join(' AND ')} ORDER BY o.id LIMIT $${p.push(q.limite + 1)}`,
        p,
      );
      return paginar(linhas, q.limite);
    },
    async nomesMunicipios(codigos) {
      if (codigos.length === 0) return new Map();
      const l = await executar<{ codigo: string; nome: string }>(tx, 'SELECT DISTINCT ON (codigo) codigo, nome FROM cadastros.municipio WHERE codigo = ANY($1::text[]) ORDER BY codigo, vigencia_inicio DESC NULLS LAST', [[...codigos]]);
      return new Map(l.map((m) => [m.codigo, m.nome]));
    },
    ncmVigente: (ncm, data) => existe(`SELECT 1 FROM cadastros.ncm n WHERE n.codigo = $1 AND ${VIGENTE('n')}`, [ncm], data),
    ncmExigeCest: (ncm, data) =>
      existe(`SELECT 1 FROM cadastros.cest_ncm cn JOIN cadastros.cest c ON c.codigo = cn.cest_codigo WHERE $1 LIKE cn.ncm_prefixo || '%' AND ${VIGENTE('cn')} AND ${VIGENTE('c')}`, [ncm], data),
    cestVigente: (cest, data) => existe(`SELECT 1 FROM cadastros.cest c WHERE c.codigo = $1 AND ${VIGENTE('c')}`, [cest], data),
    cestCombinaComNcm: (cest, ncm, data) =>
      existe(`SELECT 1 FROM cadastros.cest_ncm cn JOIN cadastros.cest c ON c.codigo = cn.cest_codigo WHERE cn.cest_codigo = $1 AND $2 LIKE cn.ncm_prefixo || '%' AND ${VIGENTE('cn')} AND ${VIGENTE('c')}`, [cest, ncm], data),
  };
}
