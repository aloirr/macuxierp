import { caminhoDoRecebidosCsv } from '@macuxierp/integracao-fdv/web';
import { DOWNLOAD_FDV, proxyDeDownload } from '@/lib/proxy-download';

/**
 * Proxy do "Baixar recebidos (.csv)" do Log da Integração FDV (decisão 21 A): o arquivo completo da API, até o teto dela;
 * quando corta, a última linha do próprio arquivo traz o aviso. O caminho vem do módulo; a API aplica perfil e licença.
 */
export async function GET() {
  return proxyDeDownload({ ...DOWNLOAD_FDV, permitido: true, caminho: caminhoDoRecebidosCsv() });
}
