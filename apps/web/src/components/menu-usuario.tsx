'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export const ROTULOS_MENU_USUARIO = { ver: 'Ver perfil', senha: 'Alterar senha', sair: 'Sair' } as const;

/** Destino da troca voluntária: volta à página em que a pessoa estava (`destino`, sem a query). Só o BKO (`destino` já existe lá). */
export function hrefAlterarSenha(base: string, caminho: string | null, comDestino: boolean): string {
  return comDestino && caminho && caminho !== '/' ? `${base}?destino=${encodeURIComponent(caminho)}` : base;
}

interface Props {
  nome: string;
  /** Segunda linha do botão (perfil por extenso; vazio no /config). */
  detalhe?: string;
  hrefPerfil: string;
  hrefSenha: string;
  comDestino?: boolean;
  /** Server action do "Sair" (POST). */
  sair: () => void | Promise<void>;
}

const iniciais = (nome: string) => nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/**
 * T-0139: botão do usuário no topo, à direita (BKO e /config). Substitui "Nome · Trocar senha · Sair". Itens: Ver perfil, Alterar senha, Sair
 * (sem Ajuda). Teclado: Enter/Espaço/↓ abrem com o foco no 1º item; ↑↓, Home e End andam; Esc e Tab fecham e devolvem o foco ao botão; clique fora fecha.
 */
export function MenuUsuario({ nome, detalhe, hrefPerfil, hrefSenha, comDestino = false, sair }: Props) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const id = useId();
  const caminho = usePathname();
  useEffect(() => { setAberto(false); }, [caminho]);
  const itens = () => [...(lista.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    if (!aberto) return;
    itens()[0]?.focus();
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!lista.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const teclasLista = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      setAberto(false);
      botao.current?.focus();
      return;
    }
    const todos = itens();
    const i = todos.findIndex((x) => x === document.activeElement);
    const alvo = e.key === 'ArrowDown' ? (i + 1) % todos.length : e.key === 'ArrowUp' ? (i - 1 + todos.length) % todos.length : e.key === 'Home' ? 0 : e.key === 'End' ? todos.length - 1 : null;
    if (alvo === null) return;
    e.preventDefault();
    todos[alvo]?.focus();
  };
  return (
    <div className="menu-usuario">
      <button
        ref={botao}
        type="button"
        className="menu-usuario-botao"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={id}
        aria-label={`Menu do usuário: ${[nome, detalhe].filter(Boolean).join(', ')}`}
        onClick={() => setAberto((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !aberto) { e.preventDefault(); setAberto(true); } }}
      >
        <span className="avatar" aria-hidden="true">{iniciais(nome)}</span>
        <span className="identidade">
          <span className="nome">{nome}</span>
          {detalhe && <span className="detalhe">{detalhe}</span>}
        </span>
        <span className="seta" aria-hidden="true">{aberto ? '⌃' : '⌄'}</span>
      </button>
      <div id={id} ref={lista} role="menu" aria-label="Usuário" className="menu-usuario-lista" hidden={!aberto} onKeyDown={teclasLista}>
        <a role="menuitem" className="mx-acoes-item" href={hrefPerfil}>{ROTULOS_MENU_USUARIO.ver}</a>
        <a role="menuitem" className="mx-acoes-item" href={hrefAlterarSenha(hrefSenha, caminho, comDestino)}>{ROTULOS_MENU_USUARIO.senha}</a>
        <form action={sair}><button role="menuitem" type="submit" className="mx-acoes-item mx-acoes-perigo">{ROTULOS_MENU_USUARIO.sair}</button></form>
      </div>
    </div>
  );
}
