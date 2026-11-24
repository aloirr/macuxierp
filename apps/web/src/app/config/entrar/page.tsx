import { redirect } from 'next/navigation';

/** Rota antiga do login do superadmin (T-0076): o login é único em `/login`; o redirect mantém os favoritos. */
export default function Entrar(): never {
  redirect('/login');
}
