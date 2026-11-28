/**
 * Vocabulário único da situação da licença por módulo (RN-CORE-02), para o BKO e o /config usarem os mesmos nomes:
 * "Ativa", "Inativa", "Vencida" (selo) e "Sem prazo" (validade em branco). Função pura; a API revalida a licença.
 */
import type { Licenca } from '../contracts';

export type SituacaoLicenca = 'ativa' | 'inativa' | 'vencida';

export const ROTULO_SITUACAO_LICENCA: Readonly<Record<SituacaoLicenca, string>> = { ativa: 'Ativa', inativa: 'Inativa', vencida: 'Vencida' };

/** Texto da validade quando `valido_ate` é nulo. */
export const TEXTO_SEM_PRAZO = 'Sem prazo';

export function situacaoDaLicenca(l: Pick<Licenca, 'ativo' | 'valido_ate'>, agora: Date): SituacaoLicenca {
  if (!l.ativo) return 'inativa';
  return l.valido_ate !== null && new Date(l.valido_ate).getTime() <= agora.getTime() ? 'vencida' : 'ativa';
}

export const tomDaLicenca = (s: SituacaoLicenca): 'ok' | 'alerta' | 'neutro' => (s === 'ativa' ? 'ok' : s === 'vencida' ? 'alerta' : 'neutro');
