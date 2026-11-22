/**
 * Implementação da porta pública `PortaA1` (contracts): "a filial tem A1 válido". Usada pelo cadastros (consulta de IE)
 * e pelo fiscal. Devolve só o veredito: nunca certificado, senha nem CNPJ. A regra é `avaliarA1Valido` (domain).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { Id, type A1ValidoDaFilial, type PortaA1 } from '../contracts';
import { avaliarA1Valido } from '../domain';
import type { RepositorioCore } from './portas';

export interface OpcoesPortaA1 {
  repo: RepositorioCore;
  /** Executa no tenant do chamador (transação com RLS). A plataforma liga isto ao contexto da requisição. */
  noTenant<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
  agora?: () => Date;
}

export function criarPortaA1(o: OpcoesPortaA1): PortaA1 {
  const agora = o.agora ?? (() => new Date());
  return {
    async a1ValidoDaFilial(filial_id: string): Promise<A1ValidoDaFilial> {
      const id = Id.parse(filial_id);
      return o.noTenant(async (tx) => {
        const [empresa, certs] = await Promise.all([o.repo.empresa(tx), o.repo.certificados(tx, id)]);
        const ativo = certs.find((c) => c.ativo) ?? null;
        return avaliarA1Valido(ativo ? { validoDe: ativo.valido_de, validoAte: ativo.valido_ate } : null, agora(), empresa?.fuso ?? 'America/Manaus');
      });
    },
  };
}
