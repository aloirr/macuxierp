'use client';
import { useEffect, useRef } from 'react';
import { AVISO_SENHA_TROCADA } from '@/lib/troca-senha';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Aviso de sucesso depois da troca voluntária (`?aviso=senha-trocada`); "Fechar" tira o parâmetro da URL. */
export function AvisoSenhaTrocada() {
  const params = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const faixa = useRef<HTMLDivElement>(null);
  const visivel = params.get('aviso') === AVISO_SENHA_TROCADA;
  // No celular o menu vem antes do conteúdo: traz o aviso à vista.
  useEffect(() => { if (visivel) faixa.current?.scrollIntoView({ block: 'nearest' }); }, [visivel]);
  if (!visivel) return null;
  const resto = new URLSearchParams(params);
  resto.delete('aviso');
  const q = resto.toString();
  return (
    <div ref={faixa} className="aviso-sucesso" role="status">
      <span>Senha trocada.</span>
      <button type="button" className="mx-botao-secundario" onClick={() => router.replace(q ? `${caminho}?${q}` : caminho)}>Fechar</button>
    </div>
  );
}
