'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as TecladoReact, ReactNode } from 'react';
import { botaoSecundario, canto, cor, desabilitadoEstilo, espaco, texto } from './estilos.js';

/** Item do menu. `oculto` tira o item; `perigo` manda para o fim, depois do separador. */
export interface AcaoMenu {
  chave: string;
  rotulo: string;
  aoAcionar: () => void;
  perigo?: boolean;
  desabilitado?: boolean;
  oculto?: boolean;
}

/** Ação principal à vista, ao lado do "Ações". Não se repete dentro do menu. */
export interface AcaoPrincipal {
  rotulo: string;
  aoAcionar: () => void;
  desabilitado?: boolean;
  oculto?: boolean;
}

export interface MenuAcoesProps {
  /** Itens do menu (a tela decide quais valem para a situação da linha). */
  acoes: AcaoMenu[];
  /** No máximo uma ação principal à vista (ex.: falha → Reprocessar; senão Log). */
  principal?: AcaoPrincipal;
  /** Nome da linha: o gatilho ganha aria-label "Ações de <linha>", com o texto visível "Ações". */
  rotuloLinha?: string;
  /** Só para SSR e testes: renderiza o menu já aberto. */
  abertoInicial?: boolean;
}

export type TeclaMenu = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** Itens visíveis na ordem final: normais, depois (após um separador) os de perigo. */
export function ordenarAcoes(acoes: AcaoMenu[]): { normais: AcaoMenu[]; perigos: AcaoMenu[] } {
  const visiveis = acoes.filter((a) => !a.oculto);
  return { normais: visiveis.filter((a) => !a.perigo), perigos: visiveis.filter((a) => a.perigo) };
}

/** Próximo índice de foco, circular, pulando desabilitados. -1 se nada é focável. */
export function proximoItemMenu(desabilitados: boolean[], atual: number, tecla: TeclaMenu): number {
  const n = desabilitados.length;
  if (!desabilitados.some((d) => !d)) return -1;
  if (tecla === 'Home') return desabilitados.findIndex((d) => !d);
  if (tecla === 'End') return n - 1 - [...desabilitados].reverse().findIndex((d) => !d);
  const passo = tecla === 'ArrowDown' ? 1 : -1;
  let i = atual;
  for (let k = 0; k < n; k++) {
    i = (i + passo + n) % n;
    if (!desabilitados[i]) return i;
  }
  return atual;
}

export interface Retangulo {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Posição `fixed` do menu: abaixo e alinhado à direita do gatilho; vira para cima/esquerda se não couber. */
export function posicaoMenu(gatilho: Retangulo, menu: { largura: number; altura: number }, viewport: { largura: number; altura: number }, folga = 4): { top: number; left: number } {
  const cabeBaixo = gatilho.bottom + folga + menu.altura <= viewport.altura;
  const top = cabeBaixo ? gatilho.bottom + folga : Math.max(0, gatilho.top - folga - menu.altura);
  let left = gatilho.right - menu.largura;
  if (left < 0) left = Math.min(gatilho.left, Math.max(0, viewport.largura - menu.largura));
  return { top, left };
}

const itemBase: CSSProperties = {
  ...texto('base'),
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 0,
  borderRadius: 0,
  padding: `${espaco.sm}px ${espaco.lg}px`,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
};

/** Botão "Ações" da linha (T-0099): um componente único para todas as tabelas e listas. */
export function MenuAcoes({ acoes, principal, rotuloLinha, abertoInicial = false }: MenuAcoesProps) {
  const id = useId();
  const menuId = `${id}-menu`;
  const [aberto, setAberto] = useState(abertoInicial);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const gatilho = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const viaTeclado = useRef(false);

  const { normais, perigos } = ordenarAcoes(acoes);
  const lista = [...normais, ...perigos];
  const desabilitados = lista.map((a) => !!a.desabilitado);
  const principalVisivel = principal && !principal.oculto ? principal : undefined;

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) gatilho.current?.focus();
  }, []);

  const itensDom = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useLayoutEffect(() => {
    if (!aberto || !gatilho.current || !menu.current) return;
    const g = gatilho.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    setPos(posicaoMenu(g, { largura: m.width, altura: m.height }, { largura: window.innerWidth, altura: window.innerHeight }));
    if (viaTeclado.current) {
      const i = proximoItemMenu(desabilitados, -1, 'ArrowDown');
      if (i >= 0) itensDom()[i]?.focus();
    }
    // Só ao abrir: a posição e o foco inicial não se recalculam a cada render.
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!menu.current?.contains(alvo) && !gatilho.current?.contains(alvo)) fechar(false);
    };
    const rolagem = () => fechar(false);
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', rolagem, true);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('scroll', rolagem, true);
    };
  }, [aberto, fechar]);

  if (lista.length === 0 && !principalVisivel) return null;

  const tecladoGatilho = (e: TecladoReact) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      viaTeclado.current = true;
      setAberto(true);
    }
  };

  const tecladoMenu = (e: TecladoReact) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar(true);
    } else if (e.key === 'Tab') {
      fechar(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const itens = itensDom();
      const i = proximoItemMenu(desabilitados, itens.indexOf(document.activeElement as HTMLElement), e.key);
      if (i >= 0) itens[i]?.focus();
    }
  };

  const escolher = (a: AcaoMenu) => {
    if (a.desabilitado) return;
    fechar(true);
    a.aoAcionar();
  };

  const item = (a: AcaoMenu): ReactNode => (
    <button
      key={a.chave}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={a.desabilitado ? true : undefined}
      className={`mx-acoes-item mx-acoes-alvo${a.perigo ? ' mx-acoes-perigo' : ''}`}
      onClick={() => escolher(a)}
      style={{ ...itemBase, ...desabilitadoEstilo(a.desabilitado), ...(a.perigo ? { color: cor('erroTexto') } : null) }}
    >
      {a.rotulo}
    </button>
  );

  const estiloBotao: CSSProperties = botaoSecundario();

  return (
    <span style={{ display: 'inline-flex', gap: espaco.sm, alignItems: 'center', whiteSpace: 'nowrap' }}>
      {principalVisivel ? (
        <button
          type="button"
          className="mx-acoes-alvo"
          disabled={principalVisivel.desabilitado}
          onClick={principalVisivel.aoAcionar}
          style={{ ...estiloBotao, ...desabilitadoEstilo(principalVisivel.desabilitado) }}
        >
          {principalVisivel.rotulo}
        </button>
      ) : null}
      {lista.length > 0 ? (
        <>
          <button
            ref={gatilho}
            type="button"
            className="mx-acoes-gatilho mx-acoes-alvo"
            aria-haspopup="menu"
            aria-expanded={aberto}
            aria-controls={menuId}
            aria-label={rotuloLinha ? `Ações de ${rotuloLinha}` : undefined}
            onClick={() => {
              viaTeclado.current = false;
              setAberto(!aberto);
            }}
            onKeyDown={tecladoGatilho}
            style={estiloBotao}
          >
            Ações
          </button>
          {aberto ? (
            <div
              ref={menu}
              id={menuId}
              role="menu"
              aria-label={rotuloLinha ? `Ações de ${rotuloLinha}` : 'Ações'}
              onKeyDown={tecladoMenu}
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                zIndex: 1000,
                width: 'max-content',
                maxWidth: 'calc(100vw - 16px)',
                background: cor('branco'),
                border: `1px solid ${cor('bordaTabela')}`,
                borderRadius: canto,
                boxShadow: `0 4px 12px color-mix(in srgb, ${cor('grafite')} 20%, transparent)`,
                padding: `${espaco.xs}px 0`,
                boxSizing: 'border-box',
              }}
            >
              {normais.map(item)}
              {perigos.length > 0 && normais.length > 0 ? (
                <div role="separator" style={{ height: 1, margin: `${espaco.xs}px 0`, background: cor('bordaTabela') }} />
              ) : null}
              {perigos.map(item)}
            </div>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
