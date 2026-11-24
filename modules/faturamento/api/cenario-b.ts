/**
 * Cenário B (ADR 0014 §13 e §15, T-0057): portas e serviços do faturamento para o Conector de mão dupla.
 * Só PORTAS e serviços sobre elas: as implementações SQL esperam a migração 0045 do banco-dados (nomes de tabela e colunas ainda não
 * definidos; nenhum nome é inventado aqui). Os testes usam dublês em memória.
 */
import { ErroApi, erros, type Transacao } from '@macuxierp/platform-sdk';
import type { NotaParaCliente } from '../contracts';
import { modoFaturamento, notaPodeDescer, type ModoFaturamento, type NotaParaDescer } from '../domain';
import type { Violacao } from '../domain';

/** Fila de notas autorizadas pendentes de descida (`GET /notas/pendentes` e `POST /notas/{chave}/retorno` da `/entrada/v1`). */
export interface FilaNotasParaDescer {
  /** Notas elegíveis na ordem de autorização, por cursor; já com a regra `notaPodeDescer` aplicada pelo serviço (a porta só lê). */
  pendentes(tx: Transacao, tenant_id: string, limite: number): Promise<NotaPendenteDeDescida[]>;
  /** Marca como desceu, idempotente pela chave de acesso: repetir o retorno não muda nada. `inexistente` = chave de outro tenant (RLS) ou sem nota. */
  marcarDescida(tx: Transacao, tenant_id: string, chave_acesso: string): Promise<'marcada' | 'repetida' | 'inexistente'>;
}

export interface NotaPendenteDeDescida {
  elegibilidade: NotaParaDescer;
  nota: NotaParaCliente;
}

/** Licença do módulo `faturamento` da empresa (RN-CORE-02); implementada pelo core. */
export interface LicencaFaturamento {
  ativa(tx: Transacao, tenant_id: string): Promise<boolean>;
}

export interface LogCenarioB {
  (e: { evento: string; pedido_id?: string; motivo?: string }): void;
}

/** Recusa de emissão com o faturamento desligado (§15: o ERP não numera nem emite nota nesse modo). 409 `FATURAMENTO_DESLIGADO`. */
export async function exigirFaturamentoLigado(licenca: LicencaFaturamento, tx: Transacao, tenant_id: string): Promise<void> {
  if (modoFaturamento(await licenca.ativa(tx, tenant_id)) === 'desligado') {
    throw new ErroApi(409, 'CONFLITO', 'Faturamento desligado para esta empresa: o ERP não emite nota; o cliente fatura no sistema dele.', undefined, { codigo: 'faturamento_desligado' });
  }
}

/** Notas que o Conector pode buscar: só as que passam em `notaPodeDescer`; o resto fica fora da lista (e registra o motivo no log, sem dado pessoal). */
export function criarServicoDescidaNotas(deps: { fila: FilaNotasParaDescer; licenca: LicencaFaturamento; log?: LogCenarioB }) {
  return {
    async listarPendentes(tx: Transacao, tenant_id: string, limite = 50): Promise<NotaParaCliente[]> {
      const modo: ModoFaturamento = modoFaturamento(await deps.licenca.ativa(tx, tenant_id));
      if (modo === 'desligado') return [];
      const saida: NotaParaCliente[] = [];
      for (const p of await deps.fila.pendentes(tx, tenant_id, limite)) {
        const v: Violacao[] = notaPodeDescer({ ...p.elegibilidade, faturamento: modo });
        if (v.length === 0) saida.push(p.nota);
        else deps.log?.({ evento: 'faturamento.nota.descida_recusada', pedido_id: p.nota.pedido_id, motivo: v.map((x) => x.rn).join(',') });
      }
      return saida;
    },
    /** Retorno do Conector: idempotente pela chave. Chave desconhecida = 404 (nunca revela nota de outro tenant). */
    async confirmarDescida(tx: Transacao, tenant_id: string, chave_acesso: string): Promise<'marcada' | 'repetida'> {
      const r = await deps.fila.marcarDescida(tx, tenant_id, chave_acesso);
      if (r === 'inexistente') throw erros.naoEncontrado('Nota');
      return r;
    },
  };
}
