/**
 * Consumidor `integracao-fdv.publicar-cadastros` (T-0009 seção 6.1, M1, M3, M9, M10): mapeia os eventos de `cadastros`
 * (função pura do `domain`), grava o espelho `registro_publicado` e as `referencia`s, recompõe os dependentes e acorda o envio
 * da entidade (`cursor_entidade.proximo_em = least(proximo_em, agora)`). Não chama o Hub.
 *
 * Premissas: (1) o `external_id` do cadastro que o evento traz é a chave no Hub (`chaveHub`); referência de outro cadastro
 * usa a chave dele quando já está no espelho e o UUID do ERP enquanto não está, e é recomposta quando ele chegar (M10).
 * (2) Sem licença do módulo `integracao-fdv` no tenant (M9) nada é gravado: a carga inicial (C-4) cobre a ligação posterior.
 * (3) Payload fora do contrato é ignorado (erro permanente: repetir não conserta e travaria o agregado na fila).
 * (4) O UUID do ERP de cada registro fica na coluna `erp_id` do espelho (0015, RD-0318); a chave da tabela de preço no Hub segue em `referencia.external_id` (ADR 0010 manda `dados`; falta o CHECK, L2b).
 * (5) PROVISÓRIO até a C-10 (`external_id_anterior` no evento): a troca de chave de um cadastro é detectada pelo `erp_id`
 * (`inativarChaveAntiga` inativa a chave velha quando a nova chega). `chave_alterada`, `conflito_chave` (a gravação já
 * recusa a chave de outro `erp_id`, ver `gravarRegistro`) e a saída por `deleted_at` ficam no L2b.
 */
import { EVENTOS } from '@macuxierp/cadastros/contracts';
import { moduloLicenciado, type ConsumidorEvento, type EnvelopeEvento, type FonteLicencas, type Transacao } from '@macuxierp/platform-sdk';
import {
  CHAVE_FONTE_REFS,
  assinaturaDaTabela,
  assinaturaDeDerivados,
  tabelaDaReferencia,
  instanteUtc,
  mapearCliente,
  mapearCondicao,
  mapearEstoque,
  mapearFilial,
  mapearPreco,
  mapearProduto,
  mapearTabelaPreco,
  mapearVendedor,
  type ReferenciaEspelho,
  type RegistroEspelho,
} from '../domain';
import type { EntidadeHub } from '../contracts';
import { aplicarRegistros, gravarReferencia, inativarChaveAntiga, inativarRetirados, outroPrazoAtivoDaForma, recomporDependentes, removerReferencia, agendarEnvio } from './espelho';

export const CONSUMIDOR_PUBLICAR_CADASTROS = 'integracao-fdv.publicar-cadastros';

export const EVENTOS_CADASTROS_PUBLICADOS = [
  'cadastros.filial.alterada@1',
  'cadastros.vendedor.alterado@1',
  'cadastros.condicao_pagamento.alterada@1',
  'cadastros.produto.alterado@1',
  'cadastros.tabela_preco.alterada@1',
  'cadastros.preco.alterado@1',
  'cadastros.estoque.alterado@1',
  'cadastros.cliente.alterado@1',
] as const;

export interface DepsConsumidorCadastros {
  licencas: FonteLicencas;
  agora: () => Date;
}

type Pendentes = Set<EntidadeHub>;
const juntar = (alvo: Pendentes, outro: ReadonlySet<EntidadeHub>): void => {
  for (const e of outro) alvo.add(e);
};

/** Assinatura dos derivados do registro que já está no espelho com esta chave (antes da gravação); `null` = não existe. */
async function assinaturaAnterior(tx: Transacao, tenantId: string, entidade: EntidadeHub, chave: string): Promise<string | null> {
  const [l] = await tx.consultar<{ payload: Record<string, unknown> | null }>(
    `SELECT payload FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3 AND deleted_at IS NULL AND payload IS NOT NULL`,
    [tenantId, entidade, chave],
  );
  return l?.payload ? assinaturaDeDerivados({ entidade, payload: l.payload }) : null;
}

export function criarConsumidorPublicarCadastros(deps: DepsConsumidorCadastros): ConsumidorEvento {
  return {
    id: CONSUMIDOR_PUBLICAR_CADASTROS,
    eventos: EVENTOS_CADASTROS_PUBLICADOS,
    async tratar(evento: EnvelopeEvento, tx: Transacao): Promise<void> {
      const t = evento.tenant_id;
      const agora = deps.agora();
      if (!moduloLicenciado(await deps.licencas.ler(tx, t), 'integracao-fdv', agora)) return;
      const em = new Date(instanteUtc(evento.ocorrido_em));
      const pendentes: Pendentes = new Set();
      await tratarEvento(tx, evento, t, em, pendentes);
      await agendarEnvio(tx, t, pendentes, agora);
    },
  };
}

/**
 * Grava `principal` (a chave antiga do mesmo cadastro sai antes) e recompõe os dependentes só se algo de que eles derivam
 * mudou (a assinatura dos derivados). Os filhos (unidades, endereços) quem grava é o chamador, depois deste.
 * A chave de `fonte_refs` com que os dependentes apontam para o registro vem de `CHAVE_FONTE_REFS`.
 */
async function gravarComDependentes(
  tx: Transacao,
  t: string,
  em: Date,
  pendentes: Pendentes,
  principal: RegistroEspelho,
  erpId: string,
): Promise<void> {
  const antes = await assinaturaAnterior(tx, t, principal.entidade, principal.external_id);
  // a chave antiga sai antes de a nova entrar: o índice único do `erp_id` vale só entre as linhas ativas (0015)
  juntar(pendentes, await inativarChaveAntiga(tx, t, principal.entidade, erpId, principal.external_id, em));
  juntar(pendentes, await aplicarRegistros(tx, t, [principal], em));
  const chaveRef = CHAVE_FONTE_REFS[principal.entidade];
  if (chaveRef && (antes === null || antes !== assinaturaDeDerivados(principal))) {
    juntar(pendentes, await recomporDependentes(tx, t, chaveRef, erpId, em));
  }
}

async function tratarEvento(tx: Transacao, evento: EnvelopeEvento, t: string, em: Date, pendentes: Pendentes): Promise<void> {
  const emIso = em.toISOString();
  switch (evento.nome) {
    case 'cadastros.filial.alterada@1': {
      const p = EVENTOS['cadastros.filial.alterada@1'].safeParse(evento.payload);
      if (!p.success) return;
      const { registro, referencia } = mapearFilial(p.data, emIso);
      const eraPadrao = await gravarPadrao(tx, t, p.data.id, referencia, em);
      await gravarComDependentes(tx, t, em, pendentes, registro, p.data.id);
      // trocar a filial padrão muda a forma de os preços dela irem ao Hub (com ou sem filial): recompõe os dela
      if (eraPadrao) juntar(pendentes, await recomporDependentes(tx, t, 'filial_id', p.data.id, em));
      return;
    }
    case 'cadastros.vendedor.alterado@1': {
      const p = EVENTOS['cadastros.vendedor.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      await gravarComDependentes(tx, t, em, pendentes, mapearVendedor(p.data, emIso), p.data.id);
      return;
    }
    case 'cadastros.condicao_pagamento.alterada@1': {
      const p = EVENTOS['cadastros.condicao_pagamento.alterada@1'].safeParse(evento.payload);
      if (!p.success) return;
      const previa = mapearCondicao(p.data, emIso, { tenantId: t, formaAtiva: !p.data.inativo });
      const formaAtiva = !p.data.inativo || (await outroPrazoAtivoDaForma(tx, t, previa.forma.external_id, previa.prazo.external_id));
      const { forma, prazo } = mapearCondicao(p.data, emIso, { tenantId: t, formaAtiva });
      // a forma é derivada dos prazos vigentes (não de um agregado próprio): vale sempre o último evento de condição
      juntar(pendentes, await aplicarRegistros(tx, t, [forma], em));
      await gravarComDependentes(tx, t, em, pendentes, prazo, p.data.id);
      // a forma pode ter mudado de código: os clientes da condição recompõem
      juntar(pendentes, await recomporDependentes(tx, t, 'condicao_pagamento_id', p.data.id, em));
      return;
    }
    case 'cadastros.produto.alterado@1': {
      const p = EVENTOS['cadastros.produto.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      const { produto, unidades } = mapearProduto(p.data, emIso);
      await gravarComDependentes(tx, t, em, pendentes, produto, p.data.id);
      juntar(pendentes, await aplicarRegistros(tx, t, unidades, em));
      juntar(pendentes, await inativarRetirados(tx, t, 'produto_unidade', 'produto_id', p.data.id, p.data.unidades.map((u) => u.id), em));
      return;
    }
    case 'cadastros.tabela_preco.alterada@1': {
      const p = EVENTOS['cadastros.tabela_preco.alterada@1'].safeParse(evento.payload);
      if (!p.success) return;
      const ref = mapearTabelaPreco(p.data, emIso);
      const antes = await tx.consultar<{ dados: Record<string, unknown>; external_id: string | null }>(
        `SELECT dados, external_id FROM integracao_fdv.referencia WHERE tenant_id = $1 AND tipo = 'tabela_preco' AND erp_id = $2 AND deleted_at IS NULL`,
        [t, ref.erp_id],
      );
      const mudou = await gravarReferencia(tx, t, ref, em);
      const sig = (d: Record<string, unknown>, ext: string): string => assinaturaDaTabela(tabelaDaReferencia(d, ext));
      const a = antes[0];
      if (mudou && (!a || sig(a.dados, a.external_id ?? ref.erp_id) !== sig(ref.dados, ref.external_id ?? ref.erp_id))) {
        juntar(pendentes, await recomporDependentes(tx, t, 'tabela_preco_id', ref.erp_id, em));
      }
      return;
    }
    case 'cadastros.preco.alterado@1': {
      const p = EVENTOS['cadastros.preco.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      // tabela e filial padrão entram na recomposição (única via, M10); aqui só o registro bruto
      juntar(pendentes, await aplicarRegistros(tx, t, [mapearPreco(evento.agregado_id, p.data, emIso, { tabela: null, filialPadraoId: null })], em));
      return;
    }
    case 'cadastros.estoque.alterado@1': {
      const p = EVENTOS['cadastros.estoque.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      juntar(pendentes, await aplicarRegistros(tx, t, [mapearEstoque(evento.agregado_id, p.data, emIso, { depositoNome: null })], em));
      return;
    }
    case 'cadastros.cliente.alterado@1': {
      const p = EVENTOS['cadastros.cliente.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      const { cliente, enderecos } = mapearCliente(p.data, emIso, { condicao: null });
      await gravarComDependentes(tx, t, em, pendentes, cliente, p.data.id);
      juntar(pendentes, await aplicarRegistros(tx, t, enderecos, em));
      juntar(pendentes, await inativarRetirados(tx, t, 'cliente_endereco', 'cliente_id', p.data.id, enderecos.map((e) => e.erp_id ?? ''), em));
      return;
    }
    default:
      return;
  }
}

/** Mantém a referência `filial_padrao`: grava se a filial é a padrão, remove se deixou de ser. `true` = a situação mudou. */
async function gravarPadrao(
  tx: Transacao,
  t: string,
  filialId: string,
  referencia: ReferenciaEspelho | null,
  em: Date,
): Promise<boolean> {
  if (referencia) return gravarReferencia(tx, t, referencia, em);
  return removerReferencia(tx, t, 'filial_padrao', filialId, em);
}
