import type { NextRequest } from 'next/server';
import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { caminhoDoLogCsv } from '@macuxierp/integracao-fdv/web';
import { proxyDeDownload } from '@/lib/proxy-download';

/** Proxy do "Baixar erros (.csv)" do Log da Integração FDV: só as entidades conhecidas; o caminho vem do módulo. */
export async function GET(req: NextRequest) {
  const entidade = ENTIDADES_ENVIO_FDV.find((e) => e === req.nextUrl.searchParams.get('entidade'));
  return proxyDeDownload({
    permitido: entidade !== undefined,
    caminho: entidade ? caminhoDoLogCsv(entidade) : '',
    modulo: 'integracao-fdv',
    acao: 'integracao-fdv.ver',
    mensagens: { 403: 'Seu perfil não pode baixar este arquivo.', 404: 'Arquivo não disponível.' },
  });
}
