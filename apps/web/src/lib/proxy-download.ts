import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { pode } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from '@/lib/manifestos';
import { NaoAutenticado, baixarArquivo } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';
import { redirecionar } from '@/lib/redirecionar';

const SEM_CACHE = { 'cache-control': 'no-store' } as const;
const TEXTO = { ...SEM_CACHE, 'content-type': 'text/plain; charset=utf-8' } as const;
/** Falha de infraestrutura: um texto só para as rotas de download. */
export const FALHA_DOWNLOAD = 'Não foi possível baixar agora. Tente de novo em instantes.';

export interface OpcoesDownload {
  /** Caminho já validado contra a lista fechada da rota (senão 404 sem chamar a API). */
  permitido: boolean;
  caminho: string;
  modulo: string;
  /** Ação do `pode` (ex.: `cadastros.carga.executar`). */
  acao: Parameters<typeof pode>[1];
  /** Texto por status (403, 404); os demais erros viram 502 com `FALHA_DOWNLOAD`. */
  mensagens: Readonly<Record<number, string>>;
}

/**
 * Proxy de download: o token de acesso é httpOnly, então o arquivo passa pelo servidor do shell. Licença, perfil e `pode` são
 * conferidos aqui e de novo pela API (RN-CORE-02). Nada é gravado em log.
 */
export async function proxyDeDownload({ permitido, caminho, modulo, acao, mensagens }: OpcoesDownload): Promise<NextResponse> {
  if (!permitido) return new NextResponse('Não encontrado.', { status: 404, headers: SEM_CACHE });
  const { eu } = await contexto();
  const licenciado = eu.modulos.some((m) => m.id === modulo);
  const perfilOk = MANIFESTOS.some((m) => m.id === modulo && m.perfis.includes(eu.usuario.perfil));
  if (!licenciado || !perfilOk || !pode(eu.usuario.perfil, acao)) return new NextResponse('Não encontrado.', { status: 404, headers: SEM_CACHE });
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  const renovar = () => redirecionar('/sessao/renovar');
  if (!acesso) return renovar();
  try {
    const r = await baixarArquivo(caminho, acesso);
    if (!r.ok) return new NextResponse(mensagens[r.status] ?? FALHA_DOWNLOAD, { status: r.status === 403 || r.status === 404 ? r.status : 502, headers: TEXTO });
    return new NextResponse(r.corpo, { status: 200, headers: { 'content-type': r.tipo, 'content-disposition': `attachment; filename="${r.nome}"`, ...SEM_CACHE } });
  } catch (e) {
    if (e instanceof NaoAutenticado) return renovar();
    if (e instanceof TrocarSenhaPendente) return redirecionar(ROTA_SENHA);
    return new NextResponse(FALHA_DOWNLOAD, { status: 502, headers: SEM_CACHE });
  }
}
