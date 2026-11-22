import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { filtrosDaUrl, paraQuery } from '@macuxierp/platform-sdk/listas';
import { paginaVisivel } from '@/lib/paginas';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu, resolverPagina } from '@/lib/menu';
import { baixarCsv } from '@/lib/api';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';
import { telaDaRota } from '@/lib/telas';

/**
 * Exporta o CSV de uma lista de descritor: o shell só repassa o pedido com o token do cookie httpOnly para
 * `<api da lista>/exportar` e devolve o arquivo; as colunas do perfil (e a LGPD do documento) são da API.
 */
export async function GET(req: NextRequest) {
  const { eu } = await contexto();
  const rota = req.nextUrl.searchParams.get('rota') ?? '';
  const resolvida = resolverPagina(montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil), rota, eu.usuario.perfil);
  const tela = resolvida?.pagina ? telaDaRota(resolvida.pagina.rota) : undefined;
  if (!resolvida?.pagina || !paginaVisivel(resolvida.pagina, eu.usuario.perfil) || tela?.tipo !== 'lista' || !tela.pagina.csv) return new NextResponse('Não encontrado.', { status: 404 });
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return new NextResponse('Sessão expirada.', { status: 401 });
  const { cursor: _c, limite: _l, ...filtros } = filtrosDaUrl(tela.pagina, req.nextUrl.searchParams);
  const r = await baixarCsv(`${tela.pagina.api}/exportar${paraQuery(filtros)}`, acesso);
  if (!r) return new NextResponse('Não foi possível exportar agora. Tente de novo em instantes.', { status: 502 });
  return new NextResponse(r.corpo, { status: 200, headers: { 'content-type': r.tipo, 'content-disposition': `attachment; filename="${tela.pagina.csv.arquivo}"`, 'cache-control': 'no-store' } });
}
