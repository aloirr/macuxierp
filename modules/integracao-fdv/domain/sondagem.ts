import { MOTIVOS_SONDAVEIS_FDV } from '@macuxierp/platform-sdk';
/** Sondagem periódica da credencial recusada (decisão 25 B): só o sinal chama o Hub, 1 vez a cada 30 min. Funções puras. */
export const INTERVALO_SONDAGEM_CREDENCIAL_S = 1800;

/** A pausa é de credencial/licença do FDV (lista `MOTIVOS_SONDAVEIS_FDV` do SDK; a sondagem a retoma sozinha, as demais continuam manuais)? */
export function ehMotivoSondavel(motivo: string): boolean {
  return (MOTIVOS_SONDAVEIS_FDV as readonly string[]).includes(motivo);
}

/** `pausadaEm` = a pausa mais antiga de credencial/licença do FDV do tenant (null = não há). */
export function deveSondarCredencial(pausadaEm: Date | null, agora: Date): boolean {
  return pausadaEm !== null && agora.getTime() - pausadaEm.getTime() >= INTERVALO_SONDAGEM_CREDENCIAL_S * 1000;
}

/** Próxima tentativa conforme o motivo da pausa: só credencial/licença do FDV tem sondagem; os demais motivos, null. */
export function proximaTentativaEm(motivo: string | null, pausadaEm: Date | string | null | undefined): Date | null {
  if (!motivo || !ehMotivoSondavel(motivo) || !pausadaEm) return null;
  return proximaSondagemCredencialEm(new Date(pausadaEm));
}

/** "Próxima tentativa em" do monitor: só para pausa sondável. */
export function proximaSondagemCredencialEm(pausadaEm: Date | null): Date | null {
  return pausadaEm ? new Date(pausadaEm.getTime() + INTERVALO_SONDAGEM_CREDENCIAL_S * 1000) : null;
}
