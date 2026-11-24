/**
 * Peças comuns das rotas do "Esqueci a senha" (T-0076): `POST /v1/auth/esqueci` (tenant e MACUXI) e
 * `POST /v1/plataforma/auth/esqueci` (portal `/config`).
 * - Ordem: limite por IP (429) → corpo (400) → anti-CSRF do código MACUXI (o 401 do login, ADR 0018) → limite por conta
 *   (429) → 202 neutro, sem banco → segundo plano depois da resposta (T-0083: busca da conta, argon2, gravação, auditoria e
 *   e-mail; `segundoPlanoAposResposta`). Os dois 429 são iguais para conta que existe ou não.
 * - Os limites são os mesmos objetos nas duas rotas (um por processo): o MACUXI da tela única e o `/config` somam juntos.
 * - As rotas ficam sempre montadas. Sem a porta de e-mail (`envio: null`), o pedido segue a mesma ordem até o limite por
 *   conta e responde o mesmo 202 neutro; o segundo plano tem o mesmo custo de argon2 (`esqueciSemEnvio` dos serviços, que
 *   chama `custoTemporariaDescartada`), sem tocar o banco, sem gravar temporária e sem enviar nada; a situação diz
 *   `esqueci_disponivel: false` e a web oculta o link.
 * - Banco: empresa suspensa ou inexistente, e-mail inexistente ou conta inativa = nada gravado e nada enviado; senão grava
 *   só o hash (72 h, substitui o anterior) e a auditoria na mesma transação, e devolve a mensagem de e-mail para o
 *   endereço da conta lido do banco (T-0083), não para o digitado.
 * - Nem o e-mail, nem a temporária, nem o IP vão para log.
 */
import { randomUUID } from 'node:crypto';
import { erros, MENSAGEM_ESQUECI_NEUTRA, textoMuitasTentativas, type ErroApi, type PedidoSenhaTemporariaResposta } from '@macuxierp/platform-sdk';
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { enviarComTentativas, logSemFalhar } from '../email/envio-apos-resposta';
import type { EnvioEmail, MensagemEmail } from '../email/porta';
import { chaveEmpresaEmail, type LimitesEsqueci } from '../plataforma/limite-ip';

/** O "Esqueci a senha" montado: a porta de e-mail (`null` = e-mail desligado) e os limites do processo. */
export interface EsqueciMontado {
  envio: EnvioEmail | null;
  limites: LimitesEsqueci;
}

/** 429 `MuitasTentativasResposta` (esqueci e login por IP): o texto da tela e o prazo em `detalhes.retry_after_s`. */
export const erroMuitasTentativas = (retryAfterS: number): ErroApi => erros.muitasTentativas(textoMuitasTentativas(retryAfterS), retryAfterS);

/** 429 do limite por IP; roda antes de ler o corpo e de qualquer consulta ao banco. */
export function limitarEsqueciPorIp(limites: LimitesEsqueci, ip: string, agoraMs: number): void {
  const r = limites.ip.registrar(ip, agoraMs);
  if (!r.permitido) throw erroMuitasTentativas(r.retry_after_s);
}

/** 429 do limite por conta (empresa + e-mail normalizados, em SHA-256); roda antes de qualquer consulta ao banco. */
export function limitarEsqueciPorConta(limites: LimitesEsqueci, empresa: string, email: string, agoraMs: number): void {
  const r = limites.conta.registrar(chaveEmpresaEmail(empresa, email), agoraMs);
  if (!r.permitido) throw erroMuitasTentativas(r.retry_after_s);
}

/** O trabalho do pedido, feito depois do 202: busca da conta, argon2, gravação, auditoria; devolve o e-mail a enviar ou `null`. */
export type TrabalhoEsqueci = () => Promise<MensagemEmail | null>;

/** Os trabalhos de segundo plano em andamento (do agendamento ao fim do envio agendado); os testes esperam por eles. */
const emAndamento = new Set<Promise<void>>();

/** Espera os trabalhos de segundo plano do "esqueci" terminarem, também os que começarem enquanto espera (para os testes). */
export async function aguardarSegundoPlanoEsqueci(): Promise<void> {
  while (emAndamento.size > 0) await Promise.allSettled([...emAndamento]);
}

/**
 * Segundo plano depois da resposta (T-0083, tempo constante): o `onResponse` (resposta já enviada) solta o trabalho num
 * `setImmediate`, e o e-mail devolvido sai pelo `enviarComTentativas`. Erro do trabalho vai ao log só com um id
 * (`erro_id`), sem e-mail nem mensagem do erro, e nunca rejeita.
 */
export function segundoPlanoAposResposta(envio: EnvioEmail | null): {
  opcoes: RouteShorthandOptions;
  responder(req: FastifyRequest, reply: FastifyReply, trabalho: TrabalhoEsqueci): FastifyReply;
} {
  const pendentes = new WeakMap<FastifyRequest, (executar: boolean) => void>();
  return {
    opcoes: {
      onResponse: async (req, reply) => {
        const soltar = pendentes.get(req);
        pendentes.delete(req);
        if (soltar) setImmediate(soltar, reply.statusCode === 202);
      },
    },
    responder(req, reply, trabalho) {
      let soltar!: (executar: boolean) => void;
      const solto = new Promise<boolean>((r) => (soltar = r));
      const feito = solto
        .then((executar) => (executar ? trabalho() : null))
        .then(
          (m) => (envio && m ? enviarComTentativas(envio, m, { log: req.log }) : undefined),
          () => logSemFalhar(req.log, 'error', { evento: 'esqueci.falha', erro_id: randomUUID() }, 'pedido de senha temporária não concluído'),
        )
        .finally(() => emAndamento.delete(feito));
      emAndamento.add(feito);
      pendentes.set(req, soltar);
      return reply.header('cache-control', 'no-store').status(202).send({ mensagem: MENSAGEM_ESQUECI_NEUTRA } satisfies PedidoSenhaTemporariaResposta);
    },
  };
}
