/**
 * Tela da bandeira por filial "faturamento real com NF-e simulada" (T-0088; RN-FAT-04). Só descreve e monta: a API revalida
 * (`PUT /filiais/:id/configuracao` só do administrador, com Idempotency-Key e auditoria). Não mexe no ambiente fiscal: a nota segue de homologação.
 */
import { type Perfil } from '@macuxierp/platform-sdk';
import { ConfigurarFilialEntrada, type ConfiguracaoFilialResposta } from '../contracts';
import { comChave, exigirChave, falha, seloDoAmbiente, textoDoAmbiente, urlDaConfiguracaoDaFilial, type Montagem, type Selo } from './notas';

/** O que a tela mostra por filial: a bandeira (selo), o ambiente (selo) e o botão. Quem vê a tela é `perfilVeFaturamento`. */
export interface SituacaoDaBandeira {
  selo: Selo;
  /** Homologação no tom alerta; produção em tom neutro. */
  ambiente: Selo;
  /** Só o administrador liga e desliga (liga quando desligada, desliga quando ligada); `null` = sem botão. */
  rotuloBotao: string | null;
}

export const ROTULO_BANDEIRA = 'Faturamento real com NF-e simulada';

export function situacaoDaBandeira(perfil: Perfil, c: Pick<ConfiguracaoFilialResposta, 'faturamento_real_nfe_simulada' | 'ambiente'>): SituacaoDaBandeira {
  const ligada = c.faturamento_real_nfe_simulada;
  return {
    selo: ligada ? { texto: 'Ligada', tom: 'ok' } : { texto: 'Desligada', tom: 'neutro' },
    ambiente: seloDoAmbiente(c.ambiente) ?? { texto: textoDoAmbiente(c.ambiente), tom: 'neutro' },
    rotuloBotao: perfil === 'administrador' ? (ligada ? 'Desligar' : 'Ligar') : null,
  };
}

/** Confirmação curta antes de ligar ou desligar: título com a filial, [Voltar] e [Ligar/Desligar]. */
export const dialogoDaBandeira = (ligar: boolean, filial: { nome?: string | null } = {}): { titulo: string; rotuloConfirmar: string; rotuloFechar: string; destrutivo: false } => ({
  titulo: `${ligar ? 'Ligar' : 'Desligar'} a bandeira${filial.nome ? `: ${filial.nome}` : ''}?`,
  rotuloConfirmar: ligar ? 'Ligar' : 'Desligar', rotuloFechar: 'Voltar', destrutivo: false,
});

/** PUT com a Idempotency-Key; a API revalida o perfil. */
export function requisicaoConfigurarBandeira(filialId: string, ligar: boolean, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const v = ConfigurarFilialEntrada.safeParse({ faturamento_real_nfe_simulada: ligar });
  if (!v.success) return falha('Confira a configuração.');
  return { ok: true, requisicao: { metodo: 'PUT', caminho: urlDaConfiguracaoDaFilial(filialId), cabecalhos: comChave(chave), corpo: v.data } };
}
