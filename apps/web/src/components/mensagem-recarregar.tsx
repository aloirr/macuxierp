'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SISTEMA_ATUALIZADO } from '@/lib/sistema-atualizado';

/** Id do ponto, no topo da área de conteúdo do shell, onde o aviso de sistema atualizado aparece. */
export const ID_AVISOS_CONTEUDO = 'avisos-conteudo';

/** Aviso de sistema atualizado (tokens de aviso, role=status) com o botão "Recarregar", no topo da área de conteúdo. Outros erros de ação vão para o ResultadoAcao. */
export function MensagemRecarregar({ classe, noLugar = false }: { classe?: string; /** Sem portal: fica onde foi montada (o aviso do layout raiz). */ noLugar?: boolean }) {
  const [topo, setTopo] = useState<HTMLElement | null>(null);
  useEffect(() => { if (!noLugar) setTopo(document.getElementById(ID_AVISOS_CONTEUDO)); }, [noLugar]);
  const no = (
    <p className={classe ? `faixa-aviso aviso-sistema ${classe}` : 'faixa-aviso aviso-sistema'} role="status">
      <span className="aviso-versao-nova-texto">{SISTEMA_ATUALIZADO}</span>{' '}<button type="button" className="mx-botao-secundario" onClick={() => window.location.reload()}>Recarregar</button>
    </p>
  );
  return topo ? createPortal(no, topo) : no;
}
