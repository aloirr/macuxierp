/** Fusos do Brasil oferecidos ao criar empresa (o SDK não tem lista). O padrão é FUSO_PADRAO do SDK (America/Manaus).
 *  O rótulo segue o FDV, "Cidade (UTC−4)", com o sinal de menos tipográfico; o ID IANA fica só no value.
 *  O Brasil não tem horário de verão hoje, então o offset é fixo. Ordem: offset (mais a leste primeiro) e depois cidade. */
export const FUSOS_BRASIL_LISTA = [
  { id: 'America/Noronha', cidade: 'Fernando de Noronha', horas: -2 },
  { id: 'America/Araguaina', cidade: 'Araguaína', horas: -3 },
  { id: 'America/Bahia', cidade: 'Salvador', horas: -3 },
  { id: 'America/Belem', cidade: 'Belém', horas: -3 },
  { id: 'America/Fortaleza', cidade: 'Fortaleza', horas: -3 },
  { id: 'America/Maceio', cidade: 'Maceió', horas: -3 },
  { id: 'America/Recife', cidade: 'Recife', horas: -3 },
  { id: 'America/Santarem', cidade: 'Santarém', horas: -3 },
  { id: 'America/Sao_Paulo', cidade: 'São Paulo', horas: -3 },
  { id: 'America/Boa_Vista', cidade: 'Boa Vista', horas: -4 },
  { id: 'America/Campo_Grande', cidade: 'Campo Grande', horas: -4 },
  { id: 'America/Cuiaba', cidade: 'Cuiabá', horas: -4 },
  { id: 'America/Manaus', cidade: 'Manaus', horas: -4 },
  { id: 'America/Porto_Velho', cidade: 'Porto Velho', horas: -4 },
  { id: 'America/Rio_Branco', cidade: 'Rio Branco', horas: -5 },
] as const;

export const FUSOS_BRASIL = FUSOS_BRASIL_LISTA.map((f) => f.id);

/** "Manaus (UTC−4)". */
export function rotuloFuso(f: { cidade: string; horas: number }): string {
  return `${f.cidade} (UTC${f.horas < 0 ? '−' : '+'}${Math.abs(f.horas)})`;
}
