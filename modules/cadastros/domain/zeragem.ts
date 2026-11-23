// Zerar dados por cadastro (RN-CAD-10). Plano puro: não toca no banco; o efeito roda nas funções do banco
// (cadastros.portal_zeragem_fatos e as de DELETE), com os fatos injetados e reconferidos com FOR UPDATE.
// DELETE de verdade, não soft delete, por causa do índice único (tenant_id, external_id).
// A frase de confirmação não é do domain: é do SDK (normalizarFrase/FRASE_ZERAR_DADOS), conferida no plugin.
// Nada fiscal aqui: nota, XML e evento não entram no plano. Pedidos não faturados ficam fora desta versão.

import { CADASTROS_ZERAR_PORTAL, type CadastroZerarPortal, type TabelaZeragem } from '@macuxierp/platform-sdk';

/** Fonte única: o contrato do SDK (portal-cargas.ts). */
export const CADASTROS_ZERAR = CADASTROS_ZERAR_PORTAL;
export type CadastroZerar = CadastroZerarPortal;
export type { TabelaZeragem };

/** 'fiscal' = filial com certificado A1 ou ambiente fiscal configurado (RN-CAD-10, v0.3.6). */
export type MotivoUso = 'pedido' | 'titulo' | 'nota' | 'fiscal';
export type MotivoBloqueio = 'integracao_ligada' | 'lote_em_andamento';

/** Do mais forte para o mais fraco: com vários motivos, o primeiro é o contado. */
export const MOTIVOS: readonly MotivoUso[] = ['pedido', 'titulo', 'nota', 'fiscal'];

/** Cadastro → tabelas dele (forma_prazo = condicao_pagamento; preco = tabela_preco + item; estoque = saldo + movimento). */
export const TABELAS_DO_CADASTRO: Record<CadastroZerar, readonly TabelaZeragem[]> = {
  filial: ['filial'],
  vendedor: ['vendedor'],
  forma_prazo: ['condicao_pagamento'],
  produto: ['produto'],
  produto_unidade: ['produto_unidade'],
  preco: ['tabela_preco', 'tabela_preco_item'],
  estoque: ['estoque_saldo', 'estoque_movimento'],
  cliente: ['cliente', 'cliente_contato'],
  cliente_endereco: ['cliente_endereco'],
};

export const CADASTRO_DA_TABELA: Record<TabelaZeragem, CadastroZerar> = {
  filial: 'filial',
  vendedor: 'vendedor',
  condicao_pagamento: 'forma_prazo',
  produto: 'produto',
  produto_unidade: 'produto_unidade',
  tabela_preco: 'preco',
  tabela_preco_item: 'preco',
  estoque_saldo: 'estoque',
  estoque_movimento: 'estoque',
  cliente: 'cliente',
  cliente_endereco: 'cliente_endereco',
  cliente_contato: 'cliente',
};

/** Dependências automáticas: apagar o pai leva os cadastros listados junto (a carteira é cliente.vendedor_id, sem tabela). */
const DEPENDENCIAS: Partial<Record<CadastroZerar, readonly CadastroZerar[]>> = {
  produto: ['produto_unidade', 'estoque'],
  cliente: ['cliente_endereco'],
};

/** A filial segue a cascata por FK: vendedor, estoque, cliente (e endereço) e os itens de preço dela. */
const DEPENDENTES_DA_FILIAL: readonly CadastroZerar[] = ['vendedor', 'preco', 'estoque', 'cliente', 'cliente_endereco'];

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

/** Pais por FK NOT NULL (0004_cadastros.sql): apagar o pai apaga o filho. */
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

/** Referências opcionais do cliente: ao apagar o pai, o cliente fica e a coluna vai a NULL. */
const ANULAVEIS: readonly { tabela: 'cliente'; pai: TabelaZeragem; coluna: string }[] = [
  { tabela: 'cliente', pai: 'vendedor', coluna: 'vendedor_id' },
  { tabela: 'cliente', pai: 'tabela_preco', coluna: 'tabela_preco_id' },
  { tabela: 'cliente', pai: 'condicao_pagamento', coluna: 'condicao_pagamento_id' },
];

export interface LinhaZeragem {
  id: string;
  /** Pai por tabela (ex.: { produto: '...', filial: '...' }). */
  refs?: Partial<Record<TabelaZeragem, string>>;
  /** external_id não nulo. Sem chave, o FDV não consegue casar: vira "inativar + criar". */
  com_chave: boolean;
}

export interface IntegracaoZeragem {
  cadastro: CadastroZerar;
  ligada: boolean;
  lote_em_voo: boolean;
}

/** O que cadastros.portal_zeragem_fatos devolve. */
export interface FatosZeragem {
  existentes: Partial<Record<TabelaZeragem, readonly LinhaZeragem[]>>;
  /** Ids em uso, por cadastro e motivo (portas do pedido e do faturamento). */
  usos?: Partial<Record<CadastroZerar, Partial<Record<MotivoUso, readonly string[]>>>>;
  /** Filiais que já emitiram nota. */
  filiaisComNota?: readonly string[];
  integracao: readonly IntegracaoZeragem[];
}

export interface BloqueioZeragem {
  cadastro: CadastroZerar;
  motivo: MotivoBloqueio;
}

export interface PlanoZeragem {
  /** Escolhidos mais dependências, na ordem da carga. */
  efetivos: CadastroZerar[];
  /** Na ordem de execução. Tabela sem id não aparece. */
  apagar: { tabela: TabelaZeragem; ids: string[] }[];
  /** UPDATE ... SET coluna = NULL, antes dos DELETE. */
  anular: { tabela: 'cliente'; coluna: string; ids: string[] }[];
  mantidos: { cadastro: CadastroZerar; motivo: MotivoUso; quantidade: number }[];
  /** Com bloqueio, apagar e anular vêm vazios (a rota responde 422 zeragem_bloqueada). */
  bloqueios: BloqueioZeragem[];
  /** Linhas apagadas sem external_id: no FDV viram "inativar + criar". */
  sem_chave: number;
  /** Ids mantidos por tabela, para o efeito reconferir com FOR UPDATE. */
  emUso: { tabela: TabelaZeragem; ids: string[] }[];
}

const unicos = (l: readonly LinhaZeragem[] = []): LinhaZeragem[] => {
  const vistos = new Set<string>();
  return l.filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true)));
};

const naOrdem = (s: ReadonlySet<CadastroZerar>): CadastroZerar[] => CADASTROS_ZERAR.filter((c) => s.has(c));

export function planoZeragem(escolhidos: readonly CadastroZerar[], fatos: FatosZeragem): PlanoZeragem {
  // Raízes: escolhidos + dependências (produto, cliente). A filial não vira raiz: ela age só pela cascata.
  const raizes = new Set<CadastroZerar>(escolhidos);
  for (const c of [...raizes]) for (const d of DEPENDENCIAS[c] ?? []) raizes.add(d);
  const efetivosSet = new Set(raizes);
  if (raizes.has('filial')) for (const d of DEPENDENTES_DA_FILIAL) efetivosSet.add(d);
  const efetivos = naOrdem(efetivosSet);

  const linhas = (t: TabelaZeragem) => unicos(fatos.existentes[t]);
  const motivoDe = (t: TabelaZeragem, id: string): MotivoUso | undefined =>
    MOTIVOS.find((m) => fatos.usos?.[CADASTRO_DA_TABELA[t]]?.[m]?.includes(id));
  const mais = (a: MotivoUso | undefined, b: MotivoUso | undefined) =>
    !a ? b : !b ? a : MOTIVOS.indexOf(b) < MOTIVOS.indexOf(a) ? b : a;
  const comNota = new Set(fatos.filiaisComNota ?? []);

  const apagados = new Map<TabelaZeragem, Set<string>>();
  const mantidosPorTabela = new Map<TabelaZeragem, Set<string>>();
  const contados = new Map<CadastroZerar, Map<MotivoUso, number>>();
  const conta = (t: TabelaZeragem, m: MotivoUso) => {
    const c = CADASTRO_DA_TABELA[t];
    const mm = contados.get(c) ?? new Map<MotivoUso, number>();
    mm.set(m, (mm.get(m) ?? 0) + 1);
    contados.set(c, mm);
  };

  // Pais antes dos filhos: ORDEM_DELETE ao contrário.
  for (const t of [...ORDEM_DELETE].reverse()) {
    const raiz = raizes.has(CADASTRO_DA_TABELA[t]);
    const pais = PAIS[t] ?? [];
    const del = new Set<string>();
    const ficam = new Set<string>();
    for (const r of linhas(t)) {
      const ref = (p: TabelaZeragem) => r.refs?.[p];
      // FK: pai apagado força apagar o filho.
      if (pais.some((p) => { const x = ref(p); return x !== undefined && apagados.get(p)?.has(x); })) {
        del.add(r.id);
        continue;
      }
      let motivo = motivoDe(t, r.id);
      if (t === 'filial') {
        if (comNota.has(r.id)) motivo = mais(motivo, 'nota');
        // dependente em uso (cliente ou vendedor da filial) mantém a filial
        for (const dep of ['cliente', 'vendedor'] as const) {
          for (const d of linhas(dep)) {
            if (d.refs?.filial === r.id) motivo = mais(motivo, motivoDe(dep, d.id));
          }
        }
      }
      const pelaCasca = pais.some((p) => { const x = ref(p); return x !== undefined && mantidosPorTabela.get(p)?.has(x); });
      if (motivo) {
        // só conta quando o cadastro está no plano
        if (efetivosSet.has(CADASTRO_DA_TABELA[t])) { ficam.add(r.id); conta(t, motivo); }
      } else if (raiz) {
        (pelaCasca ? ficam : del).add(r.id);
      }
    }
    apagados.set(t, del);
    mantidosPorTabela.set(t, ficam);
  }

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

  const semChave = new Set(
    ORDEM_DELETE.flatMap((t) => linhas(t).filter((r) => !r.com_chave && apagados.get(t)?.has(r.id)).map((r) => `${t}:${r.id}`)),
  );

  const mantidos = CADASTROS_ZERAR.flatMap((cadastro) =>
    MOTIVOS.flatMap((motivo) => {
      const quantidade = contados.get(cadastro)?.get(motivo) ?? 0;
      return quantidade ? [{ cadastro, motivo, quantidade }] : [];
    }),
  );

  const emUso = ORDEM_DELETE.flatMap((tabela) => {
    const ids = [...(mantidosPorTabela.get(tabela) ?? [])];
    return ids.length ? [{ tabela, ids }] : [];
  });

  // Bloqueios: além dos efetivos, valem os cadastros "tocados" pela cascata (ex.: zerar produto apaga itens de
  // preço sem tornar 'preco' efetivo). O FDV recebe esses dados, então a integração ligada deve barrar também.
  const tocados = new Set<CadastroZerar>(efetivos);
  for (const a of apagar) tocados.add(CADASTRO_DA_TABELA[a.tabela]);
  const bloqueios: BloqueioZeragem[] = naOrdem(tocados).flatMap((cadastro) => {
    const i = fatos.integracao.find((x) => x.cadastro === cadastro);
    const l: BloqueioZeragem[] = [];
    if (i?.ligada) l.push({ cadastro, motivo: 'integracao_ligada' });
    if (i?.lote_em_voo) l.push({ cadastro, motivo: 'lote_em_andamento' });
    return l;
  });
  if (bloqueios.length) {
    return { efetivos, apagar: [], anular: [], mantidos: [], bloqueios, sem_chave: 0, emUso: [] };
  }

  return { efetivos, apagar, anular, mantidos, bloqueios: [], sem_chave: semChave.size, emUso };
}

/** Contagens para a resposta: apagados por tabela e anulados por `tabela.coluna`. */
export function contagens(plano: PlanoZeragem): { tabela: string; quantidade: number }[] {
  return [
    ...plano.apagar.map((a) => ({ tabela: a.tabela as string, quantidade: a.ids.length })),
    ...plano.anular.map((a) => ({ tabela: `${a.tabela}.${a.coluna}`, quantidade: a.ids.length })),
  ];
}
