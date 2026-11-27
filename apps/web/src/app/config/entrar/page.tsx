import { redirect } from 'next/navigation';
import { ROTA_ENTRAR } from '@/lib/config/constantes';

/** Rota antiga do login do superadmin (T-0076): o login é único em `/login`, com destino na plataforma; o redirect mantém os favoritos. */
export default function Entrar(): never {
  redirect(ROTA_ENTRAR);
}
