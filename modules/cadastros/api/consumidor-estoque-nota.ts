/**
 * Estoque pelas notas do faturamento (T-0021, decisão R-20261122-022626): `faturamento.nota.autorizada@1` baixa o estoque
 * e `faturamento.nota.cancelada@1` devolve. Só move a nota de produção ou a de filial com a bandeira
 * "faturamento real com NF-e simulada" (`conta_como_real`, campo opcional do payload do evento: o cadastros não lê a bandeira no faturamento, usa o campo do evento).
 * - Leitor tolerante (Zod local, `passthrough`), sem importar o pacote do faturamento. Payload inválido, ou sem os campos
 *   novos por item (`produto_id`, `filial_id`, `quantidade` × 10^4), é ignorado.
 * - RN-CAD-07: a baixa pela nota SEMPRE acontece, mesmo com saldo negativo (PREMISSA aceita pelo gerente, levada ao PO para o Alexandre confirmar; a nota autorizada é fato consumado).
 * - Idempotência: a plataforma já deduplica por consumidor; além disso cada movimento leva `external_id` = UUID v5 de
 *   (nota.id = agregado_id do evento, tipo, índice do item), conferido antes de gravar: o mesmo fato republicado com outro id de evento não move duas vezes.
 * - A cancelada só devolve se existir a saída da autorizada (mesma nota, mesmo índice). Item de produto ou filial inexistente no tenant é ignorado, com log técnico só de ids. Tudo na transação do evento (saldo com FOR UPDATE).
 */
import { criarEvento, type ConsumidorEvento, type Outbox, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { aplicarMovimento, deveMoverEstoque, movimentosDaNota, type TipoNotaEstoque } from '../domain';
import { eventoEstoque } from './eventos';
import type { Repositorios } from './portas';
import { agregadoEstoque, uuidV5 } from './uuid';

export const EVENTO_NOTA_AUTORIZADA = 'faturamento.nota.autorizada@1';
export const EVENTO_NOTA_CANCELADA = 'faturamento.nota.cancelada@1';

const NS_ESTOQUE_NOTA = '5e1b9c3a-8d24-5f6b-a07c-2b4d6f8a0c13';

const ItemLido = z.object({
  produto_id: z.string().uuid().nullish().catch(undefined),
  filial_id: z.string().uuid().nullish().catch(undefined),
  quantidade: z.number().int().nullish().catch(undefined),
}).passthrough();

const NotaLida = z.object({
  ambiente: z.string(),
  conta_como_real: z.boolean().nullish().catch(undefined),
  nota: z.object({ numero: z.number().int(), serie: z.number().int() }).passthrough(),
  itens: z.array(ItemLido),
}).passthrough();

export const externalDoMovimentoDaNota = (notaId: string, tipo: TipoNotaEstoque, indice: number): string =>
  uuidV5(`nota-estoque:${notaId}:${tipo}:${indice}`, NS_ESTOQUE_NOTA);

export function criarConsumidorEstoqueNota(deps: { repositorios(tx: Transacao): Repositorios; outbox: Outbox; agora?: () => Date; registrar?: (msg: string) => void }): ConsumidorEvento {
  return {
    id: 'cadastros.estoque-nota',
    eventos: [EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_CANCELADA],
    async tratar(evento, tx) {
      const lido = NotaLida.safeParse(evento.payload);
      if (!lido.success) return;
      const nota = lido.data;
      if (!deveMoverEstoque({ ambiente: nota.ambiente, conta_como_real: nota.conta_como_real })) return;
      const tipo: TipoNotaEstoque = evento.nome === EVENTO_NOTA_CANCELADA ? 'cancelada' : 'autorizada';
      const r = deps.repositorios(tx);
      const motivo = `${tipo === 'cancelada' ? 'Cancelamento da ' : ''}NF-e ${nota.nota.numero}/${nota.nota.serie}`.slice(0, 120);
      const registrar = deps.registrar ?? ((msg: string) => console.warn(msg));
      for (const m of movimentosDaNota(tipo, nota.itens)) {
        const external_id = externalDoMovimentoDaNota(evento.agregado_id, tipo, m.indice);
        if (await r.estoque.movimentoPorExternalId(external_id)) continue;
        if (tipo === 'cancelada' && !(await r.estoque.movimentoPorExternalId(externalDoMovimentoDaNota(evento.agregado_id, 'autorizada', m.indice)))) continue;
        if (!(await r.produtos.obter(m.produto_id)) || !(await r.filiais.obter(m.filial_id))) {
          registrar(`estoque-nota: item ignorado (produto ou filial inexistente) nota=${evento.agregado_id} indice=${m.indice} produto=${m.produto_id} filial=${m.filial_id}`);
          continue;
        }
        const saldo = await r.estoque.saldoParaAtualizar(m.filial_id, m.produto_id);
        const mov = aplicarMovimento({ saldo, tipo: m.tipo, quantidade: m.quantidade, podeNegativo: true }); // RN-CAD-07: a baixa pela nota nunca trava
        if (!mov.ok) continue;
        const novo = mov.saldo;
        await r.estoque.gravarMovimento({ filial_id: m.filial_id, produto_id: m.produto_id, tipo: m.tipo, quantidade: m.quantidade, motivo, external_id, usuario_id: null, origem_tipo: 'nfe', origem_id: evento.agregado_id }, novo);
        const e = eventoEstoque(agregadoEstoque(m.filial_id, m.produto_id), { filial_id: m.filial_id, produto_id: m.produto_id, quantidade: novo });
        await deps.outbox.gravar(tx, criarEvento(
          { nome: e.nome, tenant_id: evento.tenant_id, agregado_id: e.agregado_id, versao: 1, ator: 'sistema', request_id: evento.request_id, payload: e.payload },
          (deps.agora ?? (() => new Date()))(),
        ));
      }
    },
  };
}
