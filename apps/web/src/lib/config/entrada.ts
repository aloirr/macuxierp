import { ConectorIdEntrada, type PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import type { Resultado } from './executar';
import { maisRecentePor } from './ligacoes';
import { ERRO_CODIGO_REGRA, ERRO_CODIGO_VAZIO, ERRO_GERAR_INCERTO, ROTULOS_ENTRADA } from './entrada-textos';

/**
 * Ligação "Sistema do cliente → ERP" do /config (v0.3.24; T-0057 A1, ADR 0014 §3): funções puras do estado, dos textos e do fluxo do diálogo da
 * chave. A chave só existe no estado do diálogo (`EstadoChave`): sem URL, armazenamento nem log.
 */

type ResultadoCodigo = { ok: true; valor: string } | { ok: false; erro: string };

/** Valida o código do conector com o mesmo schema do SDK (`ConectorIdEntrada`) e a mensagem fixa do desenho. */
export function validarConectorId(texto: string): ResultadoCodigo {
  const t = texto.trim();
  if (t === '') return { ok: false, erro: ERRO_CODIGO_VAZIO };
  const r = ConectorIdEntrada.safeParse(t);
  return r.success ? { ok: true, valor: r.data } : { ok: false, erro: ERRO_CODIGO_REGRA };
}

/** Código para o campo "Código" (só sem chave viva): o da última credencial, mesmo revogada, para a pessoa não redigitar. */
export function codigoSugerido(l: PortalEntradaLeitura | null): string {
  return maisRecentePor(l?.credenciais ?? [], 'criada_em')?.conector_id ?? '';
}

/** "Gerar chave" sem chave (sem confirmação) e "Trocar chave" com chave (com confirmação). Depois de falha incerta, volta a "Gerar chave". */
export function botaoDaChave(temChave: boolean, aposFalhaIncerta: boolean): { rotulo: string; pedeConfirmacao: boolean } {
  const trocar = temChave && !aposFalhaIncerta;
  return { rotulo: trocar ? ROTULOS_ENTRADA.trocar : ROTULOS_ENTRADA.gerar, pedeConfirmacao: trocar };
}

/** A geração não é idempotente: só a falha de rede (texto incerto) deixa dúvida sobre qual chave vale. */
export const ehGeracaoIncerta = (r: Resultado<unknown>): boolean => !r.ok && r.erro === ERRO_GERAR_INCERTO;

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
