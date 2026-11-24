/** Parte pura das colunas de entrada (cenário B, ADR 0014 §5 e §14). Sem React. Textos do designer-ux. */
import { plural } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { ROTULO_ENTIDADE } from '@macuxierp/integracao-fdv/web';
import type { EntidadeEnvioFdv } from '@macuxierp/platform-sdk';
import type { ConfirmacaoPendente, DonoEntrada, LinhaEntradaApi } from './entrada-provisorio';

export interface LinhaEntrada {
  cadastro: EntidadeEnvioFdv;
  rotulo: string;
  dono: DonoEntrada;
  /** "Segue Clientes" / "Segue Produtos", no lugar do seletor, nos dependentes (vem de `dono_herdado_de`). */
  segue: string | null;
  ultimoLote: string;
  erros: number;
  pendente: ConfirmacaoPendente | null;
}

export const semSinal = '—';
export const hora = (iso: string | null, fuso: string): string => (iso ? formatarDataHora(iso, fuso) : semSinal);

export function textoUltimoLote(l: LinhaEntradaApi['ultimo_lote'], fuso: string): string {
  if (!l) return semSinal;
  return `${formatarDataHora(l.em, fuso)} · ${l.gravadas} de ${l.recebidas}${l.com_erro > 0 ? `, ${l.com_erro} com erro` : ''}`;
}

export function linhasEntrada(cadastros: LinhaEntradaApi[], fuso: string): LinhaEntrada[] {
  return cadastros.map((c) => ({
    cadastro: c.cadastro,
    rotulo: ROTULO_ENTIDADE[c.cadastro],
    dono: c.dono,
    segue: c.dono_herdado_de ? `Segue ${ROTULO_ENTIDADE[c.dono_herdado_de]}` : null,
    ultimoLote: textoUltimoLote(c.ultimo_lote, fuso),
    erros: c.erros,
    pendente: c.confirmacao_pendente,
  }));
}

/** Trava de 30% (ADR 0014 §3). Textos da carga de clientes: "Vai inativar N de M clientes (X%)." e, nos endereços, "Vai inativar 5 endereços e nenhum cliente.". */
export function textoTrava(cadastro: EntidadeEnvioFdv, p: { a_inativar: number; total: number; percentual: number }): string {
  if (cadastro === 'cliente_endereco') return `Vai inativar ${plural(p.a_inativar, 'endereço', 'endereços')} e nenhum cliente.`;
  const nome = ROTULO_ENTIDADE[cadastro].toLowerCase();
  return `Vai inativar ${p.a_inativar} de ${p.total} ${nome} (${Math.round(p.percentual)}%).`;
}

export const TEXTOS_ENTRADA = {
  tituloConector: 'Integração via Conector',
  tituloApi: 'Integração via API',
  tituloCadastros: 'Cadastros recebidos do cliente',
  avisoChave: 'Esta chave não aparece de novo.',
  semCredencial: 'Nenhuma chave gerada ainda.',
  semDados: 'Sem dados de entrada desta empresa ainda.',
  trocaChave: 'A chave atual para de funcionar agora.',
  erro503: 'O servidor ainda não está preparado para gerar chaves. Avise o responsável pelo servidor.',
  erro409Codigo: 'Este código já está em uso. Escolha outro.',
  erro400Codigo: 'Use só letras, números, ponto, hífen e sublinhado, até 100 caracteres.',
  erroRedeChave: 'Não foi possível confirmar a chave. Gere de novo: a chave nova substitui a anterior.',
  donoPendente: 'Resolva a inativação pendente antes de trocar o dono.',
  donoEmAndamento: 'Há uma carga do servidor do cliente em andamento neste cadastro.',
  loteRecusado: 'Lote recusado. Nada foi inativado.',
  prazoTitulo: 'Prazo vencido',
  prazoCorpo: 'O pedido de inativação venceu. Peça ao cliente que envie a carga completa de novo pelo Conector.',
  fecharSemCopiarTitulo: 'Fechar sem copiar a chave?',
  paraCliente: 'Vai pedir a carga completa do Conector deste cadastro. Os registros que não vierem nela serão inativados, com a trava de 30%.',
  paraErp: 'Os registros ficam e passam a ser editáveis aqui.',
  avisoTrava: 'Inativar não apaga: os registros ficam no histórico.',
} as const;

export const ROTULO_DONO: Readonly<Record<DonoEntrada, string>> = { erp: 'Macuxi ERP', cliente: 'Servidor do cliente' };
export const textoApoioTrava = (expiraEm: string, fuso: string): string =>
  `Confirme até ${hora(expiraEm, fuso)}. Depois disso o pedido vence e a carga precisa ser enviada de novo.`;
export const avisoDono = (rotulo: string, cargaPedida: boolean): string =>
  cargaPedida ? `Dono de ${rotulo} alterado. Carga completa pedida ao Conector.` : `Dono de ${rotulo} alterado.`;
