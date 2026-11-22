/**
 * Fontes HTTP reais (BrasilAPI, ViaCEP, CNPJ.ws como reserva do CNPJ). O `fetch` é injetável: os testes usam fonte falsa
 * porque a sessão da nuvem não alcança estes sites (ADR 0002). Tempo máximo por chamada vem do chamador (5 s).
 * A URL leva só CNPJ de empresa ou CEP; nada pessoal é logado.
 */
import type { FonteExterna, Fontes } from './portas';

type Buscar = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function fonteJson(id: FonteExterna<Record<string, unknown>>['id'], montarUrl: (chave: string) => string, buscar: Buscar, naoAchou?: (j: Record<string, unknown>) => boolean): FonteExterna<Record<string, unknown>> {
  return {
    id,
    async consultar(chave, { timeoutMs }) {
      const r = await buscar(montarUrl(chave), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'user-agent': 'macuxi-erp' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fonte ${id} respondeu ${r.status}`);
      const json = (await r.json()) as Record<string, unknown>;
      return naoAchou?.(json) ? null : json;
    },
  };
}

export function fontesHttp(buscar: Buscar = fetch as unknown as Buscar): Fontes {
  return {
    cnpj: [
      fonteJson('brasilapi', (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, buscar),
      fonteJson('receita-aberta', (c) => `https://publica.cnpj.ws/cnpj/${c}`, buscar),
    ],
    cep: [
      fonteJson('viacep', (c) => `https://viacep.com.br/ws/${c}/json/`, buscar, (j) => j.erro === true || j.erro === 'true'),
      fonteJson('brasilapi', (c) => `https://brasilapi.com.br/api/cep/v2/${c}`, buscar),
    ],
  };
}
