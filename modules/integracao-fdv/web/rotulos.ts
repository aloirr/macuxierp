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

export const ROTULO_AMBIENTE: Readonly<Record<AmbienteHub, string>> = { teste: 'Teste', producao: 'Produção' };

export const ROTULO_MODO_LOTE: Readonly<Record<ModoLote, string>> = { completo: 'Carga completa', delta: 'Alterações' };
