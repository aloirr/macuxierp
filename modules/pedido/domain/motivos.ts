import type { MotivoCodigo } from '../contracts';

/** T-0013 §4.3: texto em português que vai ao vendedor no FDV. Em `outro`, vai o `motivo_texto`. */
export const CATALOGO_MOTIVOS: Readonly<Record<MotivoCodigo, string>> = {
  preco_divergente: 'Preço divergente da tabela',
  credito_insuficiente: 'Crédito insuficiente',
  estoque_insuficiente: 'Estoque insuficiente',
  cliente_bloqueado: 'Cliente bloqueado',
  pedido_duplicado: 'Pedido duplicado',
  condicao_nao_aceita: 'Condição de pagamento não aceita',
  solicitacao_cliente: 'Solicitação do cliente',
  sem_estoque: 'Produto sem estoque',
  erro_lancamento: 'Erro de lançamento',
  outro: 'Outro motivo',
};

export function textoMotivo(codigo: MotivoCodigo, motivoTexto: string | null | undefined): string {
  if (codigo === 'outro') {
    const livre = motivoTexto?.trim();
    return livre ? livre : CATALOGO_MOTIVOS.outro;
  }
  return CATALOGO_MOTIVOS[codigo];
}

/** Motivo gravado pelo sistema no histórico quando a nota cancelada recua o status (RN-PED-02). Fora do contrato de escolha do usuário. */
export const MOTIVO_NOTA_CANCELADA = 'nota_cancelada' as const;
export type MotivoSistema = typeof MOTIVO_NOTA_CANCELADA;

export const CATALOGO_MOTIVOS_SISTEMA: Readonly<Record<MotivoSistema, string>> = {
  nota_cancelada: 'Nota fiscal cancelada',
};

/** Texto do motivo de sistema; `null` se o código não é de sistema. */
export function textoMotivoSistema(codigo: string): string | null {
  return Object.hasOwn(CATALOGO_MOTIVOS_SISTEMA, codigo) ? CATALOGO_MOTIVOS_SISTEMA[codigo as MotivoSistema] : null;
}
