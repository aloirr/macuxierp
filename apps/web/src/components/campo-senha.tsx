'use client';
import { useId, useState } from 'react';
import { ROTULOS_OLHO_SENHA } from '@macuxierp/platform-sdk';

/** Campo de senha com o botão do olho ("Mostrar senha" / "Ocultar senha"). O valor fica só no estado do formulário: nunca em URL, storage ou log. */
export function CampoSenha({ rotulo, nome, valor, aoMudar, autoComplete, erro, apoio }: { rotulo: string; nome: string; valor: string; aoMudar: (v: string) => void; autoComplete: 'current-password' | 'new-password'; erro?: string | undefined; apoio?: string }) {
  const [visivel, setVisivel] = useState(false);
  const id = useId();
  return (
    <div className="campo campo-senha">
      <label htmlFor={id}>{rotulo}</label>
      <div className="campo-senha-linha">
        <input id={id} name={nome} type={visivel ? 'text' : 'password'} value={valor} onChange={(e) => aoMudar(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} required aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined} />
        <button type="button" className="mx-botao-secundario olho" onClick={() => setVisivel((v) => !v)} aria-pressed={visivel}>{visivel ? ROTULOS_OLHO_SENHA.ocultar : ROTULOS_OLHO_SENHA.mostrar}</button>
      </div>
      {apoio && <span className="apoio">{apoio}</span>}
      {erro && <span id={`${id}-erro`} className="erro-campo" role="alert">{erro}</span>}
    </div>
  );
}
