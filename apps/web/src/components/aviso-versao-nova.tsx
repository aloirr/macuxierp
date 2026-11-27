'use client';
import { useEffect, useState } from 'react';
import { EVENTO_VERSAO_NOVA } from '@/lib/acao-versao';
import { MensagemRecarregar } from './mensagem-recarregar';

/** Aviso de versão nova no topo de qualquer tela (montado no layout raiz): aparece quando uma action falha de novo depois da recarga única (lib/acao-versao.ts). */
export function AvisoVersaoNova() {
  const [ativo, setAtivo] = useState(false);
  useEffect(() => {
    const ligar = () => setAtivo(true);
    window.addEventListener(EVENTO_VERSAO_NOVA, ligar);
    return () => window.removeEventListener(EVENTO_VERSAO_NOVA, ligar);
  }, []);
  if (!ativo) return null;
  return <MensagemRecarregar classe="aviso-versao-nova" noLugar />;
}
