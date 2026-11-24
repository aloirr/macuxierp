/**
 * Campos compostos de outro registro (M10, T-0009 seção 1) e chaves cruzadas (decisão de 21/11/2026, 23h22). Funções puras.
 * O mapeamento entrega o registro com os UUIDs do ERP nos campos que apontam para outro cadastro e guarda esses UUIDs em
 * `fonte_refs`; aqui eles viram a chave do Hub (`chaveHub`: `external_id` da carga quando existe, senão o UUID) e os campos
 * derivados (nome e vigência da tabela, nome do depósito, filial padrão do preço).
 * Idempotente: recompor o que já está composto devolve o mesmo hash.
 *
 * Premissa: referência ainda ausente do espelho (a filial do vendedor que não chegou) usa o UUID do ERP; quando o registro
 * alvo chegar, o consumidor recompõe os dependentes (índice GIN de `fonte_refs`).
 */
import type { EntidadeHub } from '../contracts';
import { hashRegistro } from './canonico';
import { type RegistroEspelho } from './mapeamento';

export interface TabelaReferencia {
  /** Chave da tabela no Hub (`chaveHub` do evento `tabela_preco.alterada`). */
  external_id: string;
  nome: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  inativo: boolean;
}

export interface FontesRecomposicao {
  /** Chave no Hub do registro do espelho com este UUID do ERP; `null` = ainda não chegou (vale o UUID). */
  chave(entidade: EntidadeHub, erpId: string): string | null;
  tabela(erpId: string): TabelaReferencia | null;
  filialPadraoId: string | null;
  nomeFilial(erpId: string): string | null;
}

function limpo(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

/** Recompõe os campos de referência do registro a partir de `fonte_refs` e das fontes. */
export function recomporRegistro(r: RegistroEspelho, f: FontesRecomposicao): RegistroEspelho {
  const refs = r.fonte_refs;
  const p: Record<string, unknown> = { ...r.payload };
  let ativo = r.ativo;
  const chave = (entidade: EntidadeHub, erpId: string | undefined): string | undefined => (erpId ? (f.chave(entidade, erpId) ?? erpId) : undefined);
  const poe = (campo: string, valor: string | undefined): void => {
    if (valor !== undefined) p[campo] = valor;
  };

  switch (r.entidade) {
    case 'vendedor':
      poe('filial_external_id', chave('filial', refs.filial_id));
      break;
    case 'produto_unidade':
      poe('produto_external_id', chave('produto', refs.produto_id));
      break;
    case 'cliente_endereco':
      poe('cliente_external_id', chave('cliente', refs.cliente_id));
      break;
    case 'preco': {
      poe('produto_external_id', chave('produto', refs.produto_id));
      const t = refs.tabela_preco_id ? f.tabela(refs.tabela_preco_id) : null;
      if (t) {
        p.tabela_external_id = t.external_id;
        p.tabela_nome = t.nome;
        p.vigencia_inicio = t.vigencia_inicio;
        if (t.vigencia_fim) p.vigencia_fim = t.vigencia_fim;
        else delete p.vigencia_fim;
        // o evento do preço repete o `inativo` da tabela: tabela inativa = preço inativo
        ativo = !t.inativo;
        p.ativo = ativo;
      }
      // P-1: o item da filial padrão vale para as filiais sem item; no Hub "sem filial = todas"
      if (refs.filial_id) {
        if (f.filialPadraoId === refs.filial_id) delete p.filial_external_id;
        else poe('filial_external_id', chave('filial', refs.filial_id));
      }
      break;
    }
    case 'estoque': {
      const filial = chave('filial', refs.filial_id);
      poe('deposito_external_id', filial);
      poe('filial_external_id', filial);
      poe('produto_external_id', chave('produto', refs.produto_id));
      const nome = refs.filial_id ? f.nomeFilial(refs.filial_id) : null;
      if (nome) p.deposito_nome = nome;
      else delete p.deposito_nome;
      break;
    }
    case 'cliente': {
      poe('filial_external_id', chave('filial', refs.filial_id));
      poe('vendedor_external_id', chave('vendedor', refs.vendedor_id));
      break;
    }
    default:
      break;
  }
  const payload = limpo(p);
  return { ...r, ativo, payload, hash: hashRegistro(payload) };
}

/**
 * Parte do registro de que outros registros derivam: se não mudou, não há o que recompor nos dependentes (evita varrer
 * milhares de preços quando só o nome de um produto mudou). `null` = entidade sem dependentes.
 */
export function assinaturaDeDerivados(r: Pick<RegistroEspelho, 'entidade' | 'payload'>): string | null {
  const p = r.payload;
  switch (r.entidade) {
    case 'filial':
      return JSON.stringify([p.external_id, p.nome]);
    case 'vendedor':
    case 'produto':
    case 'cliente':
      return JSON.stringify([p.external_id]);
    case 'forma_pagamento':
      return JSON.stringify([p.external_id, p.codigo]);
    default:
      return null;
  }
}

/** Assinatura da referência da tabela de preço a partir de `referencia.dados`; `null` = ainda sem chave (anterior à 0018). */
export function assinaturaDaReferenciaTabela(dados: Readonly<Record<string, unknown>>): string | null {
  const t = tabelaDaReferencia(dados);
  return t ? assinaturaDaTabela(t) : null;
}

/** Mesma ideia para a referência da tabela de preço (nome, vigência, inativa, chave). */
export function assinaturaDaTabela(t: TabelaReferencia): string {
  return JSON.stringify([t.external_id, t.nome, t.vigencia_inicio, t.vigencia_fim, t.inativo]);
}

/** Chave de `fonte_refs` que os dependentes usam para apontar para o registro de cada entidade do Hub. */
export const CHAVE_FONTE_REFS: Readonly<Partial<Record<EntidadeHub, string>>> = {
  filial: 'filial_id',
  vendedor: 'vendedor_id',
  produto: 'produto_id',
  cliente: 'cliente_id',
};

/** Alvo de cada chave de `fonte_refs`: a entidade do Hub do registro apontado, ou `tabela` (referência da tabela de preço). */
export const ALVO_DA_CHAVE_REFS: Readonly<Record<string, EntidadeHub | 'tabela'>> = {
  ...Object.fromEntries(Object.entries(CHAVE_FONTE_REFS).map(([entidade, chave]) => [chave, entidade as EntidadeHub])),
  tabela_preco_id: 'tabela',
};

/**
 * Tabela de preço a partir de `referencia.dados` (jsonb). RD-0318: a chave do Hub é `dados.chave`; sem ela (referência
 * gravada antes da 0018) devolve `null` e o preço fica `referencia_ausente` até o próximo evento da tabela. Tolera dado faltando.
 */
export function tabelaDaReferencia(dados: Readonly<Record<string, unknown>>): TabelaReferencia | null {
  const chave = typeof dados.chave === 'string' ? dados.chave.trim() : '';
  if (!chave) return null;
  return {
    external_id: chave,
    nome: String(dados.nome ?? ''),
    vigencia_inicio: String(dados.vigencia_inicio ?? ''),
    vigencia_fim: typeof dados.vigencia_fim === 'string' ? dados.vigencia_fim : null,
    inativo: dados.inativo === true,
  };
}
