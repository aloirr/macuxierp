/**
 * Plugin `/entrada/v1` (T-0057 E2, ADR 0014 §3): monta as rotas que o módulo dono declara (`RotaEntrada`), com a
 * autenticação de máquina antes de tudo, depois a licença do módulo no tenant da credencial (regra 6) e a transação
 * com o `app.tenant_id` (RLS). O JWT do BKO não vale aqui: a sessão de usuário é ignorada.
 */
import {
  moduloLicenciado,
  MODULO_ENTRADA,
  PREFIXO_ENTRADA,
  TAMANHO_MAXIMO_MULTIPART,
  erros,
  type Banco,
  type ContextoEntrada,
  type FilaDeTrabalhos,
  type FonteLicencas,
  type Relogio,
  type RotaEntrada,
} from '@macuxierp/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { enfileirarDoModulo, entradaDaChamada, responder } from '../execucao-rota';
import { ipDoCliente } from '../plataforma/ip-cliente';
import type { AutenticadorEntrada } from './autenticacao';

/** Teto do corpo do `POST /lotes` (5.000 registros do Hub). */
export const LIMITE_BYTES_LOTE_ENTRADA = TAMANHO_MAXIMO_MULTIPART;

export interface DependenciasEntrada {
  rotas: readonly RotaEntrada[];
  autenticador: AutenticadorEntrada;
}

export function montarEntrada(
  app: FastifyInstance,
  e: DependenciasEntrada,
  d: { banco: Banco; licencas: FonteLicencas; trabalhos: FilaDeTrabalhos; relogio: Relogio; segredoBff: string | null },
): void {
  for (const rota of e.rotas) {
    app.route({
      method: rota.metodo,
      url: `${PREFIXO_ENTRADA}${rota.caminho}`,
      bodyLimit: LIMITE_BYTES_LOTE_ENTRADA,
      handler: async (req, reply) => {
        req.log = reply.log = req.log.child({ modulo: MODULO_ENTRADA, entrada: true });
        const agora = d.relogio.agora();
        const conector = await e.autenticador.autenticar(req.headers, ipDoCliente(req, d.segredoBff), agora.getTime());
        req.log = reply.log = req.log.child({ tenant_id: conector.tenant_id, credencial_id: conector.credencial_id });
        const resposta = await d.banco.comTenant(conector.tenant_id, async (tx) => {
          if (!moduloLicenciado(await d.licencas.ler(tx, conector.tenant_id), MODULO_ENTRADA, agora)) throw erros.moduloInativo(MODULO_ENTRADA);
          const ctx: ContextoEntrada = {
            conector,
            tx,
            request_id: req.id,
            agora,
            enfileirar: enfileirarDoModulo(MODULO_ENTRADA, d.trabalhos, tx, conector.tenant_id),
          };
          return rota.executar(ctx, entradaDaChamada(req, rota));
        });
        return responder(reply, resposta, false);
      },
    });
  }
}
