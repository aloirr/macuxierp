'use client';
import { useId } from 'react';

/**
 * Campo "digite a frase para confirmar" (Substituir tudo e Zerar dados). A comparação vem de `fraseConfere` do SDK (`portal-cargas`):
 * este componente não tem lógica própria. O botão de quem usa fica desligado até `fraseConfere(...)` valer.
 */
export function FraseConfirmacao({ frase, valor, aoMudar, erro }: { frase: string; valor: string; aoMudar: (v: string) => void; erro?: boolean }) {
  const id = useId();
  return (
    <label className="campo" htmlFor={id}>
      <span>Para confirmar, digite <strong className="codigo">{frase}</strong>.</span>
      <input id={id} autoFocus value={valor} onChange={(e) => aoMudar(e.target.value)} autoComplete="off" spellCheck={false} maxLength={64} aria-invalid={erro ? true : undefined} />
    </label>
  );
}

