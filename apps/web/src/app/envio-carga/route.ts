import { cookies } from 'next/headers';
import { PAGINA_CARGA } from '@macuxierp/cadastros/web';
import { enviarCarga, NaoAutenticado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { COOKIE_ACESSO } from '@/lib/sessao';
import { CARGA_GRANDE_DEMAIS, SESSAO_EXPIRADA } from '@/lib/textos';

/** Folga do multipart (fronteiras e cabeçalhos das partes) acima do total de bytes dos arquivos. */
export const FOLGA_MULTIPART = 64 * 1024;
const LIMITE = PAGINA_CARGA.maxBytes + FOLGA_MULTIPART;

function origemPermitida(req: Request): boolean {
  const origem = req.headers.get('origin');
  if (!origem) return true;
  try {
    // Atrás do túnel o Host é o interno; o público vem em x-forwarded-host (só o 1º valor). Sem ele, vale o Host. A Origin tem de bater com UM só: o público.
    const encaminhado = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    return new URL(origem).host === (encaminhado || req.headers.get('host'));
  } catch {
    return false; // "null" ou inválida
  }
}

/** Lê o corpo em stream e corta ao passar do limite (o content-length pode mentir). Null se passou. */
async function lerComCorte(req: Request): Promise<FormData | null> {
  if (!req.body) return null;
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return new Response(new Blob(partes as BlobPart[]), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
}

/** Ponte do navegador para `POST /v1/cadastros/cargas`: o token de acesso é httpOnly, então o envio passa pelo servidor do shell. */
export async function POST(req: Request) {
  if (!origemPermitida(req)) return Response.json({ ok: false, erro: 'Origem não permitida.' }, { status: 403 });
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return Response.json({ ok: false, erro: SESSAO_EXPIRADA }, { status: 401 });
  const tamanho = Number(req.headers.get('content-length'));
  if (!req.headers.get('content-length') || !Number.isFinite(tamanho) || tamanho > LIMITE) {
    return Response.json({ ok: false, erro: CARGA_GRANDE_DEMAIS }, { status: 413 });
  }
  try {
    const formulario = await lerComCorte(req).catch(() => undefined);
    if (formulario === null) return Response.json({ ok: false, erro: CARGA_GRANDE_DEMAIS }, { status: 413 });
    if (!formulario) return Response.json({ ok: false, erro: 'Envio inválido: confira os arquivos e o modo.' }, { status: 400 });
    const r = await enviarCarga(acesso, formulario);
    return Response.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    if (e instanceof NaoAutenticado) return Response.json({ ok: false, erro: SESSAO_EXPIRADA }, { status: 401 });
    if (e instanceof TrocarSenhaPendente) return Response.json({ ok: false, erro: 'Troque a senha provisória antes de continuar.', redirecionar: ROTA_SENHA }, { status: 403 });
    return Response.json({ ok: false, erro: 'A API não respondeu. Tente de novo em instantes.' }, { status: 503 });
  }
}
