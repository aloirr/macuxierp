import type { CadastroCargaPortal, IntegracaoFdvPlataforma, LoteEntradaResumo, MonitorConectorFdv, PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { plural, rotuloCadastroCarga } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { AMBIENTES_FDV } from './integracao-fdv';
import { situacaoDoConector, type Tom } from './operacao-fdv';

/**
 * v0.3.24 (R-20261127-101915, docs/design/integracao-duas-ligacoes): a aba Integração tem duas ligações, cada uma com uma ficha só.
 * Os nomes dizem a direção ("De → Para"); "API" ou "conector" nunca aparecem soltos. Decisão 49: o destino da saída é a força de
 * vendas, e o "Macuxi FDV" é um valor da ficha ("Ligado a"), de uma constante só.
 */
export const ROTULO_SISTEMA_CLIENTE = 'Sistema do cliente';
export const ROTULO_ERP = 'ERP';
/** Marca (v0.3.31): o destino da saída leva o nome do produto, igual ao "Ligado a" da ficha. */
export const ROTULO_FORCA_VENDAS = 'Macuxi FDV';
export const ROTULO_DESTINO_FDV = 'Macuxi FDV';

/** Ponta de uma ligação: o nome e o artigo do texto lido ("para o ERP", "para o Macuxi FDV"). */
export interface Ponta { nome: string; artigo: 'o' | 'a' }
export interface Ligacao { id: 'entrada' | 'saida'; de: Ponta; para: Ponta }

export const LIGACAO_ENTRADA: Ligacao = { id: 'entrada', de: { nome: ROTULO_SISTEMA_CLIENTE, artigo: 'o' }, para: { nome: ROTULO_ERP, artigo: 'o' } };
export const LIGACAO_SAIDA: Ligacao = { id: 'saida', de: { nome: ROTULO_ERP, artigo: 'o' }, para: { nome: ROTULO_FORCA_VENDAS, artigo: 'o' } };


/** Ficha de uma ligação (sem chave, não há ficha: só o formulário). */
export interface FichaLigacao {
  situacao: { texto: string; tom: Tom };
  ultimoContato: string;
  codigo: string;
  chave: string;
  /** Só na saída. */
  ambiente?: string;
  ligadoA?: string;
  /** Texto de apoio embaixo do selo (fila com N > 0; código da última recusa). */
  apoio: string[];
}

const DIA_MS = 24 * 60 * 60 * 1000;
export const SITUACAO_RECEBENDO = { texto: 'Recebendo', tom: 'sucesso' } as const satisfies FichaLigacao['situacao'];
export const SITUACAO_SEM_ENVIO = { texto: 'Sem envio', tom: 'neutro' } as const satisfies FichaLigacao['situacao'];
export const SITUACAO_INDISPONIVEL = { texto: 'Indisponível', tom: 'neutro' } as const satisfies FichaLigacao['situacao'];
export const APOIO_INDISPONIVEL = 'Não foi possível ler a situação agora.';

/** O item mais recente pela data do campo (ou null sem itens): uma conta só para credenciais e lotes (RD-1111). */
export function maisRecentePor<K extends string, T extends Record<K, string>>(itens: readonly T[], campo: K): T | null {
  return itens.reduce<T | null>((m, x) => (m === null || Date.parse(x[campo]) > Date.parse(m[campo]) ? x : m), null);
}
const dataHora = (iso: string | null | undefined, fuso: string): string => (iso ? formatarDataHora(iso, fuso) : '—');

/** Sistema do cliente → ERP: "Recebendo" com lote nas últimas 24 h; senão "Sem envio". O texto sempre vai com a cor. */
export function fichaEntrada(l: PortalEntradaLeitura | null, fuso: string, agora: Date = new Date()): FichaLigacao | null {
  const vivas = (l?.credenciais ?? []).filter((c) => c.revogada_em === null);
  if (!l || vivas.length === 0) return null;
  const c = maisRecentePor(vivas, 'criada_em')!;
  const sinal = l.ultimo_sinal?.conector_id === c.conector_id ? l.ultimo_sinal.em : null;
  const ultimoLote = maisRecentePor(l.lotes, 'recebido_em')?.recebido_em ?? null;
  const contato = [sinal, ultimoLote].filter((x): x is string => x !== null).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const recebendo = ultimoLote !== null && agora.getTime() - Date.parse(ultimoLote) <= DIA_MS;
  return { situacao: recebendo ? SITUACAO_RECEBENDO : SITUACAO_SEM_ENVIO, ultimoContato: dataHora(contato, fuso), codigo: c.conector_id, chave: `${c.prefixo}…`, apoio: [] };
}

/** ERP → Macuxi FDV: o Monitor vira a Situação (Em dia / Atrasado / Desativado; Indisponível quando a leitura falha). */
export function fichaSaida(d: IntegracaoFdvPlataforma, monitor: MonitorConectorFdv | null, fuso: string): FichaLigacao | null {
  if (d.credencial_id === null) return null;
  const apoio: string[] = [];
  if (!monitor) apoio.push(APOIO_INDISPONIVEL);
  if (monitor && monitor.fila.lotes > 0) apoio.push(`Fila: ${plural(monitor.fila.lotes, 'lote', 'lotes')}`);
  if (d.ultimo_sinal?.ultimo_codigo) apoio.push(`Código da última recusa: ${d.ultimo_sinal.ultimo_codigo}`);
  return {
    situacao: monitor ? situacaoDoConector(monitor.situacao) : SITUACAO_INDISPONIVEL,
    ultimoContato: dataHora(monitor?.ultimo_sinal_em ?? d.ultimo_sinal?.ultimo_envio_em, fuso),
    codigo: d.conector_id ?? '—',
    chave: `${d.chave_prefixo ?? ''}…`,
    ambiente: AMBIENTES_FDV.find(([v]) => v === d.ambiente)?.[1] ?? '—',
    ligadoA: ROTULO_DESTINO_FDV,
    apoio,
  };
}

// ---- Aba Dados: "Cadastros recebidos" (Registros e Com erro do último lote; a tabela "Lotes recebidos" saiu, RD-1103) ----

/** Entidades da entrada que alimentam cada cadastro da carga (condição = forma + prazo; cliente = cliente + endereço). */
const ENTIDADES_DO_CADASTRO: Readonly<Record<CadastroCargaPortal, readonly string[]>> = {
  filial: ['filial'],
  vendedor: ['vendedor'],
  condicao_pagamento: ['forma_pagamento', 'prazo_pagamento'],
  produto: ['produto'],
  produto_unidade: ['produto_unidade'],
  preco: ['preco'],
  estoque: ['estoque'],
  cliente: ['cliente', 'cliente_endereco'],
};

/** O último lote recebido pela entrada para o cadastro, ou null. */
export function ultimoLoteDoCadastro(lotes: readonly LoteEntradaResumo[], cadastro: CadastroCargaPortal): LoteEntradaResumo | null {
  const ents = ENTIDADES_DO_CADASTRO[cadastro];
  return maisRecentePor(lotes.filter((l) => ents.includes(l.entidade)), 'recebido_em');
}

/** "Cadastro" de um lote recebido (Envios recentes): o rótulo da carga a que a entidade pertence; sem correspondência, a entidade como veio. */
export function rotuloDoLote(entidade: string): string {
  const par = (Object.entries(ENTIDADES_DO_CADASTRO) as [CadastroCargaPortal, readonly string[]][]).find(([, e]) => e.includes(entidade));
  return par ? rotuloCadastroCarga(par[0]) : entidade;
}
