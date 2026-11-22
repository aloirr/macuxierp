/**
 * Corpo `multipart/form-data` para `app.inject` (POST /v1/core/certificados é multipart desde o #42, T-0040):
 * campos de texto em `campos`; arquivos em `arquivos` (campo → bytes). Nada vai ao disco.
 */
export const LIMITE_MULTIPART = 'limite-de-teste-t0008';

export function formulario(campos: Record<string, string>, arquivos: Record<string, Buffer> = {}) {
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) partes.push(Buffer.from(`--${LIMITE_MULTIPART}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const [k, v] of Object.entries(arquivos)) {
    partes.push(Buffer.from(`--${LIMITE_MULTIPART}\r\nContent-Disposition: form-data; name="${k}"; filename="a1-ficticio.pfx"\r\nContent-Type: application/x-pkcs12\r\n\r\n`), v, Buffer.from('\r\n'));
  }
  partes.push(Buffer.from(`--${LIMITE_MULTIPART}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${LIMITE_MULTIPART}` } };
}
