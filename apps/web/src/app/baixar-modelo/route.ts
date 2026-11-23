import type { NextRequest } from 'next/server';
import { modeloPermitido } from '@/lib/carga-entidade';
import { proxyDeDownload } from '@/lib/proxy-download';

/** Proxy de download do modelo CSV da carga (T-0051): só `/v1/cadastros/cargas/modelos/<entidade da lista>`. */
export async function GET(req: NextRequest) {
  const caminho = req.nextUrl.searchParams.get('caminho') ?? '';
  return proxyDeDownload({ permitido: modeloPermitido(caminho), caminho, modulo: 'cadastros', acao: 'cadastros.carga.executar', mensagens: { 403: 'Seu perfil não pode baixar este modelo.' } });
}
