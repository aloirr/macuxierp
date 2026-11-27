/**
 * Contrato da `/entrada/v1` (T-0057, ADR 0014 §3 e §4, corte do PO de 26/11): a API de entrada de cadastros no ERP, que fala
 * o mesmo envelope do Hub `/integracao/v1` do FDV (`./hub-v1`: `CorpoLote`, `LoteAceito`, `LoteResultado`, `CursorEntidade`,
 * `CorpoSinal`, `RespostaSinal`). Aqui ficam só o que é da entrada: rotas, cabeçalhos, a credencial por conector e a leitura
 * do portal `/config`.
 *
 * - Nesta etapa só o delta: o lote `modo: 'completo'` responde 422 `CARGA_COMPLETA_NAO_SUPORTADA` (sem sessão, sem
 *   inativação e sem a trava de 30% da RN-INT-06).
 * - O banco guarda só o HMAC da chave com o pepper; log e auditoria levam só o prefixo.
 */
import { z } from 'zod';
import { ConectorIdHub, ENTIDADES_HUB_F2, EstadoLoteHub, Instante, ModoLote, VersaoSemver, type EntidadeHub } from './hub-v1';
import type { Transacao } from './banco';
import { CABECALHO_IDEMPOTENCIA, PADRAO_CHAVE_IDEMPOTENCIA } from './idempotencia';
import type { ContextoRota, EntradaRota, RespostaRota, RotaModulo } from './rotas';

export const PREFIXO_ENTRADA = '/entrada/v1';

/** Caminhos sob `PREFIXO_ENTRADA`, os mesmos do Hub (o cliente HTTP do Conector só troca o prefixo). */
export const CAMINHOS_ENTRADA = Object.freeze({
  lotes: '/lotes',
  lote: '/lotes/:id',
  cursor: '/cursores/:entidade',
  sinal: '/sinal',
});

/** Autenticação de máquina (ADR 0014 §3): `Authorization: Bearer <chave>` e este cabeçalho, como no Hub. */
export const CABECALHO_CONECTOR_ID_ENTRADA = 'x-macuxi-conector-id';
/** Obrigatória no `POST /lotes` (o cabeçalho comum das rotas): a mesma chave com o mesmo corpo devolve o mesmo lote; com outro corpo, 409. */
export const CABECALHO_IDEMPOTENCIA_ENTRADA = CABECALHO_IDEMPOTENCIA;

/** Trabalho do worker que processa o lote recebido (apps/worker → cadastros). */
export const TRABALHO_ENTRADA_LOTE = 'cadastros.entrada_lote';

/** As 10 entidades da F2 do Hub (sem título e nota, que só saem do ERP). */
export const ENTIDADES_ENTRADA = ENTIDADES_HUB_F2;
export const EntidadeEntrada = z.enum(ENTIDADES_ENTRADA as unknown as [EntidadeHub, ...EntidadeHub[]]);

export const CODIGO_CARGA_COMPLETA_NAO_SUPORTADA = 'CARGA_COMPLETA_NAO_SUPORTADA';
export const MENSAGEM_CARGA_COMPLETA_NAO_SUPORTADA = 'carga completa ainda não suportada';

/** `X-Macuxi-Conector-Id`: o `conector_id` do Hub, começando por letra ou dígito, sem espaço. */
export const ConectorIdEntrada = ConectorIdHub.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export type ConectorIdEntrada = z.infer<typeof ConectorIdEntrada>;

/** `Idempotency-Key`: a mesma regra das outras rotas (`PADRAO_CHAVE_IDEMPOTENCIA`). */
export const IdempotencyKeyEntrada = z.string().regex(PADRAO_CHAVE_IDEMPOTENCIA);

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** A chave do conector: 32 bytes aleatórios em base64url, sem `=` (43 caracteres). */
export const ChaveEntrada = z.string().length(43).regex(BASE64URL);
export const PREFIXO_CHAVE_ENTRADA_TAMANHO = 8;
/** O prefixo exibido no portal (nunca a chave inteira). */
export const prefixoChaveEntrada = (chave: string): string => chave.slice(0, PREFIXO_CHAVE_ENTRADA_TAMANHO);

const Prefixo = z.string().length(PREFIXO_CHAVE_ENTRADA_TAMANHO).regex(BASE64URL);

/** Portal `/config` (superadmin, lista fechada da ADR 0012), sob `/v1/plataforma`. */
export const CAMINHOS_ENTRADA_PLATAFORMA = Object.freeze({
  /** GET: credenciais, último sinal e lotes recentes. */
  ler: '/empresas/:id/entrada',
  /** POST: cria (ou troca) a chave de um conector; DELETE `?conector_id=`: revoga. */
  credencial: '/empresas/:id/entrada/credencial',
});

/** Corpo do POST de criar ou trocar a chave. */
export const CriarCredencialEntrada = z.object({ conector_id: ConectorIdEntrada }).strict();
export type CriarCredencialEntrada = z.infer<typeof CriarCredencialEntrada>;

/** Resposta da criação: a única vez em que a chave aparece. */
export const CredencialEntradaCriada = z
  .object({ conector_id: ConectorIdEntrada, chave: ChaveEntrada, prefixo: Prefixo, criada_em: Instante })
  .strict();
export type CredencialEntradaCriada = z.infer<typeof CredencialEntradaCriada>;

/** Credencial na leitura do portal: sem chave e sem hash; sem "último uso" (a tela mostra o último sinal, RD-2319). */
export const CredencialEntradaResumo = z
  .object({ conector_id: ConectorIdEntrada, prefixo: Prefixo, criada_em: Instante, revogada_em: Instante.nullable() })
  .strict();
export type CredencialEntradaResumo = z.infer<typeof CredencialEntradaResumo>;

/** Lote recebido, na lista do portal: só contagens, nunca o dado. */
export const LoteEntradaResumo = z
  .object({
    lote_id: z.string().uuid(),
    entidade: EntidadeEntrada,
    modo: ModoLote,
    status: EstadoLoteHub,
    recebidos: z.number().int().nonnegative(),
    com_erro: z.number().int().nonnegative(),
    recebido_em: Instante,
    concluido_em: Instante.nullable(),
  })
  .strict()
  .refine((l) => l.com_erro <= l.recebidos, { path: ['com_erro'], message: 'com_erro acima de recebidos' });
export type LoteEntradaResumo = z.infer<typeof LoteEntradaResumo>;

export const LIMITE_LOTES_PORTAL_ENTRADA = 50;

/** `GET /v1/plataforma/empresas/:id/entrada`. */
export const PortalEntradaLeitura = z
  .object({
    credenciais: z.array(CredencialEntradaResumo).max(20),
    ultimo_sinal: z.object({ conector_id: ConectorIdEntrada, em: Instante, versao_conector: VersaoSemver }).strict().nullable(),
    lotes: z.array(LoteEntradaResumo).max(LIMITE_LOTES_PORTAL_ENTRADA),
  })
  .strict();
export type PortalEntradaLeitura = z.infer<typeof PortalEntradaLeitura>;

// ---------------------------------------------------------------------------------------------------------------------
// Rotas da `/entrada/v1` (E2): o módulo dono (cadastros) declara as rotas; a apps/api autentica a máquina e abre a
// transação no tenant da credencial. Sem sessão de usuário nem JWT: o "perfil" é o `conector_entrada` (ADR 0014 §3).
// ---------------------------------------------------------------------------------------------------------------------

/** O módulo que responde pela entrada e cuja licença a rota exige (regra 6). */
export const MODULO_ENTRADA = 'cadastros' as const;

/** Quem chamou, depois da autenticação (o HMAC da chave conferido). */
export interface ConectorAutenticado {
  tenant_id: string;
  credencial_id: string;
  conector_id: string;
}

/** O `ContextoRota` sem sessão de usuário: a `tx` tem o `app.tenant_id` da credencial (RLS). */
export interface ContextoEntrada extends Pick<ContextoRota, 'tx' | 'request_id' | 'agora' | 'enfileirar'> {
  conector: ConectorAutenticado;
}

export type CaminhoEntrada = (typeof CAMINHOS_ENTRADA)[keyof typeof CAMINHOS_ENTRADA];

export interface RotaEntrada<TC = unknown, TQ = unknown> extends Pick<RotaModulo<TC, TQ>, 'corpo' | 'consulta'> {
  metodo: 'GET' | 'POST';
  caminho: CaminhoEntrada;
  executar(c: ContextoEntrada, e: EntradaRota<TC, TQ>): Promise<RespostaRota>;
}

/** Ajuda de tipo, como o `definirRota`: infere corpo e consulta dos schemas e devolve a rota "apagada" para a API. */
export function definirRotaEntrada<TC = undefined, TQ = undefined>(r: RotaEntrada<TC, TQ>): RotaEntrada {
  return r as unknown as RotaEntrada;
}

/** A credencial guardada, lida antes de haver tenant (B1: `cadastros.entrada_autenticar`). Nunca vai a log. */
export interface CredencialEntradaArmazenada {
  tenant_id: string;
  credencial_id: string;
  /** HMAC-SHA256(pepper, chave) em hex minúsculo (64). */
  chave_hmac: string;
}

/** Porta da autenticação: credencial ativa (não revogada) do `conector_id`, ou `null`. */
export interface PortaCredencialEntrada {
  buscar(tx: Transacao, conectorId: string): Promise<CredencialEntradaArmazenada | null>;
}
