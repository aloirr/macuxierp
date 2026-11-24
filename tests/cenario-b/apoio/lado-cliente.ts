/**
 * T-0057 (cenário B, ADR 0014 §13 e §15): dublê do banco do cliente para a mão dupla, em memória.
 *
 * Faz o papel do `ERP_THATHYANY` e das procedures do kit do ERP: o que **desce** (pedido aprovado no ERP, nota emitida
 * pelo ERP, pré-cadastro de cliente do FDV) é gravado por "procedures" idempotentes pela mesma chave do Conector
 * (`pedido_uuid`, chave da nota, `cliente_uuid`), e o que **sobe** (status do pedido e nota emitida pelo cliente, o
 * cadastro criado a partir do pré-cadastro) fica nas "views" que o Conector lê.
 *
 * `cicloMaoDupla` é o ciclo do Conector 1.5.0 sobre a `/entrada/v1`: busca os pendentes, grava no cliente, devolve o
 * retorno; o retorno que o ERP não aceitou fica na fila e se repete no ciclo seguinte (§13, "o retorno se repete até o ERP
 * aceitar"). Nada aqui fala com o FDV nem com o banco do ERP.
 *
 * Premissas (plano T-0057, P-5 a P-8): a forma da lista de pendentes, o corpo do retorno da nota e o do pré-cadastro
 * ainda não existem no SDK; o ciclo lê a lista de forma tolerante e os corpos ficam marcados com TODO.
 */
import type { ConectorSimulado, RegistroLocal } from './conector-simulado';

export interface ItemPedidoCliente {
  sequencia: number;
  produto_external_id: string;
  quantidade: number;
  preco_unitario_cents: number;
  total_cents: number;
}
/** O mínimo do `PedidoParaErp` do Hub que a procedure do kit grava. */
export interface PedidoDescido {
  pedido_uuid: string;
  cliente_external_id: string;
  vendedor_external_id: string;
  total_cents: number;
  itens: ItemPedidoCliente[];
  [campo: string]: unknown;
}
/** TODO(T-0057): `NotaParaCliente` do hub-v1 (chave, número, série, emissão, totais e itens; sem XML). */
export interface NotaDescida {
  chave: string;
  numero: number;
  serie: number;
  emitida_em: string;
  total_cents: number;
  pedido_uuid?: string | null;
  itens: { sequencia: number; produto_external_id: string; quantidade: number; valor_cents: number }[];
  [campo: string]: unknown;
}
/** TODO(T-0057): `ClienteParaErp` do Hub do FDV v1.0.27. */
export interface PreCadastroDescido {
  cliente_uuid: string;
  razao_social: string;
  documento?: string | null;
  [campo: string]: unknown;
}

export type StatusPedidoCliente = 'integrado' | 'faturado_parcial' | 'faturado_total' | 'cancelado';
export interface NotaDoCliente {
  numero: number;
  serie: number;
  chave: string;
  emitida_em: string;
  total_cents: number;
}

interface PedidoGravado {
  numero: string;
  pedido: PedidoDescido;
  status: StatusPedidoCliente;
  nota?: NotaDoCliente;
  /** Último status que o Conector já devolveu ao ERP com sucesso. */
  statusReportado: StatusPedidoCliente | null;
}

export interface LadoCliente {
  /** `sp_macuxi_pedido_inserir` + `sp_macuxi_pedido_item_inserir`: idempotente por `pedido_uuid`; o número vem de `macuxi_pedido_entrada`. */
  spPedidoInserir(p: PedidoDescido): string;
  /** `sp_macuxi_nota_inserir` + itens: idempotente pela chave da nota. */
  spNotaInserir(n: NotaDescida): void;
  /** `sp_macuxi_cliente_inserir`: idempotente por `cliente_uuid`. */
  spClienteInserir(c: PreCadastroDescido): void;
  /** O ERP do cliente fatura (faturamento desligado no ERP, §15): muda a `vw_macuxi_pedido_status`. */
  faturar(pedidoUuid: string, tipo: 'faturado_parcial' | 'faturado_total', nota: NotaDoCliente): void;
  cancelar(pedidoUuid: string): void;
  /** O ERP do cliente cria o cadastro a partir do pré-cadastro: entra na `vw_macuxi_cliente` com o código dele. */
  criarClienteDoPreCadastro(clienteUuid: string, registro: RegistroLocal): void;
  /** `vw_macuxi_*`: o que o Conector sobe por entidade. */
  view(entidade: string): RegistroLocal[];
  semearView(entidade: string, registros: readonly RegistroLocal[]): void;
  pedido(uuid: string): Readonly<PedidoGravado> | null;
  nota(chave: string): Readonly<NotaDescida> | null;
  preCadastro(
    uuid: string,
  ): Readonly<{ pre: PreCadastroDescido; external_id: string | null; vinculoReportado: boolean }> | null;
  /** Status ainda não devolvidos ao ERP (o que o ciclo de status sobe). */
  statusPendentes(): {
    pedido_uuid: string;
    status: StatusPedidoCliente;
    numero: string;
    nota?: NotaDoCliente;
  }[];
  marcarStatusReportado(pedidoUuid: string, status: StatusPedidoCliente): void;
  marcarVinculoReportado(clienteUuid: string): void;
  /** Pré-cadastros que o cliente já transformou em cadastro e cujo vínculo ainda não voltou ao ERP: `[cliente_uuid, external_id]`. */
  vinculosPendentes(): [string, string][];
  /** Quantas vezes cada procedure gravou de fato (a repetição idempotente não conta). */
  readonly gravacoes: Readonly<{ pedido: number; item: number; nota: number; cliente: number }>;
  /** Quantas vezes cada procedure foi chamada (com as repetições). */
  readonly chamadas: Readonly<{ pedido: number; nota: number; cliente: number }>;
}

export function criarLadoCliente(o: { primeiroNumeroPedido?: number } = {}): LadoCliente {
  let proximoNumero = o.primeiroNumeroPedido ?? 1;
  const pedidos = new Map<string, PedidoGravado>();
  const notas = new Map<string, NotaDescida>();
  const pre = new Map<
    string,
    { pre: PreCadastroDescido; external_id: string | null; vinculoReportado: boolean }
  >();
  const views = new Map<string, RegistroLocal[]>();
  const gravacoes = { pedido: 0, item: 0, nota: 0, cliente: 0 };
  const chamadas = { pedido: 0, nota: 0, cliente: 0 };

  const exigirPedido = (uuid: string) => {
    const p = pedidos.get(uuid);
    if (!p) throw new Error('lado do cliente: pedido não desceu.');
    return p;
  };
  const upsertView = (entidade: string, r: RegistroLocal) => {
    const lista = views.get(entidade) ?? [];
    const i = lista.findIndex((x) => x.external_id === r.external_id);
    if (i >= 0) lista[i] = { ...r };
    else lista.push({ ...r });
    views.set(entidade, lista);
  };

  return {
    spPedidoInserir(p) {
      chamadas.pedido++;
      const ja = pedidos.get(p.pedido_uuid);
      if (ja) return ja.numero;
      const numero = String(proximoNumero++).padStart(6, '0');
      pedidos.set(p.pedido_uuid, {
        numero,
        pedido: structuredClone(p),
        status: 'integrado',
        statusReportado: null,
      });
      gravacoes.pedido++;
      gravacoes.item += p.itens.length;
      return numero;
    },
    spNotaInserir(n) {
      chamadas.nota++;
      if (notas.has(n.chave)) return;
      notas.set(n.chave, structuredClone(n));
      gravacoes.nota++;
    },
    spClienteInserir(c) {
      chamadas.cliente++;
      if (pre.has(c.cliente_uuid)) return;
      pre.set(c.cliente_uuid, { pre: structuredClone(c), external_id: null, vinculoReportado: false });
      gravacoes.cliente++;
    },
    faturar(uuid, tipo, nota) {
      const p = exigirPedido(uuid);
      if (p.status === 'cancelado' || p.status === 'faturado_total')
        throw new Error('lado do cliente: pedido já encerrado.');
      p.status = tipo;
      p.nota = { ...nota };
    },
    cancelar(uuid) {
      const p = exigirPedido(uuid);
      if (p.status === 'faturado_total')
        throw new Error('lado do cliente: pedido faturado não cancela aqui.');
      p.status = 'cancelado';
    },
    criarClienteDoPreCadastro(uuid, registro) {
      const x = pre.get(uuid);
      if (!x) throw new Error('lado do cliente: pré-cadastro não desceu.');
      x.external_id = registro.external_id;
      upsertView('cliente', registro);
    },
    view: (entidade) => (views.get(entidade) ?? []).map((r) => ({ ...r })),
    semearView(entidade, registros) {
      for (const r of registros) upsertView(entidade, r);
    },
    pedido: (uuid) => pedidos.get(uuid) ?? null,
    nota: (chave) => notas.get(chave) ?? null,
    preCadastro: (uuid) => pre.get(uuid) ?? null,
    statusPendentes: () =>
      [...pedidos.entries()]
        .filter(([, p]) => p.status !== p.statusReportado)
        .map(([uuid, p]) => ({
          pedido_uuid: uuid,
          status: p.status,
          numero: p.numero,
          ...(p.nota ? { nota: p.nota } : {}),
        })),
    marcarStatusReportado(uuid, status) {
      exigirPedido(uuid).statusReportado = status;
    },
    marcarVinculoReportado(uuid) {
      const x = pre.get(uuid);
      if (x) x.vinculoReportado = true;
    },
    vinculosPendentes: () =>
      [...pre.entries()]
        .filter(([, x]) => x.external_id !== null && !x.vinculoReportado)
        .map(([uuid, x]) => [uuid, x.external_id!] as [string, string]),
    gravacoes,
    chamadas,
  };
}

/** Lista de pendentes de forma tolerante: array direto ou `{ <chave>: [...] }` / `{ itens: [...] }` (premissa P-5). */
export function listaDePendentes<T>(corpo: unknown, chave: string): T[] {
  if (Array.isArray(corpo)) return corpo as T[];
  if (corpo && typeof corpo === 'object') {
    const o = corpo as Record<string, unknown>;
    const l = o[chave] ?? o.itens;
    if (Array.isArray(l)) return l as T[];
  }
  return [];
}

export interface ResultadoCiclo {
  pedidosGravados: string[];
  notasGravadas: string[];
  preCadastrosGravados: string[];
  /** Retornos aceitos pelo ERP (2xx), por recurso e id. */
  retornosAceitos: { recurso: 'pedidos' | 'notas' | 'clientes'; id: string; status: string }[];
  /** Retornos recusados ou com falha: ficam para o próximo ciclo. */
  retornosPendentes: number;
}

const aceito = (s: number) => s >= 200 && s < 300;

/**
 * Um ciclo do Conector de mão dupla (§13). `agora` carimba o `ocorrido_em`. Ordem: pedidos (desce e devolve
 * `integrado`), status do cliente (sobe `faturado_*`/`cancelado` com a nota), notas do ERP (desce), pré-cadastros
 * (desce; quando o cliente já criou o cadastro, devolve `vinculado` com o `external_id` dele).
 */
export async function cicloMaoDupla(
  conector: ConectorSimulado,
  lado: LadoCliente,
  agora: () => Date,
): Promise<ResultadoCiclo> {
  const r: ResultadoCiclo = {
    pedidosGravados: [],
    notasGravadas: [],
    preCadastrosGravados: [],
    retornosAceitos: [],
    retornosPendentes: 0,
  };
  const ocorrido_em = () => agora().toISOString();

  const pend = await conector.pendentes('pedidos');
  if (aceito(pend.status)) {
    for (const p of listaDePendentes<PedidoDescido>(pend.corpo, 'pedidos')) {
      // o Conector guarda antes de gravar; a procedure é idempotente pelo pedido_uuid
      lado.spPedidoInserir(p);
      r.pedidosGravados.push(p.pedido_uuid);
    }
  }

  for (const s of lado.statusPendentes()) {
    const corpo: Record<string, unknown> = {
      versao_contrato: 'v1',
      pedido_uuid: s.pedido_uuid,
      status: s.status,
      numero_erp: s.numero,
      ocorrido_em: ocorrido_em(),
      ...(s.nota ? { nota: s.nota } : {}),
    };
    const resp = await conector.retorno('pedidos', s.pedido_uuid, corpo);
    if (aceito(resp.status)) {
      lado.marcarStatusReportado(s.pedido_uuid, s.status);
      r.retornosAceitos.push({ recurso: 'pedidos', id: s.pedido_uuid, status: s.status });
    } else r.retornosPendentes++;
  }

  const notas = await conector.pendentes('notas');
  if (aceito(notas.status)) {
    for (const n of listaDePendentes<NotaDescida>(notas.corpo, 'notas')) {
      lado.spNotaInserir(n);
      r.notasGravadas.push(n.chave);
      // TODO(T-0057, P-6): corpo do retorno da nota conforme o contrato novo do hub-v1
      const resp = await conector.retorno('notas', n.chave, {
        versao_contrato: 'v1',
        chave: n.chave,
        status: 'gravada',
        ocorrido_em: ocorrido_em(),
      });
      if (aceito(resp.status)) r.retornosAceitos.push({ recurso: 'notas', id: n.chave, status: 'gravada' });
      else r.retornosPendentes++;
    }
  }

  const clientes = await conector.pendentes('clientes');
  if (aceito(clientes.status)) {
    for (const c of listaDePendentes<PreCadastroDescido>(clientes.corpo, 'clientes')) {
      lado.spClienteInserir(c);
      r.preCadastrosGravados.push(c.cliente_uuid);
    }
  }
  // TODO(T-0057, P-7): corpo do `RetornoCliente` do Hub do FDV v1.0.27 (status `vinculado` + external_id)
  for (const [uuid, x] of lado.vinculosPendentes()) {
    const resp = await conector.retorno('clientes', uuid, {
      versao_contrato: 'v1',
      cliente_uuid: uuid,
      status: 'vinculado',
      external_id: x,
      ocorrido_em: ocorrido_em(),
    });
    if (aceito(resp.status)) {
      lado.marcarVinculoReportado(uuid);
      r.retornosAceitos.push({ recurso: 'clientes', id: uuid, status: 'vinculado' });
    } else r.retornosPendentes++;
  }
  return r;
}
