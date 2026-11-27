import type { NextRequest } from 'next/server';
import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { caminhoDoLogCsv } from '@macuxierp/integracao-fdv/web';
import { DOWNLOAD_FDV, proxyDeDownload } from '@/lib/proxy-download';

/** Proxy do "Baixar erros (.csv)" do Log da Integração FDV: só as entidades conhecidas; o caminho vem do módulo. */
export async function GET(req: NextRequest) {
  const entidade = ENTIDADES_ENVIO_FDV.find((e) => e === req.nextUrl.searchParams.get('entidade'));
  return proxyDeDownload({ ...DOWNLOAD_FDV, permitido: entidade !== undefined, caminho: entidade ? caminhoDoLogCsv(entidade) : '' });
}
