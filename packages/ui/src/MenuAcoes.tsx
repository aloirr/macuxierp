'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as TecladoReact, ReactNode } from 'react';
import { botaoSecundario, canto, cor, desabilitadoEstilo, espaco, texto } from './estilos.js';

/**
 * Item do menu. `oculto` tira o item; `perigo` manda para o fim, depois do separador.
 * `desabilitado`: `true` desliga o item (pulado nas setas); um texto desliga e mostra o motivo
 * abaixo do rótulo (o item continua focável, para o leitor de tela anunciar o motivo).
 */
export type Desabilitado = boolean | string;

export interface AcaoMenu {
  chave: string;
  rotulo: string;
  aoAcionar: () => void;
  perigo?: boolean;
  desabilitado?: Desabilitado;
  oculto?: boolean;
}

/** Ação principal à vista, ao lado do "Ações". Não se repete dentro do menu. `desabilitado` segue a regra do item do menu. */
export interface AcaoPrincipal {
  rotulo: string;
  aoAcionar: () => void;
  desabilitado?: Desabilitado;
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

export type AcaoTeclaGatilho = 'abrir-primeiro' | 'abrir-ultimo' | 'entrar-primeiro' | 'entrar-ultimo' | 'fechar' | null;

/** Tecla no gatilho "Ações" → o que fazer (T-0099). Enter, Espaço e ↓ vão ao primeiro item; ↑ ao último; Esc fecha. */
export function acaoTeclaGatilho(tecla: string, aberto: boolean): AcaoTeclaGatilho {
  if (tecla === 'Escape') return aberto ? 'fechar' : null;
  if (tecla === 'ArrowUp') return aberto ? 'entrar-ultimo' : 'abrir-ultimo';
  if (tecla === 'ArrowDown' || tecla === 'Enter' || tecla === ' ') return aberto ? 'entrar-primeiro' : 'abrir-primeiro';
  return null;
}

/** Tab (ou Shift+Tab) dentro do menu: fecha e devolve o foco ao gatilho; o foco nunca cai no body (T-0099). */
export function acaoTeclaMenu(tecla: string): 'fechar-e-focar-gatilho' | null {
  return tecla === 'Tab' ? 'fechar-e-focar-gatilho' : null;
}

/** Itens visíveis na ordem final: normais, depois (após um separador) os de perigo. */
export function ordenarAcoes(acoes: AcaoMenu[]): { normais: AcaoMenu[]; perigos: AcaoMenu[] } {
  const visiveis = acoes.filter((a) => !a.oculto);
  return { normais: visiveis.filter((a) => !a.perigo), perigos: visiveis.filter((a) => a.perigo) };
}

/** Motivo do item desligado: o texto de `desabilitado`, se houver (string vazia ou só espaços não conta). */
export function motivoDoItem(a: { desabilitado?: Desabilitado }): string | undefined {
  return typeof a.desabilitado === 'string' && a.desabilitado.trim() ? a.desabilitado.trim() : undefined;
}

/** Item desligado, com ou sem motivo. Enter, Espaço e clique nele não acionam nem fecham o menu. */
export function itemDesligado(a: { desabilitado?: Desabilitado }): boolean {
  return a.desabilitado === true || typeof a.desabilitado === 'string';
}

/** Próximo índice de foco, circular, pulando os marcados. -1 se nada é focável. */
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
  ...texto('texto'),
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

/** Botão "Ações ▾" da linha (T-0099; v0.3.30, padrão da T-0134): um componente único para todas as tabelas e listas. A seta é aria-hidden. */
export function MenuAcoes({ acoes, principal, rotuloLinha, abertoInicial = false }: MenuAcoesProps) {
  const id = useId();
  const menuId = `${id}-menu`;
  const [aberto, setAberto] = useState(abertoInicial);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const gatilho = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focoInicial = useRef<'primeiro' | 'ultimo' | null>(null);

  const { normais, perigos } = ordenarAcoes(acoes);
  const lista = [...normais, ...perigos];
  const desabilitados = lista.map((a) => itemDesligado(a) && !motivoDoItem(a));
  const principalVisivel = principal && !principal.oculto ? principal : undefined;

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) gatilho.current?.focus();
  }, []);

  const itensDom = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const irParaItem = (qual: 'primeiro' | 'ultimo') => {
    const i = proximoItemMenu(desabilitados, -1, qual === 'primeiro' ? 'Home' : 'End');
    if (i >= 0) itensDom()[i]?.focus();
  };

  useLayoutEffect(() => {
    if (!aberto || !gatilho.current || !menu.current) return;
    const g = gatilho.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    setPos(posicaoMenu(g, { largura: m.width, altura: m.height }, { largura: window.innerWidth, altura: window.innerHeight }));
    if (focoInicial.current) {
      irParaItem(focoInicial.current);
      focoInicial.current = null;
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

  const fecharComEsc = (e: TecladoReact) => {
    e.preventDefault();
    e.stopPropagation();
    fechar(true);
  };

  const tecladoGatilho = (e: TecladoReact) => {
    const acao = acaoTeclaGatilho(e.key, aberto);
    if (!acao) return;
    if (acao === 'fechar') {
      fecharComEsc(e);
      return;
    }
    e.preventDefault();
    if (acao === 'entrar-primeiro' || acao === 'entrar-ultimo') {
      irParaItem(acao === 'entrar-primeiro' ? 'primeiro' : 'ultimo');
    } else {
      // O foco vai ao item só depois de o menu montado e posicionado (layout effect).
      focoInicial.current = acao === 'abrir-primeiro' ? 'primeiro' : 'ultimo';
      setAberto(true);
    }
  };

  // Espaço dispara o clique no keyup: evita que ele feche o menu recém-aberto.
  const soltarGatilho = (e: TecladoReact) => {
    if (e.key === ' ') e.preventDefault();
  };

  const tecladoMenu = (e: TecladoReact) => {
    if (e.key === 'Escape') {
      fecharComEsc(e);
    } else if (acaoTeclaMenu(e.key) === 'fechar-e-focar-gatilho') {
      // Padrão WAI-ARIA de menu button: o foco volta ao gatilho e o próximo Tab segue a ordem natural.
      e.preventDefault();
      fechar(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const itens = itensDom();
      const i = proximoItemMenu(desabilitados, itens.indexOf(document.activeElement as HTMLElement), e.key);
      if (i >= 0) itens[i]?.focus();
    }
  };

  const escolher = (a: AcaoMenu) => {
    if (itemDesligado(a)) return;
    fechar(true);
    a.aoAcionar();
  };

  const item = (a: AcaoMenu): ReactNode => {
    const desligado = itemDesligado(a);
    const motivo = motivoDoItem(a);
    const idMotivo = `${id}-motivo-${a.chave}`;
    // Com motivo não se usa opacidade: o texto fica em textoSecundario (neutro, contraste ≥ 4,5:1), inclusive o perigo.
    const estilo: CSSProperties = motivo
      ? { cursor: 'not-allowed', color: cor('textoSecundario') }
      : { ...desabilitadoEstilo(desligado), ...(a.perigo ? { color: cor('erroTexto') } : null) };
    return (
      <button
        key={a.chave}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={desligado ? true : undefined}
        aria-describedby={motivo ? idMotivo : undefined}
        className={`mx-acoes-item mx-acoes-alvo${a.perigo ? ' mx-acoes-perigo' : ''}`}
        onClick={() => escolher(a)}
        style={{ ...itemBase, ...estilo }}
      >
        {a.rotulo}
        {motivo ? (
          <span id={idMotivo} style={{ ...texto('pequeno'), display: 'block', whiteSpace: 'normal', maxWidth: 260 }}>
            {motivo}
          </span>
        ) : null}
      </button>
    );
  };

  const estiloBotao: CSSProperties = botaoSecundario();
  const principalDesligado = principalVisivel ? itemDesligado(principalVisivel) : false;
  const motivoPrincipal = principalVisivel ? motivoDoItem(principalVisivel) : undefined;
  const idMotivoPrincipal = `${id}-motivo-principal`;

  return (
    <span style={{ display: 'inline-flex', gap: espaco.sm, alignItems: 'center', whiteSpace: 'nowrap' }}>
      {principalVisivel ? (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <button
            type="button"
            className="mx-acoes-alvo"
            aria-disabled={principalDesligado ? true : undefined}
            aria-describedby={motivoPrincipal ? idMotivoPrincipal : undefined}
            onClick={() => {
              if (!principalDesligado) principalVisivel.aoAcionar();
            }}
            style={{ ...estiloBotao, ...desabilitadoEstilo(principalDesligado) }}
          >
            {principalVisivel.rotulo}
          </button>
          {motivoPrincipal ? (
            <span
              id={idMotivoPrincipal}
              style={{ ...texto('pequeno'), color: cor('textoSecundario'), whiteSpace: 'normal', maxWidth: 260 }}
            >
              {motivoPrincipal}
            </span>
          ) : null}
        </span>
      ) : null}
      {lista.length > 0 ? (
        <>
          <button
            ref={gatilho}
            type="button"
            className="mx-acoes-gatilho mx-acoes-alvo"
            aria-haspopup="menu"
            aria-expanded={aberto}
            aria-controls={aberto ? menuId : undefined}
            aria-label={rotuloLinha ? `Ações de ${rotuloLinha}` : undefined}
            onClick={() => setAberto(!aberto)}
            onKeyDown={tecladoGatilho}
            onKeyUp={soltarGatilho}
            style={{ ...estiloBotao, gap: espaco.xs }}
          >
            Ações
            <span aria-hidden="true" style={{ fontSize: texto('micro').fontSize, lineHeight: 1 }}>
              ▾
            </span>
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
