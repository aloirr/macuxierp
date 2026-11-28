'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Só no celular (CSS, ≤ 800 px): recolhe o menu lateral num botão "☰ Menu" (MC-0209). Abre e fecha o menu pelo atributo da casca; Esc fecha e devolve o foco ao botão. */
export function BotaoMenu() {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const caminho = usePathname();
  useEffect(() => { setAberto(false); }, [caminho]); // navegar fecha o menu
  useEffect(() => {
    const casca = botao.current?.closest('.casca');
    if (!casca) return;
    if (aberto) casca.setAttribute('data-menu-aberto', ''); else casca.removeAttribute('data-menu-aberto');
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAberto(false);
      botao.current?.focus();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto]);
  return (
    <button ref={botao} type="button" className="botao-menu" aria-expanded={aberto} aria-controls="menu-principal" onClick={() => setAberto((v) => !v)}>
      <span aria-hidden="true">☰</span>Menu
    </button>
  );
}
