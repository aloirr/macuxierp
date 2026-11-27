import { ConectorIdEntrada, type LoteEntradaResumo, type PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { ROTULO_ENTIDADE } from '@macuxierp/integracao-fdv/web';
import type { Resultado } from './executar';
import { ERRO_CODIGO_REGRA, ERRO_CODIGO_VAZIO, ERRO_GERAR_INCERTO } from './entrada-textos';
import type { Tom } from './operacao-fdv';

/**
 * Bloco "Integração via API" do /config (T-0057 A1, ADR 0014 §3): funções puras do estado, dos textos e do fluxo do diálogo da
 * chave. A chave só existe no estado do diálogo (`EstadoChave`): sem URL, armazenamento nem log.
 */

export type ResultadoCodigo = { ok: true; valor: string } | { ok: false; erro: string };

/** Valida o código do conector com o mesmo schema do SDK (`ConectorIdEntrada`) e a mensagem fixa do desenho. */
export function validarConectorId(texto: string): ResultadoCodigo {
  const t = texto.trim();
  if (t === '') return { ok: false, erro: ERRO_CODIGO_VAZIO };
  const r = ConectorIdEntrada.safeParse(t);
  return r.success ? { ok: true, valor: r.data } : { ok: false, erro: ERRO_CODIGO_REGRA };
}

const FUSO_MANAUS = 'America/Manaus';
/** Data e hora no fuso do tenant; "(Manaus)" só quando o fuso é Manaus (README A). */
export const dataHoraTenant = (iso: string, fuso: string): string => `${formatarDataHora(iso, fuso)}${fuso === FUSO_MANAUS ? ' (Manaus)' : ''}`;

export interface FichaChave {
  conectorId: string;
  /** 8 caracteres e "…" (nunca a chave inteira). */
  prefixo: string;
  versao: string;
  ultimoSinal: string;
  criadaEm: string;
}
export interface VistaEntrada {
  /** A credencial não revogada mais recente; `null` quando não há chave. */
  vigente: FichaChave | null;
  /** Código para o campo: o da chave vigente ou, sem ela, o da última credencial (revogada). */
  codigoSugerido: string;
  lotes: LinhaLote[];
}

const maisRecenteCriada = (a: PortalEntradaLeitura['credenciais'][number], b: PortalEntradaLeitura['credenciais'][number]) => (a.criada_em >= b.criada_em ? a : b);

export function vistaEntrada(l: PortalEntradaLeitura | null, fuso: string): VistaEntrada {
  if (!l) return { vigente: null, codigoSugerido: '', lotes: [] };
  const vivas = l.credenciais.filter((c) => c.revogada_em === null);
  const c = vivas.length > 0 ? vivas.reduce(maisRecenteCriada) : null;
  const ultima = l.credenciais.length > 0 ? l.credenciais.reduce(maisRecenteCriada) : null;
  const sinal = c && l.ultimo_sinal && l.ultimo_sinal.conector_id === c.conector_id ? l.ultimo_sinal : null;
  return {
    vigente: c && {
      conectorId: c.conector_id,
      prefixo: `${c.prefixo}…`,
      versao: sinal?.versao_conector ?? '—',
      ultimoSinal: sinal ? dataHoraTenant(sinal.em, fuso) : 'ainda sem sinal',
      criadaEm: dataHoraTenant(c.criada_em, fuso),
    },
    codigoSugerido: (c ?? ultima)?.conector_id ?? '',
    lotes: linhasLotes(l.lotes, fuso),
  };
}

/** "Gerar chave" sem chave (sem confirmação) e "Trocar chave" com chave (com confirmação). Depois de falha incerta, volta a "Gerar chave". */
export function botaoDaChave(temChave: boolean, aposFalhaIncerta: boolean): { rotulo: 'Gerar chave' | 'Trocar chave'; pedeConfirmacao: boolean } {
  const trocar = temChave && !aposFalhaIncerta;
  return { rotulo: trocar ? 'Trocar chave' : 'Gerar chave', pedeConfirmacao: trocar };
}

/** A geração não é idempotente: só a falha de rede (texto incerto) deixa dúvida sobre qual chave vale. */
export const ehGeracaoIncerta = (r: Resultado<unknown>): boolean => !r.ok && r.erro === ERRO_GERAR_INCERTO;

export interface LinhaLote {
  id: string;
  cadastro: string;
  recebidoEm: string;
  recebidos: number;
  comErro: number;
  situacao: { texto: string; tom: Tom };
}

const SITUACAO_LOTE: Record<LoteEntradaResumo['status'], { texto: string; tom: Tom }> = {
  recebido: { texto: 'Recebido', tom: 'neutro' },
  processando: { texto: 'Em processamento', tom: 'neutro' },
  concluido: { texto: 'Concluído', tom: 'sucesso' },
  concluido_com_erros: { texto: 'Concluído com erros', tom: 'aviso' },
  falhou: { texto: 'Falhou', tom: 'erro' },
};

/** Só contagens e datas: o contrato nunca traz o dado do lote. A API já ordena do mais recente para o mais antigo. */
export const linhasLotes = (lotes: readonly LoteEntradaResumo[], fuso: string): LinhaLote[] =>
  lotes.map((l) => ({ id: l.lote_id, cadastro: ROTULO_ENTIDADE[l.entidade], recebidoEm: dataHoraTenant(l.recebido_em, fuso), recebidos: l.recebidos, comErro: l.com_erro, situacao: SITUACAO_LOTE[l.status] }));

/** Estado do diálogo da chave mostrada uma vez (README B). `chave` é a única cópia no navegador; `null` = diálogo fechado. */
export interface EstadoChave {
  chave: string | null;
  /** `null`: ainda não usou Copiar; `falhou` não conta como copiada. */
  copiou: 'sim' | 'falhou' | null;
  confirmandoFechar: boolean;
}
export type AcaoChave =
  | { tipo: 'gerada'; chave: string }
  | { tipo: 'copiou'; ok: boolean }
  /** Esc, clique no fundo (mesmo `aoFechar`): fecha direto se já copiou; senão pede a confirmação. */
  | { tipo: 'fechar' }
  | { tipo: 'voltar' }
  | { tipo: 'descartar' }
  | { tipo: 'ja-copiei' };

export const estadoDaChave = (): EstadoChave => ({ chave: null, copiou: null, confirmandoFechar: false });
export const chaveNaoCopiada = (s: EstadoChave): boolean => s.chave !== null && s.copiou !== 'sim';

export function reduzirChave(s: EstadoChave, a: AcaoChave): EstadoChave {
  switch (a.tipo) {
    case 'gerada':
      return { chave: a.chave, copiou: null, confirmandoFechar: false };
    case 'copiou':
      return { ...s, copiou: a.ok ? 'sim' : 'falhou' };
    case 'fechar':
      return chaveNaoCopiada(s) ? { ...s, confirmandoFechar: true } : estadoDaChave();
    case 'voltar':
      return { ...s, confirmandoFechar: false };
    case 'descartar':
    case 'ja-copiei':
      return estadoDaChave();
  }
}
