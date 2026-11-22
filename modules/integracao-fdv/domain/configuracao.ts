/**
 * Regras da configuração do conector e das ações do BKO (RF-INF-05, RN-INF-02/04; T-0009 seção 6). Funções puras; a API
 * (`api/rotas.ts`) revalida e grava.
 */
import { violacao, type Violacao } from '@macuxierp/platform-sdk/erros';
import { ENTIDADES_HUB_F2, LIMITE_REGISTROS_LOTE, type AmbienteHub, type MotivoPausa } from '../contracts';

/** Textos da validação da configuração (RN-INF-02): a API e a web usam estes, sem cópia. */
export const MENSAGEM_LIMITE_LOTE = 'O limite por lote vai de 1 a 5.000 registros';
export const MENSAGEM_ENTIDADES_HABILITADAS = 'Escolha só cadastros da lista, sem repetir';

export interface IdentidadeCredencial {
  conector_id: string;
  ambiente: AmbienteHub;
}

export interface PlanoTroca {
  /** Não havia credencial ativa neste tenant. */
  primeira: boolean;
  /** Outro conector ou outro ambiente é outro tenant do FDV: o espelho esquece o que o Hub confirmou. */
  zerarEspelho: boolean;
  /** Publica `integracao-fdv.carga_inicial.solicitada@1` (C-4). */
  pedirCargaInicial: boolean;
}

/** Troca só da chave (mesmo `conector_id` e ambiente) não mexe no espelho nem pede carga: o FDV é o mesmo. */
export function planejarTrocaCredencial(anterior: IdentidadeCredencial | null, nova: IdentidadeCredencial): PlanoTroca {
  if (!anterior) return { primeira: true, zerarEspelho: false, pedirCargaInicial: true };
  const mudou = anterior.conector_id !== nova.conector_id || anterior.ambiente !== nova.ambiente;
  return { primeira: false, zerarEspelho: mudou, pedirCargaInicial: mudou };
}

export interface ConfiguracaoEnvio {
  entidades_habilitadas: readonly string[];
  limite_registros_lote: number;
}

/** Entidades habilitáveis: as da F2 (título e nota entram na F4), sem repetição; limite de 1 a 5.000 registros por lote. */
export function validarConfiguracao(c: ConfiguracaoEnvio): Violacao[] {
  const v: Violacao[] = [];
  const validas = new Set<string>(ENTIDADES_HUB_F2);
  if (new Set(c.entidades_habilitadas).size !== c.entidades_habilitadas.length || c.entidades_habilitadas.some((e) => !validas.has(e))) {
    v.push(violacao('RN-INF-02', 'entidades_habilitadas', MENSAGEM_ENTIDADES_HABILITADAS));
  }
  if (!Number.isInteger(c.limite_registros_lote) || c.limite_registros_lote < 1 || c.limite_registros_lote > LIMITE_REGISTROS_LOTE) {
    v.push(violacao('RN-INF-02', 'limite_registros_lote', MENSAGEM_LIMITE_LOTE));
  }
  return v;
}

export type DecisaoCargaCompleta = { ok: true } | { ok: false; codigo: 'entidade_desabilitada' | 'lote_em_voo'; mensagem: string };

/** Carga completa recomeça a sessão da entidade: só se ela está habilitada e sem lote em voo (a sessão não troca no meio de um lote). */
export function decidirCargaCompleta(e: { habilitada: boolean; loteEmVoo: boolean }): DecisaoCargaCompleta {
  if (!e.habilitada) return { ok: false, codigo: 'entidade_desabilitada', mensagem: 'Habilite a entidade antes de pedir a carga completa' };
  if (e.loteEmVoo) return { ok: false, codigo: 'lote_em_voo', mensagem: 'Já há um envio desta entidade em andamento. Espere terminar e tente de novo' };
  return { ok: true };
}

export type DecisaoRetomar = { acao: 'retomar' } | { acao: 'nada' };

/** "Tentar de novo": limpa a pausa e antecipa o envio; sem pausa não há o que fazer (idempotente). */
export function decidirRetomar(motivo: MotivoPausa | null): DecisaoRetomar {
  return motivo ? { acao: 'retomar' } : { acao: 'nada' };
}
