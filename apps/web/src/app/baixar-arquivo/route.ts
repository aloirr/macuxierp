import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { pode } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from '@/lib/manifestos';
import { NaoAutenticado, baixarArquivo } from '@/lib/api';
import { arquivoPermitido } from '@/lib/arquivos';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';

const SEM_CACHE = { 'cache-control': 'no-store' } as const;
const MENSAGENS: Readonly<Record<number, string>> = {
  403: 'Seu perfil não pode baixar este arquivo.',
  404: 'Arquivo ainda não disponível para esta nota.',
};

/**
 * Proxy de download (XML e DANFE da nota): o token de acesso é httpOnly, então o arquivo passa pelo servidor do shell. Só caminhos
 * da lista fechada em `lib/arquivos.ts`; a licença e o perfil são conferidos aqui e de novo pela API (RN-CORE-02). Nada é gravado em log.
 */
export async function GET(req: NextRequest) {
  const caminho = req.nextUrl.searchParams.get('caminho') ?? '';
  if (!arquivoPermitido(caminho)) return new NextResponse('Não encontrado.', { status: 404, headers: SEM_CACHE });
  const { eu } = await contexto();
  const licenciado = eu.modulos.some((m) => m.id === 'faturamento');
  const perfilOk = MANIFESTOS.some((m) => m.id === 'faturamento' && m.perfis.includes(eu.usuario.perfil));
  if (!licenciado || !perfilOk || !pode(eu.usuario.perfil, 'faturamento.nota.emitir')) return new NextResponse('Não encontrado.', { status: 404, headers: SEM_CACHE });
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  const renovar = () => NextResponse.redirect(new URL('/sessao/renovar', req.url));
  if (!acesso) return renovar();
  try {
    const r = await baixarArquivo(caminho, acesso);
    if (!r.ok) return new NextResponse(MENSAGENS[r.status] ?? 'Não foi possível baixar agora. Tente de novo em instantes.', { status: r.status === 403 || r.status === 404 ? r.status : 502, headers: { ...SEM_CACHE, 'content-type': 'text/plain; charset=utf-8' } });
    return new NextResponse(r.corpo, { status: 200, headers: { 'content-type': r.tipo, 'content-disposition': `attachment; filename="${r.nome}"`, ...SEM_CACHE } });
  } catch (e) {
    if (e instanceof NaoAutenticado) return renovar();
    return new NextResponse('Não foi possível baixar agora. Tente de novo em instantes.', { status: 502, headers: SEM_CACHE });
  }
}
