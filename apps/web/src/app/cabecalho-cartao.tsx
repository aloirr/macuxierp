import { NOME_PRODUTO } from '@/lib/marca';

/** Faixa de marca e título dos cartões centrais (login e seleção de filial). */
export function CabecalhoCartao({ titulo }: { titulo: string }) {
  return (
    <>
      <header><span className="marca">{NOME_PRODUTO}</span></header>
      <h1>{titulo}</h1>
    </>
  );
}
