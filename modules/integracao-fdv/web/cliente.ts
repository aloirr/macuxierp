/**
 * Cliente tipado da API `/v1/integracao-fdv` para o BKO: a resposta é validada pelo Zod de `contracts`; o token e o `fetch`
 * entram por injeção (mesmo molde do pedido). Só leitura: a escrita é do portal `/config`.
 */
import { LogCadastroFdvTenant, StatusIntegracaoFdvTenant, type EntidadeEnvioFdv } from '@macuxierp/platform-sdk';
import { paraQuery } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import { LoteEnvioResumo, LoteErroLinha, MonitorResposta } from '../contracts';

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

export type FetchIntegracaoFdv = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ status: number; ok: boolean; headers: { get(nome: string): string | null }; json(): Promise<unknown> }>;

const Erro = z.object({ codigo: z.string(), mensagem: z.string() });
const Pagina = <T extends z.ZodTypeAny>(item: T) => z.object({ itens: z.array(item), proximo_cursor: z.string().uuid().nullable() });

export function criarClienteIntegracaoFdv(cfg: { baseUrl: string; token: () => string; fetch: FetchIntegracaoFdv }) {
  async function chamar<T>(metodo: string, caminho: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    const r = await cfg.fetch(`${cfg.baseUrl}/v1/integracao-fdv${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token()}` },
    });
    const ehJson = (r.headers.get('content-type') ?? '').includes('json');
    if (!r.ok) {
      const e = ehJson ? Erro.safeParse(await r.json().catch(() => null)) : null;
      throw new ErroIntegracaoFdv(r.status, e?.success ? e.data.codigo : 'ERRO', e?.success ? e.data.mensagem : 'Não foi possível concluir. Tente de novo.');
    }
    if (!ehJson) throw new ErroIntegracaoFdv(r.status, 'RESPOSTA_INVALIDA', 'Não foi possível concluir. Tente de novo.');
    return schema.parse(await r.json());
  }

  return {
    monitor: () => chamar('GET', '/monitor', MonitorResposta),
    /** Vista só de leitura (ADR 0013 seção 6): ligada ou desligada por cadastro, último envio e falha. */
    status: () => chamar('GET', '/status', StatusIntegracaoFdvTenant),
    /** Log do cadastro (T-0086 §4): envios recentes e um item por registro com erro, com motivo, ação e "Corrigir". */
    log: (entidade: EntidadeEnvioFdv) => chamar('GET', `/entidades/${encodeURIComponent(entidade)}/log`, LogCadastroFdvTenant),
    lotes: (filtros: Record<string, string> = {}) => chamar('GET', `/lotes${paraQuery(filtros)}`, Pagina(LoteEnvioResumo)),
    errosDoLote: (id: string, filtros: Record<string, string> = {}) => chamar('GET', `/lotes/${encodeURIComponent(id)}/erros${paraQuery(filtros)}`, Pagina(LoteErroLinha)),
    /** Caminho do CSV dos envios com os filtros da tela (o navegador baixa direto; a API aplica o perfil). */
    caminhoDoCsv: (filtros: Record<string, string> = {}) => `/v1/integracao-fdv/lotes/exportar${paraQuery(filtros)}`,
  };
}
