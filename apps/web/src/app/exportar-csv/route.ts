import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { filtrosDaUrl, paraQuery } from '@macuxierp/platform-sdk/listas';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu, resolverPagina } from '@/lib/menu';
import { NaoAutenticado, baixarCsv } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';
import { redirecionar } from '@/lib/redirecionar';
import { telaDaRota } from '@/lib/telas';
import { filtrosParaApi } from '@/lib/descritor/lista';

/**
 * Exporta o CSV de uma lista de descritor: o shell só repassa o pedido com o token do cookie httpOnly para
 * `<api da lista>/exportar` e devolve o arquivo; as colunas do perfil (e a LGPD do documento) são da API.
 */
export async function GET(req: NextRequest) {
  const { eu } = await contexto();
  const rota = req.nextUrl.searchParams.get('rota') ?? '';
  const resolvida = resolverPagina(montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil), rota, eu.usuario.perfil);
  const tela = resolvida?.pagina ? telaDaRota(resolvida.pagina.rota) : undefined;
  if (!resolvida?.pagina || tela?.tipo !== 'lista' || !tela.pagina.csv) return new NextResponse('Não encontrado.', { status: 404 });
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  const renovar = () => redirecionar('/sessao/renovar');
  if (!acesso) return renovar();
  const { cursor: _c, limite: _l, ...daUrl } = filtrosDaUrl(tela.pagina, req.nextUrl.searchParams);
  const filtros = filtrosParaApi(tela.filtrosTela, daUrl, eu.empresa.fuso); // `de`/`ate` da auditoria: dia civil -> datetime ISO completo
  let r;
  try {
    r = await baixarCsv(`${tela.pagina.api}/exportar${paraQuery(filtros)}`, acesso);
  } catch (e) {
    if (e instanceof NaoAutenticado) return renovar(); // acesso vencido: renova e volta ao início, sem 500
    if (e instanceof TrocarSenhaPendente) return redirecionar(ROTA_SENHA);
    r = null;
  }
  if (!r) return new NextResponse('Não foi possível exportar agora. Tente de novo em instantes.', { status: 502 });
  return new NextResponse(r.corpo, { status: 200, headers: { 'content-type': r.tipo, 'content-disposition': `attachment; filename="${tela.pagina.csv.arquivo}"`, 'cache-control': 'no-store' } });
}
