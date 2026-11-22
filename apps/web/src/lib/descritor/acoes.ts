/** Corpo e validação do diálogo de ação do detalhe (parte pura). A API revalida (RN-CORE-02). */
import type { AcaoVista } from './tipos';

/** Corpo da ação a partir do que a pessoa informou (puro, testado). */
export function corpoDaAcao(a: AcaoVista, motivo: string, texto: string): Record<string, string> | undefined {
  // O texto livre só segue no motivo que o exige ("outro"): nos demais o catálogo basta (e o texto não vai ao histórico).
  if (a.entrada === 'motivo') return { [a.campoMotivo ?? 'motivo_codigo']: motivo, ...(a.motivos?.find((m) => m.codigo === motivo)?.exigeTexto && texto.trim() ? { [a.campoTexto ?? 'motivo_texto']: texto.trim() } : {}) };
  if (a.entrada === 'justificativa') return texto.trim() ? { [a.campoJustificativa ?? 'justificativa']: texto.trim() } : {};
  return undefined;
}

/** Erro de preenchimento do diálogo, ou "" quando pode enviar. */
export function erroDaAcao(a: AcaoVista, motivo: string, texto: string): string {
  if (a.entrada === 'motivo') {
    const m = a.motivos?.find((x) => x.codigo === motivo);
    if (!m) return 'Escolha o motivo.';
    if (m.exigeTexto && !texto.trim()) return 'Descreva o motivo (obrigatório em "outro").';
  }
  if (a.entrada === 'justificativa' && a.justificativaObrigatoria && !texto.trim()) return 'Informe a justificativa.';
  return '';
}
