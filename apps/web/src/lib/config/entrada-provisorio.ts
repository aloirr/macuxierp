/**
 * CONTRATO PROVISÓRIO da entrada de dados (cenário B, ADR 0014 §5 e §14).
 * TROCA PELO SDK: o contrato do modulo-cadastros (contrato do modulo-cadastros de 24/11 (situação, credencial, dono e confirmação)) ainda não existe. Quando sair em `@macuxierp/platform-sdk`, apague este arquivo e importe tipos, rotas
 * e fixture de lá. Nada aqui chega ao banco: as rotas abaixo são placeholders e as ações recebem `enviar` (padrão `fetch`).
 */
import { ENTIDADES_ENVIO_FDV, type EntidadeEnvioFdv } from '@macuxierp/platform-sdk';

export type CanalEntrada = 'conector' | 'api';
export type DonoEntrada = 'cliente' | 'erp';

export interface CredencialEntrada {
  conector_id: string;
  prefixo_chave: string;
  criada_em: string;
  ultimo_sinal_em: string | null;
  versao: string | null;
}
export interface ConfirmacaoPendente {
  lote_id: string;
  a_inativar: number;
  total: number;
  percentual: number;
  expira_em: string;
}
export interface LinhaEntradaApi {
  cadastro: EntidadeEnvioFdv;
  dono: DonoEntrada;
  dono_herdado_de: 'cliente' | 'produto' | null;
  ultimo_lote: { em: string; recebidas: number; gravadas: number; com_erro: number } | null;
  erros: number;
  confirmacao_pendente: ConfirmacaoPendente | null;
}
/** Leitura GET da situação. */
export interface EntradaPortal {
  credenciais: { conector: CredencialEntrada | null; api: CredencialEntrada | null };
  cadastros: LinhaEntradaApi[];
}

/** Os 10 cadastros da F2, na ordem do Hub. */
export const CADASTROS_ENTRADA: readonly EntidadeEnvioFdv[] = ENTIDADES_ENVIO_FDV;

/** Placeholder de `CAMINHOS_ENTRADA_PLATAFORMA` (SDK): trocar quando o SDK sair. */
const base = (empresaId: string) => `/config/api/empresas/${encodeURIComponent(empresaId)}/entrada`;
export const ROTAS_ENTRADA = {
  situacao: (empresaId: string) => `${base(empresaId)}/situacao`,
  credencial: (empresaId: string) => `${base(empresaId)}/credencial`,
  dono: (empresaId: string) => `${base(empresaId)}/dono`,
  confirmacao: (empresaId: string) => `${base(empresaId)}/confirmacao`,
} as const;

export type Enviar = (url: string, init: RequestInit) => Promise<Response>;
/** `status` 0 = falha de rede. `codigo` vem do corpo do erro, quando houver. */
export type ResultadoEntrada<T> = { ok: true; valor: T } | { ok: false; erro: string; status: number; codigo: string | null };

async function chamar<T>(enviar: Enviar, url: string, corpo: unknown, chaveIdempotencia: string): Promise<ResultadoEntrada<T>> {
  let r: Response;
  try {
    r = await enviar(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': chaveIdempotencia }, body: JSON.stringify(corpo) });
  } catch {
    return { ok: false, erro: 'Sem conexão. Tente de novo.', status: 0, codigo: null };
  }
  if (!r.ok) {
    const c = (await r.json().catch(() => null)) as { codigo?: unknown; erro?: unknown } | null;
    const codigo = typeof c?.codigo === 'string' ? c.codigo : typeof c?.erro === 'string' ? c.erro : null;
    return { ok: false, erro: 'Não foi possível concluir. Tente de novo.', status: r.status, codigo };
  }
  try {
    return { ok: true, valor: (await r.json()) as T };
  } catch {
    return { ok: false, erro: 'Sem conexão. Tente de novo.', status: 0, codigo: null };
  }
}

const padrao: Enviar = (u, i) => fetch(u, i);

/** A chave devolvida vive só na memória do chamador: nunca em URL, armazenamento ou log. */
export const gerarCredencial = (empresaId: string, tipo: CanalEntrada, conectorId: string, idem: string, enviar: Enviar = padrao) =>
  chamar<{ chave: string; prefixo_chave: string }>(enviar, ROTAS_ENTRADA.credencial(empresaId), { tipo, conector_id: conectorId }, idem);
export const definirDono = (empresaId: string, cadastro: EntidadeEnvioFdv, dono: DonoEntrada, idem: string, enviar: Enviar = padrao) =>
  chamar<LinhaEntradaApi & { carga_completa_pedida?: boolean }>(enviar, ROTAS_ENTRADA.dono(empresaId), { cadastro, dono }, idem);
export const decidirConfirmacao = (empresaId: string, loteId: string, decisao: 'aprovar' | 'recusar', idem: string, enviar: Enviar = padrao) =>
  chamar<{ lote_id: string; estado: string }>(enviar, ROTAS_ENTRADA.confirmacao(empresaId), { lote_id: loteId, decisao }, idem);

const linha = (cadastro: EntidadeEnvioFdv, i: number): LinhaEntradaApi => ({
  cadastro,
  dono: cadastro === 'cliente' || cadastro === 'cliente_endereco' || cadastro === 'filial' ? 'cliente' : 'erp',
  dono_herdado_de: cadastro === 'cliente_endereco' ? 'cliente' : cadastro === 'produto_unidade' ? 'produto' : null,
  ultimo_lote: i % 2 === 0 || cadastro === 'vendedor' ? { em: '2026-11-24T12:00:00.000Z', recebidas: 100 + i, gravadas: 98 + i, com_erro: cadastro === 'vendedor' ? 2 : 0 } : null,
  erros: cadastro === 'vendedor' ? 3 : 0,
  confirmacao_pendente: cadastro === 'produto'
    ? { lote_id: 'lote-1', a_inativar: 120, total: 266, percentual: 45.1, expira_em: '2026-11-25T12:00:00.000Z' }
    : cadastro === 'cliente_endereco' ? { lote_id: 'lote-2', a_inativar: 5, total: 20, percentual: 25, expira_em: '2026-11-25T12:00:00.000Z' } : null,
});

/** Fixture de teste e de demonstração. */
export const ENTRADA_FIXTURE: EntradaPortal = {
  credenciais: {
    conector: { conector_id: 'thathyany-erp', prefixo_chave: 'mxc_ab12', criada_em: '2026-11-20T14:05:00.000Z', ultimo_sinal_em: '2026-11-24T12:30:00.000Z', versao: '1.0.0' },
    api: { conector_id: 'thathyany-api', prefixo_chave: 'mxa_cd34', criada_em: '2026-11-21T15:00:00.000Z', ultimo_sinal_em: null, versao: null },
  },
  cadastros: CADASTROS_ENTRADA.map(linha),
};
