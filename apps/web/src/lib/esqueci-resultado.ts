import { MENSAGEM_ESQUECI_NEUTRA, textoMuitasTentativas } from '@macuxierp/platform-sdk';
import { erroDaApi, type ErrosLogin } from './login-regras';

/** "Esqueci a senha" na tela única (RN-CORE-13). Pura: serve ao cliente (tipos e textos) e ao servidor (`interpretarEsqueci`). */
export const TEXTOS_ESQUECI = {
  /** Texto do link na tela de entrada. */
  titulo: 'Esqueci a senha',
  /** Título (h1) e rótulo do painel aberto (T-0111): "Recuperar a senha". */
  tituloPainel: 'Recuperar a senha',
  botao: 'Enviar senha temporária',
  voltar: 'Voltar para entrar',
  /** Confirmação neutra do 202 (ADR 0021): o texto do SDK, igual exista ou não a conta. */
  confirmacao: MENSAGEM_ESQUECI_NEUTRA,
  erroGenerico: 'Não foi possível enviar agora. Tente de novo.',
} as const;

export type CampoEsqueci = 'email';
export type DadosEsqueci = Partial<Record<CampoEsqueci, string>>;

export type ResultadoEsqueci =
  | { tipo: 'ok' }
  | { tipo: 'limite'; texto: string }
  | { tipo: 'campos'; erros: ErrosLogin }
  | { tipo: 'erro'; texto: string };

export type EnviarEsqueci = (dados: { email: string }) => Promise<ResultadoEsqueci>;

/** Status e corpo da API na resposta da tela: 202 neutro, 429 com `retry_after_s`, 400 VALIDACAO por campo. */
export function interpretarEsqueci(status: number, corpo: unknown): ResultadoEsqueci {
  if (status === 202) return { tipo: 'ok' };
  const f = erroDaApi(status, corpo);
  if (f?.tipo === 'limite') return { tipo: 'limite', texto: textoMuitasTentativas(f.retry_after_s) };
  if (f) return f;
  return { tipo: 'erro', texto: TEXTOS_ESQUECI.erroGenerico };
}
