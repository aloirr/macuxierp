/**
 * Cliente tipado da API `/v1/integracao-fdv` para o BKO: a resposta é validada pelo Zod de `contracts`; o token e o `fetch`
 * entram por injeção (mesmo molde do pedido). A chave do conector só existe no corpo do `PUT /credencial`; o erro nunca a leva.
 */
import { StatusIntegracaoFdvTenant } from '@macuxierp/platform-sdk';
import { paraQuery } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import { ConfiguracaoResumo, CredencialResumo, LoteEnvioResumo, LoteErroLinha, MonitorResposta, RespostaAceito, RespostaRetomada, RespostaTestar, type ConfiguracaoEntrada, type CredencialEntrada, type EntidadeHub } from '../contracts';

export class ErroIntegracaoFdv extends Error {
  override readonly name = 'ErroIntegracaoFdv';
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type FetchIntegracaoFdv = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; headers: { get(nome: string): string | null }; json(): Promise<unknown> }>;

const Erro = z.object({ codigo: z.string(), mensagem: z.string() });
const Pagina = <T extends z.ZodTypeAny>(item: T) => z.object({ itens: z.array(item), proximo_cursor: z.string().uuid().nullable() });

export function criarClienteIntegracaoFdv(cfg: { baseUrl: string; token: () => string; fetch: FetchIntegracaoFdv }) {
  async function chamar<T>(metodo: string, caminho: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, corpo?: unknown): Promise<T> {
    const r = await cfg.fetch(`${cfg.baseUrl}/v1/integracao-fdv${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token()}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const ehJson = (r.headers.get('content-type') ?? '').includes('json');
    if (!r.ok) {
      const e = ehJson ? Erro.safeParse(await r.json().catch(() => null)) : null;
      throw new ErroIntegracaoFdv(r.status, e?.success ? e.data.codigo : 'ERRO', e?.success ? e.data.mensagem : 'Não foi possível concluir. Tente de novo.');
    }
    if (!ehJson) throw new ErroIntegracaoFdv(r.status, 'RESPOSTA_INVALIDA', 'Não foi possível concluir. Tente de novo.');
    return schema.parse(await r.json());
  }
  const entidade = (e: EntidadeHub) => encodeURIComponent(e);

  return {
    monitor: () => chamar('GET', '/monitor', MonitorResposta),
    /** Vista só de leitura (ADR 0013 seção 6): ligada ou desligada por cadastro, último envio e falha. */
    status: () => chamar('GET', '/status', StatusIntegracaoFdvTenant),
    lotes: (filtros: Record<string, string> = {}) => chamar('GET', `/lotes${paraQuery(filtros)}`, Pagina(LoteEnvioResumo)),
    errosDoLote: (id: string, filtros: Record<string, string> = {}) => chamar('GET', `/lotes/${encodeURIComponent(id)}/erros${paraQuery(filtros)}`, Pagina(LoteErroLinha)),
    /** Só o prefixo volta. */
    salvarCredencial: (e: CredencialEntrada) => chamar('PUT', '/credencial', CredencialResumo, e),
    /** `pedido_em`: o instante do pedido; o sinal aceito depois dele é a resposta do FDV. */
    testar: () => chamar('POST', '/credencial/testar', RespostaTestar, {}),
    configurar: (e: ConfiguracaoEntrada) => chamar('PUT', '/configuracao', ConfiguracaoResumo, e),
    cargaCompleta: (e: EntidadeHub) => chamar('POST', `/entidades/${entidade(e)}/carga-completa`, RespostaAceito, {}),
    retomar: (e: EntidadeHub) => chamar('POST', `/entidades/${entidade(e)}/retomar`, RespostaRetomada, {}),
    /** Caminho do CSV dos envios com os filtros da tela (o navegador baixa direto; a API aplica o perfil). */
    caminhoDoCsv: (filtros: Record<string, string> = {}) => `/v1/integracao-fdv/lotes/exportar${paraQuery(filtros)}`,
  };
}
