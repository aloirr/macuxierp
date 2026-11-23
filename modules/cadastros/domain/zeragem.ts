// Zerar dados por cadastro (v0.3.5). Plano puro: não toca no banco; quem executa é a API, com os fatos injetados.
// RN-CAD-10. DELETE de verdade, não soft delete, por causa do índice único
// (tenant_id, external_id). Registro em uso (pedido, título, nota) fica mantido, junto com os filhos dele.

export type CadastroZeravel =
  | 'filial'
  | 'vendedor'
  | 'condicao_pagamento'
  | 'tabela_preco'
  | 'produto'
  | 'cliente';

export type TabelaZeragem =
  | CadastroZeravel
  | 'produto_unidade'
  | 'tabela_preco_item'
  | 'estoque_saldo'
  | 'estoque_movimento'
  | 'cliente_endereco'
  | 'cliente_contato';

export type MotivoUso = 'pedido' | 'titulo' | 'nota';

/** Do mais forte para o mais fraco: com vários motivos, o primeiro é o contado. */
export const MOTIVOS: readonly MotivoUso[] = ['pedido', 'titulo', 'nota'];

/** Ordem global de DELETE: toda tabela vem depois das que dependem dela. */
export const ORDEM_DELETE: readonly TabelaZeragem[] = [
  'estoque_movimento',
  'estoque_saldo',
  'tabela_preco_item',
  'produto_unidade',
  'cliente_contato',
  'cliente_endereco',
  'cliente',
  'vendedor',
  'produto',
  'tabela_preco',
  'condicao_pagamento',
  'filial',
];

/** Pais (FK NOT NULL, 0004_cadastros.sql) de cada tabela filha: apagar o pai apaga o filho. */
const PAIS: Partial<Record<TabelaZeragem, readonly TabelaZeragem[]>> = {
  estoque_movimento: ['produto', 'filial'],
  estoque_saldo: ['produto', 'filial'],
  tabela_preco_item: ['tabela_preco', 'produto', 'filial'],
  produto_unidade: ['produto'],
  cliente_contato: ['cliente'],
  cliente_endereco: ['cliente'],
  cliente: ['filial'],
  vendedor: ['filial'],
};

/**
 * Referências opcionais do cliente: ao apagar o pai, o cliente fica e a coluna vai a NULL.
 * A carteira é cliente.vendedor_id (D7): não existe tabela de carteira.
 */
const ANULAVEIS: readonly { tabela: 'cliente'; pai: TabelaZeragem; coluna: string }[] = [
  { tabela: 'cliente', pai: 'vendedor', coluna: 'vendedor_id' },
  { tabela: 'cliente', pai: 'tabela_preco', coluna: 'tabela_preco_id' },
  { tabela: 'cliente', pai: 'condicao_pagamento', coluna: 'condicao_pagamento_id' },
];

/** Cadastro → tabelas apagadas por ele, na ordem de DELETE (filhos antes do pai, o próprio cadastro por último). */
export const CASCATA: Record<CadastroZeravel, readonly TabelaZeragem[]> = {
  produto: ['estoque_movimento', 'estoque_saldo', 'tabela_preco_item', 'produto_unidade', 'produto'],
  cliente: ['cliente_contato', 'cliente_endereco', 'cliente'],
  tabela_preco: ['tabela_preco_item', 'tabela_preco'],
  vendedor: ['vendedor'],
  condicao_pagamento: ['condicao_pagamento'],
  filial: [
    'estoque_movimento',
    'estoque_saldo',
    'tabela_preco_item',
    'cliente_contato',
    'cliente_endereco',
    'cliente',
    'vendedor',
    'filial',
  ],
};

export interface LinhaZeragem {
  id: string;
  /** Pai por tabela (ex.: { produto: '...', filial: '...' }). */
  refs?: Partial<Record<TabelaZeragem, string>>;
}

export interface FatosZeragem {
  existentes: Partial<Record<TabelaZeragem, readonly LinhaZeragem[]>>;
  /** Ids em uso, por cadastro e por motivo (portas de consulta do pedido e do faturamento). */
  usos?: Partial<Record<CadastroZeravel, Partial<Record<MotivoUso, readonly string[]>>>>;
  /** Filiais que já emitiram nota. */
  filiaisComNota?: readonly string[];
}

export interface PlanoZeragem {
  /** Na ordem de execução. Tabela sem id não aparece. */
  apagar: { tabela: TabelaZeragem; ids: string[] }[];
  /** UPDATE ... SET coluna = NULL, antes dos DELETE. */
  anular: { tabela: 'cliente'; coluna: string; ids: string[] }[];
  mantidos: { cadastro: CadastroZeravel; motivo: MotivoUso; quantidade: number }[];
}

const unicos = (l: readonly LinhaZeragem[] = []): LinhaZeragem[] => {
  const vistos = new Set<string>();
  return l.filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true)));
};

export function planoZeragem(cadastro: CadastroZeravel, fatos: FatosZeragem): PlanoZeragem {
  const linhas = (t: TabelaZeragem) => unicos(fatos.existentes[t]);
  const motivoDe = (c: CadastroZeravel, id: string): MotivoUso | undefined =>
    MOTIVOS.find((m) => fatos.usos?.[c]?.[m]?.includes(id));

  // 1. Quem da raiz fica mantido, e por qual motivo.
  const motivos = new Map<string, MotivoUso>();
  const comNota = new Set(fatos.filiaisComNota ?? []);
  for (const r of linhas(cadastro)) {
    let m = motivoDe(cadastro, r.id);
    if (cadastro === 'filial') {
      if (!m && comNota.has(r.id)) m = 'nota';
      // dependente em uso (cliente ou vendedor da filial) mantém a filial
      for (const dep of ['cliente', 'vendedor'] as const) {
        if (m) break;
        for (const d of linhas(dep)) {
          const md = d.refs?.filial === r.id ? motivoDe(dep, d.id) : undefined;
          if (md && (!m || MOTIVOS.indexOf(md) < MOTIVOS.indexOf(m))) m = md;
        }
      }
    }
    if (m) motivos.set(r.id, m);
  }

  // 2. Cascata: o que depende de apagado é apagado (a filial mantida segura os dependentes dela).
  const apagados = new Map<TabelaZeragem, Set<string>>();
  apagados.set(cadastro, new Set(linhas(cadastro).filter((r) => !motivos.has(r.id)).map((r) => r.id)));
  // pais antes dos filhos: ORDEM_DELETE ao contrário
  for (const t of [...ORDEM_DELETE].reverse()) {
    if (t === cadastro) continue;
    const pais = PAIS[t];
    if (!pais?.some((p) => apagados.has(p))) continue;
    const alvo = new Set<string>();
    for (const r of linhas(t)) {
      if (pais.some((p) => { const ref = r.refs?.[p]; return ref !== undefined && apagados.get(p)?.has(ref); })) {
        alvo.add(r.id);
      }
    }
    apagados.set(t, alvo);
  }

  // 3. Referências opcionais de quem fica.
  const anular: PlanoZeragem['anular'] = [];
  for (const a of ANULAVEIS) {
    const pais = apagados.get(a.pai);
    if (!pais?.size) continue;
    const filhos = apagados.get(a.tabela) ?? new Set<string>();
    const ids = linhas(a.tabela)
      .filter((r) => !filhos.has(r.id) && r.refs?.[a.pai] !== undefined && pais.has(r.refs[a.pai] as string))
      .map((r) => r.id);
    if (ids.length) anular.push({ tabela: a.tabela, coluna: a.coluna, ids });
  }

  const apagar = ORDEM_DELETE.flatMap((tabela) => {
    const ids = [...(apagados.get(tabela) ?? [])];
    return ids.length ? [{ tabela, ids }] : [];
  });

  const mantidos = MOTIVOS.flatMap((motivo) => {
    const quantidade = [...motivos.values()].filter((m) => m === motivo).length;
    return quantidade ? [{ cadastro, motivo, quantidade }] : [];
  });

  return { apagar, anular, mantidos };
}
