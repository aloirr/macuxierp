'use client';
import { useActionState } from 'react';
import { entrarConfigAcao, type EstadoEntrarConfig } from './acoes';

export function FormularioEntrar() {
  const [estado, acao, pendente] = useActionState<EstadoEntrarConfig, FormData>(entrarConfigAcao, {});
  return (
    <form action={acao}>
      {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
      <label className="campo"><span>E-mail</span><input name="email" type="email" defaultValue={estado.email} autoComplete="username" required /></label>
      <label className="campo"><span>Senha</span><input name="senha" type="password" autoComplete="current-password" required /></label>
      <button className="mx-botao" type="submit" disabled={pendente}>{pendente ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}
