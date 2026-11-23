import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { redirect } from 'next/navigation';
import { ErroPlataforma, mensagemDoErro, type ContextoErro } from './erros';
import { ROTA_SENHA, encerrarEVoltar, exigirTokenConfig } from './sessao';

/** Resposta de ação de servidor para o cliente: serializável, sem corpo de erro cru e sem log. */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string; campos: Record<string, string>; chaveNova: boolean };

export const falha = (erro: string, campos: Record<string, string> = {}): Resultado<never> => ({ ok: false, erro, campos, chaveNova: false });

/**
 * Roda uma chamada da API com o token da sessão do /config. 401 apaga o cookie e volta ao login; 403 `TROCAR_SENHA` leva à troca;
 * o resto vira mensagem (`mensagemDoErro`). Os redirects ficam FORA do try (o redirect do Next é uma exceção).
 */
export async function executarConfig<T>(ctx: ContextoErro, fn: (token: string) => Promise<T>): Promise<Resultado<T>> {
  const token = await exigirTokenConfig();
  let falhou: unknown;
  try {
    return { ok: true, valor: await fn(token) };
  } catch (e) {
    falhou = e;
  }
  const m = mensagemDoErro(falhou, ctx);
  if (m.expirou) return encerrarEVoltar();
  if (falhou instanceof ErroPlataforma && falhou.status === 403 && falhou.codigo === CODIGO_TROCAR_SENHA) redirect(ROTA_SENHA);
  return { ok: false, erro: m.texto, campos: m.campos, chaveNova: m.chaveNova };
}
