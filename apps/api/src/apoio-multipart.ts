/**
 * Corpo `multipart/form-data` para o `app.inject` dos testes (RD-0116, T-0042): helper único da API; o
 * `tests/apoio/multipart.ts` passa a reexportar este (recado ao testes). Campos de texto em `campos`; arquivos como mapa campo → bytes (um por
 * campo, `.pfx` fictício) ou como lista (vários no mesmo campo, com nome e tipo). Nada vai ao disco.
 */
export const LIMITE_MULTIPART = 'limite-de-teste-macuxierp';
/** Nome padrão do arquivo: os testes de log conferem que ele nunca aparece. */
export const NOME_ARQUIVO_PADRAO = 'a1-ficticio.pfx';
const TIPO_PADRAO = 'application/x-pkcs12';

export interface ArquivoMultipart {
  campo: string;
  conteudo: Buffer | string;
  /** Padrão `NOME_ARQUIVO_PADRAO`. */
  nome?: string;
  /** Padrão `application/x-pkcs12`. */
  tipo?: string;
}

export function formulario(
  campos: Record<string, string>,
  arquivos: Record<string, Buffer> | readonly ArquivoMultipart[] = {},
  limite: string = LIMITE_MULTIPART,
): { payload: Buffer; headers: { 'content-type': string } } {
  const lista: readonly ArquivoMultipart[] = Array.isArray(arquivos)
    ? (arquivos as readonly ArquivoMultipart[])
    : Object.entries(arquivos as Record<string, Buffer>).map(([campo, conteudo]) => ({ campo, conteudo }));
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const a of lista) {
    partes.push(
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${a.campo}"; filename="${a.nome ?? NOME_ARQUIVO_PADRAO}"\r\nContent-Type: ${a.tipo ?? TIPO_PADRAO}\r\n\r\n`),
      Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(a.conteudo),
      Buffer.from('\r\n'),
    );
  }
  partes.push(Buffer.from(`--${limite}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${limite}` } };
}
