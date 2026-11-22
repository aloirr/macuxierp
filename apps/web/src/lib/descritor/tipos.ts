/**
 * Descritores de tela do shell (T-0015). O renderizador genérico só conhece estes tipos: cada módulo adapta os descritores
 * dele (`modules/<m>/web`) para eles em `apps/web/src/lib/telas/<modulo>.ts`. Parte pura, segura para 'use client'.
 * Sem dado pessoal em log; horários em texto para pessoas saem no fuso do tenant (Manaus).
 */
import type { Acao, Perfil, PaginaLista } from '@macuxierp/platform-sdk';

/** Fonte de opções de seletor (cliente, vendedor, filial, condição, produto): caminho da lista no cadastros (`/v1/cadastros/clientes`). */
export type FonteOpcoes = string;

export interface FiltroTela {
  /** Chave da URL e da consulta da API (a mesma do `filtros` do `PaginaLista`, ou `busca`). */
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'data' | 'selecao' | 'cadastro';
  /** `selecao`: valores fixos (ex.: status). */
  opcoes?: readonly { valor: string; rotulo: string }[];
  /** `cadastro`: de onde ler as opções (cadastros). */
  fonte?: FonteOpcoes;
}

export type Linha = Readonly<Record<string, unknown>>;

export interface TelaLista {
  tipo: 'lista';
  pagina: PaginaLista;
  filtrosTela: readonly FiltroTela[];
  /** Colunas da tabela para o perfil (id e título). */
  colunas: (perfil: Perfil) => readonly { id: string; rotulo: string }[];
  /** Linha pronta para exibir (texto por id de coluna), no fuso do tenant. */
  linha: (item: Linha, fuso: string) => Readonly<Record<string, string>>;
  /** Botão "Novo", quando houver; some se o perfil não puder `criar`. */
  novo?: { rota: string; rotulo: string; criar?: Acao };
  /** Rota do detalhe de uma linha. */
  rotaDaLinha?: (linha: Linha) => string;
  /** Rótulo do campo `busca` (a página aceita `busca`). */
  rotuloBusca?: string;
}

export interface CampoVista { rotulo: string; valor: string }
export interface ColunaVista { id: string; rotulo: string; numerica?: boolean }
export interface TabelaVista { titulo: string; colunas: readonly ColunaVista[]; linhas: readonly Readonly<Record<string, string>>[] }
export interface PendenciaVista { texto: string; bloqueante: boolean; detalhe?: string }
export interface EventoVista { quando: string; texto: string }

/** Ação do detalhe, já filtrada por perfil e status pelo módulo. */
export interface AcaoVista {
  id: string;
  rotulo: string;
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Caminho na API, `/v1/<modulo>/...`. */
  caminho: string;
  /** `justificativa`: texto livre (aprovar com pendência não bloqueante); `motivo`: diálogo com catálogo; `nenhum`: confirma direto. */
  entrada: 'nenhum' | 'justificativa' | 'motivo';
  /** Em `justificativa`: o texto é obrigatório? */
  justificativaObrigatoria?: boolean;
  /** Em `motivo`: catálogo (`GET /motivos`) já resolvido. */
  motivos?: readonly { codigo: string; rotulo: string; exigeTexto: boolean }[];
  /** Aviso a mostrar antes de confirmar. */
  aviso?: string;
  /** Aviso por código de motivo escolhido (ex.: LGPD no "outro" do pedido do FDV). */
  avisoPorMotivo?: Readonly<Record<string, string>>;
  /** Botão visível porém desabilitado, com o motivo (ex.: aprovar com pendência bloqueante). */
  desabilitada?: string;
  /** Versão do registro (If-Match). */
  versao?: string;
  /** Nomes dos campos do corpo. */
  campoMotivo?: string;
  campoTexto?: string;
  campoJustificativa?: string;
  perigosa?: boolean;
}

export interface DetalheVista {
  titulo: string;
  selo?: { texto: string; tom: 'ok' | 'aviso' | 'erro' | 'neutro' };
  cabecalho: readonly CampoVista[];
  tabelas: readonly TabelaVista[];
  pendencias: readonly PendenciaVista[];
  historico: readonly EventoVista[];
  /** Quem decidiu, quando e por quê (texto já em Manaus). */
  decisao?: readonly CampoVista[];
  acoes: readonly AcaoVista[];
}

export interface TelaDetalhe {
  tipo: 'detalhe';
  /** Caminho GET do registro. */
  api: (id: string) => string;
  /** Monta a vista a partir da resposta já validada (`ler`), do perfil e do fuso do tenant. `motivos` é o corpo do catálogo. */
  montar: (dados: unknown, perfil: Perfil, fuso: string, motivos: unknown) => DetalheVista;
  /** Parse da resposta da API (Zod `.parse`). */
  ler: (corpo: unknown) => unknown;
  /** Catálogo de motivos (`GET`), quando houver ação com motivo. */
  motivosApi?: string;
  /** Rota de volta para a lista. */
  voltar: string;
}

export type TipoCampo = 'texto' | 'area' | 'data' | 'numero' | 'selecao' | 'cadastro';
export interface CampoFormulario {
  nome: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  fonte?: FonteOpcoes;
  opcoes?: readonly { valor: string; rotulo: string }[];
  ajuda?: string;
}
export type ValoresFormulario = Readonly<Record<string, string>>;
export interface ItemFormulario { produto_id: string; quantidade: string; preco: string; desconto?: string }
export type ErrosFormulario = Readonly<Record<string, string>>;

export interface TelaFormulario {
  tipo: 'formulario';
  campos: readonly CampoFormulario[];
  /** Itens (produto, quantidade, preço): ausente = formulário sem itens. */
  itens?: { fonte: FonteOpcoes; rotuloProduto: string };
  /** Validação local (a API sempre revalida). Devolve erros por campo (`itens` = erro geral dos itens). */
  validar: (valores: ValoresFormulario, itens: readonly ItemFormulario[]) => ErrosFormulario;
  /** Corpo do POST, a partir dos valores. */
  montar: (valores: ValoresFormulario, itens: readonly ItemFormulario[]) => unknown;
  /** POST de criação. */
  api: string;
  /** Rota do detalhe, a partir do `id` devolvido pela API. */
  depois: (id: string) => string;
  voltar: string;
  enviar: string;
}

export type TelaDescrita = TelaLista | TelaDetalhe | TelaFormulario;
