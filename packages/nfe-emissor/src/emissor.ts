/**
 * Implementação da porta `EmissorNFe` pelo porte em TS da lógica do sped-nfe (opção (a) do spike, MIT).
 * Atribuição: Copyright (c) NFePHP — https://github.com/nfephp-org/sped-nfe e sped-common (opção MIT).
 */
import type { PedidoEvento, RespostaEvento } from '@macuxierp/nfe-sefaz';
import { assinarDocumento, assinarNFe, type DocumentoAssinado } from './assinatura';
import type { CertificadoA1EmMemoria } from './certificado';
import { loteDoEvento, montarCancelamento, montarCartaCorrecao, montarInutilizacao, type PedidoCancelamento, type PedidoCartaCorrecao } from './eventos';
import { montarNFe } from './montar';
import type { EmissorNFe } from './porta';

/** Cancelamento e CC-e: assina o `<evento>` montado e envia no `envEvento` pelo serviço do transporte. */
async function enviarEvento(
  pedido: PedidoCancelamento | PedidoCartaCorrecao,
  xml: string,
  a1: CertificadoA1EmMemoria,
  enviar: (p: PedidoEvento) => Promise<RespostaEvento>,
): Promise<RespostaEvento & { assinado: DocumentoAssinado }> {
  const assinado = assinarDocumento(xml, a1, 'infEvento');
  return { ...(await enviar({ idLote: loteDoEvento(pedido), eventoAssinado: assinado.xml })), assinado };
}

export function criarEmissorNFe(): EmissorNFe {
  return {
    montar: montarNFe,
    assinar: assinarNFe,
    transmitir: (xmlAssinado, idLote, transporte) => transporte.autorizar({ idLote, sincrono: true, nfes: [xmlAssinado] }),
    cancelar: async (pedido, a1, transporte) => enviarEvento(pedido, montarCancelamento(pedido), a1, (p) => transporte.cancelar(p)),
    cartaCorrecao: async (pedido, a1, transporte) => enviarEvento(pedido, montarCartaCorrecao(pedido), a1, (p) => transporte.cartaCorrecao(p)),
    async inutilizar(pedido, a1, transporte) {
      const assinado = assinarDocumento(montarInutilizacao(pedido), a1, 'infInut');
      return { ...(await transporte.inutilizar({ inutilizacaoAssinada: assinado.xml })), assinado };
    },
  };
}
