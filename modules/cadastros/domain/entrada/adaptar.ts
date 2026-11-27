/**
 * T-0057 C2 (ADR 0014 §1 e §2): adaptadores puros dos payloads do Hub (`hub-v1`) para a linha da carga, que passa por `mapearLinha`.
 *
 * Simplificações assumidas (o desenho não fecha estes pontos, vale o mais simples):
 * - a forma de pagamento sozinha não vira linha da carga: `adaptarForma` a entrega ao contexto, que completa o prazo (RN-CAD-09);
 * - `ativo` do endereço do cliente, da forma e do estoque não tem destino na carga e é ignorado;
 * - `ClienteHub.formas_pagamento` e `deposito_*` não têm destino na carga (o layout do kit os ignora).
 */
import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import {
  PAYLOADS_HUB, type ClienteEnderecoHub, type ClienteHub, type CorpoLote, type EstoqueHub, type FilialHub, type FormaPagamentoHub,
  type PrazoPagamentoHub, type PrecoHub, type ProdutoHub, type ProdutoUnidadeHub, type VendedorHub,
} from '@macuxierp/platform-sdk/hub-v1';
import type { EntidadeCarga, LinhasCarga } from '../../contracts';
import { errosDeZod, mapearLinha, tpagDaForma, type ContextoMapeamento, type ErroLinha, type Registro } from '../carga';

export interface ContextoAdaptacao extends ContextoMapeamento {
  /** Forma de pagamento já conhecida (do lote ou do banco), pelo `external_id` do Hub. */
  formas: ReadonlyMap<string, Pick<FormaPagamentoHub, 'codigo' | 'nome'>>;
}

export type Adaptacao<E extends EntidadeCarga> = { ok: true; linha: LinhasCarga[E] } | { ok: false; erros: ErroLinha[] };

const sim = (b: boolean): string => (b ? 'sim' : 'nao');
const texto = (n: number): string => String(n);

/** Quantidade do Hub (número) na célula decimal da carga: até 4 casas sem notação científica; mais que isso a carga recusa. */
function decimal(n: number): string {
  const t = String(n);
  const casas = t.includes('e') ? 99 : (t.split('.')[1]?.length ?? 0);
  return casas <= 4 ? n.toFixed(4) : t;
}

/** Linha da carga a partir do índice (base 0) do registro no lote: a linha 1 do kit é o cabeçalho. */
const numeroDaLinha = (indice: number): number => indice + 2;

function registro(campos: Record<string, string | undefined>): Registro {
  return Object.fromEntries(Object.entries(campos).filter((e): e is [string, string] => e[1] !== undefined));
}

function mapear<E extends EntidadeCarga>(entidade: E, campos: Record<string, string | undefined>, indice: number, ctx: ContextoMapeamento): Adaptacao<E> {
  return mapearLinha(entidade, registro(campos), numeroDaLinha(indice), ctx);
}

/** RN-CAD-01 (CNPJ), RN-CAD-03 (município pelo nome da UF), RN-CAD-08 (`ativo`). */
export const adaptarFilial = (p: FilialHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'filial'> =>
  mapear('filial', {
    external_id: p.external_id, nome: p.nome, ativo: sim(p.ativo), cidade: p.cidade, uf: p.uf, cnpj: p.cnpj, logradouro: p.logradouro,
    numero: p.numero, complemento: p.complemento, bairro: p.bairro, cep: p.cep,
  }, indice, ctx);

/** RN-CAD-08: o vendedor inativado no ERP de origem fica inativo (nunca apagado); a filial é referência. */
export const adaptarVendedor = (p: VendedorHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'vendedor'> =>
  mapear('vendedor', { external_id: p.external_id, nome: p.nome, ativo: sim(p.ativo), filial_external_id: p.filial_external_id }, indice, ctx);

/** RN-CAD-09: a forma tem o tPag da NF-e pelo dicionário do `mapear.ts`; o que não está nele vira tPag recusado. */
export type FormaAdaptada = Pick<FormaPagamentoHub, 'external_id' | 'codigo' | 'nome' | 'ativo'> & { tpag: string };
export const adaptarForma = (p: FormaPagamentoHub): FormaAdaptada => ({ external_id: p.external_id, codigo: p.codigo, nome: p.nome, tpag: tpagDaForma(p.codigo), ativo: p.ativo });

/** RN-CAD-09 e RN-CAD-15: o prazo é a condição de pagamento (`parcelas_dias` "28/56", à vista "0"), com a forma do contexto. */
export const adaptarPrazoPagamento = (p: PrazoPagamentoHub, indice: number, ctx: ContextoAdaptacao): Adaptacao<'condicao_pagamento'> => {
  const forma = ctx.formas.get(p.forma_external_id);
  return mapear('condicao_pagamento', {
    external_id: p.external_id, codigo: p.codigo, descricao: p.descricao, parcelas_dias: p.parcelas_dias, ativo: sim(p.ativo),
    forma_external_id: p.forma_external_id, forma_codigo: forma?.codigo, forma_nome: forma?.nome,
  }, indice, ctx);
};

/** RN-CAD-04 e RN-CAD-11: o produto do Hub não traz custo, preço de venda nem NCM (M8); a carga não os altera. */
export const adaptarProduto = (p: ProdutoHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'produto'> =>
  mapear('produto', { external_id: p.external_id, sku: p.sku, nome: p.nome, unidade: p.unidade, ean: p.ean, marca: p.marca, ativo: sim(p.ativo) }, indice, ctx);

/** RN-CAD-12 e RN-CAD-17: fator em até 4 casas; fracionário só em KG e M. */
export const adaptarProdutoUnidade = (p: ProdutoUnidadeHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'produto_unidade'> =>
  mapear('produto_unidade', {
    external_id: p.external_id, produto_external_id: p.produto_external_id, unidade: p.unidade, fator: decimal(p.fator), ean: p.ean, ativo: sim(p.ativo),
  }, indice, ctx);

/** RN-CAD-06 e RN-CAD-11: preço em centavos por tabela, vigência e filial (sem filial a referência não é preenchida e a gravação aplica a regra da filial padrão, como no `mapear.ts`). */
export const adaptarPreco = (p: PrecoHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'preco'> =>
  mapear('preco', {
    external_id: p.external_id, tabela_external_id: p.tabela_external_id, tabela_nome: p.tabela_nome, vigencia_inicio: p.vigencia_inicio, vigencia_fim: p.vigencia_fim,
    produto_external_id: p.produto_external_id, preco_cents: texto(p.preco_cents), filial_external_id: p.filial_external_id, ativo: sim(p.ativo),
  }, indice, ctx);

/** RN-CAD-07: saldo por filial; o negativo só passa na gravação com a permissão (a carga já trata).  */
export const adaptarEstoque = (p: EstoqueHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'estoque'> =>
  mapear('estoque', {
    external_id: p.external_id, produto_external_id: p.produto_external_id, saldo: decimal(p.saldo), filial_external_id: p.filial_external_id,
  }, indice, ctx);

/** RN-CAD-01, RN-CAD-02 e RN-CAD-03 (documento, IE e município); RN-CAD-16: `prazo_medio_max_dias` é o prazo médio do cliente. */
export const adaptarCliente = (p: ClienteHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'cliente'> => {
  const e = p.endereco;
  return mapear('cliente', {
    external_id: p.external_id, razao_social: p.razao_social, nome_fantasia: p.nome_fantasia, ativo: sim(p.ativo), documento: p.documento,
    inscricao_estadual: p.inscricao_estadual, vendedor_external_id: p.vendedor_external_id, filial_external_id: p.filial_external_id,
    limite_credito_cents: texto(p.limite_credito_cents), prazo_medio_dias: p.prazo_medio_max_dias === undefined ? undefined : texto(p.prazo_medio_max_dias),
    'endereco.logradouro': e?.logradouro, 'endereco.numero': e?.numero, 'endereco.complemento': e?.complemento, 'endereco.bairro': e?.bairro,
    'endereco.cidade': e?.cidade, 'endereco.uf': e?.uf, 'endereco.cep': e?.cep, tipo_endereco: e === undefined ? undefined : 'principal',
  }, indice, ctx);
};

/**
 * RN-CAD-03: o endereço é uma linha do cliente só com o endereço (os dados e o `ativo` do cliente não mudam: célula vazia não
 * altera, D6) e mantém o `external_id` que o Hub deu a ele. `principal` vence o `tipo`; `tipo` principal sem a marca vira entrega,
 * porque só um endereço é o principal (RN-CAD-03).
 */
export const adaptarClienteEndereco = (p: ClienteEnderecoHub, indice: number, ctx: ContextoMapeamento): Adaptacao<'cliente'> => {
  const tipo = p.principal ? 'principal' : p.tipo === 'principal' ? 'entrega' : p.tipo;
  const r = mapear('cliente', {
    external_id: p.cliente_external_id, tipo_endereco: tipo, 'endereco.logradouro': p.logradouro, 'endereco.numero': p.numero, 'endereco.complemento': p.complemento,
    'endereco.bairro': p.bairro, 'endereco.cidade': p.cidade, 'endereco.uf': p.uf, 'endereco.cep': p.cep,
  }, indice, ctx);
  if (!r.ok) return r;
  return { ok: true, linha: { ...r.linha, enderecos: r.linha.enderecos.map((x) => ({ ...x, external_id: p.external_id })) } };
};

export interface RecusaEnvelope {
  ok: false;
  status: 422;
  codigo: 'CARGA_COMPLETA_NAO_SUPORTADA' | 'ENTIDADE_FORA_DA_FASE';
  motivo: string;
}

export interface LoteAdaptado {
  ok: true;
  /** Entidade da carga que recebe as linhas; `null` no lote de formas (só alimenta o contexto dos prazos). */
  entidade: EntidadeCarga | null;
  /** Um resultado por registro, na ordem do lote (o índice do erro é o do registro). */
  resultados: Adaptacao<EntidadeCarga>[];
  formas: FormaAdaptada[];
}

export type EnvelopeEntrada = Pick<CorpoLote, 'entidade' | 'modo'> & { registros: readonly unknown[] };

type AdaptadorLinha = (p: never, indice: number, ctx: ContextoAdaptacao) => Adaptacao<EntidadeCarga>;
/** Entidade do Hub → entidade da carga e adaptador; a forma não tem linha própria (`adaptarForma`). */
const TABELA: Readonly<Record<Exclude<(typeof ENTIDADES_ENVIO_FDV)[number], 'forma_pagamento'>, { entidade: EntidadeCarga; adaptar: AdaptadorLinha }>> = {
  filial: { entidade: 'filial', adaptar: adaptarFilial },
  vendedor: { entidade: 'vendedor', adaptar: adaptarVendedor },
  prazo_pagamento: { entidade: 'condicao_pagamento', adaptar: adaptarPrazoPagamento },
  produto: { entidade: 'produto', adaptar: adaptarProduto },
  produto_unidade: { entidade: 'produto_unidade', adaptar: adaptarProdutoUnidade },
  preco: { entidade: 'preco', adaptar: adaptarPreco },
  estoque: { entidade: 'estoque', adaptar: adaptarEstoque },
  cliente: { entidade: 'cliente', adaptar: adaptarCliente },
  cliente_endereco: { entidade: 'cliente', adaptar: adaptarClienteEndereco },
};

/** Recusa do envelope inteiro (a API responde 422 e não cria lote): carga completa (RN-INT-06) ou entidade fora da F2 (ADR 0014 §2). Código em MAIÚSCULAS, como o `ErroApi`. */
export function recusarEnvelope(envelope: Pick<EnvelopeEntrada, 'entidade' | 'modo'>): RecusaEnvelope | null {
  if (envelope.modo === 'completo') {
    return { ok: false, status: 422, codigo: 'CARGA_COMPLETA_NAO_SUPORTADA', motivo: 'Carga completa não aceita: envie só as alterações (delta)' };
  }
  if (!ENTIDADES_ENVIO_FDV.some((e) => e === envelope.entidade)) {
    return {
      ok: false, status: 422, codigo: 'ENTIDADE_FORA_DA_FASE',
      motivo: 'Entidade não aceita: envie filial, vendedor, forma e prazo de pagamento, produto, unidade, preço, estoque, cliente ou endereço do cliente',
    };
  }
  return null;
}

/** Valida cada registro pelo Zod do SDK e o adapta; recusa o envelope inteiro como `recusarEnvelope`. Erro de registro fica no resultado dele, sem o valor (RN-INT-01). */
export function adaptarLote(envelope: EnvelopeEntrada, ctx: ContextoAdaptacao): RecusaEnvelope | LoteAdaptado {
  const recusa = recusarEnvelope(envelope);
  if (recusa) return recusa;
  const chave = ENTIDADES_ENVIO_FDV.find((e) => e === envelope.entidade) as (typeof ENTIDADES_ENVIO_FDV)[number];
  const schema = PAYLOADS_HUB[chave];
  const formas: FormaAdaptada[] = [];
  const resultados: Adaptacao<EntidadeCarga>[] = [];
  envelope.registros.forEach((bruto, indice) => {
    const v = schema.safeParse(bruto);
    if (!v.success) {
      resultados.push({ ok: false, erros: errosDeZod(numeroDaLinha(indice), v.error.issues) });
    } else if (chave === 'forma_pagamento') {
      formas.push(adaptarForma(v.data as FormaPagamentoHub));
    } else {
      resultados.push((TABELA[chave].adaptar as (p: unknown, i: number, c: ContextoAdaptacao) => Adaptacao<EntidadeCarga>)(v.data, indice, ctx));
    }
  });
  return { ok: true, entidade: chave === 'forma_pagamento' ? null : TABELA[chave].entidade, resultados, formas };
}
