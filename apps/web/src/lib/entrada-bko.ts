/** Regras puras da entrada do cliente no BKO (ADR 0014 §5): que cadastro é a tela, texto da linha de status e situação. */
import type { EntidadeEnvioFdv } from '@macuxierp/platform-sdk';
import type { LinhaEntradaBko } from './entrada-bko-provisorio';

/** Rota da página (prefixo, vale para o detalhe `/:id`) -> nome do cadastro na F2 (`ENTIDADES_ENVIO_FDV`). */
const ENTIDADE_DA_ROTA: readonly (readonly [string, EntidadeEnvioFdv])[] = [
  ['/cadastros/clientes', 'cliente'],
  ['/cadastros/produtos', 'produto'],
  ['/cadastros/tabelas-preco', 'preco'],
  ['/cadastros/estoque', 'estoque'],
  ['/cadastros/condicoes-pagamento', 'prazo_pagamento'],
  ['/cadastros/equipe', 'vendedor'],
  ['/cadastros/filiais', 'filial'],
];

export function entidadeDaRota(rotaDaPagina: string): EntidadeEnvioFdv | undefined {
  return ENTIDADE_DA_ROTA.find(([p]) => rotaDaPagina === p || rotaDaPagina.startsWith(`${p}/`))?.[1];
}

/** A linha do cadastro da tela quando o dono é o cliente; `undefined` em qualquer outro caso (erp, rota sem cadastro, rota falhou). */
export function linhaDoCliente(linhas: readonly LinhaEntradaBko[] | null, rotaDaPagina: string): LinhaEntradaBko | undefined {
  const e = entidadeDaRota(rotaDaPagina);
  const l = e ? linhas?.find((x) => x.cadastro === e) : undefined;
  return l?.dono === 'cliente' ? l : undefined;
}

/** "dd/mm HHhMM" no fuso do tenant. */
export function dataHoraCurta(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}h${p.minute}`;
}

/** Linha de status abaixo do título do cadastro. */
export function textoLinhaStatus(l: LinhaEntradaBko, fuso: string): string {
  let t = l.ultimo_lote
    ? `Último lote ${dataHoraCurta(l.ultimo_lote.em, fuso)}: ${l.ultimo_lote.gravadas} de ${l.ultimo_lote.recebidas} gravados${l.ultimo_lote.com_erro > 0 ? `, ${l.ultimo_lote.com_erro} com erro` : ''}`
    : 'Nenhum lote recebido ainda.';
  if (l.erros > 0) t += ` · ${l.erros} ${l.erros === 1 ? 'erro aberto' : 'erros abertos'}`;
  if (l.confirmacao_pendente) t += ' · Inativação aguardando confirmação.';
  return t;
}

export type SituacaoEntrada = { texto: 'Em dia' | 'Com erros' | 'Aguardando confirmação'; tom: 'sucesso' | 'aviso' } | null;

/** Situação da tabela da Integração; `null` ("—", sem Chip) quando o dono é o Macuxi ERP. Derivada na web: pendência vence erro. */
export function situacaoDaEntrada(l: LinhaEntradaBko): SituacaoEntrada {
  if (l.dono === 'erp') return null;
  if (l.confirmacao_pendente) return { texto: 'Aguardando confirmação', tom: 'aviso' };
  return l.erros > 0 ? { texto: 'Com erros', tom: 'aviso' } : { texto: 'Em dia', tom: 'sucesso' };
}

/** "Último lote" da tabela: "<data e hora> · <gravadas> de <recebidas>[, <n> com erro]"; "—" sem lote. */
export function textoUltimoLote(l: LinhaEntradaBko, fuso: string): string {
  const u = l.ultimo_lote;
  return u ? `${dataHoraCurta(u.em, fuso)} · ${u.gravadas} de ${u.recebidas}${u.com_erro > 0 ? `, ${u.com_erro} com erro` : ''}` : '—';
}
