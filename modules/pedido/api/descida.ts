/**
 * Fila de descida do pedido ao banco do cliente e retorno vindo do cliente (ADR 0014 §13 e §15, T-0057 etapa 3b).
 * Serviço que o engenheiro-software chama nas rotas `/entrada/v1/pedidos/*` (o Conector busca, o ERP nunca abre conexão):
 *  - `enfileirar`: todo pedido aprovado entra na fila, com ou sem faturamento (idempotente por pedido);
 *  - `pendentes`: itens a descer, por tenant (RLS), do mais antigo ao mais novo;
 *  - `marcarDescido`: o Conector confirmou a gravação; repetir não desce de novo;
 *  - `aplicarRetorno`: `faturado_parcial`, `faturado_total` ou `cancelado` do cliente, pela máquina RN-PED-02.
 * Licença: sem o módulo `pedido`, 403 `MODULO_INATIVO` (RN-CORE-02). O faturamento "desligado" é a licença `faturamento` da
 * empresa (ADR 0014 §15): sem ela o ERP é só ponte e o `faturado_*` vem do cliente. Perfil e credencial do Conector: do plugin.
 * Sem dado pessoal em log (regra 8): só ids, status e códigos.
 */
import { ErroApi, erros, moduloLicenciado, type FonteLicencas, type Transacao } from '@macuxierp/platform-sdk';
import { ItemFilaDescida, type NotaClienteTexto, type NotaReferenciaCliente, type ResultadoRetornoCliente, type RetornoClientePedido, type StatusPedido } from '../contracts';
import { converterNotaCliente, decidirEnfileirar, decidirMarcarDescido, decidirRetornoCliente, STATUS_DESCEM } from '../domain';
import { eventoCancelado, eventoFaturadoCliente, pedidoAprovado } from './eventos';
import type { Dependencias, PedidoGravado, RepoPedidos } from './portas';
import type { Efeitos } from './servico';
import { erroTransicao } from './util';

/** Linha da fila (tabela `pedido.descida_pedido`, migração 0045 do banco-dados). */
export interface LinhaDescida {
  pedido_id: string;
  pedido_uuid: string;
  /** UTC, ISO 8601 com ms. */
  enfileirado_em: string;
  descido_em: string | null;
}

/** O que a API precisa da fila, na transação do tenant. */
export interface FilaDescida {
  /** `INSERT … ON CONFLICT (pedido_id) DO NOTHING`: `false` = já estava na fila. */
  enfileirar(pedidoId: string, pedidoUuid: string, quando: Date): Promise<boolean>;
  obter(pedidoId: string): Promise<LinhaDescida | null>;
  /** Não descidos de pedido em `STATUS_DESCEM`, por `enfileirado_em` e `pedido_id`, até `limite`. */
  pendentes(limite: number): Promise<LinhaDescida[]>;
  /** `UPDATE … WHERE descido_em IS NULL`: `false` = já descido ou fora da fila. */
  marcarDescido(pedidoId: string, quando: Date): Promise<boolean>;
  /** Referência da nota do cliente gravada em `pedido.pedido` (`nota_cliente_*`, migração 0045); `null` = sem nota. */
  notaCliente(pedidoId: string): Promise<NotaReferenciaCliente | null>;
  /** `UPDATE pedido.pedido` nas quatro colunas juntas (CHECK do banco), na mesma transação do status. A decisão é do domain. */
  gravarNotaCliente(pedidoId: string, nota: NotaReferenciaCliente): Promise<void>;
}

export interface DependenciasDescida extends Dependencias {
  fila(tx: Transacao): FilaDescida;
  licencas: FonteLicencas;
}

export const LIMITE_PENDENTES = 100;
/** Referência (inteiros) → nota do evento (texto, com a chave obrigatória). */
const notaDoEvento = (n: NotaReferenciaCliente, chave: string): NotaClienteTexto => ({
  numero: String(n.numero), serie: String(n.serie), chave, emitida_em: n.emitida_em, total_centavos: n.total_centavos,
});
const MOTIVO_CANCELADO_NO_CLIENTE = 'Cancelado no sistema do cliente';

export function criarServicoDescida(d: DependenciasDescida) {
  const log = (dados: Record<string, unknown>, msg: string) => d.log?.info({ modulo: 'pedido', ...dados }, msg);

  async function exigirLicenca(tx: Transacao, repo: RepoPedidos, fx: Efeitos): Promise<{ faturamentoLigado: boolean }> {
    const licencas = await d.licencas.ler(tx, await repo.tenantId());
    if (!moduloLicenciado(licencas, 'pedido', fx.agora)) throw erros.moduloInativo('pedido');
    return { faturamentoLigado: moduloLicenciado(licencas, 'faturamento', fx.agora) };
  }

  const uuidDe = (p: PedidoGravado): string => (p.origem === 'fdv' && p.external_id ? p.external_id : p.id);

  async function porUuid(repo: RepoPedidos, uuid: string): Promise<PedidoGravado> {
    const chave = uuid.toLowerCase();
    const p = (await repo.porExternalId(chave)) ?? (await repo.obter(chave));
    if (!p || uuidDe(p) !== chave) throw erros.naoEncontrado('Pedido');
    return p;
  }

  return {
    /** Chamado na aprovação (consumidor de `aprovado@1` ou o serviço). Idempotente: `false` = não entrou. */
    async enfileirar(tx: Transacao, fx: Efeitos, pedidoId: string): Promise<boolean> {
      const repo = d.repositorios(tx);
      const p = await repo.obter(pedidoId);
      if (!p) throw erros.naoEncontrado('Pedido');
      const fila = d.fila(tx);
      const r = decidirEnfileirar({ status: p.status, jaNaFila: (await fila.obter(p.id)) !== null });
      if (!r.ok) return false;
      const entrou = await fila.enfileirar(p.id, uuidDe(p), fx.agora);
      if (entrou) log({ tenant_id: fx.tenant_id, pedido_id: p.id, acao: 'enfileirar_descida' }, 'pedido na fila de descida');
      return entrou;
    },

    async pendentes(tx: Transacao, fx: Efeitos, limite = LIMITE_PENDENTES): Promise<ItemFilaDescida[]> {
      const repo = d.repositorios(tx);
      await exigirLicenca(tx, repo, fx);
      const itens: ItemFilaDescida[] = [];
      for (const l of await d.fila(tx).pendentes(Math.min(Math.max(limite, 1), LIMITE_PENDENTES))) {
        const p = await repo.obter(l.pedido_id);
        if (!p || !STATUS_DESCEM.includes(p.status)) continue;
        const condicao = p.condicao_pagamento_id ? await d.cadastros.condicao(tx, p.condicao_pagamento_id) : null;
        itens.push(ItemFilaDescida.parse({
          pedido_id: p.id, pedido_uuid: l.pedido_uuid, numero: p.numero, origem: p.origem, filial_id: p.filial_id, cliente_id: p.cliente_id,
          vendedor_id: p.vendedor_id, aprovado_em: l.enfileirado_em, pedido: pedidoAprovado(p, condicao),
        }));
      }
      return itens;
    },

    /** O Conector gravou no banco do cliente. `repetido` = já estava marcado (não desce duas vezes). */
    async marcarDescido(tx: Transacao, fx: Efeitos, pedidoUuid: string): Promise<{ resultado: 'marcado' | 'repetido'; pedido_id: string }> {
      const repo = d.repositorios(tx);
      await exigirLicenca(tx, repo, fx);
      const p = await porUuid(repo, pedidoUuid);
      const fila = d.fila(tx);
      const linha = await fila.obter(p.id);
      if (!linha) throw erros.naoEncontrado('Pedido');
      if (!decidirMarcarDescido({ descidoEm: linha.descido_em }).ok) return { resultado: 'repetido', pedido_id: p.id };
      await fila.marcarDescido(p.id, fx.agora);
      log({ tenant_id: fx.tenant_id, pedido_id: p.id, acao: 'marcar_descido' }, 'pedido descido ao banco do cliente');
      return { resultado: 'marcado', pedido_id: p.id };
    },

    /** RN-PED-02: `POST /pedidos/{uuid}/retorno`. Recusa vira 422 `RN-PED-02`; repetido e obsoleto respondem 200 sem evento. */
    async aplicarRetorno(tx: Transacao, fx: Efeitos, retorno: RetornoClientePedido): Promise<ResultadoRetornoCliente> {
      const repo = d.repositorios(tx);
      const { faturamentoLigado } = await exigirLicenca(tx, repo, fx);
      const achado = await porUuid(repo, retorno.pedido_uuid);
      const p = await repo.obterParaAtualizar(achado.id);
      if (!p) throw erros.naoEncontrado('Pedido');
      const fila = d.fila(tx);
      let notaNova: NotaReferenciaCliente | null = null;
      let chave: string | null = null;
      if (retorno.nota && retorno.status !== 'cancelado') {
        const c = converterNotaCliente(retorno.nota, fx.agora);
        if (!c.ok) throw erros.regra(c.rn, c.mensagem, undefined, { codigo: c.codigo, campo: c.campo });
        notaNova = c.referencia;
        chave = c.chave;
      }
      const r = decidirRetornoCliente({ statusAtual: p.status, retorno: retorno.status, faturamentoLigado, notaAtual: await fila.notaCliente(p.id), notaNova });
      if (!r.ok) {
        if (r.codigo === 'transicao_invalida') throw erroTransicao(r.possiveis, r.mensagem);
        if (r.codigo === 'nota_cliente_divergente') throw new ErroApi(409, 'CONFLITO', r.mensagem, undefined, { codigo: r.codigo });
        throw erros.regra(r.rn, r.mensagem, undefined, { codigo: r.codigo });
      }
      if (r.acao === 'sem_efeito') return { resultado: r.motivo === 'ja_aplicado' ? 'repetido' : 'obsoleto', pedido_id: p.id, status: p.status };
      if (r.acao === 'atualizar_nota') {
        // Um evento por mudança aplicada: o FDV precisa receber a nota nova (status e status_anterior iguais).
        await fila.gravarNotaCliente(p.id, r.nota);
        const idNota = await fx.publicar(eventoFaturadoCliente((await repo.obter(p.id)) as PedidoGravado, p.status, notaDoEvento(r.nota, chave as string)));
        await repo.registrarEvento({
          pedido_id: p.id, de: p.status, para: p.status, ator_tipo: 'sistema', ator_id: null, motivo_codigo: null,
          motivo_texto: null, pendencias: null, evento_id: idNota, ocorrido_em: fx.agora,
        });
        await fx.auditar({ acao: 'pedido.nota_cliente', entidade: 'pedido', entidade_id: p.id, antes: { status: p.status }, depois: { status: p.status, nota_cliente_numero: r.nota.numero } });
        log({ tenant_id: fx.tenant_id, pedido_id: p.id, acao: 'nota_cliente' }, 'referência da nota do cliente atualizada');
        return { resultado: 'aplicado', pedido_id: p.id, status: p.status };
      }

      await repo.atualizarStatus(p.id, r.para, p.pendencias, null);
      if (r.nota) await fila.gravarNotaCliente(p.id, r.nota);
      const final = (await repo.obter(p.id)) as PedidoGravado;
      const nota = r.nota;
      const cancelando = r.para === 'cancelado';
      const motivoTexto = cancelando ? (retorno.motivo ?? MOTIVO_CANCELADO_NO_CLIENTE) : null;
      const idEvento = await fx.publicar(cancelando ? eventoCancelado(final, p.status, 'outro', motivoTexto) : eventoFaturadoCliente(final, p.status, nota && chave ? notaDoEvento(nota, chave) : null));
      await repo.registrarEvento({
        pedido_id: p.id, de: p.status, para: r.para, ator_tipo: 'sistema', ator_id: null, motivo_codigo: cancelando ? 'outro' : null,
        motivo_texto: motivoTexto, pendencias: null, evento_id: idEvento, ocorrido_em: fx.agora,
      });
      await fx.auditar({ acao: 'pedido.retorno_cliente', entidade: 'pedido', entidade_id: p.id, antes: { status: p.status }, depois: { status: r.para } });
      log({ tenant_id: fx.tenant_id, pedido_id: p.id, acao: 'retorno_cliente', status: r.para as StatusPedido }, 'retorno do cliente aplicado ao pedido');
      return { resultado: 'aplicado', pedido_id: p.id, status: r.para };
    },
  };
}
export type ServicoDescida = ReturnType<typeof criarServicoDescida>;
