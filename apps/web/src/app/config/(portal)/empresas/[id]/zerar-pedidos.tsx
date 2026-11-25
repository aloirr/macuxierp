'use client';
import type { ZeragemPedidosResposta } from '@macuxierp/pedido/contracts';
import { FRASE_ZERAR_DADOS } from '@macuxierp/platform-sdk';
import { useEffect, useState } from 'react';
import { ConfirmarComFrase } from '@/components/confirmar-com-frase';
import { AVISO_ZERAR } from '@/lib/config/cargas';
import { AVISO_PEDIDOS_FDV, TEXTO_ANTES_DE_ZERAR_PEDIDOS, pedirPreviaZerarPedidos, pedirZerarPedidos, textoApagarPedidos, textosMantidosPedidos, type ResultadoZerarPedidos } from '@/lib/config/pedidos-zerar';

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
  const [previa, setPrevia] = useState<ZeragemPedidosResposta | null>(previaInicial);
  const [carregando, setCarregando] = useState(previaInicial === null);
  const [erroPrevia, setErroPrevia] = useState('');
  const [recontar, setRecontar] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setCarregando(true);
    setErroPrevia('');
    void pedirPreviaZerarPedidos(empresaId, fetch, ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      setCarregando(false);
      if (!r.ok && r.redirecionar) window.location.assign(r.redirecionar);
      if (r.ok) setPrevia(r.valor); else { setPrevia(null); setErroPrevia(r.erro); }
    });
    return () => ctl.abort();
  }, [empresaId, recontar]);

  const mantidos = previa ? textosMantidosPedidos(previa.mantidos) : null;

  return (
    <ConfirmarComFrase
      titulo="Zerar Pedidos não faturados?"
      frase={FRASE_ZERAR_DADOS}
      rotulo="Zerar"
      rotuloEnviando="Zerando…"
      idEnvio="zerar:pedidos"
      podeEnviar={!!previa && !carregando}
      enviar={(chave, frase) => pedirZerarPedidos(empresaId, frase, chave)}
      aoSucesso={aoZerar}
      aoFalha={(r) => { if (r.codigo === 'dados_mudaram') setRecontar((n) => n + 1); return undefined; }}
      aoFechar={aoFechar}
      aviso={<><span>{AVISO_ZERAR}</span><br /><span data-testid="aviso-fdv-pedidos">{AVISO_PEDIDOS_FDV}</span></>}
      tomAviso="erro"
    >
      <p className="sem-margem">{TEXTO_ANTES_DE_ZERAR_PEDIDOS}</p>
      {erroPrevia && <p className="erro" role="alert">{erroPrevia}</p>}
      {previa && (
        <div className="previa-zerar" aria-live="polite">
          <p data-testid="apagar-pedidos">{textoApagarPedidos(previa)}</p>
          {mantidos && (
            <div>
              <p>{mantidos.total}</p>
              <ul className="lista-simples apoio">{mantidos.detalhes.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </ConfirmarComFrase>
  );
}
