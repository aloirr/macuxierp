'use client';
import type { ZeragemPedidosResposta } from '@macuxierp/pedido/contracts';
import { FRASE_ZERAR_DADOS } from '@macuxierp/platform-sdk';
import { ConfirmarComFrase } from '@/components/confirmar-com-frase';
import { AVISO_ZERAR } from '@/lib/config/cargas';
import { TEXTO_ANTES_DE_ZERAR_PEDIDOS, pedirPreviaZerarPedidos, pedirZerarPedidos, semPedidoParaApagar, textoApagarPedidos, textosMantidosPedidos, type ResultadoZerarPedidos } from '@/lib/config/pedidos-zerar';
import { ListaMantidos, usePreviaZerar } from './previa-zerar';

/**
 * "Pedidos não faturados" no Zerar por cadastro (T-0093, RN-CAD-10): apaga só os pedidos sem nota e sem título, com a mesma frase
 * "autorizo zerar os dados". A prévia mostra o que será apagado e "Mantidos: N" por motivo (nota ou título) e avisa que o pedido
 * do FDV só volta pelo reenvio do FDV. Passa pelos route handlers de `/config/empresas/:id/pedidos/zerar`.
 */
export function ZerarPedidos({ empresaId, aoFechar, aoZerar, previaInicial = null }: {
  empresaId: string;
  aoFechar: () => void;
  aoZerar: (r: ResultadoZerarPedidos) => void;
  previaInicial?: ZeragemPedidosResposta | null;
}) {
  const { previa, carregando, erroPrevia, recontar } = usePreviaZerar((sinal) => pedirPreviaZerarPedidos(empresaId, fetch, sinal), [empresaId], previaInicial);

  const vazia = !!previa && !carregando && semPedidoParaApagar(previa);
  const mantidos = previa ? textosMantidosPedidos(previa.mantidos) : null;

  return (
    <ConfirmarComFrase
      titulo="Zerar pedidos não faturados?"
      frase={FRASE_ZERAR_DADOS}
      rotulo="Zerar pedidos"
      rotuloEnviando="Zerando pedidos…"
      idEnvio="zerar:pedidos"
      semAcao={vazia}
      podeEnviar={!!previa && !carregando}
      enviar={(chave, frase) => pedirZerarPedidos(empresaId, frase, chave)}
      aoSucesso={aoZerar}
      aoFalha={(r) => { if (r.codigo === 'dados_mudaram') recontar(); return undefined; }}
      aoFechar={aoFechar}
      aviso={AVISO_ZERAR}
      tomAviso="erro"
    >
      {!vazia && <p className="sem-margem">{TEXTO_ANTES_DE_ZERAR_PEDIDOS}</p>}
      {erroPrevia && <p className="erro" role="alert">{erroPrevia}</p>}
      {previa && (
        <div className="previa-zerar" aria-live="polite">
          <p data-testid="apagar-pedidos">{textoApagarPedidos(previa)}</p>
          {mantidos && <ListaMantidos total={mantidos.total} detalhes={mantidos.detalhes} />}
        </div>
      )}
    </ConfirmarComFrase>
  );
}
