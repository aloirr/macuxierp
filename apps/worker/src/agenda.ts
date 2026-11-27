/**
 * Laço de agenda do worker (contrato C-9; desenho T-0009 §6.1). Para cada agenda registrada:
 * 1. reserva os itens vencidos em `banco.semTenant` (papel `macuxierp_worker`, política `worker_global`); a própria
 *    reserva adia o `proximo*_em` até `agora + POSSE_AGENDA_MS` e a transação termina aqui;
 * 2. para cada item, confere a licença do módulo em `banco.comTenant(item.tenant_id)`; sem licença, `semLicenca` pausa
 *    o item na mesma transação;
 * 3. com licença, `executar` roda fora de transação (a chamada ao Hub não segura transação), com `ctx.emTransacao` no
 *    tenant do item, o `posseAte` da reserva e o `decifrarCredencial` (chave mestra do worker; o claro nunca vai ao log);
 * 4. a cada item, com `agora >= posseAte - MARGEM_POSSE_AGENDA_MS`, para o lote: os restantes voltam pela posse.
 * Erro num item ou numa agenda só vai ao log (nome do erro, sem mensagem: pode citar dado pessoal) e não derruba o laço;
 * a posse vence sozinha e o item volta numa próxima reserva.
 */
import { MARGEM_POSSE_AGENDA_MS, moduloLicenciado, POSSE_AGENDA_MS, type AgendaModulo, type Banco, type ClienteHub, type ContextoAgenda, type FonteLicencas, type ItemAgenda, type Relogio } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro } from './backoff';

export interface DependenciasAgendas {
  banco: Banco;
  licencas: FonteLicencas;
  hub: ClienteHub;
  /** Abre a chave do conector (`credencial.ts`); o resultado nunca vai ao log. */
  decifrarCredencial: ContextoAgenda['decifrarCredencial'];
  relogio: Relogio;
  log: Logger;
  /** Itens por agenda e por rodada (padrão 10). */
  lote?: number;
}

export interface ResumoAgendas {
  executados: number;
  falhas: number;
  semLicenca: number;
}

const LOTE_AGENDA_PADRAO = 10;

export function resumoAgendasVazio(): ResumoAgendas {
  return { executados: 0, falhas: 0, semLicenca: 0 };
}

export async function rodarAgendas(agendas: readonly AgendaModulo[], d: DependenciasAgendas): Promise<ResumoAgendas> {
  const resumo = resumoAgendasVazio();
  for (const agenda of agendas) {
    let itens: ItemAgenda[];
    let posseAte: Date;
    try {
      const agora = d.relogio.agora();
      posseAte = new Date(agora.getTime() + POSSE_AGENDA_MS);
      const ate = posseAte;
      itens = await d.banco.semTenant((tx) => agenda.reservar(tx, d.lote ?? LOTE_AGENDA_PADRAO, agora, ate));
    } catch (e) {
      d.log.error({ agenda: agenda.id, erro: nomeDoErro(e) }, 'reserva da agenda falhou');
      continue;
    }
    const limite = posseAte.getTime() - MARGEM_POSSE_AGENDA_MS;
    for (const [i, item] of itens.entries()) {
      if (d.relogio.agora().getTime() >= limite) {
        d.log.warn({ agenda: agenda.id, devolvidos: itens.length - i }, 'posse da agenda no fim: itens restantes voltam pela posse');
        break;
      }
      try {
        const licenciado = await d.banco.comTenant(item.tenant_id, async (tx) => {
          const agora = d.relogio.agora();
          if (moduloLicenciado(await d.licencas.ler(tx, item.tenant_id), agenda.modulo, agora)) return true;
          await agenda.semLicenca(item, tx, agora);
          return false;
        });
        if (!licenciado) {
          resumo.semLicenca++;
          continue;
        }
        await agenda.executar(item, {
          agora: d.relogio.agora(),
          posseAte,
          hub: d.hub,
          decifrarCredencial: d.decifrarCredencial,
          emTransacao: (fn) => d.banco.comTenant(item.tenant_id, fn),
          log: d.log.child({ agenda: agenda.id, tarefa: item.tarefa, tenant_id: item.tenant_id }),
        });
        resumo.executados++;
      } catch (e) {
        resumo.falhas++;
        d.log.warn({ agenda: agenda.id, tarefa: item.tarefa, tenant_id: item.tenant_id, erro: nomeDoErro(e) }, 'item da agenda falhou');
      }
    }
  }
  return resumo;
}
