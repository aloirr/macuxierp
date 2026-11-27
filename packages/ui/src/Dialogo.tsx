'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { canto, cor, espaco, texto, tons } from './estilos.js';

export interface DialogoProps {
  titulo: string;
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
  /** id do elemento que descreve o diálogo (aria-describedby). */
  descricaoId?: string;
  /** Aviso fixo logo abaixo do título, fora da rolagem (15 px, peso 600). */
  aviso?: ReactNode;
  /** Tom do aviso: 'erro' para ação irreversível (ex.: Zerar). Padrão 'aviso'. */
  tomAviso?: 'aviso' | 'erro';
}

/** Altura máxima do painel (decidida pela marca): base vale no SSR e sem dvh; dvh quando o navegador suporta. */
const alturaMaxBase = 'calc(100vh - 48px)';
const alturaMaxDvh = 'calc(100dvh - 48px)';

const FOCAVEIS = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/** Próximo índice de foco com Tab preso (circular). */
export function proximoFoco(atual: number, total: number, voltar: boolean): number {
  if (total <= 0) return -1;
  return voltar ? (atual <= 0 ? total - 1 : atual - 1) : (atual + 1) % total;
}

/** Base modal: fundo clicável, foco preso, Esc fecha, foco volta ao elemento anterior. */
export function Dialogo({ titulo, aoFechar, rodape, children, descricaoId, aviso, tomAviso = 'aviso' }: DialogoProps) {
  const id = useId();
  const avisoId = `${id}-aviso`;
  const descritoPor = [descricaoId, aviso ? avisoId : undefined].filter(Boolean).join(' ') || undefined;
  const raiz = useRef<HTMLDivElement>(null);
  const [alturaMax, setAlturaMax] = useState(alturaMaxBase);

  useEffect(() => {
    if (typeof CSS !== 'undefined' && CSS.supports('max-height', '100dvh')) setAlturaMax(alturaMaxDvh);
  }, []);

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
        aria-describedby={descritoPor}
        onKeyDown={teclado}
        style={{ ...texto('base'), background: cor('branco'), padding: espaco.xl, width: 'min(480px, 92vw)', boxSizing: 'border-box', borderRadius: 'var(--mx-medida-canto-cartao)', display: 'flex', flexDirection: 'column', gap: espaco.md, maxHeight: alturaMax, overflow: 'hidden', position: 'relative' }}
      >
        <h2 id={`${id}-t`} style={{ ...texto('titulo-dialogo', 'titulo'), margin: 0, flex: 'none' }}>{titulo}</h2>
        {aviso ? (
          <div id={avisoId} data-aviso-dialogo="" style={{ ...texto('base', 'rotulo-campo'), ...tons[tomAviso], padding: espaco.sm, borderRadius: canto, flex: 'none', marginBottom: espaco.sm }}>{aviso}</div>
        ) : null}
        <div data-corpo-dialogo="" style={{ padding: '4px', overflowY: 'auto', flex: '1 1 auto', minHeight: 0, display: 'grid', gap: espaco.md, alignContent: 'start' }}>{children}</div>
        {rodape ? <div style={{ display: 'flex', gap: espaco.sm, justifyContent: 'flex-end', flex: 'none' }}>{rodape}</div> : null}
      </div>
    </div>
  );
}
