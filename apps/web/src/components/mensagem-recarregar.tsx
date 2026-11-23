'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SISTEMA_ATUALIZADO } from '@/lib/sistema-atualizado';

/** Id do ponto, no topo da área de conteúdo do shell, onde o aviso de sistema atualizado aparece. */
export const ID_AVISOS_CONTEUDO = 'avisos-conteudo';

/** Mensagem de erro; quando é a do sistema atualizado, vira aviso informativo (tokens de aviso, role=status) com o botão "Recarregar", no topo da área de conteúdo. */
export function MensagemRecarregar({ texto, className = 'erro', role = 'alert' }: { texto: string; className?: string; role?: 'alert' | 'status' }) {
  const atualizado = texto === SISTEMA_ATUALIZADO;
  const [topo, setTopo] = useState<HTMLElement | null>(null);
  useEffect(() => { if (atualizado) setTopo(document.getElementById(ID_AVISOS_CONTEUDO)); }, [atualizado]);
  const no = (
    <p className={atualizado ? 'faixa-aviso aviso-sistema' : className} role={atualizado ? 'status' : role}>
      {texto}
      {atualizado && <>{' '}<button type="button" className="mx-botao-secundario" onClick={() => window.location.reload()}>Recarregar</button></>}
    </p>
  );
  return topo ? createPortal(no, topo) : no;
}
