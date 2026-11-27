import { ROTA_LOGIN } from '@/lib/rota-login';
import { NextResponse, type NextRequest } from 'next/server';
import { ApiIndisponivel, buscarEu, renovar } from '@/lib/api';
import { COOKIE_ACESSO, COOKIE_REFRESH, opcoesAcesso, opcoesLongas } from '@/lib/sessao';
import { redirecionar } from '@/lib/redirecionar';

/** Acesso vencido: troca o refresh (cookie httpOnly) por um novo acesso e volta ao início; sem refresh válido, login. */
export async function GET(req: NextRequest) {
  const refresh = req.cookies.get(COOKIE_REFRESH)?.value;
  const aoLogin = () => {
    const r = redirecionar(ROTA_LOGIN);
    r.cookies.delete(COOKIE_ACESSO);
    r.cookies.delete(COOKIE_REFRESH);
    return r;
  };
  if (!refresh) return aoLogin();
  try {
    const nova = await renovar(refresh);
    if (!nova) return aoLogin();
    await buscarEu(nova.acesso); // evita laço de redirecionamento se o token novo também for recusado
    const r = redirecionar('/');
    r.cookies.set(COOKIE_ACESSO, nova.acesso, opcoesAcesso);
    r.cookies.set(COOKIE_REFRESH, nova.refresh, opcoesLongas);
    return r;
  } catch (e) {
    if (e instanceof ApiIndisponivel) return new NextResponse('Serviço indisponível. Tente novamente em instantes.', { status: 503 });
    return aoLogin();
  }
}
