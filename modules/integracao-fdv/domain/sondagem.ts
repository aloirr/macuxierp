/** Sondagem periódica da credencial recusada (decisão 25 B): só o sinal chama o Hub, 1 vez a cada 30 min. Funções puras. */
export const INTERVALO_SONDAGEM_CREDENCIAL_S = 1800;

/** Pausas que a sondagem retoma sozinha; as demais continuam manuais. */
export const MOTIVOS_SONDAVEIS = ['credencial', 'licenca_fdv'] as const;

/** A pausa é de credencial/licença do FDV (a sondagem a retoma sozinha)? */
export function ehMotivoSondavel(motivo: string): boolean {
  return (MOTIVOS_SONDAVEIS as readonly string[]).includes(motivo);
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
