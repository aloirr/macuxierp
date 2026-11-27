'use client';
import { useEffect, useState } from 'react';
import { EVENTO_VERSAO_NOVA } from '@/lib/acao-versao';
import { SISTEMA_ATUALIZADO } from '@/lib/sistema-atualizado';

/** Aviso de versão nova no topo de qualquer tela (montado no layout raiz): aparece quando uma action falha de novo depois da recarga única (lib/acao-versao.ts). */
export function AvisoVersaoNova() {
  const [ativo, setAtivo] = useState(false);
  useEffect(() => {
    const ligar = () => setAtivo(true);
    window.addEventListener(EVENTO_VERSAO_NOVA, ligar);
    return () => window.removeEventListener(EVENTO_VERSAO_NOVA, ligar);
  }, []);
  if (!ativo) return null;
  return (
    <p className="faixa-aviso aviso-sistema aviso-versao-nova" role="status">
      {SISTEMA_ATUALIZADO}{' '}<button type="button" className="mx-botao-secundario" onClick={() => window.location.reload()}>Recarregar</button>
    </p>
  );
}
