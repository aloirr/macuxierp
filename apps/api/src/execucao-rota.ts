/**
 * Peças comuns da execução das rotas declaradas (tenant em `app.ts` e portal `/config` em `plataforma/rotas.ts`): a
 * entrada passada ao `executar` da rota e o envio da `RespostaRota` (com o cabeçalho de resposta repetida).
 */
import { CABECALHO_REPETIDA, cabecalhosDaRota, type ArquivoRecebido, type EntradaRota, type RespostaRota } from '@macuxierp/platform-sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

interface RotaComEntrada {
  corpo?: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  consulta?: z.ZodType<unknown, z.ZodTypeDef, unknown>;
}

/**
 * Valida corpo e consulta pelos schemas da rota. Rota multipart passa o `lido` (campos de texto e arquivos já lidos);
 * nas rotas JSON o corpo é o `req.body` e não há arquivos.
 */
export function entradaDaChamada(
  req: FastifyRequest,
  rota: RotaComEntrada,
  lido: { corpo: unknown; todosArquivos: Record<string, ArquivoRecebido[]> } = { corpo: req.body, todosArquivos: {} },
): EntradaRota<unknown, unknown> {
  const { todosArquivos } = lido;
  return {
    corpo: rota.corpo ? rota.corpo.parse(lido.corpo) : undefined,
    consulta: rota.consulta ? rota.consulta.parse(req.query) : undefined,
    params: req.params as Record<string, string>,
    cabecalhos: cabecalhosDaRota(req.headers),
    arquivos: Object.fromEntries(Object.entries(todosArquivos).map(([k, v]) => [k, v[0]!])),
    todosArquivos,
  };
}

export function responder(reply: FastifyReply, resposta: RespostaRota, repetida: boolean) {
  if (repetida) reply.header(CABECALHO_REPETIDA, 'true');
  else if (resposta.cabecalhos) reply.headers(resposta.cabecalhos);
  return reply.status(resposta.status ?? 200).send(resposta.corpo ?? null);
}
