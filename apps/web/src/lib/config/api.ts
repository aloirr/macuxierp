import {
  COOKIE_CONFIG,
  EmailPrimeiroAdminResposta,
  EmpresaPlataforma,
  EuPlataforma,
  PADRAO_UUID,
  PREFIXO_PLATAFORMA,
  PrimeiroAdminResposta,
  SessaoPlataformaResposta,
  paginaDe,
  CODIGO_TROCAR_SENHA,
  type AlterarModulosEntrada,
  type CriarEmpresaEntrada,
  type EntrarPlataformaEntrada,
  type PrimeiroAdminEntrada,
  type SituacaoEmpresaEntrada,
  type TrocarSenhaPlataformaEntrada,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { buscarNaApi } from '../api';
import { ConfigIndisponivel, ConfigMuitasTentativas, ConfigNaoAutenticado, ConfigSemPermissao, ErroPlataforma } from './erros';

/** Cliente das rotas `/v1/plataforma/*` (ADR 0012). Só no servidor: o token da sessão nunca chega ao navegador. */
const ListaEmpresas = paginaDe(EmpresaPlataforma);
export type ListaEmpresas = z.infer<typeof ListaEmpresas>;

interface Pedido {
  token?: string;
  corpo?: unknown;
  chave?: string;
}

async function chamar(metodo: string, caminho: string, p: Pedido = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (p.token) headers.cookie = `${COOKIE_CONFIG}=${p.token}`;
  // CSRF (ADR 0012): toda escrita leva o cabeçalho. Literal até o SDK exportar a constante (trocar depois).
  if (metodo !== 'GET') headers['x-macuxierp-config'] = '1';
  if (p.corpo !== undefined) headers['content-type'] = 'application/json';
  if (p.chave) headers['idempotency-key'] = p.chave;
  try {
    return await buscarNaApi(`${PREFIXO_PLATAFORMA}${caminho}`, { method: metodo, headers, body: p.corpo === undefined ? undefined : JSON.stringify(p.corpo) });
  } catch {
    throw new ConfigIndisponivel('API não respondeu');
  }
}

/** Mapeia o status de erro; nunca repassa o corpo cru. */
async function recusar(r: Response): Promise<never> {
  if (r.status === 401) throw new ConfigNaoAutenticado();
  if (r.status === 429) throw new ConfigMuitasTentativas();
  let corpo: { codigo?: unknown; campos?: Record<string, unknown> } = {};
  try {
    corpo = (await r.json()) as typeof corpo;
  } catch {
    /* corpo fora do formato: segue só com o status */
  }
  const codigo = typeof corpo.codigo === 'string' ? corpo.codigo : '';
  if (r.status === 403 && codigo !== CODIGO_TROCAR_SENHA) throw new ConfigSemPermissao();
  if (r.status >= 400 && r.status < 500) {
    const campos = Object.fromEntries(Object.entries(corpo.campos ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    throw new ErroPlataforma(r.status, codigo, campos);
  }
  throw new ConfigIndisponivel(`HTTP ${r.status}`);
}

async function validado<S extends z.ZodTypeAny>(r: Response, schema: S): Promise<z.infer<S>> {
  if (!r.ok) return recusar(r);
  const dados = schema.safeParse(await r.json().catch(() => null));
  if (!dados.success) throw new ConfigIndisponivel('resposta fora do contrato');
  return dados.data;
}

/** Só UUID entra no caminho (nada de `../` vindo da URL). */
function idEmpresa(id: string): string {
  if (!PADRAO_UUID.test(id)) throw new ErroPlataforma(404, 'NAO_ENCONTRADO');
  return id;
}

export interface SessaoAberta {
  /** Token opaco do cookie da API; vai só ao cookie httpOnly do shell. */
  token: string;
  expira_em: string;
}

/** `POST /auth/entrar`. Null: e-mail ou senha inválidos (a API não diz qual, nem se a conta está travada). */
export async function entrarPlataforma(corpo: EntrarPlataformaEntrada): Promise<SessaoAberta | null> {
  const r = await chamar('POST', '/auth/entrar', { corpo });
  if (r.status === 401 || r.status === 403) return null;
  const dados = await validado(r, SessaoPlataformaResposta);
  const token = r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .find((c) => c.startsWith(`${COOKIE_CONFIG}=`))
    ?.slice(COOKIE_CONFIG.length + 1);
  if (!token) throw new ConfigIndisponivel('sessão sem cookie');
  return { token, expira_em: dados.expira_em };
}

export async function euPlataforma(token: string): Promise<EuPlataforma> {
  return validado(await chamar('GET', '/auth/eu', { token }), EuPlataforma);
}

export async function sairPlataforma(token: string): Promise<void> {
  await chamar('POST', '/auth/sair', { token }).catch(() => undefined);
}

export async function trocarSenhaPlataforma(token: string, corpo: TrocarSenhaPlataformaEntrada): Promise<void> {
  const r = await chamar('POST', '/auth/senha', { token, corpo });
  if (!r.ok) await recusar(r);
}

export async function listarEmpresas(token: string, q: { busca?: string; cursor?: string } = {}): Promise<ListaEmpresas> {
  const qs = new URLSearchParams();
  if (q.busca) qs.set('busca', q.busca);
  if (q.cursor) qs.set('cursor', q.cursor);
  const s = qs.toString();
  return validado(await chamar('GET', `/empresas${s ? `?${s}` : ''}`, { token }), ListaEmpresas);
}

export async function lerEmpresa(token: string, id: string): Promise<EmpresaPlataforma> {
  return validado(await chamar('GET', `/empresas/${idEmpresa(id)}`, { token }), EmpresaPlataforma);
}

export async function criarEmpresa(token: string, corpo: CriarEmpresaEntrada, chave: string): Promise<EmpresaPlataforma> {
  return validado(await chamar('POST', '/empresas', { token, corpo, chave }), EmpresaPlataforma);
}

export async function alterarModulos(token: string, id: string, corpo: z.input<typeof AlterarModulosEntrada>): Promise<EmpresaPlataforma> {
  return validado(await chamar('PUT', `/empresas/${idEmpresa(id)}/modulos`, { token, corpo }), EmpresaPlataforma);
}

export async function alterarSituacao(token: string, id: string, corpo: SituacaoEmpresaEntrada, chave: string): Promise<EmpresaPlataforma> {
  return validado(await chamar('PUT', `/empresas/${idEmpresa(id)}/situacao`, { token, corpo, chave }), EmpresaPlataforma);
}

/** A resposta traz a senha provisória: quem chama a mostra uma vez e não a guarda nem a loga. */
export async function criarPrimeiroAdmin(token: string, id: string, corpo: PrimeiroAdminEntrada, chave: string): Promise<PrimeiroAdminResposta> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/primeiro-admin`, { token, corpo, chave }), PrimeiroAdminResposta);
}

export async function redefinirSenhaPrimeiroAdmin(token: string, id: string, chave: string): Promise<PrimeiroAdminResposta> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/primeiro-admin/senha`, { token, chave }), PrimeiroAdminResposta);
}

/** `POST .../primeiro-admin/email` (no-store): o e-mail inteiro, só para a tela. Escrita auditada pela API: sem Idempotency-Key. */
export async function mostrarEmailPrimeiroAdmin(token: string, id: string): Promise<EmailPrimeiroAdminResposta> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/primeiro-admin/email`, { token }), EmailPrimeiroAdminResposta);
}
