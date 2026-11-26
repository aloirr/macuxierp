import { AvisoDesbloqueada } from '@/components/aviso-desbloqueada';
import { AssinaturaErp } from '@macuxierp/ui/marca';

/**
 * Faixa de marca e título dos cartões centrais (login e seleção de filial): a assinatura C negativo sobre azul-noite.
 * A área de proteção (altura do "M", guia-area-de-protecao-c) fica no padding da faixa (globals.css).
 */
export function CabecalhoCartao({ titulo, desbloqueada = false }: { titulo: string; /** "Conta desbloqueada." entre a marca e o título. */ desbloqueada?: boolean }) {
  return (
    <>
      <header className="mx-fundo-escuro"><AssinaturaErp variante="C" altura={100} /></header>
      {desbloqueada && <AvisoDesbloqueada />}
      <h1>{titulo}</h1>
    </>
  );
}
