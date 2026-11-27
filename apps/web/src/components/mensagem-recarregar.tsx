'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SISTEMA_ATUALIZADO } from '@/lib/sistema-atualizado';

/** Id do ponto, no topo da área de conteúdo do shell, onde o aviso de sistema atualizado aparece. */
export const ID_AVISOS_CONTEUDO = 'avisos-conteudo';

/** Aviso de sistema atualizado (tokens de aviso, role=status) com o botão "Recarregar", no topo da área de conteúdo. Outros erros de ação vão para o ResultadoAcao. */
export function MensagemRecarregar() {
  const [topo, setTopo] = useState<HTMLElement | null>(null);
  useEffect(() => { setTopo(document.getElementById(ID_AVISOS_CONTEUDO)); }, []);
  const no = (
    <p className="faixa-aviso aviso-sistema" role="status">
      {SISTEMA_ATUALIZADO}{' '}<button type="button" className="mx-botao-secundario" onClick={() => window.location.reload()}>Recarregar</button>
    </p>
  );
  return topo ? createPortal(no, topo) : no;
}
