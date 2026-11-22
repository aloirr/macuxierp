/** Regras puras da escrita pelo shell: que caminho de API uma tela pode chamar e como a resposta vira texto (sem dado pessoal). */
import type { EuResposta, ManifestoModulo, ModuloId } from '@macuxierp/platform-sdk';

const CAMINHO_ESCRITA = /^\/v1\/([a-z][a-z0-9-]*)\/[A-Za-z0-9/_-]*$/;
const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * O caminho é `/v1/<modulo>/...`, o módulo está licenciado para a empresa e o perfil entra no manifesto dele. É só a primeira
 * barreira do shell: a API checa de novo perfil, tenant, licença e a ação (RN-CORE-02).
 */
export function escritaPermitida(metodo: string, caminho: string, eu: EuResposta, manifestos: readonly ManifestoModulo[]): ModuloId | null {
  if (!METODOS.has(metodo) || caminho.includes('..')) return null;
  const m = CAMINHO_ESCRITA.exec(caminho);
  if (!m) return null;
  const modulo = m[1] as ModuloId;
  const licenciado = eu.modulos.some((x) => x.id === modulo);
  const perfilOk = manifestos.some((f) => f.id === modulo && f.perfis.includes(eu.usuario.perfil));
  return licenciado && perfilOk ? modulo : null;
}

export interface ResultadoEscrita {
  ok: boolean;
  mensagem: string;
  /** `id` do registro criado, quando a API devolve. */
  id?: string;
  /** Campo -> mensagem, quando a API aponta. */
  campos?: Record<string, string>;
  /** 412/409: a versão mudou; a tela recarrega. */
  desatualizado?: boolean;
}

const FIXAS: Readonly<Record<number, string>> = {
  403: 'Seu perfil não pode fazer esta ação.',
  404: 'Registro não encontrado.',
  409: 'O registro mudou ou a ação não vale mais neste estado. Atualize a página.',
  412: 'Outra pessoa alterou este registro. Atualize a página e tente de novo.',
  422: 'A ação foi recusada pelas regras do pedido.',
  429: 'Muitas tentativas. Aguarde um instante.',
};

/** Lê `mensagem` e `campos` do corpo de erro da API, sem repassar nada fora do esperado. */
export function resultadoDaResposta(status: number, ok: boolean, corpo: unknown): ResultadoEscrita {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as { id?: unknown; mensagem?: unknown; campos?: unknown };
  if (ok) return { ok: true, mensagem: 'Feito.', ...(typeof c.id === 'string' ? { id: c.id } : {}) };
  const mensagem = typeof c.mensagem === 'string' && c.mensagem.trim() && status < 500 ? c.mensagem.trim() : (FIXAS[status] ?? 'Não foi possível concluir agora. Tente de novo em instantes.');
  const campos: Record<string, string> = {};
  if (c.campos && typeof c.campos === 'object') for (const [k, v] of Object.entries(c.campos)) if (typeof v === 'string') campos[k] = v;
  return { ok: false, mensagem, ...(Object.keys(campos).length ? { campos } : {}), ...(status === 409 || status === 412 ? { desatualizado: true } : {}) };
}
