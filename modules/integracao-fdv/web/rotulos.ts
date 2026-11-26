/** Rótulos em português para pessoas (sem jargão): cadastros, situação do envio e motivos. Só texto fixo, nunca dado do FDV. */
import type { AmbienteHub, EntidadeHub, EstadoLote, ModoLote } from '../contracts';

export const ROTULO_ENTIDADE: Readonly<Record<EntidadeHub, string>> = {
  filial: 'Filiais',
  vendedor: 'Vendedores',
  forma_pagamento: 'Formas de pagamento',
  prazo_pagamento: 'Condições de pagamento',
  produto: 'Produtos',
  produto_unidade: 'Unidades do produto',
  preco: 'Preços',
  estoque: 'Estoque',
  cliente: 'Clientes',
  cliente_endereco: 'Endereços de clientes',
  titulo: 'Títulos',
  nota: 'Notas',
};

export const ROTULO_ESTADO_LOTE: Readonly<Record<EstadoLote, string>> = {
  montado: 'Preparado',
  enviando: 'Enviando',
  aceito: 'Em conferência',
  concluido: 'Concluído',
  concluido_com_erros: 'Concluído com erros',
  falhou: 'Falhou',
  recusado: 'Recusado',
};

/** Log do cadastro de cliente (RN-INF-09) e rota /clientes-recebidos (T-0059): situação do pré-cadastro e do retorno ao FDV. */
export const ROTULO_SITUACAO_CLIENTE_RECEBIDO: Readonly<Record<'recebido' | 'aceito' | 'recusado' | 'reenviado', string>> = {
  recebido: 'Recebido',
  aceito: 'Aceito',
  recusado: 'Recusado',
  reenviado: 'Reenviado',
};
export const ROTULO_RETORNO_CLIENTE: Readonly<Record<'pendente' | 'enviado' | 'falhou', string>> = {
  pendente: 'Na fila para voltar ao FDV',
  enviado: 'Voltou ao FDV',
  falhou: 'Não voltou ao FDV',
};
/** Vendedor ausente, nulo ou linha expurgada: a tela mostra o traço (decisão do Alexandre, 24/11). */
export const TEXTO_SEM_VALOR = '—';

export const ROTULO_AMBIENTE: Readonly<Record<AmbienteHub, string>> = { teste: 'Teste', producao: 'Produção' };

export const ROTULO_MODO_LOTE: Readonly<Record<ModoLote, string>> = { completo: 'Carga completa', delta: 'Alterações' };
