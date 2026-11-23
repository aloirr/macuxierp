'use client';

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cor, espaco, texto } from './estilos.js';

export interface DialogoProps {
  titulo: string;
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
  /** id do elemento que descreve o diálogo (aria-describedby). */
  descricaoId?: string;
}

const FOCAVEIS = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/** Próximo índice de foco com Tab preso (circular). */
export function proximoFoco(atual: number, total: number, voltar: boolean): number {
  if (total <= 0) return -1;
  return voltar ? (atual <= 0 ? total - 1 : atual - 1) : (atual + 1) % total;
}

/** Base modal: fundo clicável, foco preso, Esc fecha, foco volta ao elemento anterior. */
export function Dialogo({ titulo, aoFechar, rodape, children, descricaoId }: DialogoProps) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    (raiz.current?.querySelector<HTMLElement>(FOCAVEIS) ?? raiz.current)?.focus();
    return () => anterior?.focus?.();
  }, []);

  const teclado = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      aoFechar();
    } else if (e.key === 'Tab') {
      const itens = Array.from(raiz.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []);
      const i = proximoFoco(itens.indexOf(document.activeElement as HTMLElement), itens.length, e.shiftKey);
      if (i >= 0) {
        e.preventDefault();
        itens[i]?.focus();
      }
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center' }} data-fundo-dialogo>
      <div aria-hidden="true" onClick={aoFechar} style={{ position: 'absolute', inset: 0, background: cor('grafite'), opacity: 0.55 }} />
      <div
        ref={raiz}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={`${id}-t`}
        aria-describedby={descricaoId}
        onKeyDown={teclado}
        style={{ ...texto('base'), background: cor('branco'), padding: espaco.xl, width: 'min(480px, 92vw)', boxSizing: 'border-box', display: 'grid', gap: espaco.md, position: 'relative' }}
      >
        <h2 id={`${id}-t`} style={{ ...texto('titulo-dialogo', 'titulo'), margin: 0 }}>{titulo}</h2>
        {children}
        {rodape ? <div style={{ display: 'flex', gap: espaco.sm, justifyContent: 'flex-end' }}>{rodape}</div> : null}
      </div>
    </div>
  );
}
