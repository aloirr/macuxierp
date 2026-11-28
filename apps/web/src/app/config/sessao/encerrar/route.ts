import { euPlataforma } from '@/lib/config/api';
import { COOKIE_CONFIG_WEB, PATH_CONFIG } from '@/lib/config/constantes';
import { ConfigNaoAutenticado } from '@/lib/config/erros';
import { tokenConfig } from '@/lib/config/sessao';
import { ROTA_LOGIN } from '@/lib/rota-login';
import { redirecionar } from '@/lib/redirecionar';

/**
 * Destino interno do 401 de página (um Server Component não apaga cookie). NÃO desloga por GET: só apaga o cookie do /config se a API
 * confirmar agora que a sessão é inválida (401); com sessão válida, volta ao portal sem tocar no cookie. O "Sair" do usuário é POST
 * (server action em `(portal)/sair.ts`). Location relativo (T-0021).
 */
export async function GET() {
  const token = await tokenConfig();
  if (!token) return redirecionar(ROTA_LOGIN);
  try {
    await euPlataforma(token);
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) {
      const r = redirecionar(ROTA_LOGIN);
      r.cookies.delete({ name: COOKIE_CONFIG_WEB, path: PATH_CONFIG });
      return r;
    }
  }
  return redirecionar('/config'); // sessão válida (ou API fora do ar): nunca encerra por GET
}
