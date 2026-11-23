import type { ZodError } from 'zod';

/** Texto de erro por campo da criação de empresa (spec do portal, tela 3), a partir do que o contrato recusou. */
export function traduzirCriarEmpresa(e: ZodError): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const i of e.issues) {
    const campo = String(i.path[0] ?? '');
    if (campos[campo]) continue;
    if (campo === 'slug') campos.slug = i.message === 'Slug reservado' ? 'Código reservado. Escolha outro.' : 'Código fora do padrão. Veja a regra acima.';
    else if (campo === 'nome') campos.nome = 'Informe o nome da empresa (2 a 120 caracteres).';
    else if (campo === 'fuso') campos.fuso = 'Fuso inválido. Use o formato America/Manaus.';
  }
  return campos;
}

export const MOTIVO_INVALIDO = 'Informe o motivo (3 a 200 caracteres).';

/** Motivo da suspensão ou reativação (3 a 200 caracteres, como `SituacaoEmpresaEntrada`). */
export function validarMotivo(texto: string): string | null {
  const n = texto.trim().length;
  return n >= 3 && n <= 200 ? null : MOTIVO_INVALIDO;
}
