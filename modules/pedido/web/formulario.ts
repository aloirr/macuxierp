/**
 * Formulário do pedido manual (RF-PED-02): do texto digitado ao `PedidoManualEntrada` do contrato, com a validação
 * do navegador (a API revalida e aplica RN-PED-03/04), a `Idempotency-Key` e o resumo do retorno.
 */
import { valorItem } from '@macuxierp/platform-sdk';
import { PedidoManualEntrada, type Pedido } from '../contracts';
import { linhasDePendencias, type LinhaPendencia } from './detalhe';
import { errosPorCampo } from './erros';
import { interpretarCentavos, interpretarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { textoCentavos, textoQuantidade } from './texto';

export interface LinhaItemFormulario {
  produto_id: string;
  /** Texto digitado: "12,5" (até 4 casas). */
  quantidade: string;
  /** "1.234,56" em reais. */
  preco: string;
  /** Desconto do item, em reais. Vazio = sem desconto. */
  desconto: string;
}

export interface Formulario {
  filial_id: string;
  cliente_id: string;
  condicao_pagamento_id: string;
  endereco_entrega_id: string;
  observacao: string;
  itens: LinhaItemFormulario[];
}

export const ITEM_VAZIO: LinhaItemFormulario = { produto_id: '', quantidade: '', preco: '', desconto: '' };
export const formularioVazio = (): Formulario => ({ filial_id: '', cliente_id: '', condicao_pagamento_id: '', endereco_entrega_id: '', observacao: '', itens: [{ ...ITEM_VAZIO }] });

/**
 * `Idempotency-Key` do envio: gerada UMA vez quando o formulário abre e reusada em todo reenvio (clique duplo, queda de
 * rede), para a API devolver o mesmo pedido (RN-CORE-05). Formulário novo, chave nova.
 */
export function novaChaveDoFormulario(): string {
  return globalThis.crypto.randomUUID();
}

export type ResultadoFormulario = { ok: true; entrada: PedidoManualEntrada } | { ok: false; erros: Record<string, string> };

/** Nome do campo no contrato → nome no formulário (o texto digitado é em reais). */
const CAMPO_DA_TELA = { preco_unitario_centavos: 'preco', desconto_centavos: 'desconto' } as const;

const MENSAGENS = {
  filial_id: 'Escolha a filial',
  cliente_id: 'Escolha o cliente',
  produto_id: 'Escolha o produto',
  condicao_pagamento_id: 'Condição inválida',
  endereco_entrega_id: 'Endereço inválido',
  quantidade: 'Quantidade maior que zero, até 4 casas',
  preco: 'Preço em reais, ex.: 12,50',
  preco_unitario_centavos: 'Preço em reais, ex.: 12,50',
  desconto: 'Desconto em reais, ex.: 1,00',
  desconto_centavos: 'Desconto em reais, ex.: 1,00',
  itens: 'Inclua ao menos um item',
} as const;

/**
 * Erros por campo (`filial_id`, `itens.0.quantidade`...), em português. Aqui fica só a conversão do texto digitado e a regra
 * do desconto; todos os limites vêm do `safeParse` de `PedidoManualEntrada` (a API revalida e aplica RN-PED-03/04).
 */
export function validarFormulario(f: Formulario): ResultadoFormulario {
  const erros: Record<string, string> = {};
  const itens = f.itens.map((i, n) => {
    const campo = (c: string) => `itens.${n}.${c}`;
    const quantidade = interpretarQuantidade(i.quantidade);
    if (quantidade === null) erros[campo('quantidade')] = MENSAGENS.quantidade;
    const preco = interpretarCentavos(i.preco);
    if (preco === null) erros[campo('preco')] = MENSAGENS.preco;
    const desconto = i.desconto.trim() === '' ? 0 : interpretarCentavos(i.desconto);
    if (desconto === null) erros[campo('desconto')] = MENSAGENS.desconto;
    else if (quantidade && preco !== null && desconto > valorItem(quantidade, preco)) erros[campo('desconto')] = 'O desconto passa do valor do item';
    return { produto_id: i.produto_id, quantidade: quantidade ?? 0, preco_unitario_centavos: preco ?? 0, desconto_centavos: desconto ?? 0 };
  });

  const r = PedidoManualEntrada.safeParse({
    filial_id: f.filial_id,
    cliente_id: f.cliente_id,
    condicao_pagamento_id: f.condicao_pagamento_id || null,
    endereco_entrega_id: f.endereco_entrega_id || null,
    observacao: f.observacao.trim() || null,
    itens,
  });
  if (!r.success) for (const [chave, msg] of Object.entries(errosPorCampo(r.error.issues, CAMPO_DA_TELA, MENSAGENS))) erros[chave] ??= msg;
  return Object.keys(erros).length ? { ok: false, erros } : r.success ? { ok: true, entrada: r.data } : { ok: false, erros: { formulario: 'Confira os dados do pedido' } };
}

/** Preenche o formulário com um pedido existente, para a edição (o inverso do texto digitado). */
export function formularioDoPedido(p: Pick<Pedido, 'filial_id' | 'cliente_id' | 'condicao_pagamento_id' | 'endereco_entrega' | 'observacao' | 'itens'>): Formulario {
  return {
    filial_id: p.filial_id,
    cliente_id: p.cliente_id,
    condicao_pagamento_id: p.condicao_pagamento_id ?? '',
    endereco_entrega_id: p.endereco_entrega?.endereco_id ?? '',
    observacao: p.observacao ?? '',
    itens: p.itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: textoQuantidade(i.quantidade),
      preco: textoCentavos(i.preco_unitario_centavos),
      desconto: i.desconto_centavos ? textoCentavos(i.desconto_centavos) : '',
    })),
  };
}

export interface RetornoDoLancamento {
  status: 'aprovado' | 'em_analise';
  titulo: string;
  /** Pendências do pedido em análise, com esperado e informado; vazio quando foi aprovado. */
  pendencias: LinhaPendencia[];
}

/** O que mostrar depois do `POST /pedidos`: aprovado na hora, ou em análise com as pendências (RN-PED-03). */
export function retornoDoLancamento(p: Pick<Pedido, 'numero' | 'status' | 'pendencias'>): RetornoDoLancamento {
  if (p.status === 'aprovado') return { status: 'aprovado', titulo: `Pedido ${p.numero} aprovado`, pendencias: [] };
  return { status: 'em_analise', titulo: `Pedido ${p.numero} em análise: há pendências para aprovar`, pendencias: linhasDePendencias(p.pendencias) };
}
