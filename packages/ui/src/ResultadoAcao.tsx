'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { canto, espaco, texto, tons } from './estilos.js';

/** Tom do resultado: sucesso (deu certo), aviso (deu certo com ressalva) ou erro (não deu; diz o que fazer). */
export type TomResultado = 'sucesso' | 'aviso' | 'erro';

export interface Resultado {
  tom: TomResultado;
  /** Uma frase: o que aconteceu. No erro, diz também o que fazer ("Não foi possível X. Tente de novo."). */
  texto: string;
  /** Detalhe opcional (lista curta, link para o Log). */
  detalhe?: ReactNode;
}

export interface ResultadoAcaoProps {
  /** `null`/`undefined` = nada a mostrar; a região educada continua montada (vazia) para anunciar o próximo resultado. */
  resultado?: Resultado | null | undefined;
  /** Muda a cada clique (contador ou horário), para rolar até o resultado mesmo quando o texto se repete. */
  chave?: string | number | undefined;
  /** `id` da região, para o botão apontar com `aria-describedby` se quiser. */
  id?: string | undefined;
}

/** Ocupa a linha inteira logo abaixo do botão, também dentro de uma fila flex de botões (`flex-wrap`). */
const regiao: CSSProperties = { flexBasis: '100%', width: '100%', minWidth: 0 };

const caixa = (tom: TomResultado): CSSProperties => ({
  ...texto('texto'),
  display: 'grid',
  gap: espaco.xs,
  marginTop: espaco.sm,
  marginBottom: espaco.sm,
  padding: `${espaco.sm}px ${espaco.md}px`,
  borderRadius: canto,
  border: `1px solid ${tons[tom].color}`,
  background: tons[tom].background,
  color: tons[tom].color,
  overflowWrap: 'anywhere',
});

/** Fora da área visível (celular, botão no pé da tela, teclado aberto)? */
export function precisaRolar(r: Pick<DOMRect, 'top' | 'bottom'>, alturaTela: number): boolean {
  return r.top < 0 || r.bottom > alturaTela;
}

function Conteudo({ r }: { r: Resultado }) {
  return (
    <div style={caixa(r.tom)}>
      <span>{r.texto}</span>
      {r.detalhe ? <div>{r.detalhe}</div> : null}
    </div>
  );
}

/**
 * Resultado de uma ação, logo abaixo do botão que a disparou (decisão 36 A; docs/design/resultado-acao).
 * Sucesso e aviso: região `role="status"` sempre montada. Erro: `role="alert"`. O foco fica no botão; a tela rola
 * só o necessário quando o resultado nasce fora da área visível. Não some sozinho: troca no próximo clique.
 */
export function ResultadoAcao({ resultado, chave, id }: ResultadoAcaoProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!resultado || !el || typeof window === 'undefined') return;
    if (precisaRolar(el.getBoundingClientRect(), window.innerHeight)) {
      const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'nearest', behavior: reduzir ? 'auto' : 'smooth' });
    }
  }, [resultado, chave]);
  const erro = resultado?.tom === 'erro';
  // As duas regiões ficam sempre montadas (vazias sem resultado): o leitor anuncia quando o conteúdo entra.
  // `chave` nunca é `key` do React: só dispara a rolagem, a região não remonta.
  return (
    <div ref={ref} id={id} data-resultado-acao={resultado?.tom ?? ''} style={regiao}>
      <div role="status" aria-live="polite" aria-atomic="true">{resultado && !erro ? <Conteudo r={resultado} /> : null}</div>
      <div role="alert" aria-atomic="true">{resultado && erro ? <Conteudo r={resultado} /> : null}</div>
    </div>
  );
}

/** Estado de um botão com retorno: `[resultado, chave, mostrar(r), limpar()]`. `mostrar` sempre avança a `chave`. */
export function useResultado(): [Resultado | null, number, (r: Resultado) => void, () => void] {
  const [estado, setEstado] = useState<{ r: Resultado | null; chave: number }>({ r: null, chave: 0 });
  const mostrar = useCallback((r: Resultado) => setEstado((e) => ({ r, chave: e.chave + 1 })), []);
  const limpar = useCallback(() => setEstado((e) => ({ r: null, chave: e.chave })), []);
  return [estado.r, estado.chave, mostrar, limpar];
}
