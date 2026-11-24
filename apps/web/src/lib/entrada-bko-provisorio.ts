/**
 * PROVISÓRIO (v0.3.11, ADR 0014 §5 e §14): o contrato da entrada do cenário B ainda não existe. Este arquivo concentra tudo o que o
 * BKO assume dele e será TROCADO pelos `contracts` do cadastros (schema `LinhaEntradaBko`) e pelo SDK
 * (`CODIGO_DONO_CLIENTE`, `MENSAGEM_DONO_CLIENTE`). Nada fora daqui declara esses nomes: ao sair o contrato, troca-se só este arquivo.
 */
import { z } from 'zod';
import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { getValidado, usaApiFalsaAgora } from './api';

/** Nomes do SDK que ainda vão sair (409 CONFLITO com `detalhes.codigo`). */
export const CODIGO_DONO_CLIENTE = 'dono_cliente';
export const MENSAGEM_DONO_CLIENTE = 'Vem do servidor do cliente';

/** `GET /v1/cadastros/entrada/situacao`: o dono já vem com o herdado resolvido (endereços seguem clientes, unidades seguem produtos). */
export const LinhaEntradaBko = z.object({
  cadastro: z.enum(ENTIDADES_ENVIO_FDV),
  dono: z.enum(['cliente', 'erp']),
  ultimo_lote: z.object({ em: z.string(), recebidas: z.number().int(), gravadas: z.number().int(), com_erro: z.number().int() }).nullable(),
  erros: z.number().int(),
  confirmacao_pendente: z.boolean(),
});
export type LinhaEntradaBko = z.infer<typeof LinhaEntradaBko>;
export const SituacaoEntradaBko = z.object({ cadastros: z.array(LinhaEntradaBko) });

export const CAMINHO_ENTRADA_SITUACAO = '/v1/cadastros/entrada/situacao';

/**
 * Lê a situação da entrada. Qualquer falha (rota ausente, 403, rede, corpo fora do contrato) devolve `null`: o BKO segue como hoje,
 * sem Chip, sem bloqueio e sem bloco (a API revalida; o bloqueio real é o 409).
 */
export async function buscarSituacaoEntrada(acesso: string): Promise<readonly LinhaEntradaBko[] | null> {
  try {
    if (usaApiFalsaAgora()) return null;
    return (await getValidado(CAMINHO_ENTRADA_SITUACAO, SituacaoEntradaBko, acesso, 'entrada', true)).cadastros;
  } catch {
    return null;
  }
}
