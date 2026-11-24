/**
 * T-0012: dublê do Hub `/integracao/v1` do Macuxi FDV — HTTP local, em processo (127.0.0.1, porta livre).
 *
 * Decisão do Alexandre (21/11/2026 23h10 de Manaus): os testes de ponta a ponta rodam contra o FDV real, num tenant de
 * teste; o dublê fica só para os testes unitários e para provar o arnês enquanto o tenant e a chave não existem.
 *
 * Fiel ao guia do integrador do FDV (commit b75ab88, só consulta) no que a ida ERP → FDV usa:
 *  - autenticação: `Authorization: Bearer mxc_…` + `X-Macuxi-Conector-Id`; o tenant vem da chave; recusa genérica 401;
 *  - `X-Request-Id` em toda resposta;
 *  - `POST /lotes`: `Idempotency-Key` obrigatória (ausente = 400; fora de 16 a 128 caracteres `[A-Za-z0-9._:-]` = 422,
 *    premissa a conferir na rodada real, ver docs/testes/T-0012.md), mesma chave e mesmo conteúdo = 202 com o mesmo
 *    `lote_id`, `repetido: true` e `Idempotent-Replay: true`, sem mudar nada; outro conteúdo = 409; envelope:
 *    `versao_nao_suportada`, `entidade_desconhecida`, `lote_vazio`, `acima_do_limite` (5.000), `sessao_ausente`,
 *    `sessao_nao_se_aplica`, `entidade_de_outro_conector` (422) e `corpo_grande` (413, 8 MiB);
 *  - um Conector por entidade (RN-INT-13 do FDV): o dublê guarda o dono de cada entidade por tenant; cadastrar ou mudar
 *    um Conector com entidade de outro = 409 `topologia_conflitante` (tela de Conectores do BKO do FDV, aqui
 *    `registrarConector`/`alterarEntidades`); lote de entidade de outro Conector = 422 `entidade_de_outro_conector`;
 *  - erro por linha: `campo_obrigatorio`, `registro_invalido`, `valor_fora_da_faixa` e `referencia_ausente`
 *    (reprocessável) quando a referência ainda não foi carregada (ordem quebrada) ou, no vendedor, quando falta a
 *    `filial_external_id`; mensagem sem valor de campo;
 *  - preço e estoque sem `filial_external_id` vão para a filial padrão do tenant (`filialAplicada`);
 *  - upsert por `external_id` com `alterado_em` monotônico (novas, atualizadas, inalteradas, obsoletas);
 *  - carga completa em sessão (partes, `ultimo`), inativação do que não veio com a trava de 30 %;
 *  - `GET /lotes/{id}` (recebido → processando → concluído), `GET /cursores/{entidade}`, `POST /sinal`;
 *  - taxa por Conector (lotes: balde 30, repõe 20/min; demais: 300 e 300/min) → 429 com `Retry-After`;
 *  - 426 por versão mínima (global ou por entidade: o Conector pausa só a entidade);
 *  - falhas programadas (429/503/500 com `Retry-After`) para provar a retentativa.
 * Fora do escopo (T-0017): `GET /pedidos/pendentes` e `POST /pedidos/{uuid}/retorno` respondem 501 até a T-0017
 * registrar os tratadores em `rotasExtras` (o estado do tenant já fica exposto para eles).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cnpjValido } from '../../../packages/platform-sdk/src/documentos';
import {
  DATA_HORA_UTC,
  FORMATO_CHAVE,
  FORMATO_CONECTOR_ID,
  FORMATO_IDEMPOTENCIA,
  LIMITE_CORPO_BYTES,
  LIMITE_REGISTROS_LOTE,
  ORDEM_CARGA_HUB,
  VERSAO_CONTRATO,
  type Contagens,
  type CursorHub,
  type EntidadeHub,
  type EnvelopeLote,
  type ErroLinha,
  type InativacaoLote,
  type LoteAceito,
  type LoteResultado,
  type RegistroHub,
} from './contrato-hub';
import type { Relogio } from './relogio';

// ---------------------------------------------------------------- regras por entidade ----------------------------------

/** Campos obrigatórios por entidade (carga-arquivo.md do FDV; filial com CNPJ e endereço, RN-CORE-39 do FDV). */
const OBRIGATORIOS: Partial<Record<EntidadeHub, readonly string[]>> = {
  filial: ['codigo', 'nome', 'cnpj', 'logradouro', 'numero', 'bairro', 'cep', 'cidade', 'uf'],
  vendedor: ['nome'],
  forma_pagamento: ['codigo', 'nome'],
  prazo_pagamento: ['forma_external_id', 'codigo', 'parcelas_dias'],
  produto: ['sku', 'nome', 'unidade'],
  produto_unidade: ['produto_external_id', 'unidade', 'fator'],
  preco: ['tabela_external_id', 'tabela_nome', 'vigencia_inicio', 'produto_external_id', 'preco_cents'],
  estoque: ['deposito_external_id', 'produto_external_id', 'saldo'],
  cliente: ['razao_social'],
  cliente_endereco: ['cliente_external_id', 'logradouro', 'cidade', 'uf'],
  titulo: ['cliente_external_id', 'numero', 'vencimento', 'valor_cents', 'saldo_cents', 'situacao'],
  nota: ['cliente_external_id', 'tipo', 'numero', 'emitida_em', 'total_cents'],
};

/** Referências por `external_id` (RN-INT-04 do FDV): [campo, entidade citada]. Ausente/nulo não é conferido. */
const REFERENCIAS: Partial<Record<EntidadeHub, readonly (readonly [string, EntidadeHub])[]>> = {
  vendedor: [['filial_external_id', 'filial']],
  prazo_pagamento: [['forma_external_id', 'forma_pagamento']],
  produto_unidade: [['produto_external_id', 'produto']],
  preco: [
    ['produto_external_id', 'produto'],
    ['filial_external_id', 'filial'],
  ],
  tabela_escalonada: [
    ['produto_external_id', 'produto'],
    ['filial_external_id', 'filial'],
  ],
  estoque: [
    ['produto_external_id', 'produto'],
    ['filial_external_id', 'filial'],
  ],
  cliente: [
    ['filial_external_id', 'filial'],
    ['vendedor_external_id', 'vendedor'],
  ],
  cliente_endereco: [['cliente_external_id', 'cliente']],
  rota: [['vendedor_external_id', 'vendedor']],
  titulo: [['cliente_external_id', 'cliente']],
  nota: [['cliente_external_id', 'cliente']],
};

/** Referência que não pode faltar: ausente vira `referencia_ausente` (o vendedor sempre pertence a uma filial). */
const REFERENCIAS_OBRIGATORIAS: Partial<Record<EntidadeHub, readonly string[]>> = {
  vendedor: ['filial_external_id'],
};

/** Sem `filial_external_id`, o registro vale para a filial padrão do tenant. */
const VAI_PARA_FILIAL_PADRAO: ReadonlySet<EntidadeHub> = new Set<EntidadeHub>(['preco', 'estoque']);
/** Identificador interno da filial padrão de um tenant novo do dublê (não é `external_id` de carga). */
export const FILIAL_PADRAO_DUBLE = 'filial-padrao-do-tenant';

const SITUACOES_TITULO = ['aberto', 'baixado', 'cancelado'];
const DECIMAL = /^-?\d+(\.\d{1,4})?$/;
/** Trava de inativação em massa na carga completa (RN-INT-06 do FDV). */
const LIMITE_INATIVACAO = 0.3;
/**
 * `parcelas_dias` do prazo é lista de inteiros de 0 a 999, com ao menos um item (`[28, 56]`; à vista `[0]`),
 * como o Hub real exige (T-0085, `PrazoPagamentoHub` em modules/integracao-fdv/contracts/hub.ts). O texto "28/56" é recusado.
 */
const parcelasDiasValidas = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 999);

// ---------------------------------------------------------------- tipos públicos ---------------------------------------

export interface ConectorDuble {
  tenant: string;
  conectorId: string;
  chave: string;
  /** Entidades do cadastro do Conector no FDV (P-6 e RN-INT-13 do FDV); ausente no cadastro = todas. */
  entidades: readonly EntidadeHub[];
}

/** Recusa de uma ação de cadastro do Conector (no FDV, a tela de Conectores do BKO). */
export class ErroBkoDuble extends Error {
  override readonly name = 'ErroBkoDuble';
  constructor(
    readonly status: 409,
    readonly codigo: 'topologia_conflitante',
    readonly entidades: readonly EntidadeHub[],
  ) {
    super(`HTTP ${status} ${codigo}: ${entidades.join(', ')} já tem outro Conector dono.`);
  }
}

export interface FalhaProgramada {
  /** `POST /lotes`, `GET /lotes`, `POST /sinal`… (método + primeiro segmento) ou `*`. */
  rota: string;
  status: 429 | 500 | 503;
  /** Valor cru do cabeçalho (segundos ou data HTTP). */
  retryAfter?: string;
  vezes?: number;
}

export interface RequisicaoVista {
  metodo: string;
  caminho: string;
  status: number;
  em: string;
  /** Cabeçalhos do pedido, com `authorization` mascarado. */
  cabecalhos: Record<string, string>;
  idempotencyKey: string | null;
  /** SHA-256 do corpo recebido (prova o "mesmo corpo" na retentativa sem guardar o conteúdo). */
  corpoSha256: string | null;
  tenant: string | null;
}

interface RegistroGuardado {
  registro: RegistroHub;
  hash: string;
  ativo: boolean;
  /** Preço e estoque: a filial em que o registro vale (a padrão, quando veio sem filial). */
  filial: string | null;
}

interface LoteInterno {
  id: string;
  tenant: string;
  conectorId: string;
  aceito: LoteAceito;
  resultado: LoteResultado;
  cursorPendente: { entidade: EntidadeHub; cursor: CursorHub } | null;
  consultas: number;
}

export interface EstadoTenantDuble {
  registros: Map<EntidadeHub, Map<string, RegistroGuardado>>;
  cursores: Map<EntidadeHub, CursorHub>;
  lotes: Map<string, LoteInterno>;
  idempotencia: Map<string, { hashConteudo: string; loteId: string }>;
  sessoes: Map<string, { entidade: EntidadeHub; ids: Set<string> }>;
  /** Dono de cada entidade no tenant (um Conector por entidade). */
  donos: Map<EntidadeHub, string>;
  /** Filial padrão do tenant (preço e estoque sem filial). */
  filialPadrao: string;
  /** Livre para a T-0017 (fila de pedidos e retornos). */
  extras: Map<string, unknown>;
}

export interface ContextoRota {
  metodo: string;
  caminho: string;
  consulta: URLSearchParams;
  corpo: unknown;
  conector: ConectorDuble;
  estado: EstadoTenantDuble;
  agora: Date;
}

export interface RespostaRota {
  status: number;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

/** Ponto de extensão (T-0017): rota extra, testada antes das rotas da ida. */
export interface RotaExtra {
  metodo: 'GET' | 'POST';
  padrao: RegExp;
  tratar(ctx: ContextoRota): RespostaRota | Promise<RespostaRota>;
}

export interface Taxa {
  balde: number;
  porMinuto: number;
}

export interface OpcoesDuble {
  relogio: Relogio;
  /** Quantas consultas `GET /lotes/{id}` respondem `processando` antes do estado final (padrão 1). */
  consultasAtePronto?: number;
  taxa?: { lotes?: Taxa; geral?: Taxa };
  versaoMinima?: string;
  versaoMinimaPorEntidade?: Partial<Record<EntidadeHub, string>>;
  rotasExtras?: readonly RotaExtra[];
}

export interface DubleHub {
  /** Base com `/integracao/v1`, sem barra final. */
  readonly url: string;
  /** Cadastra o Conector; `entidades` ausente = todas. Entidade com outro dono = `ErroBkoDuble` 409 `topologia_conflitante`. */
  registrarConector(
    c: Omit<ConectorDuble, 'chave' | 'entidades'> & { chave?: string; entidades?: readonly EntidadeHub[] },
  ): ConectorDuble;
  /** Troca as entidades do Conector (virada entidade por entidade); entidade com outro dono = 409 `topologia_conflitante`. */
  alterarEntidades(tenant: string, conectorId: string, entidades: readonly EntidadeHub[]): void;
  donoDaEntidade(tenant: string, entidade: EntidadeHub): string | null;
  /** Aponta a filial padrão do tenant para uma filial carregada. */
  definirFilialPadrao(tenant: string, filialExternalId: string): void;
  /** Preço e estoque: em que filial o registro vale (`FILIAL_PADRAO_DUBLE` ou a apontada, quando veio sem filial). */
  filialAplicada(tenant: string, entidade: EntidadeHub, externalId: string): string | null;
  /** Grava registros como se outro Conector (o kit) já os tivesse enviado, sem HTTP e sem mexer no cursor. */
  semear(tenant: string, entidade: EntidadeHub, registros: readonly RegistroHub[]): void;
  programarFalha(f: FalhaProgramada): void;
  readonly requisicoes: readonly RequisicaoVista[];
  /** Linhas do log de acesso do dublê (método, caminho, status; nunca corpo nem chave). */
  readonly log: readonly string[];
  contar(tenant: string, entidade: EntidadeHub, filtro?: { ativos?: boolean }): number;
  registro(tenant: string, entidade: EntidadeHub, externalId: string): RegistroHub | null;
  estado(tenant: string): EstadoTenantDuble;
  fechar(): Promise<void>;
}

/** Chave no formato do Hub (`mxc_` + 43 base64url), gerada na hora; nunca fixa no código. */
export function gerarChaveConector(): string {
  return `mxc_${randomBytes(32).toString('base64url')}`;
}

// ---------------------------------------------------------------- utilidades -------------------------------------------

class Resposta extends Error {
  constructor(
    readonly status: number,
    readonly corpo: unknown,
    readonly cabecalhos: Record<string, string> = {},
  ) {
    super(`HTTP ${status}`);
  }
}

function erroPadrao(
  status: number,
  codigo: string,
  mensagem: string,
  campo: string | null = null,
  cabecalhos: Record<string, string> = {},
): Resposta {
  return new Resposta(status, { codigo, mensagem, erros: [{ codigo, campo, mensagem }] }, cabecalhos);
}

/** JSON com chaves em ordem: a identidade do conteúdo não depende da ordem dos campos. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const sha256 = (t: string | Buffer) => createHash('sha256').update(t).digest('hex');
const ehEntidade = (e: unknown): e is EntidadeHub =>
  typeof e === 'string' && (ORDEM_CARGA_HUB as readonly string[]).includes(e);
const vazio = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function compararVersao(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function compararCursor(a: CursorHub, b: CursorHub): number {
  const dt = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
  if (dt !== 0) return dt < 0 ? -1 : 1;
  return Buffer.compare(Buffer.from(a.external_id), Buffer.from(b.external_id));
}

async function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  let total = 0;
  let grande = false;
  for await (const p of req) {
    const b = p as Buffer;
    total += b.length;
    if (total > LIMITE_CORPO_BYTES) grande = true;
    else partes.push(b);
  }
  if (grande) throw erroPadrao(413, 'corpo_grande', 'O corpo da requisição passa do limite desta rota.');
  return Buffer.concat(partes);
}

function estadoNovo(): EstadoTenantDuble {
  return {
    registros: new Map(),
    cursores: new Map(),
    lotes: new Map(),
    idempotencia: new Map(),
    sessoes: new Map(),
    donos: new Map(),
    filialPadrao: FILIAL_PADRAO_DUBLE,
    extras: new Map(),
  };
}

function zeros(recebidas: number): Contagens {
  return {
    recebidas,
    duplicadas_no_lote: 0,
    com_erro: 0,
    novas: 0,
    atualizadas: 0,
    inalteradas: 0,
    obsoletas: 0,
  };
}

// ---------------------------------------------------------------- validação de linha ----------------------------------

type FalhaLinha = Pick<ErroLinha, 'codigo' | 'campo' | 'mensagem' | 'reprocessavel'>;
const falha = (
  codigo: string,
  campo: string | null,
  mensagem: string,
  reprocessavel = false,
): FalhaLinha => ({ codigo, campo, mensagem, reprocessavel });

function validarLinha(
  entidade: EntidadeHub,
  r: Record<string, unknown>,
  estado: EstadoTenantDuble,
): FalhaLinha | null {
  if (typeof r.external_id !== 'string' || r.external_id.length < 1 || r.external_id.length > 200) {
    return falha(
      'campo_obrigatorio',
      'external_id',
      'O campo "external_id" é obrigatório (até 200 caracteres).',
    );
  }
  if (
    typeof r.alterado_em !== 'string' ||
    !DATA_HORA_UTC.test(r.alterado_em) ||
    Number.isNaN(Date.parse(r.alterado_em))
  ) {
    return falha(
      'campo_obrigatorio',
      'alterado_em',
      'O campo "alterado_em" é obrigatório, em data-hora UTC (ISO 8601 com Z).',
    );
  }
  if (r.ativo !== undefined && typeof r.ativo !== 'boolean')
    return falha('registro_invalido', 'ativo', 'O campo "ativo" deve ser verdadeiro ou falso.');
  for (const campo of OBRIGATORIOS[entidade] ?? []) {
    if (vazio(r[campo])) return falha('campo_obrigatorio', campo, `O campo "${campo}" é obrigatório.`);
  }
  for (const [campo, v] of Object.entries(r)) {
    if (
      campo.endsWith('_cents') &&
      v !== undefined &&
      v !== null &&
      (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    ) {
      return falha(
        'valor_fora_da_faixa',
        campo,
        `O campo "${campo}" deve ser um inteiro em centavos, sem sinal.`,
      );
    }
  }
  if (entidade === 'filial') {
    if (!cnpjValido(String(r.cnpj)))
      return falha('registro_invalido', 'cnpj', 'CNPJ da filial inválido (dígito verificador).');
    if (!/^[A-Z]{2}$/.test(String(r.uf))) return falha('registro_invalido', 'uf', 'UF deve ter 2 letras.');
  }
  if (entidade === 'produto_unidade' && !DECIMAL.test(String(r.fator)))
    return falha('registro_invalido', 'fator', 'O fator deve ser decimal com até 4 casas.');
  if (entidade === 'estoque' && !DECIMAL.test(String(r.saldo)))
    return falha('registro_invalido', 'saldo', 'O saldo deve ser decimal com até 4 casas.');
  if (entidade === 'prazo_pagamento' && !parcelasDiasValidas(r.parcelas_dias)) {
    return falha(
      'registro_invalido',
      'parcelas_dias',
      'Os dias das parcelas vão como lista de inteiros (ex.: [28, 56]; à vista [0]).',
    );
  }
  if (entidade === 'titulo' && !SITUACOES_TITULO.includes(String(r.situacao)))
    return falha('valor_nao_permitido', 'situacao', 'Situação do título fora da lista.');
  for (const campo of REFERENCIAS_OBRIGATORIAS[entidade] ?? []) {
    if (vazio(r[campo])) {
      return falha(
        'referencia_ausente',
        campo,
        `O campo "${campo}" é obrigatório e aponta para a filial do registro. Envie a referência; o Hub reprocessa a linha.`,
        true,
      );
    }
  }
  for (const [campo, alvo] of REFERENCIAS[entidade] ?? []) {
    const ref = r[campo];
    if (vazio(ref)) continue;
    if (typeof ref !== 'string' || !estado.registros.get(alvo)?.has(ref)) {
      return falha(
        'referencia_ausente',
        campo,
        `O campo "${campo}" aponta para um(a) ${alvo} que ainda não foi carregado(a). Envie o(a) ${alvo}; o Hub reprocessa a linha.`,
        true,
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------- o dublê ----------------------------------------------

export async function criarDubleHub(o: OpcoesDuble): Promise<DubleHub> {
  const relogio = o.relogio;
  const consultasAtePronto = o.consultasAtePronto ?? 1;
  const taxa = {
    lotes: o.taxa?.lotes ?? { balde: 30, porMinuto: 20 },
    geral: o.taxa?.geral ?? { balde: 300, porMinuto: 300 },
  };
  const conectores = new Map<string, ConectorDuble>();
  const estados = new Map<string, EstadoTenantDuble>();
  const baldes = new Map<string, { fichas: number; em: number }>();
  const falhas: (FalhaProgramada & { restam: number })[] = [];
  const requisicoes: RequisicaoVista[] = [];
  const log: string[] = [];

  const estadoDe = (tenant: string) => {
    let e = estados.get(tenant);
    if (!e) {
      e = estadoNovo();
      estados.set(tenant, e);
    }
    return e;
  };

  /** Balde por Conector e classe de rota; devolve os segundos de espera (0 = passou). */
  function gastarFicha(conectorId: string, classe: 'lotes' | 'geral'): number {
    const t = taxa[classe];
    const chave = `${conectorId}:${classe}`;
    const agora = relogio.agora().getTime();
    const b = baldes.get(chave) ?? { fichas: t.balde, em: agora };
    b.fichas = Math.min(t.balde, b.fichas + ((agora - b.em) * t.porMinuto) / 60_000);
    b.em = agora;
    baldes.set(chave, b);
    if (b.fichas >= 1) {
      b.fichas -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil(((1 - b.fichas) * 60) / t.porMinuto));
  }

  function autenticar(req: IncomingMessage): ConectorDuble {
    const aut = req.headers.authorization ?? '';
    const id = req.headers['x-macuxi-conector-id'];
    const chave = aut.startsWith('Bearer ') ? aut.slice(7) : '';
    const c = FORMATO_CHAVE.test(chave) ? [...conectores.values()].find((x) => x.chave === chave) : undefined;
    if (!c || typeof id !== 'string' || !FORMATO_CONECTOR_ID.test(id) || id !== c.conectorId) {
      throw erroPadrao(401, 'credencial_invalida', 'Credencial inválida.');
    }
    return c;
  }

  function verificarVersao(req: IncomingMessage, entidade: EntidadeHub | null): void {
    const minima = (entidade && o.versaoMinimaPorEntidade?.[entidade]) || o.versaoMinima;
    if (!minima) return;
    const v = req.headers['x-macuxi-conector-versao'];
    if (typeof v !== 'string' || compararVersao(v, minima) < 0) {
      throw erroPadrao(
        426,
        'abaixo_da_minima',
        `A versão do Conector está abaixo da mínima (${minima}). Atualize o Conector.`,
        entidade ? 'entidade' : null,
      );
    }
  }

  // ---------------- cadastro de Conector e upsert ----------------

  /** Um Conector por entidade: devolve as entidades que já têm outro dono no tenant. */
  function conflitos(tenant: string, conectorId: string, entidades: readonly EntidadeHub[]): EntidadeHub[] {
    const donos = estadoDe(tenant).donos;
    return entidades.filter((e) => donos.has(e) && donos.get(e) !== conectorId);
  }

  function assumir(tenant: string, conectorId: string, entidades: readonly EntidadeHub[]): void {
    const donos = estadoDe(tenant).donos;
    for (const [e, dono] of [...donos]) if (dono === conectorId) donos.delete(e);
    for (const e of entidades) donos.set(e, conectorId);
  }

  function guardar(
    entidade: EntidadeHub,
    r: RegistroHub,
    hash: string,
    estado: EstadoTenantDuble,
  ): RegistroGuardado {
    const filialInformada =
      typeof r.filial_external_id === 'string' && r.filial_external_id.trim() !== ''
        ? r.filial_external_id
        : null;
    const filial = VAI_PARA_FILIAL_PADRAO.has(entidade) ? (filialInformada ?? estado.filialPadrao) : null;
    return { registro: r, hash, ativo: r.ativo !== false, filial };
  }

  const hashRegistro = (r: RegistroHub) => {
    const { alterado_em: _a, ...semData } = r;
    return sha256(canonico(semData));
  };

  // ---------------- POST /lotes ----------------

  function aplicar(
    c: ConectorDuble,
    estado: EstadoTenantDuble,
    env: EnvelopeLote & { entidade: EntidadeHub },
    loteId: string,
  ): LoteInterno {
    const agora = relogio.agora().toISOString();
    const contagens = zeros(env.registros.length);
    const erros: ErroLinha[] = [];
    for (const [i, l] of (env.linhas_invalidas ?? []).entries()) {
      erros.push({
        indice: i,
        external_id: l.external_id ?? null,
        codigo: l.codigo,
        campo: l.campo ?? null,
        mensagem: 'Linha recusada pelo Conector antes do envio.',
        reprocessavel: false,
        origem: 'conector',
      });
    }
    const ultimaPosicao = new Map<string, number>();
    env.registros.forEach((r, i) => {
      if (r && typeof r.external_id === 'string') ultimaPosicao.set(r.external_id, i);
    });
    const sessao = env.modo === 'completo' && env.sessao ? env.sessao : null;
    const chaveSessao = sessao ? `${c.conectorId}:${sessao.id}` : null;
    if (chaveSessao && !estado.sessoes.has(chaveSessao))
      estado.sessoes.set(chaveSessao, { entidade: env.entidade, ids: new Set() });
    const daSessao = chaveSessao ? estado.sessoes.get(chaveSessao)!.ids : null;
    let mapa = estado.registros.get(env.entidade);
    if (!mapa) {
      mapa = new Map();
      estado.registros.set(env.entidade, mapa);
    }
    let maior: CursorHub | null = null;

    env.registros.forEach((bruto, i) => {
      if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
        contagens.com_erro++;
        erros.push({
          indice: i,
          external_id: null,
          codigo: 'registro_invalido',
          campo: null,
          mensagem: 'O registro deve ser um objeto.',
          reprocessavel: false,
          origem: 'hub',
        });
        return;
      }
      const r = bruto as RegistroHub;
      if (typeof r.external_id === 'string' && ultimaPosicao.get(r.external_id) !== i) {
        contagens.duplicadas_no_lote++;
        return;
      }
      if (typeof r.external_id === 'string') daSessao?.add(r.external_id);
      const f = validarLinha(env.entidade, r, estado);
      if (f) {
        contagens.com_erro++;
        erros.push({
          indice: i,
          external_id: typeof r.external_id === 'string' ? r.external_id : null,
          ...f,
          origem: 'hub',
        });
        return;
      }
      const hash = hashRegistro(r);
      const atual = mapa.get(r.external_id);
      const guardado = guardar(env.entidade, r, hash, estado);
      if (!atual) {
        contagens.novas++;
        mapa.set(r.external_id, guardado);
      } else if (atual.hash === hash) {
        contagens.inalteradas++;
      } else if (Date.parse(r.alterado_em) < Date.parse(atual.registro.alterado_em)) {
        contagens.obsoletas++;
      } else {
        contagens.atualizadas++;
        mapa.set(r.external_id, guardado);
      }
      const cur = { alterado_em: r.alterado_em, external_id: r.external_id };
      if (!maior || compararCursor(cur, maior) > 0) maior = cur;
    });

    let inativacao: InativacaoLote | null = null;
    if (sessao?.ultimo && daSessao && chaveSessao) {
      const ativos = [...mapa.entries()].filter(([, g]) => g.ativo);
      const sobra = ativos.filter(([id]) => !daSessao.has(id));
      if (sobra.length === 0) inativacao = { situacao: 'nada_a_inativar', quantidade: 0 };
      else if (sobra.length / ativos.length > LIMITE_INATIVACAO)
        inativacao = { situacao: 'aguardando_confirmacao', quantidade: sobra.length };
      else {
        for (const [, g] of sobra) g.ativo = false;
        inativacao = { situacao: 'aplicada', quantidade: sobra.length };
      }
      estado.sessoes.delete(chaveSessao);
    }

    erros.sort((a, b) => a.indice - b.indice);
    const resultado: LoteResultado = {
      lote_id: loteId,
      entidade: env.entidade,
      modo: env.modo,
      status: erros.length ? 'concluido_com_erros' : 'concluido',
      contagens,
      erros,
      erros_total: erros.length,
      erros_omitidos: 0,
      inativacao,
      recebido_em: agora,
      concluido_em: agora,
    };
    const aceito: LoteAceito = {
      lote_id: loteId,
      status: 'recebido',
      entidade: env.entidade,
      modo: env.modo,
      recebidos: env.registros.length,
      repetido: false,
      consulta: `/integracao/v1/lotes/${loteId}`,
    };
    const fim: CursorHub | null = maior;
    return {
      id: loteId,
      tenant: c.tenant,
      conectorId: c.conectorId,
      aceito,
      resultado,
      cursorPendente: fim ? { entidade: env.entidade, cursor: fim } : null,
      consultas: 0,
    };
  }

  function postLotes(req: IncomingMessage, c: ConectorDuble, corpo: Buffer): RespostaRota {
    const chave = req.headers['idempotency-key'];
    if (typeof chave !== 'string' || chave === '') {
      throw erroPadrao(
        400,
        'chave_idempotencia_invalida',
        'O cabeçalho Idempotency-Key é obrigatório em POST /lotes.',
        'Idempotency-Key',
      );
    }
    if (!FORMATO_IDEMPOTENCIA.test(chave)) {
      // premissa do arnês (docs/testes/T-0012.md): fora do formato = 422; conferir o status na rodada real
      throw erroPadrao(
        422,
        'chave_idempotencia_invalida',
        'O cabeçalho Idempotency-Key deve ter de 16 a 128 caracteres entre letras, números, ponto, hífen, sublinhado e dois-pontos.',
        'Idempotency-Key',
      );
    }
    let env: EnvelopeLote;
    try {
      env = JSON.parse(corpo.toString('utf8')) as EnvelopeLote;
    } catch {
      throw erroPadrao(400, 'envelope_invalido', 'O corpo não é um JSON válido.');
    }
    if (!env || typeof env !== 'object')
      throw erroPadrao(400, 'envelope_invalido', 'O corpo deve ser um objeto.');
    if (env.versao_contrato !== VERSAO_CONTRATO)
      throw erroPadrao(
        422,
        'versao_nao_suportada',
        'Versão de contrato não suportada. Use "v1".',
        'versao_contrato',
      );
    if (!ehEntidade(env.entidade))
      throw erroPadrao(422, 'entidade_desconhecida', 'Entidade desconhecida.', 'entidade');
    const entidade = env.entidade;
    if (!Array.isArray(env.registros))
      throw erroPadrao(400, 'envelope_invalido', 'registros deve ser uma lista.', 'registros');
    if (env.modo !== 'completo' && env.modo !== 'delta')
      throw erroPadrao(400, 'envelope_invalido', 'modo deve ser "completo" ou "delta".', 'modo');
    verificarVersao(req, entidade);
    if (estadoDe(c.tenant).donos.get(entidade) !== c.conectorId) {
      throw erroPadrao(
        422,
        'entidade_de_outro_conector',
        `A entidade "${entidade}" é de outro Conector desta empresa (um Conector por entidade).`,
        'entidade',
      );
    }
    const temInvalidas = (env.linhas_invalidas?.length ?? 0) > 0;
    if (env.registros.length === 0 && !temInvalidas)
      throw erroPadrao(
        422,
        'lote_vazio',
        'O lote não tem registros. Envie ao menos um registro.',
        'registros',
      );
    if (env.registros.length > LIMITE_REGISTROS_LOTE) {
      throw erroPadrao(
        422,
        'acima_do_limite',
        `O lote tem ${env.registros.length} registros e o limite é ${LIMITE_REGISTROS_LOTE}. Divida em lotes menores (na carga completa, use partes da mesma sessão).`,
        'registros',
      );
    }
    if (env.modo === 'completo' && !env.sessao)
      throw erroPadrao(
        422,
        'sessao_ausente',
        'A carga completa exige "sessao" (id, parte e ultimo).',
        'sessao',
      );
    if (env.modo === 'delta' && env.sessao)
      throw erroPadrao(422, 'sessao_nao_se_aplica', 'O delta não leva "sessao".', 'sessao');

    const estado = estadoDe(c.tenant);
    const hashConteudo = sha256(
      canonico({
        versao: env.versao_contrato,
        entidade,
        modo: env.modo,
        sessao: env.sessao ?? null,
        registros: env.registros,
        linhas_invalidas: env.linhas_invalidas ?? [],
        linhas_invalidas_omitidas: env.linhas_invalidas_omitidas ?? 0,
      }),
    );
    const chaveIdem = `${c.conectorId}:${chave}`;
    const anterior = estado.idempotencia.get(chaveIdem);
    if (anterior) {
      if (anterior.hashConteudo !== hashConteudo) {
        throw erroPadrao(
          409,
          'chave_idempotencia_reutilizada',
          'Esta Idempotency-Key já foi usada com outro conteúdo.',
          'Idempotency-Key',
        );
      }
      const lote = estado.lotes.get(anterior.loteId)!;
      return {
        status: 202,
        corpo: { ...lote.aceito, repetido: true },
        cabecalhos: { 'idempotent-replay': 'true' },
      };
    }
    const lote = aplicar(c, estado, { ...env, entidade }, randomUUID());
    estado.lotes.set(lote.id, lote);
    estado.idempotencia.set(chaveIdem, { hashConteudo, loteId: lote.id });
    if (consultasAtePronto === 0) finalizar(estado, lote);
    return { status: 202, corpo: lote.aceito };
  }

  /** O cursor só avança quando o lote chega ao estado final. */
  function finalizar(estado: EstadoTenantDuble, lote: LoteInterno): void {
    if (!lote.cursorPendente) return;
    const { entidade, cursor } = lote.cursorPendente;
    const atual = estado.cursores.get(entidade);
    if (!atual || compararCursor(cursor, atual) > 0) estado.cursores.set(entidade, cursor);
    lote.cursorPendente = null;
  }

  function getLote(c: ConectorDuble, id: string, consulta: URLSearchParams): RespostaRota {
    const estado = estadoDe(c.tenant);
    const lote = estado.lotes.get(id);
    if (!lote || lote.conectorId !== c.conectorId)
      throw erroPadrao(
        404,
        'lote_nao_encontrado',
        'Lote não encontrado. Reenvie o lote com a mesma Idempotency-Key.',
      );
    const limiteBruto = consulta.get('limite_erros');
    const limite = limiteBruto === null ? 1000 : Number(limiteBruto);
    if (!Number.isInteger(limite) || limite < 0 || limite > 5500)
      throw erroPadrao(
        400,
        'requisicao_invalida',
        'limite_erros deve ser um inteiro de 0 a 5.500.',
        'limite_erros',
      );
    lote.consultas++;
    if (lote.consultas <= consultasAtePronto) {
      return {
        status: 200,
        corpo: {
          ...lote.resultado,
          status: lote.consultas === 1 ? 'recebido' : 'processando',
          contagens: zeros(lote.aceito.recebidos),
          erros: [],
          erros_total: 0,
          erros_omitidos: 0,
          inativacao: null,
          concluido_em: null,
        },
      };
    }
    finalizar(estado, lote);
    const r = lote.resultado;
    return {
      status: 200,
      corpo: { ...r, erros: r.erros.slice(0, limite), erros_omitidos: Math.max(0, r.erros.length - limite) },
    };
  }

  // ---------------- servidor ----------------

  async function tratar(
    req: IncomingMessage,
    corpo: Buffer,
  ): Promise<{ tenant: string; resposta: RespostaRota }> {
    const url = new URL(req.url ?? '/', 'http://duble');
    const metodo = req.method ?? 'GET';
    if (!url.pathname.startsWith('/integracao/v1/'))
      throw erroPadrao(404, 'rota_nao_encontrada', 'Rota não encontrada.');
    const caminho = url.pathname.slice('/integracao/v1'.length);
    const c = autenticar(req);
    const primeiro = `${metodo} /${caminho.split('/')[1] ?? ''}`;
    const programada = falhas.find((f) => f.restam > 0 && (f.rota === '*' || f.rota === primeiro));
    if (programada) {
      programada.restam--;
      const cab: Record<string, string> = programada.retryAfter
        ? { 'retry-after': programada.retryAfter }
        : {};
      const codigo =
        programada.status === 429
          ? 'limite_de_taxa'
          : programada.status === 503
            ? 'servico_indisponivel'
            : 'erro_interno';
      throw erroPadrao(programada.status, codigo, 'Falha programada no dublê.', null, cab);
    }
    const espera = gastarFicha(c.conectorId, metodo === 'POST' && caminho === '/lotes' ? 'lotes' : 'geral');
    if (espera > 0) {
      throw erroPadrao(
        429,
        'limite_de_taxa',
        'O Conector chamou o Hub mais vezes do que o permitido. Aguarde um instante; o Conector retoma sozinho.',
        null,
        { 'retry-after': String(espera) },
      );
    }
    const estado = estadoDe(c.tenant);
    for (const extra of o.rotasExtras ?? []) {
      if (extra.metodo === metodo && extra.padrao.test(caminho)) {
        let json: unknown = null;
        try {
          json = corpo.length ? (JSON.parse(corpo.toString('utf8')) as unknown) : null;
        } catch {
          throw erroPadrao(400, 'requisicao_invalida', 'O corpo não é um JSON válido.');
        }
        const resposta = await extra.tratar({
          metodo,
          caminho,
          consulta: url.searchParams,
          corpo: json,
          conector: c,
          estado,
          agora: relogio.agora(),
        });
        return { tenant: c.tenant, resposta };
      }
    }
    let m: RegExpMatchArray | null;
    if (metodo === 'POST' && caminho === '/lotes')
      return { tenant: c.tenant, resposta: postLotes(req, c, corpo) };
    if (metodo === 'GET' && (m = caminho.match(/^\/lotes\/([^/]+)$/))) {
      if (!/^[0-9a-f-]{36}$/i.test(m[1]!))
        throw erroPadrao(400, 'requisicao_invalida', 'O identificador do lote precisa ser um UUID.', 'id');
      return { tenant: c.tenant, resposta: getLote(c, m[1]!, url.searchParams) };
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/cursores\/([^/]+)$/))) {
      if (!ehEntidade(m[1]))
        throw erroPadrao(404, 'entidade_desconhecida', 'Entidade desconhecida.', 'entidade');
      return {
        tenant: c.tenant,
        resposta: { status: 200, corpo: { entidade: m[1], cursor: estado.cursores.get(m[1]) ?? null } },
      };
    }
    if (metodo === 'POST' && caminho === '/sinal') {
      const politica = { minima: o.versaoMinima ?? null, situacao: 'liberada' };
      return {
        tenant: c.tenant,
        resposta: {
          status: 200,
          corpo: { aceito: true, servidor_em: relogio.agora().toISOString(), politica_versao: politica },
        },
      };
    }
    if (
      (metodo === 'GET' && caminho === '/pedidos/pendentes') ||
      (metodo === 'POST' && /^\/pedidos\/[^/]+\/retorno$/.test(caminho))
    ) {
      throw erroPadrao(
        501,
        'nao_implementado_no_duble',
        'Rota da volta (pedidos): o dublê recebe o tratador na T-0017 (rotasExtras).',
      );
    }
    throw erroPadrao(404, 'rota_nao_encontrada', 'Rota não encontrada.');
  }

  function responder(
    res: ServerResponse,
    status: number,
    corpo: unknown,
    cabecalhos: Record<string, string>,
  ): void {
    const texto = corpo === undefined ? '' : JSON.stringify(corpo);
    res.writeHead(status, {
      ...cabecalhos,
      ...(texto ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    });
    res.end(texto);
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requisicaoId = randomUUID();
    res.setHeader('x-request-id', requisicaoId);
    let corpo: Buffer | null = null;
    let tenant: string | null = null;
    let resposta: RespostaRota;
    try {
      corpo = await lerCorpo(req);
      const t = await tratar(req, corpo);
      tenant = t.tenant;
      resposta = t.resposta;
    } catch (e) {
      const r = e instanceof Resposta ? e : erroPadrao(500, 'erro_interno', 'Erro interno no dublê.');
      if (!(e instanceof Resposta)) log.push(`erro interno do dublê: ${(e as Error).name}`);
      resposta = {
        status: r.status,
        corpo: { ...(r.corpo as object), requisicao_id: requisicaoId },
        cabecalhos: r.cabecalhos,
      };
    }
    responder(res, resposta.status, resposta.corpo, resposta.cabecalhos ?? {});
    const caminho = (req.url ?? '').split('?')[0] ?? '';
    requisicoes.push({
      metodo: req.method ?? '',
      caminho,
      status: resposta.status,
      em: relogio.agora().toISOString(),
      cabecalhos: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          k === 'authorization' ? 'Bearer mxc_***' : String(v),
        ]),
      ),
      idempotencyKey:
        typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null,
      corpoSha256: corpo && corpo.length ? sha256(corpo) : null,
      tenant,
    });
    log.push(`${req.method} ${caminho} ${resposta.status} ${requisicaoId}`);
  }

  const servidor = createServer((req, res) => void atender(req, res));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = (servidor.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${porta}/integracao/v1`,
    registrarConector(c) {
      const entidades = [...(c.entidades ?? ORDEM_CARGA_HUB)];
      const conflito = conflitos(c.tenant, c.conectorId, entidades);
      if (conflito.length) throw new ErroBkoDuble(409, 'topologia_conflitante', conflito);
      const completo: ConectorDuble = { ...c, entidades, chave: c.chave ?? gerarChaveConector() };
      conectores.set(completo.conectorId + ':' + completo.tenant, completo);
      assumir(c.tenant, c.conectorId, entidades);
      return completo;
    },
    alterarEntidades(tenant, conectorId, entidades) {
      const c = conectores.get(conectorId + ':' + tenant);
      if (!c) throw new Error('Conector não cadastrado no dublê.');
      const conflito = conflitos(tenant, conectorId, entidades);
      if (conflito.length) throw new ErroBkoDuble(409, 'topologia_conflitante', conflito);
      c.entidades = [...entidades];
      assumir(tenant, conectorId, entidades);
    },
    donoDaEntidade(tenant, entidade) {
      return estados.get(tenant)?.donos.get(entidade) ?? null;
    },
    definirFilialPadrao(tenant, filialExternalId) {
      estadoDe(tenant).filialPadrao = filialExternalId;
    },
    filialAplicada(tenant, entidade, id) {
      return estados.get(tenant)?.registros.get(entidade)?.get(id)?.filial ?? null;
    },
    semear(tenant, entidade, registros) {
      const estado = estadoDe(tenant);
      let mapa = estado.registros.get(entidade);
      if (!mapa) {
        mapa = new Map();
        estado.registros.set(entidade, mapa);
      }
      for (const r of registros) mapa.set(r.external_id, guardar(entidade, r, hashRegistro(r), estado));
    },
    programarFalha(f) {
      falhas.push({ ...f, restam: f.vezes ?? 1 });
    },
    requisicoes,
    log,
    contar(tenant, entidade, filtro = {}) {
      const m = estados.get(tenant)?.registros.get(entidade);
      if (!m) return 0;
      return filtro.ativos ? [...m.values()].filter((g) => g.ativo).length : m.size;
    },
    registro(tenant, entidade, id) {
      return estados.get(tenant)?.registros.get(entidade)?.get(id)?.registro ?? null;
    },
    estado: estadoDe,
    fechar: () => {
      if (!servidor.listening) return Promise.resolve();
      servidor.closeAllConnections();
      return new Promise<void>((ok, falhou) => servidor.close((e) => (e ? falhou(e) : ok())));
    },
  };
}
