'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Espera depois da última tecla antes de aplicar a busca (RD-2382). */
export const ESPERA_BUSCA_MS = 400;

/** URL da lista com os filtros preenchidos do formulário; os vazios saem e o cursor não entra (filtro novo volta à 1ª página). */
export function urlDosFiltros(rota: string, dados: Iterable<[string, FormDataEntryValue]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of dados) if (typeof v === 'string' && v.trim() !== '') p.append(k, v.trim());
  const q = p.toString();
  return q ? `${rota}?${q}` : rota;
}

const ehTexto = (el: EventTarget): el is HTMLInputElement => el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search');

/**
 * Filtros da lista sem o botão "Filtrar" (RD-2382): o texto se aplica ao digitar (com espera) ou com Enter; os seletores e as datas,
 * ao mudar. Com JS a navegação é `router.replace`, que mantém o foco e o que foi digitado. Sem JS o formulário continua GET e o botão
 * "Filtrar" só aparece nesse caso (CSS `scripting: none`).
 */
export function FiltrosLista({ rota, children }: { rota: string; children: ReactNode }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelar = () => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
  };
  useEffect(() => cancelar, []);
  const aplicar = () => {
    cancelar();
    if (form.current) router.replace(urlDosFiltros(rota, new FormData(form.current)), { scroll: false });
  };
  return (
    <form
      ref={form}
      method="get"
      action={rota}
      className="filtros"
      role="search"
      aria-label="Filtros"
      onSubmit={(e) => {
        e.preventDefault();
        aplicar();
      }}
      onKeyDown={(e) => {
        // Enter aplica já: com o botão oculto, nem todo navegador faz o envio implícito.
        if (e.key !== 'Enter' || !ehTexto(e.target)) return;
        e.preventDefault();
        aplicar();
      }}
      onChange={(e) => {
        if (!ehTexto(e.target)) return aplicar();
        cancelar();
        espera.current = setTimeout(aplicar, ESPERA_BUSCA_MS);
      }}
    >
      {children}
    </form>
  );
}
