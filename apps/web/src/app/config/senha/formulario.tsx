'use client';
import { useActionState } from 'react';
import { trocarSenhaAcao, type EstadoSenha } from './acoes';

export function FormularioSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(trocarSenhaAcao, {});
  return (
    <form action={acao}>
      {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
      <label className="campo"><span>Senha provisória atual</span><input name="senha_atual" type="password" autoComplete="current-password" required /></label>
      <label className="campo"><span>Senha nova</span><input name="senha_nova" type="password" autoComplete="new-password" minLength={14} required /><span className="apoio">Use ao menos 14 caracteres.</span></label>
      <button className="mx-botao" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Definir senha'}</button>
    </form>
  );
}
