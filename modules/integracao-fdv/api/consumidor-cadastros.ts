/**
 * Consumidor `integracao-fdv.publicar-cadastros` (T-0009 seção 6.1, M1, M3, M9, M10): mapeia os eventos de `cadastros`
 * (função pura do `domain`), grava o espelho `registro_publicado` e as `referencia`s, recompõe os dependentes e acorda o envio
 * da entidade (`cursor_entidade.proximo_em = least(proximo_em, agora)`). Não chama o Hub.
 *
 * Premissas: (1) o `external_id` do cadastro que o evento traz é a chave no Hub (`chaveHub`); referência de outro cadastro
 * usa a chave dele quando já está no espelho e o UUID do ERP enquanto não está, e é recomposta quando ele chegar (M10).
 * (2) Sem licença do módulo `integracao-fdv` no tenant (M9) nada é gravado: a carga inicial (C-4) cobre a ligação posterior.
 * (3) Payload fora do contrato é ignorado (erro permanente: repetir não conserta e travaria o agregado na fila).
 * (4) O UUID do ERP de cada registro fica na coluna `erp_id` do espelho (0015, RD-0318); a chave da tabela de preço no Hub fica em
 * `referencia.dados.chave` (0018) e `referencia.external_id` não é mais usado.
 * (5) Troca e conflito de chave (ADR 0010, item 3): `decidirTrocaDeChave` compara a chave do evento com a do espelho; `troca` inativa a linha antiga, e `chave_alterada`/`chave_duplicada` não gravam nada e abrem `conflito_chave`.
 */
import { EVENTOS } from '@macuxierp/cadastros/contracts';
import { moduloLicenciado, type ConsumidorEvento, type EnvelopeEvento, type FonteLicencas, type Transacao } from '@macuxierp/platform-sdk';
import {
  CHAVE_FONTE_REFS,
  assinaturaDaReferenciaTabela,
  assinaturaDeDerivados,
  chaveHub,
  decidirTrocaDeChave,
  ehConflitoDeChave,
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
import { aplicarRegistros, aplicarTrocaDeChave, gravarReferencia, inativarRetirados, outroPrazoAtivoDaForma, recomporDependentes, registrarConflito, removerReferencia, situacaoDaChave, agendarEnvio } from './espelho';

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
 * Só chega aqui depois de `conferirChave` ter dito `troca` ou `nada` (regra em troca-chave.ts): a linha antiga sai antes de a
 * nova entrar (o índice único do `erp_id` vale só entre as ativas) e, depois da troca, a gravação é `'falhar'`: o erro desfaz a
 * troca e o evento refeito registra o conflito limpo.
 */
async function trocarEGravar(tx: Transacao, t: string, em: Date, pendentes: Pendentes, reg: RegistroEspelho, erpId: string, modo?: 'falhar'): Promise<void> {
  juntar(pendentes, await aplicarTrocaDeChave(tx, t, reg.entidade, erpId, reg.external_id, em));
  juntar(pendentes, await aplicarRegistros(tx, t, [reg], em, modo));
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
  await trocarEGravar(tx, t, em, pendentes, principal, erpId, 'falhar');
  const chaveRef = CHAVE_FONTE_REFS[principal.entidade];
  if (chaveRef && (antes === null || antes !== assinaturaDeDerivados(principal))) {
    juntar(pendentes, await recomporDependentes(tx, t, chaveRef, erpId, em));
  }
}

/**
 * Grava os filhos (unidades, endereços) um a um, cada um conferido contra o espelho, e inativa os que saíram da lista do pai
 * (`pai`: entidade do filho, chave de `fonte_refs` e `erp_id` do pai; RN-CAD-08).
 */
async function gravarFilhos(
  tx: Transacao,
  t: string,
  em: Date,
  pendentes: Pendentes,
  filhos: readonly RegistroEspelho[],
  pai: { entidade: EntidadeHub; chaveRef: string; erpId: string },
): Promise<void> {
  for (const f of filhos) {
    const erpId = f.erp_id;
    if (!erpId) continue;
    if (!(await conferirChave(tx, t, f.entidade, erpId, f.external_id, undefined, em))) continue;
    await trocarEGravar(tx, t, em, pendentes, f, erpId, 'falhar');
  }
  juntar(pendentes, await inativarRetirados(tx, t, pai.entidade, pai.chaveRef, pai.erpId, filhos.flatMap((f) => (f.erp_id ? [f.erp_id] : [])), em));
}

/**
 * Confere a chave do Hub do registro contra o espelho (`decidirTrocaDeChave`). `true` = pode gravar (nada ou troca);
 * `false` = `chave_alterada` ou `chave_duplicada`: nada é gravado e o conflito fica registrado (RN-CORE-05, RN-INF-04).
 */
async function conferirChave(
  tx: Transacao,
  t: string,
  entidade: EntidadeHub,
  erpId: string,
  chaveNova: string,
  anterior: string | null | undefined,
  em: Date,
): Promise<boolean> {
  const { chaveEspelho, outroErpId, fonteOcorridoEm } = await situacaoDaChave(tx, t, entidade, erpId, chaveNova);
  // evento mais velho que o espelho é descartado (M3), sem abrir conflito falso
  if (fonteOcorridoEm && em.getTime() < fonteOcorridoEm.getTime()) return false;
  const decisao = decidirTrocaDeChave({ chaveEspelho, chaveNova, anterior, outroErpIdComChaveNova: outroErpId, erpId });
  if (ehConflitoDeChave(decisao)) {
    await registrarConflito(tx, t, entidade, erpId, chaveNova, decisao);
    return false;
  }
  return true;
}

async function tratarEvento(tx: Transacao, evento: EnvelopeEvento, t: string, em: Date, pendentes: Pendentes): Promise<void> {
  const emIso = em.toISOString();
  switch (evento.nome) {
    case 'cadastros.filial.alterada@1': {
      const p = EVENTOS['cadastros.filial.alterada@1'].safeParse(evento.payload);
      if (!p.success) return;
      const { registro, referencia } = mapearFilial(p.data, emIso);
      if (!(await conferirChave(tx, t, 'filial', p.data.id, registro.external_id, p.data.external_id_anterior, em))) return;
      const eraPadrao = await gravarPadrao(tx, t, p.data.id, referencia, em);
      await gravarComDependentes(tx, t, em, pendentes, registro, p.data.id);
      // trocar a filial padrão muda a forma de os preços dela irem ao Hub (com ou sem filial): recompõe os dela
      if (eraPadrao) juntar(pendentes, await recomporDependentes(tx, t, 'filial_id', p.data.id, em));
      return;
    }
    case 'cadastros.vendedor.alterado@1': {
      const p = EVENTOS['cadastros.vendedor.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      const vendedor = mapearVendedor(p.data, emIso);
      if (!(await conferirChave(tx, t, 'vendedor', p.data.id, vendedor.external_id, p.data.external_id_anterior, em))) return;
      await gravarComDependentes(tx, t, em, pendentes, vendedor, p.data.id);
      return;
    }
    case 'cadastros.condicao_pagamento.alterada@1': {
      const p = EVENTOS['cadastros.condicao_pagamento.alterada@1'].safeParse(evento.payload);
      if (!p.success) return;
      const previa = mapearCondicao(p.data, emIso, { tenantId: t, formaAtiva: !p.data.inativo });
      // RN-CAD-15: prazo incompleto não sai (`prazo` nulo); a forma sai assim mesmo, porque é compartilhada
      const prazoChave = chaveHub(p.data);
      const formaAtiva = !p.data.inativo || (await outroPrazoAtivoDaForma(tx, t, previa.forma.external_id, prazoChave));
      const { forma, prazo } = mapearCondicao(p.data, emIso, { tenantId: t, formaAtiva });
      if (prazo && !(await conferirChave(tx, t, 'prazo_pagamento', p.data.id, prazo.external_id, p.data.external_id_anterior, em))) return;
      // a forma é derivada dos prazos vigentes (não de um agregado próprio): vale sempre o último evento de condição
      juntar(pendentes, await aplicarRegistros(tx, t, [forma], em));
      // o cliente não depende mais da condição (`prazo_medio_max_dias` é do próprio cliente, RN-CAD-16): nada a recompor
      if (prazo) await gravarComDependentes(tx, t, em, pendentes, prazo, p.data.id);
      return;
    }
    case 'cadastros.produto.alterado@1': {
      const p = EVENTOS['cadastros.produto.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      const { produto, unidades } = mapearProduto(p.data, emIso);
      if (!(await conferirChave(tx, t, 'produto', p.data.id, produto.external_id, p.data.external_id_anterior, em))) return;
      await gravarComDependentes(tx, t, em, pendentes, produto, p.data.id);
      await gravarFilhos(tx, t, em, pendentes, unidades, { entidade: 'produto_unidade', chaveRef: 'produto_id', erpId: p.data.id });
      return;
    }
    case 'cadastros.tabela_preco.alterada@1': {
      const p = EVENTOS['cadastros.tabela_preco.alterada@1'].safeParse(evento.payload);
      if (!p.success) return;
      const ref = mapearTabelaPreco(p.data, emIso);
      const { mudou, dadosAntes } = await gravarReferencia(tx, t, ref, em);
      // RD-0318: a assinatura inclui a chave do Hub; chave nova da tabela (troca de external_id) recompõe os preços dependentes
      // (`fonte_refs.tabela_preco_id`) e os marca pendentes (`atualizarConteudo`, hash novo)
      if (mudou && (!dadosAntes || assinaturaDaReferenciaTabela(dadosAntes) !== assinaturaDaReferenciaTabela(ref.dados))) {
        juntar(pendentes, await recomporDependentes(tx, t, 'tabela_preco_id', ref.erp_id, em));
      }
      return;
    }
    case 'cadastros.preco.alterado@1': {
      const p = EVENTOS['cadastros.preco.alterado@1'].safeParse(evento.payload);
      if (!p.success) return;
      // tabela e filial padrão entram na recomposição (única via, M10); aqui só o registro bruto
      const preco = mapearPreco(evento.agregado_id, p.data, emIso, { tabela: null, filialPadraoId: null });
      if (!(await conferirChave(tx, t, 'preco', evento.agregado_id, preco.external_id, p.data.external_id_anterior, em))) return;
      await trocarEGravar(tx, t, em, pendentes, preco, evento.agregado_id, 'falhar');
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
      const { cliente, enderecos } = mapearCliente(p.data, emIso);
      if (!(await conferirChave(tx, t, 'cliente', p.data.id, cliente.external_id, p.data.external_id_anterior, em))) return;
      await gravarComDependentes(tx, t, em, pendentes, cliente, p.data.id);
      await gravarFilhos(tx, t, em, pendentes, enderecos, { entidade: 'cliente_endereco', chaveRef: 'cliente_id', erpId: p.data.id });
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
  if (referencia) return (await gravarReferencia(tx, t, referencia, em)).mudou;
  return removerReferencia(tx, t, 'filial_padrao', filialId, em);
}
