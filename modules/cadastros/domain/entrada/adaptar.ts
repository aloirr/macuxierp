/**
 * ADR 0014 §1 e §2: o registro do Hub (os 10 payloads do `hub-v1` do SDK) vira a MESMA linha interna da carga de CSV. O adaptador
 * só traduz a FORMA (payload tipado → célula de texto do layout da carga); toda validação (RN-CAD-01/02/03/04/06/07/09, tamanhos,
 * formatos) é a de `domain/carga/mapear`, e a junção por cliente e por forma (`agruparClientes`, `conferirFormasDoLote`) e a gravação
 * continuam sendo as da carga. Função pura, sem I/O. Nenhum erro leva o valor do dado (LGPD, RN-CORE-07): só índice, external_id, campo e código.
 *
 * Dez entidades do Hub, oito da carga (T-0058):
 * - `prazo_pagamento` → `condicao_pagamento` (a forma vem do contexto, pelo `forma_external_id`); `forma_pagamento` sozinha só é validada;
 * - `cliente_endereco` → `cliente`, uma linha por endereço, chave (external_id do cliente, `tipo_endereco`, `seq`);
 * - as outras sete têm o mesmo nome.
 *
 * `linha` da carga = índice do registro + 2 (a carga conta o cabeçalho do CSV como linha 1 e o contrato exige linha >= 2).
 */
import { CODIGOS_ERRO_LINHA_HUB, PAYLOADS_HUB, type FormaPagamentoHub } from '@macuxierp/platform-sdk/hub-v1';
import type { EntidadeCarga, LinhasCarga } from '../../contracts';
import { mapearLinha, type ContextoMapeamento, type Registro } from '../carga/mapear';
import type { ErroLinha } from '../carga/erros';

/** Entidades do Hub com contrato nesta fase (F2); título e nota (F4) e as 6 do kit ficam fora. */
export type EntidadeEntrada = keyof typeof PAYLOADS_HUB;
export const ENTIDADES_ENTRADA = Object.keys(PAYLOADS_HUB) as readonly EntidadeEntrada[];

/** Entidade da carga que recebe a linha de cada entidade do Hub (10 → 8). */
export const ENTIDADE_DA_CARGA: Readonly<Record<EntidadeEntrada, EntidadeCarga>> = {
  filial: 'filial', vendedor: 'vendedor', forma_pagamento: 'condicao_pagamento', prazo_pagamento: 'condicao_pagamento',
  produto: 'produto', produto_unidade: 'produto_unidade', preco: 'preco', estoque: 'estoque', cliente: 'cliente', cliente_endereco: 'cliente',
};

export interface ContextoAdaptacao extends ContextoMapeamento {
  /** Formas já conhecidas (deste lote ou já gravadas), por `external_id`: o prazo copia delas código e nome. Ver `indexarFormas`. */
  formas: ReadonlyMap<string, Pick<FormaPagamentoHub, 'codigo' | 'nome'>>;
}

/** As formas ativas por `external_id`, para o contexto do prazo. */
export function indexarFormas(formas: readonly FormaPagamentoHub[]): Map<string, FormaPagamentoHub> {
  return new Map(formas.filter((f) => f.ativo).map((f) => [f.external_id, f]));
}

/** Código do erro por registro, do catálogo do Hub (`CODIGOS_ERRO_LINHA_HUB`). */
export type CodigoErroAdaptacao = Extract<(typeof CODIGOS_ERRO_LINHA_HUB)[number], 'registro_invalido' | 'campo_obrigatorio' | 'tipo_invalido' | 'formato_invalido' | 'valor_fora_da_faixa' | 'valor_nao_permitido' | 'regra_invalida' | 'referencia_ausente'>;

export interface ErroAdaptacao {
  /** Posição do registro no lote, base 0. */
  indice: number;
  external_id: string | null;
  /** Nome do campo no payload do Hub; nunca o valor. */
  campo: string | null;
  codigo: CodigoErroAdaptacao;
  /** Código original da regra da carga (`RN-CAD-01`, `CARGA_FORMATO`...), quando o erro veio dela. */
  regra?: string;
}

export interface AvisoAdaptacao {
  indice: number;
  external_id: string | null;
  codigo: 'endereco_inativo_ignorado';
}

export type ResultadoAdaptacao =
  | { ok: false; codigo: 'entidade_fora_da_fase' }
  | {
      ok: true;
      entidade_carga: EntidadeCarga;
      /** Linhas já mapeadas e validadas, na ordem do lote; entram em `gravarLinhas` como as do CSV. */
      linhas: LinhasCarga[EntidadeCarga][];
      erros: ErroAdaptacao[];
      avisos: AvisoAdaptacao[];
      /** `external_id` (da entidade da carga) dos registros que vieram inválidos: a sessão de carga completa nunca os inativa (RN-INT-06). */
      protegidos: string[];
    };

const semReferencia = (c: Celulas | { referencia_ausente: string }): c is { referencia_ausente: string } => 'referencia_ausente' in c;

const idLegivel = (r: unknown): string | null => {
  const v = typeof r === 'object' && r !== null ? (r as { external_id?: unknown }).external_id : undefined;
  return typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : null;
};

// ---- forma do dado: payload do Hub → célula de texto do layout da carga ----

const t = (v: string | undefined): string => v ?? '';
const bool = (v: boolean): string => (v ? 'true' : 'false');
const inteiro = (n: number): string => String(n);

/** Quantidade numérica → célula decimal. 3 casas viram 4 (a carga recusa `1.234` como ambíguo de milhar); mais de 4 casas seguem e a carga recusa. */
function quantidade(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(12).replace(/0+$/, '');
  const casas = s.split('.')[1]?.length ?? 0;
  return casas <= 4 ? s.padEnd(s.length + (4 - casas), '0') : s;
}

type Payload = Record<string, unknown>;
type Celulas = Record<string, string>;
const p = <K extends string>(x: Payload, k: K): string => t(x[k] as string | undefined);
const enderecoCelulas = (e: Payload | undefined, prefixo: string): Celulas => {
  const o: Celulas = {};
  for (const c of ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep']) o[`${prefixo}${c}`] = t(e?.[c] as string | undefined);
  return o;
};

/** Um registro validado do Hub → as células da carga. `null` = não gera linha. */
const CELULAS: { [E in EntidadeEntrada]: (x: Payload, ctx: ContextoAdaptacao, extra: { seq?: number }) => Celulas | null | { referencia_ausente: string } } = {
  filial: (x) => ({
    external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), codigo: p(x, 'codigo'), nome: p(x, 'nome'), cidade: p(x, 'cidade'), uf: p(x, 'uf'), cnpj: p(x, 'cnpj'),
    logradouro: p(x, 'logradouro'), numero: p(x, 'numero'), complemento: p(x, 'complemento'), bairro: p(x, 'bairro'), cep: p(x, 'cep'),
  }),
  vendedor: (x) => ({ external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), nome: p(x, 'nome'), filial_external_id: p(x, 'filial_external_id') }),
  forma_pagamento: () => null,
  prazo_pagamento: (x, ctx) => {
    const forma = ctx.formas.get(p(x, 'forma_external_id'));
    if (!forma) return { referencia_ausente: 'forma_external_id' } as { referencia_ausente: string };
    const c: Celulas = {
      external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), codigo: p(x, 'codigo'), parcelas_dias: p(x, 'parcelas_dias'), descricao: p(x, 'descricao'),
      forma_external_id: p(x, 'forma_external_id'), forma_codigo: forma.codigo, forma_nome: forma.nome,
    };
    return c;
  },
  produto: (x) => ({ external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), sku: p(x, 'sku'), nome: p(x, 'nome'), unidade: p(x, 'unidade'), ean: p(x, 'ean'), marca: p(x, 'marca') }),
  produto_unidade: (x) => ({
    external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), produto_external_id: p(x, 'produto_external_id'), unidade: p(x, 'unidade'), fator: quantidade(x.fator as number), ean: p(x, 'ean'),
  }),
  preco: (x) => ({
    external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), tabela_external_id: p(x, 'tabela_external_id'), tabela_nome: p(x, 'tabela_nome'), vigencia_inicio: p(x, 'vigencia_inicio'),
    vigencia_fim: p(x, 'vigencia_fim'), produto_external_id: p(x, 'produto_external_id'), preco_cents: inteiro(x.preco_cents as number), filial_external_id: p(x, 'filial_external_id'),
  }),
  estoque: (x) => ({
    external_id: p(x, 'external_id'), deposito_external_id: p(x, 'deposito_external_id'), produto_external_id: p(x, 'produto_external_id'), saldo: quantidade(x.saldo as number), filial_external_id: p(x, 'filial_external_id'),
  }),
  cliente: (x) => ({
    external_id: p(x, 'external_id'), ativo: bool(x.ativo as boolean), razao_social: p(x, 'razao_social'), nome_fantasia: p(x, 'nome_fantasia'), documento: p(x, 'documento'),
    inscricao_estadual: p(x, 'inscricao_estadual'), vendedor_external_id: p(x, 'vendedor_external_id'), filial_external_id: p(x, 'filial_external_id'),
    limite_credito_cents: inteiro(x.limite_credito_cents as number), ...enderecoCelulas(x.endereco as Payload | undefined, 'endereco.'),
  }),
  // Sem `ativo`: na carga ele é o do CLIENTE da linha, e um endereço inativo não pode inativar o cliente.
  cliente_endereco: (x, _ctx, extra) => (x.ativo === false ? null : {
    external_id: p(x, 'cliente_external_id'), tipo_endereco: p(x, 'tipo'), seq: extra.seq === undefined || extra.seq < 2 ? '' : inteiro(extra.seq), ...enderecoCelulas(x, 'endereco.'),
  }),
};

// ---- erro: nome do campo e código no vocabulário do Hub ----

/** Campo da carga → campo do payload do Hub (só os que mudam de nome); o resto vai como está. */
const CAMPO_DO_HUB: Readonly<Partial<Record<EntidadeEntrada, Readonly<Record<string, string>>>>> = {
  filial: { razao_social: 'nome' },
  produto: { codigo: 'sku', descricao: 'nome', unidade_comercial: 'unidade' },
  preco: { 'tabela.external_id': 'tabela_external_id', 'tabela.nome': 'tabela_nome', 'tabela.vigencia_inicio': 'vigencia_inicio', 'tabela.vigencia_fim': 'vigencia_fim', preco_centavos: 'preco_cents' },
  cliente: { limite_credito_centavos: 'limite_credito_cents' },
  prazo_pagamento: { prazos_dias: 'parcelas_dias', parcelas_cartao: 'parcelas_dias', forma_codigo: 'forma_external_id', forma_nome: 'forma_external_id', forma_tpag: 'forma_external_id' },
};
const CAMPO_VALIDO = /^[A-Za-z0-9_.[\]]{1,80}$/;

function campoDoHub(entidade: EntidadeEntrada, campo: string | null): string | null {
  if (campo === null) return null;
  let c = campo.replace(/^refs\.(.+)$/, '$1_external_id');
  c = c.replace(/^enderecos\.\d+\./, entidade === 'cliente_endereco' ? '' : 'endereco.');
  if (entidade === 'cliente_endereco') c = c.replace(/^endereco\./, '');
  if (entidade === 'cliente_endereco' && c === 'tipo_endereco') c = 'tipo';
  if (entidade === 'cliente_endereco' && c === 'external_id') c = 'cliente_external_id';
  c = CAMPO_DO_HUB[entidade]?.[c] ?? c;
  return CAMPO_VALIDO.test(c) ? c : null;
}

function codigoDoHub(regra: string): CodigoErroAdaptacao {
  switch (regra) {
    case 'CARGA_OBRIGATORIO': return 'campo_obrigatorio';
    case 'CARGA_TAMANHO': return 'valor_fora_da_faixa';
    case 'CARGA_FORMATO': return 'formato_invalido';
    case 'CARGA_DEPENDENCIA': return 'referencia_ausente';
    default: return 'regra_invalida'; // RN-*, D8, CARGA_CONFLITO, CARGA_DUPLICADO
  }
}

/** Falha do Zod do payload → erros do Hub; só o caminho e o tipo do problema, nunca `received`/mensagem com o valor. */
function errosDoPayload(indice: number, externalId: string | null, issues: readonly { code: string; path: readonly PropertyKey[]; received?: unknown }[]): ErroAdaptacao[] {
  const vistos = new Set<string>();
  const erros: ErroAdaptacao[] = [];
  for (const i of issues) {
    const campo = i.path.length === 0 ? null : i.path.map(String).join('.');
    const codigo: CodigoErroAdaptacao =
      i.code === 'invalid_type' ? (i.received === 'undefined' ? 'campo_obrigatorio' : i.path.length === 0 ? 'registro_invalido' : 'tipo_invalido')
        : i.code === 'too_small' || i.code === 'too_big' ? 'valor_fora_da_faixa'
          : i.code === 'invalid_enum_value' ? 'valor_nao_permitido'
            : 'formato_invalido';
    const chave = `${campo}|${codigo}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    erros.push({ indice, external_id: externalId, campo: campo !== null && CAMPO_VALIDO.test(campo) ? campo : null, codigo });
  }
  return erros;
}

const doErroLinha = (entidade: EntidadeEntrada, indice: number, externalId: string | null, e: ErroLinha): ErroAdaptacao => ({
  indice, external_id: externalId, campo: campoDoHub(entidade, e.campo), codigo: codigoDoHub(e.codigo), regra: e.codigo,
});

/**
 * Adapta os registros de um lote do Hub. `entidade` é o texto do envelope: fora das 10 da fase devolve `entidade_fora_da_fase`
 * (o lote inteiro é recusado, 422). Registro inválido (payload ou regra da carga) vira erro por registro e não entra em `linhas`;
 * os válidos seguem (RN-INT-01/03).
 */
export function adaptarLote(entidade: string, registros: readonly unknown[], ctx: ContextoAdaptacao): ResultadoAdaptacao {
  if (!(ENTIDADES_ENTRADA as readonly string[]).includes(entidade)) return { ok: false, codigo: 'entidade_fora_da_fase' };
  const e = entidade as EntidadeEntrada;
  const destino = ENTIDADE_DA_CARGA[e];
  const linhas: LinhasCarga[EntidadeCarga][] = [];
  const erros: ErroAdaptacao[] = [];
  const avisos: AvisoAdaptacao[] = [];
  const protegidos = new Set<string>();
  const proteger = (r: unknown): void => {
    const id = e === 'cliente_endereco' ? ((r as { cliente_external_id?: unknown } | null)?.cliente_external_id) : idLegivel(r);
    if (typeof id === 'string' && id.length > 0) protegidos.add(id);
  };
  const porTipo = new Map<string, number>(); // cliente_endereco: ordem do endereço do mesmo (cliente, tipo) no lote, que vira a seq

  registros.forEach((registro, indice) => {
    const externalId = idLegivel(registro);
    const z = PAYLOADS_HUB[e].safeParse(registro);
    if (!z.success) {
      erros.push(...errosDoPayload(indice, externalId, z.error.issues));
      proteger(registro);
      return;
    }
    const x = z.data as Payload;
    let seq: number | undefined;
    if (e === 'cliente_endereco' && x.ativo !== false) {
      const chave = `${String(x.cliente_external_id)}|${String(x.tipo)}`;
      seq = (porTipo.get(chave) ?? 0) + 1;
      porTipo.set(chave, seq);
    }
    const celulas = CELULAS[e](x, ctx, { seq });
    if (celulas === null) {
      if (e === 'cliente_endereco') avisos.push({ indice, external_id: externalId, codigo: 'endereco_inativo_ignorado' });
      return;
    }
    if (semReferencia(celulas)) {
      erros.push({ indice, external_id: externalId, campo: celulas.referencia_ausente, codigo: 'referencia_ausente' });
      proteger(registro);
      return;
    }
    const r = mapearLinha(destino, celulas as Registro, indice + 2, ctx);
    if (r.ok) linhas.push(r.linha);
    else {
      erros.push(...r.erros.map((er) => doErroLinha(e, indice, externalId, er)));
      proteger(registro);
    }
  });
  return { ok: true, entidade_carga: destino, linhas, erros, avisos, protegidos: [...protegidos] };
}
