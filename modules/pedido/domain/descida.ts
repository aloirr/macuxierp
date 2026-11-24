import type { NotaClienteTexto, NotaReferenciaCliente, StatusPedido } from '../contracts';
import { chaveAcessoValida } from './chave-acesso';
import { validarTransicao } from './transicao';

/**
 * Fila de descida do pedido ao banco do cliente e retorno vindo do cliente (ADR 0014 §13 e §15, T-0057 etapa 3b).
 * Funções puras. A transição reaproveita `validarTransicao` (RN-PED-02); a nota do cliente é só referência e a regra de
 * nota continua no faturamento (`faturamento.ts`).
 */

/** Status que ainda precisam descer: o aprovado e o que o ERP já faturou antes de o Conector buscar. Cancelado e anteriores à aprovação não descem. */
export const STATUS_DESCEM: readonly StatusPedido[] = ['aprovado', 'faturado_parcial', 'faturado'];

export type ResultadoEnfileirar = { ok: true } | { ok: false; codigo: 'status_nao_desce' | 'ja_na_fila' };

/** RN-PED-01 (idempotência pelo UUID) e ADR 0014 §15: todo pedido aprovado entra na fila uma vez, com ou sem faturamento. */
export function decidirEnfileirar(p: { status: StatusPedido; jaNaFila: boolean }): ResultadoEnfileirar {
  if (!STATUS_DESCEM.includes(p.status)) return { ok: false, codigo: 'status_nao_desce' };
  if (p.jaNaFila) return { ok: false, codigo: 'ja_na_fila' };
  return { ok: true };
}

export type ResultadoMarcarDescido = { ok: true } | { ok: false; codigo: 'ja_descido' };

/** RN-PED-01: o pedido não desce duas vezes; marcar de novo não altera o primeiro carimbo. */
export function decidirMarcarDescido(p: { descidoEm: string | null }): ResultadoMarcarDescido {
  return p.descidoEm === null ? { ok: true } : { ok: false, codigo: 'ja_descido' };
}

/** Estados do `RetornoErp` do Hub que o cliente devolve (os outros, `integrado` e `rejeitado_erp`, são do ERP para o FDV). */
export type RetornoDoCliente = 'faturado_parcial' | 'faturado_total' | 'cancelado';

const STATUS_DO_RETORNO: Readonly<Record<RetornoDoCliente, StatusPedido>> = { faturado_parcial: 'faturado_parcial', faturado_total: 'faturado', cancelado: 'cancelado' };

export type ResultadoRetornoCliente =
  /** `nota` = referência a gravar junto do status; `null` = não mexe nas colunas (cancelado ou retorno sem nota). */
  | { ok: true; acao: 'aplicar'; para: StatusPedido; nota: NotaReferenciaCliente | null }
  /** parcial → parcial com outra nota (ou primeira nota de um status já aplicado): atualiza a referência, sem transição nem evento de status. */
  | { ok: true; acao: 'atualizar_nota'; nota: NotaReferenciaCliente }
  | { ok: true; acao: 'sem_efeito'; motivo: 'ja_aplicado' | 'obsoleto' }
  | { ok: false; rn: 'RN-PED-02'; codigo: 'faturamento_ligado' | 'nota_cliente_divergente'; mensagem: string }
  | { ok: false; rn: 'RN-PED-02'; codigo: 'transicao_invalida'; possiveis: readonly StatusPedido[]; mensagem: string };

/** Mesma nota: número, série e total iguais e a mesma data (comparada como instante UTC, não como texto). */
export function mesmaNotaCliente(a: NotaReferenciaCliente, b: NotaReferenciaCliente): boolean {
  return a.numero === b.numero && a.serie === b.serie && a.total_centavos === b.total_centavos && Date.parse(a.emitida_em) === Date.parse(b.emitida_em);
}

export type ResultadoNotaCliente =
  | { ok: true; referencia: NotaReferenciaCliente; chave: string | null }
  | { ok: false; rn: 'RN-PED-02'; codigo: 'nota_cliente_invalida'; campo: 'numero' | 'serie' | 'total_centavos' | 'emitida_em' | 'chave'; mensagem: string };

const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;

/**
 * RN-PED-02: confere a nota do Hub (texto) e a converte na referência gravável (inteiros das colunas da 0045).
 * `numero` de "1" a "999999999" e `serie` de "0" a "999", sem zero à esquerda; total inteiro ≥ 0; data até `agora` + 5 min
 * (`agora` por parâmetro, a função é pura); `chave` opcional de 44 dígitos com DV módulo 11. A chave não entra na referência.
 */
export function converterNotaCliente(n: NotaClienteTexto, agora: Date): ResultadoNotaCliente {
  const inv = (campo: 'numero' | 'serie' | 'total_centavos' | 'emitida_em' | 'chave', mensagem: string) => ({ ok: false, rn: 'RN-PED-02', codigo: 'nota_cliente_invalida', campo, mensagem }) as const;
  if (!/^[1-9]\d{0,8}$/.test(n.numero)) return inv('numero', 'Número da nota do cliente deve ir de 1 a 999999999, sem zero à esquerda');
  if (!/^(0|[1-9]\d{0,2})$/.test(n.serie)) return inv('serie', 'Série da nota do cliente deve ir de 0 a 999, sem zero à esquerda');
  if (!Number.isInteger(n.total_centavos) || n.total_centavos < 0) return inv('total_centavos', 'Total da nota do cliente deve ser inteiro em centavos, a partir de zero');
  const emitida = Date.parse(n.emitida_em);
  if (Number.isNaN(emitida)) return inv('emitida_em', 'Data de emissão da nota do cliente inválida');
  if (emitida > agora.getTime() + TOLERANCIA_RELOGIO_MS) return inv('emitida_em', 'Data de emissão da nota do cliente está no futuro (tolerância de 5 minutos)');
  if (n.chave !== undefined && !chaveAcessoValida(n.chave)) return inv('chave', 'Chave de acesso da nota do cliente deve ter 44 dígitos e o DV módulo 11 correto');
  return {
    ok: true,
    referencia: { numero: Number(n.numero), serie: Number(n.serie), emitida_em: new Date(emitida).toISOString(), total_centavos: n.total_centavos },
    chave: n.chave ?? null,
  };
}

const DIVERGENTE = { ok: false, rn: 'RN-PED-02', codigo: 'nota_cliente_divergente', mensagem: 'O pedido já tem outra nota do cliente e o status não avança: a referência não é trocada' } as const;

/**
 * RN-PED-02 e RN-CORE-02: aplica o retorno do cliente à máquina de status e à referência da nota (ADR 0014 §13 e §15).
 * - com o faturamento ligado, `faturado_*` só vem da nota do ERP (consumidor de `faturamento.nota.autorizada@1`): o do cliente é recusado;
 * - mesmo status: `ja_aplicado`; `faturado_parcial` depois de `faturado`: `obsoleto`, mesmo com nota diferente da gravada. Ambos sem efeito e sem erro (200), porque o Conector repete até o ERP aceitar;
 * - o resto passa por `validarTransicao`;
 * - a referência guarda a ÚLTIMA nota: o status que avança (aprovado → faturado_*, parcial → total) grava a nota nova; parcial → parcial
 *   com outra nota só atualiza a referência; nota igual é no-op; com o mesmo status (faturado → faturado), nota diferente é `nota_cliente_divergente`
 *   (a API responde 409). Sem nota gravada ainda, a primeira vale. `cancelado` nunca mexe na referência.
 */
export function decidirRetornoCliente(p: {
  statusAtual: StatusPedido;
  retorno: RetornoDoCliente;
  faturamentoLigado: boolean;
  notaAtual?: NotaReferenciaCliente | null;
  notaNova?: NotaReferenciaCliente | null;
}): ResultadoRetornoCliente {
  const para = STATUS_DO_RETORNO[p.retorno];
  const cancelando = p.retorno === 'cancelado';
  const nota = cancelando || p.faturamentoLigado ? null : (p.notaNova ?? null);
  const atual = p.notaAtual ?? null;
  if (p.statusAtual === 'faturado' && p.retorno === 'faturado_parcial' && !p.faturamentoLigado) return { ok: true, acao: 'sem_efeito', motivo: 'obsoleto' };
  if (p.statusAtual === para) {
    const motivo = 'ja_aplicado';
    if (!nota || (atual && mesmaNotaCliente(atual, nota))) return { ok: true, acao: 'sem_efeito', motivo };
    if (atual === null) return { ok: true, acao: 'atualizar_nota', nota };
    if (p.statusAtual === 'faturado_parcial') return { ok: true, acao: 'atualizar_nota', nota };
    return DIVERGENTE;
  }
  if (!cancelando && p.faturamentoLigado) {
    return { ok: false, rn: 'RN-PED-02', codigo: 'faturamento_ligado', mensagem: 'Com o faturamento ligado o status faturado vem da nota do ERP, não do retorno do cliente' };
  }
  const t = validarTransicao(p.statusAtual, para);
  if (!t.ok) return { ok: false, rn: t.rn, codigo: 'transicao_invalida', possiveis: t.possiveis, mensagem: t.mensagem };
  return { ok: true, acao: 'aplicar', para, nota };
}
