'use client';
import { useActionState } from 'react';
import { REGRAS_SENHA, SENHA_MINIMA, TITULO_REGRAS_SENHA } from '@macuxierp/platform-sdk';
import { trocarSenhaAcao, type EstadoSenha } from './acoes';

export function FormularioSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(trocarSenhaAcao, {});
  return (
    <form action={acao}>
      {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
      <label className="campo"><span>Senha provisória atual</span><input name="senha_atual" type="password" autoComplete="current-password" required /></label>
      <label className="campo"><span>Senha nova</span><input name="senha_nova" type="password" autoComplete="new-password" minLength={SENHA_MINIMA} required /><span className="apoio">{TITULO_REGRAS_SENHA}:</span><ul className="apoio">{REGRAS_SENHA.map((r) => <li key={r.id}>{r.texto}</li>)}</ul></label>
      <button className="mx-botao" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Definir senha'}</button>
    </form>
  );
}
