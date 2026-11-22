'use client';
import { useActionState } from 'react';
import { entrarAction, type EstadoLogin } from './entrar';

export function FormularioLogin({ destino }: { destino: string }) {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrarAction, {});
  return (
    <form action={acao}>
      {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
      <input type="hidden" name="destino" value={destino} />
      <label className="campo"><span>Empresa</span><input name="empresa" defaultValue={estado.empresa} autoComplete="organization" required autoCapitalize="none" /></label>
      <label className="campo"><span>E-mail</span><input name="email" defaultValue={estado.email} type="email" autoComplete="username" required /></label>
      <label className="campo"><span>Senha</span><input name="senha" type="password" autoComplete="current-password" required /></label>
      <button className="mx-botao" type="submit" disabled={pendente}>{pendente ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}
