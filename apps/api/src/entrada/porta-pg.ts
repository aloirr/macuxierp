/**
 * Porta da autenticação da `/entrada/v1` no PostgreSQL (T-0057 E3, B1): a `cadastros.entrada_autenticar` da 0071
 * (SECURITY DEFINER, só `macuxierp_app`) roda antes do tenant e devolve só tenant, credencial e o HMAC em hex.
 */
import type { CredencialEntradaArmazenada, PortaCredencialEntrada, Transacao } from '@macuxierp/platform-sdk';

export class PortaCredencialEntradaPg implements PortaCredencialEntrada {
  async buscar(tx: Transacao, conectorId: string): Promise<CredencialEntradaArmazenada | null> {
    const [linha] = await tx.consultar<CredencialEntradaArmazenada>(
      'SELECT tenant_id, credencial_id, chave_hmac FROM cadastros.entrada_autenticar($1)',
      [conectorId],
    );
    return linha ?? null;
  }
}
