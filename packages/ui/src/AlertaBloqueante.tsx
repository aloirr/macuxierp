'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { canto, cor, espaco, faixaLateral, texto, tons } from './estilos.js';

export interface AlertaBloqueanteProps {
  /** O que foi bloqueado, em uma frase (vira o título do alerta). */
  titulo: string;
  /** O que fazer para resolver. */
  children: ReactNode;
  /** Ação de resolução (botão ou link), depois do texto na ordem de tabulação. */
  acao?: ReactNode;
  /** Leva o foco ao alerta ao aparecer (padrão: sim, menos se a pessoa estiver digitando). */
  focar?: boolean;
}

const CAMPOS_DIGITACAO = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Regra do foco (docs/design/alerta-bloqueante): não tira o foco de quem digita, nem do que já está dentro do alerta. */
export function deveFocarAlerta(ativo: Element | null, alerta: Element | null): boolean {
  if (!ativo || ativo.tagName === 'BODY') return true;
  if (alerta?.contains(ativo)) return false;
  return !ativo.matches(CAMPOS_DIGITACAO);
}

function Icone() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 20 20" style={{ flex: 'none', marginTop: 1 }}>
      <circle cx="10" cy="10" r="9" fill="none" stroke={cor('erroTexto')} strokeWidth="2" />
      <path d="M5.5 14.5 14.5 5.5" stroke={cor('erroTexto')} strokeWidth="2" />
    </svg>
  );
}

/** Alerta bloqueante: a ação só segue depois de resolver. Ícone, barra lateral de 4 px em erro-texto, role="alert". */
export function AlertaBloqueante({ titulo, children, acao, focar = true }: AlertaBloqueanteProps) {
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focar && deveFocarAlerta(document.activeElement, raiz.current)) raiz.current?.focus();
  }, [focar]);
  return (
    <div
      ref={raiz}
      role="alert"
      tabIndex={-1}
      data-alerta-bloqueante=""
      style={{ ...texto('base'), display: 'flex', gap: espaco.md, alignItems: 'flex-start', ...faixaLateral(tons.erro), borderRadius: canto, padding: espaco.md }}
    >
      <Icone />
      <div style={{ display: 'grid', gap: espaco.xs, flex: '1 1 auto' }}>
        <strong data-alerta-titulo="" style={{ ...texto('base', 'rotulo-campo'), color: cor('erroTexto') }}>{titulo}</strong>
        <div>{children}</div>
        {acao ? <div style={{ marginTop: espaco.xs }}>{acao}</div> : null}
      </div>
    </div>
  );
}
