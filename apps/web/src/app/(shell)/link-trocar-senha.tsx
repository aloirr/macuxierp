'use client';
import { usePathname } from 'next/navigation';

/** "Trocar senha" no cabeçalho: a troca voluntária volta à página em que a pessoa estava (`destino`, sem a query). */
export function LinkTrocarSenha() {
  const caminho = usePathname();
  const destino = caminho && caminho !== '/' ? `?destino=${encodeURIComponent(caminho)}` : '';
  return <a href={`/senha${destino}`}>Trocar senha</a>;
}
