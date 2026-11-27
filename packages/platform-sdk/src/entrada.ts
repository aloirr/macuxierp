/**
 * Contrato da `/v1/entrada` (T-0057, ADR 0014 §3 e §4, corte do PO de 26/11): a API de entrada de cadastros no ERP, que fala
 * o mesmo envelope do Hub `/integracao/v1` do FDV (`./hub-v1`: `CorpoLote`, `LoteAceito`, `LoteResultado`, `CursorEntidade`,
 * `CorpoSinal`, `RespostaSinal`). Aqui ficam só o que é da entrada: rotas, cabeçalhos, a credencial por conector e a leitura
 * do portal `/config`.
 *
 * - Nesta etapa só o delta: o lote `modo: 'completo'` responde 422 `CARGA_COMPLETA_NAO_SUPORTADA` (sem sessão, sem
 *   inativação e sem a trava de 30% da RN-INT-06).
 * - O banco guarda só o HMAC da chave com o pepper; log e auditoria levam só o prefixo.
 */
import { z } from 'zod';
import { ConectorIdHub, ENTIDADES_HUB_F2, EstadoLoteHub, FilialHub, Instante, ModoLote, PAYLOADS_HUB, ProdutoHub, VersaoSemver, type EntidadeHub } from './hub-v1';
import type { Transacao } from './banco';
import { CABECALHO_IDEMPOTENCIA, PADRAO_CHAVE_IDEMPOTENCIA } from './idempotencia';
import type { ContextoRota, EntradaRota, RespostaRota, RotaModulo } from './rotas';

/**
 * Prefixo da entrada (v0.3.24, hotfix; ADR 0014, adendo de 27/11): sob o `/v1`, porque o túnel da Cloudflare manda só o
 * `/v1*` para a api e o resto para o web (ADR 0003). O `/entrada/v1` caía na tela de login em produção.
 */
export const PREFIXO_ENTRADA = '/v1/entrada';
/**
 * O prefixo antigo, montado ao lado (expand) para o conector que já tem a URL antiga configurada. Sai (contract) quando
 * nenhum conector usar mais o legado (ADR 0014, adendo de 27/11).
 */
export const PREFIXO_ENTRADA_LEGADO = '/entrada/v1';
/** Os prefixos que a api monta para a entrada, o novo primeiro. */
export const PREFIXOS_ENTRADA: readonly string[] = Object.freeze([PREFIXO_ENTRADA, PREFIXO_ENTRADA_LEGADO]);

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

/**
 * Payloads da entrada (decisão 40 B, D1/D2; ADR 0014, emenda de 27/11): os do Hub, mais dois campos opcionais (mudança aditiva) que o
 * cadastro do ERP exige para criar o que o FDV não precisa: o `crt` da filial (1 Simples, 2 Simples com excesso, 3 Normal, 4 MEI) e o
 * `ncm` do produto (8 dígitos, RN-CAD-04). Ausentes, o domain do cadastros completa pelo já cadastrado ou recusa a linha.
 * O `hub-v1.ts` (cópia do contrato do FDV) não muda.
 */
/** CRT da filial como texto (`FilialDados.crt` do cadastros): fonte única para a entrada e o cadastros (RD do corretor, D1). */
export const CrtFilial = z.enum(['1', '2', '3', '4']);
export type CrtFilial = z.infer<typeof CrtFilial>;
/** NCM com 8 dígitos (RN-CAD-04): fonte única para a entrada, o cadastros e o fiscal. */
export const Ncm = z.string().regex(/^\d{8}$/);
export const FilialEntrada = FilialHub.extend({ crt: CrtFilial.optional() });
export type FilialEntrada = z.infer<typeof FilialEntrada>;
export const ProdutoEntrada = ProdutoHub.extend({ ncm: Ncm.optional() });
export type ProdutoEntrada = z.infer<typeof ProdutoEntrada>;
export const PAYLOADS_ENTRADA = { ...PAYLOADS_HUB, filial: FilialEntrada, produto: ProdutoEntrada } as const;

/**
 * Convenção dos códigos (achado da testes no E2): o `codigo` do envelope de erro (`ErroApi`) é sempre UPPER_SNAKE
 * (`CARGA_COMPLETA_NAO_SUPORTADA`, `ENTIDADE_FORA_DA_FASE`, `EMPRESA_INATIVA`); o código por linha do `LoteResultado.erros`
 * segue o Hub, em lower_snake (`CODIGOS_ERRO_LINHA_HUB`).
 */
export const CODIGO_CARGA_COMPLETA_NAO_SUPORTADA = 'CARGA_COMPLETA_NAO_SUPORTADA';
export const MENSAGEM_CARGA_COMPLETA_NAO_SUPORTADA = 'carga completa ainda não suportada';
/** 403 da empresa fora de `ativo` (suspensa ou encerrada), antes da licença (ADR 0014 §1). */
export const CODIGO_EMPRESA_INATIVA_ENTRADA = 'EMPRESA_INATIVA';
export const MENSAGEM_EMPRESA_INATIVA_ENTRADA = 'A empresa não está ativa; a entrada de dados está suspensa.';

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

/** `DELETE .../entrada/credencial?conector_id=`: a consulta e a resposta (a revogação vale na hora; sem a ativa, 404). */
export const RevogarCredencialEntrada = z.object({ conector_id: ConectorIdEntrada }).strict();
export type RevogarCredencialEntrada = z.infer<typeof RevogarCredencialEntrada>;
export const CredencialEntradaRevogada = z.object({ conector_id: ConectorIdEntrada, revogada_em: Instante }).strict();
export type CredencialEntradaRevogada = z.infer<typeof CredencialEntradaRevogada>;

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
// Rotas da `/v1/entrada` (E2): o módulo dono (cadastros) declara as rotas; a apps/api autentica a máquina e abre a
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
  /** IP de origem já truncado (`truncarIpEntrada`), para o `entrada_sinal.ip_origem`; nunca o endereço inteiro. */
  ip_origem?: string | null;
}

const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HEXTETO = /^[0-9a-f]{1,4}$/;

/**
 * O IP do cliente reduzido à rede (ADR 0014 §3, LGPD): IPv4 em /24 (`a.b.c.0/24`, também o IPv4 mapeado em IPv6) e IPv6
 * em /48 (os 3 primeiros grupos). Fora do formato = `null` (o sinal grava sem IP).
 */
export function truncarIpEntrada(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim().toLowerCase();
  const v4 = v.startsWith('::ffff:') ? v.slice(7) : v;
  if (IPV4.test(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  const partes = v.split('::');
  if (partes.length > 2) return null;
  const cabeca = partes[0] ? partes[0].split(':') : [];
  const cauda = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  if (![...cabeca, ...cauda].every((g) => HEXTETO.test(g))) return null;
  if (partes.length === 1 ? cabeca.length !== 8 : cabeca.length + cauda.length > 7) return null;
  const grupos = [...cabeca, ...Array<string>(8 - cabeca.length - cauda.length).fill('0'), ...cauda];
  return `${grupos.slice(0, 3).map((g) => Number.parseInt(g, 16).toString(16)).join(':')}::/48`;
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
