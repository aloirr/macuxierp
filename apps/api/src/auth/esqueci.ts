/**
 * Peças comuns das rotas do "Esqueci a senha" (T-0076): `POST /v1/auth/esqueci` (tenant e MACUXI) e
 * `POST /v1/plataforma/auth/esqueci` (portal `/config`).
 * - Ordem: limite por IP (429, só anti-spam; sem limite por conta desde o hotfix v0.3.16.1) → corpo (400) → banco e argon2 → 202 neutro → e-mail, só depois
 *   da resposta (hook `onResponse` da rota + `agendarEnvioEmail`). O 429 é igual para conta que existe ou não.
 * - Os limites são os mesmos objetos nas duas rotas (um por processo): o MACUXI da tela única e o `/config` somam juntos.
 * - As rotas ficam sempre montadas. Sem a porta de e-mail (`envio: null`), o pedido segue a mesma ordem até o limite por
 *   IP e responde o mesmo 202 neutro, com o mesmo custo de argon2 (`esqueciSemEnvio` dos serviços, que chama
 *   `custoTemporariaDescartada`), sem tocar o banco, sem gravar temporária e sem enviar nada; a situação diz
 *   `esqueci_disponivel: false` e a web oculta o link.
 * - Banco: empresa suspensa ou inexistente, e-mail inexistente ou conta inativa = nada gravado e nada enviado; senão grava
 *   só o hash (72 h, substitui o anterior) e a auditoria na mesma transação, e devolve a mensagem de e-mail.
 * - Sem envio, o motivo vai ao log com um código fixo (`esqueci-log.ts`); com envio, o `agendarEnvioEmail` loga o aceite
 *   ("email.enviado") ou a falha ("email.falha").
 * - Nem o e-mail, nem a empresa, nem a temporária, nem o IP vão para log.
 */
import { erros, MENSAGEM_ESQUECI_NEUTRA, textoMuitasTentativas, type ErroApi, type PedidoSenhaTemporariaResposta } from '@macuxierp/platform-sdk';
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { agendarEnvioEmail } from '../email/envio-apos-resposta';
import type { EnvioEmail, MensagemEmail } from '../email/porta';
import type { LimitesEsqueci } from '../plataforma/limite-ip';

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

/**
 * Envio depois da resposta: a rota guarda a mensagem no pedido (`guardar`) e o `onResponse` (resposta já enviada) chama
 * `agendarEnvioEmail` (2 tentativas, falha só com `warn` sem dado pessoal). Sem mensagem (conta inexistente, inativa ou de empresa suspensa), nada sai.
 */
export function envioAposResposta(envio: EnvioEmail | null): {
  opcoes: RouteShorthandOptions;
  responder(req: FastifyRequest, reply: FastifyReply, mensagem: MensagemEmail | null): FastifyReply;
} {
  const pendentes = new WeakMap<FastifyRequest, MensagemEmail>();
  return {
    opcoes: {
      onResponse: async (req, reply) => {
        const m = pendentes.get(req);
        pendentes.delete(req);
        if (envio && m && reply.statusCode === 202) agendarEnvioEmail(envio, m, { log: req.log });
      },
    },
    responder(req, reply, mensagem) {
      if (envio && mensagem) pendentes.set(req, mensagem);
      return reply.header('cache-control', 'no-store').status(202).send({ mensagem: MENSAGEM_ESQUECI_NEUTRA } satisfies PedidoSenhaTemporariaResposta);
    },
  };
}
