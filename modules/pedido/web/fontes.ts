/**
 * Fontes dos seletores do formulário do pedido (T-0015, lote 3b). Formato ADITIVO: quem só conhece a fonte em texto
 * (`'/v1/cadastros/filiais'`) continua valendo para lista fechada; `FonteComBusca` acrescenta a busca no servidor.
 * Cliente e produto podem passar de 200 registros: o seletor consulta `GET <caminho>?busca=<texto>&limite=<n>` a cada
 * digitação (depois do atraso) em vez de carregar tudo. A API do cadastros valida `busca` (até 80 caracteres).
 */
import { CHAVE_BUSCA } from '@macuxierp/platform-sdk/listas';
import type { EnderecoClienteItem } from '@macuxierp/cadastros/contracts';

export interface FonteComBusca {
  /** Lista do cadastros: `/v1/cadastros/<recurso>`. */
  caminho: string;
  busca: {
    /** Nome do parâmetro de busca na query (o `?busca=` das listas do cadastros). */
    parametro: typeof CHAVE_BUSCA;
    /** Só consulta com ao menos este tamanho de texto; abaixo disso mostra as primeiras opções (sem busca). */
    minimo: number;
    /** `limite` pedido por consulta. */
    limite: number;
    /** Espera depois da última tecla, em ms. */
    atraso_ms: number;
    /** Máximo de caracteres aceito pela API; o shell corta o texto aqui. */
    maximo: number;
  };
}

export type FonteDoSeletor = string | FonteComBusca;

const BUSCA = { parametro: CHAVE_BUSCA, minimo: 2, limite: 20, atraso_ms: 300, maximo: 80 /* até o SDK exportar BUSCA_MAXIMO */ } as const;

export const FONTE_CLIENTE: FonteComBusca = { caminho: '/v1/cadastros/clientes', busca: BUSCA };
export const FONTE_PRODUTO: FonteComBusca = { caminho: '/v1/cadastros/produtos', busca: BUSCA };
/** Lista fechada: poucos registros por tenant. */
export const FONTE_FILIAL = '/v1/cadastros/filiais';
export const FONTE_VENDEDOR = '/v1/cadastros/vendedores';
export const FONTE_CONDICAO = '/v1/cadastros/condicoes-pagamento';

/** Caminho GET da consulta: sem texto (ou menor que o mínimo) só o `limite`. */
export function caminhoDaConsulta(fonte: FonteDoSeletor, texto = ''): string {
  if (typeof fonte === 'string') return fonte;
  const t = Array.from(texto.trim()).slice(0, fonte.busca.maximo).join('');
  const q = new URLSearchParams({ limite: String(fonte.busca.limite) });
  if (t.length >= fonte.busca.minimo) q.set(fonte.busca.parametro, t);
  return `${fonte.caminho}?${q.toString()}`;
}

/** Fonte das opções do endereço de entrega: os endereços do cliente escolhido. A rota devolve `{ itens }` (cada item é um `EnderecoClienteItem`), não um array solto. */
export const caminhoDosEnderecos = (clienteId: string) => `${FONTE_CLIENTE.caminho}/${encodeURIComponent(clienteId)}/enderecos`;

export interface OpcaoEndereco {
  valor: string;
  rotulo: string;
}

type EnderecoParaOpcao = Pick<EnderecoClienteItem, 'id' | 'logradouro' | 'numero' | 'bairro' | 'uf' | 'tipo'> & { municipio_nome?: string | null };

/**
 * Opções do seletor de endereço (opcional: sem escolha vale o principal). Rótulo: "logradouro, número, bairro, município/UF";
 * o município vem por nome quando a API o traz, senão só a UF.
 */
export function opcoesDeEndereco(enderecos: readonly EnderecoParaOpcao[]): OpcaoEndereco[] {
  return enderecos.map((e) => ({
    valor: e.id,
    rotulo: `${e.logradouro}, ${e.numero}, ${e.bairro}, ${e.municipio_nome ? `${e.municipio_nome}/${e.uf}` : e.uf}${e.tipo === 'principal' ? ' (principal)' : ''}`,
  }));
}
