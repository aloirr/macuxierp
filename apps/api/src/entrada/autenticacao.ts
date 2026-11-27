/**
 * Autenticação de máquina da `/entrada/v1` (T-0057 E2, ADR 0014 §3 e §4): `Authorization: Bearer <chave>` e
 * `X-Macuxi-Conector-Id`, sem JWT nem sessão. O banco guarda só o HMAC-SHA256(pepper, chave); a conferência é por
 * `timingSafeEqual`, com o mesmo custo exista o conector ou não. Sem o pepper no servidor, tudo responde 503.
 * Nada aqui vai a log: nem a chave, nem o HMAC, nem o `conector_id` errado.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CABECALHO_CONECTOR_ID_ENTRADA,
  ChaveEntrada,
  ConectorIdEntrada,
  erros,
  PADRAO_HEX_32,
  type Banco,
  type ConectorAutenticado,
  type PortaCredencialEntrada,
} from '@macuxierp/platform-sdk';
import { LimitePorChave } from '../plataforma/limite-ip';

/** Variável do pepper (ADR 0014 §11): 32 bytes em hex (64 caracteres), gerada uma vez no servidor. */
export const VARIAVEL_PEPPER_ENTRADA = 'MACUXIERP_PEPPER_ENTRADA';

/** O pepper do ambiente, ou `null` (ausente ou fora do formato: a entrada fica 503, nunca aberta). */
export function lerPepperEntrada(env: Readonly<Record<string, string | undefined>>): Buffer | null {
  const v = env[VARIAVEL_PEPPER_ENTRADA]?.trim() ?? '';
  return PADRAO_HEX_32.test(v) ? Buffer.from(v, 'hex') : null;
}

/** HMAC-SHA256(pepper, chave) em hex minúsculo: o que o banco guarda e o que a autenticação compara. */
export function hmacChaveEntrada(pepper: Buffer, chave: string): string {
  return createHmac('sha256', pepper).update(chave, 'utf8').digest('hex');
}

/** Tentativas falhas por IP e conector (molde da §6 da ADR 0012): 20 por 15 min. */
export const LIMITE_FALHAS_ENTRADA = { maximo: 20, janelaMs: 15 * 60_000 } as const;

const HMAC_FALSO = '0'.repeat(64);

export class AutenticadorEntrada {
  constructor(
    private readonly banco: Banco,
    private readonly porta: PortaCredencialEntrada,
    private readonly pepper: Buffer | null,
    private readonly limite = new LimitePorChave(LIMITE_FALHAS_ENTRADA.maximo, LIMITE_FALHAS_ENTRADA.janelaMs),
  ) {}

  /**
   * Confere os cabeçalhos; devolve o conector ou lança 503 (sem pepper), 429 (limite) ou 401 (o mesmo corpo para chave
   * errada, conector inexistente, revogado, JWT do BKO ou cabeçalho fora do formato).
   */
  async autenticar(cabecalhos: Readonly<Record<string, string | string[] | undefined>>, ip: string, agoraMs: number): Promise<ConectorAutenticado> {
    if (!this.pepper) throw erros.indisponivel('Entrada de dados');
    const bruto = cabecalhos[CABECALHO_CONECTOR_ID_ENTRADA];
    const conectorId = typeof bruto === 'string' ? bruto : '';
    const chaveLimite = `${ip}\u0000${conectorId.slice(0, 100)}`;
    const limite = this.limite.excedido(chaveLimite, agoraMs);
    if (!limite.permitido) throw erros.muitasTentativas('Muitas tentativas de autenticação; tente mais tarde.', limite.retry_after_s);

    const auth = cabecalhos.authorization;
    const chave = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const formatoOk = ConectorIdEntrada.safeParse(conectorId).success && ChaveEntrada.safeParse(chave).success;
    const guardada = formatoOk ? await this.banco.semTenant((tx) => this.porta.buscar(tx, conectorId)) : null;
    // Mesmo custo em todo caminho: um HMAC e um timingSafeEqual, mesmo sem credencial.
    const recebido = Buffer.from(hmacChaveEntrada(this.pepper, chave), 'hex');
    const esperado = Buffer.from(guardada && /^[0-9a-f]{64}$/.test(guardada.chave_hmac) ? guardada.chave_hmac : HMAC_FALSO, 'hex');
    const confere = timingSafeEqual(recebido, esperado) && guardada !== null;
    if (!confere) {
      this.limite.registrar(chaveLimite, agoraMs);
      throw erros.naoAutenticado('Credencial de conector inválida');
    }
    return { tenant_id: guardada.tenant_id, credencial_id: guardada.credencial_id, conector_id: conectorId };
  }
}
