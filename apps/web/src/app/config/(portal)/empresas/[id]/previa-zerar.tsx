'use client';
import { useEffect, useRef, useState, type DependencyList } from 'react';
import type { Retorno } from '@/lib/config/cargas';

/**
 * Peças comuns das janelas do Zerar (por cadastro e de pedidos): a prévia buscada ao abrir (e de novo quando "dados mudaram")
 * e o bloco "Mantidos: N" com uma linha por motivo.
 */

/**
 * Busca a prévia ao abrir e a cada mudança de `deps` ou `recontar()`. Cancela a busca anterior; sessão vencida redireciona.
 * `aoChegar` roda quando a prévia chega (ex.: limpar bloqueios antigos). Com `previaInicial` a janela já abre com carregando = false.
 */
export function usePreviaZerar<T>(pedir: (sinal: AbortSignal) => Promise<Retorno<T>>, deps: DependencyList, previaInicial: T | null = null, aoChegar?: () => void) {
  const [previa, setPrevia] = useState<T | null>(previaInicial);
  const [carregando, setCarregando] = useState(previaInicial === null);
  const [erroPrevia, setErroPrevia] = useState('');
  const [recontar, setRecontar] = useState(0);
  const atual = useRef({ pedir, aoChegar });
  atual.current = { pedir, aoChegar };

  useEffect(() => {
    const ctl = new AbortController();
    setCarregando(true);
    setErroPrevia('');
    void atual.current.pedir(ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      setCarregando(false);
      if (!r.ok && r.redirecionar) window.location.assign(r.redirecionar);
      if (r.ok) { setPrevia(r.valor); atual.current.aoChegar?.(); } else { setPrevia(null); setErroPrevia(r.erro); }
    });
    return () => ctl.abort();
  }, [...deps, recontar]);

  return { previa, carregando, erroPrevia, recontar: () => setRecontar((n) => n + 1) };
}

/** "Mantidos: N" e, abaixo, uma linha por motivo (o que `textosMantidos*` devolve). */
export function ListaMantidos({ total, detalhes }: { total: string; detalhes: readonly string[] }) {
  return (
    <div>
      <p>{total}</p>
      <ul className="lista-simples apoio">{detalhes.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  );
}
