'use client';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Valor que aparece uma única vez (senha provisória de usuário novo ou redefinida, RN-CORE-10). O valor vive só no estado desta
 * tela: some ao fechar, nunca vai a URL, log ou armazenamento do navegador. Foco preso, Esc não fecha (é preciso confirmar que anotou).
 */
const FOCAVEIS = 'button:not([disabled]), [href]';

export function PainelSegredo({ titulo, rotulo, valor, aviso, rotuloFechar = 'Já anotei', aoFechar }: { titulo: string; rotulo: string; valor: string; aviso: string; rotuloFechar?: string; aoFechar: () => void }) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [copiado, setCopiado] = useState<'sim' | 'falhou' | null>(null);

  useEffect(() => {
    raiz.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado('sim');
    } catch {
      setCopiado('falhou'); // sem permissão da área de transferência: a pessoa seleciona o texto na tela
    }
  }

  function teclado(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const itens = Array.from(raiz.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []);
    if (itens.length === 0) return;
    const i = itens.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    itens[e.shiftKey ? (i <= 0 ? itens.length - 1 : i - 1) : (i + 1) % itens.length]?.focus();
  }

  return (
    <div className="dialogo-fundo" data-fundo-dialogo>
      <div aria-hidden="true" className="dialogo-cortina" />
      <div ref={raiz} className="dialogo" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-aviso`} onKeyDown={teclado}>
        <h2 id={`${id}-t`}>{titulo}</h2>
        <p className="apoio">{rotulo}</p>
        <p><code className="segredo" data-segredo>{valor}</code></p>
        <p id={`${id}-aviso`} className="faixa-aviso">{aviso}</p>
        <p className="apoio" role="status">{copiado === 'sim' ? 'Senha copiada.' : copiado === 'falhou' ? 'Não foi possível copiar. Selecione o texto e copie.' : ''}</p>
        <div className="barra-acoes dialogo-botoes">
          <button type="button" className="mx-botao-secundario" onClick={() => void copiar()}>Copiar</button>
          <button type="button" className="mx-botao" onClick={aoFechar}>{rotuloFechar}</button>
        </div>
      </div>
    </div>
  );
}
