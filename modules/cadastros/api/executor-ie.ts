/**
 * Executor do trabalho `cadastros.consultar_ie` (D5): o worker o registra e roda na transação do tenant. Consulta a SEFAZ
 * (Consulta Cadastro, com o A1 da filial) por uma porta que o core/fiscal fornece e grava o resultado em
 * `cadastros.consulta_externa`, de onde `GET /consultas/ie/:id` lê. Idempotente: rodar de novo regrava o mesmo resultado.
 */
import type { ExecutorTrabalho, Transacao } from '@macuxierp/platform-sdk';
import { TRABALHO_CONSULTAR_IE } from '../contracts';
import { expiraEm } from '../domain';
import type { Repositorios } from './portas';

export interface PortaConsultaCadastro {
  consultar(p: { tenant_id: string; filial_id: string; uf: string; documento: string }, tx: Transacao): Promise<{ situacao: string; ie: string | null }>;
}

export function criarExecutorConsultaIe(deps: {
  repositorios(tx: Transacao): Repositorios;
  sefaz: PortaConsultaCadastro;
  agora?: () => Date;
}): ExecutorTrabalho {
  return {
    tipo: TRABALHO_CONSULTAR_IE,
    async executar(trabalho, tx) {
      const { filial_id, uf, documento } = trabalho.payload as { filial_id: string; uf: string; documento: string };
      const r = await deps.sefaz.consultar({ tenant_id: trabalho.tenant_id, filial_id, uf, documento }, tx);
      const agora = (deps.agora ?? (() => new Date()))();
      await deps.repositorios(tx).consultaExterna.gravar({
        tipo: 'ie', chave: `${uf}:${documento}`, fonte: 'sefaz', consultado_em: agora, expira_em: expiraEm(agora), external_id: trabalho.id,
        resposta: { estado: 'concluida', resultado: { situacao: r.situacao, ie: r.ie } },
      });
      return { situacao: r.situacao };
    },
  };
}
