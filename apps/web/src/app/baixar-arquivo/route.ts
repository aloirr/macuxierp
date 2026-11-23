import type { NextRequest } from 'next/server';
import { arquivoPermitido } from '@/lib/arquivos';
import { proxyDeDownload } from '@/lib/proxy-download';

/** Proxy de download (XML e DANFE da nota): só caminhos da lista fechada em `lib/arquivos.ts`. */
export async function GET(req: NextRequest) {
  const caminho = req.nextUrl.searchParams.get('caminho') ?? '';
  return proxyDeDownload({
    permitido: arquivoPermitido(caminho), caminho, modulo: 'faturamento', acao: 'faturamento.nota.emitir',
    mensagens: { 403: 'Seu perfil não pode baixar este arquivo.', 404: 'Arquivo ainda não disponível para esta nota.' },
  });
}
