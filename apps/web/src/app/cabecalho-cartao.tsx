import { AssinaturaErp } from '@macuxierp/ui/marca';

/**
 * Faixa de marca e título dos cartões centrais (login e seleção de filial): a assinatura C negativo sobre azul-noite.
 * A área de proteção (altura do "M", guia-area-de-protecao-c) fica no padding da faixa (globals.css).
 */
export function CabecalhoCartao({ titulo }: { titulo: string }) {
  return (
    <>
      <header className="mx-fundo-escuro"><AssinaturaErp variante="C" altura={100} /></header>
      <h1>{titulo}</h1>
    </>
  );
}
