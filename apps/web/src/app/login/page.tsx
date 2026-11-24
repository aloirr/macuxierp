import type { Metadata } from 'next';
import { lerSituacaoEsqueci } from '@/lib/esqueci-api';
import { destinoSeguro } from '@/lib/sessao';
import { FormularioLogin } from './formulario';

export const metadata: Metadata = { title: 'Acesse sua conta' };

/** Login único (T-0076): empresa e superadmin na mesma tela. O link "Esqueci a senha" só existe se a API diz que o envio de e-mail está configurado. */
export default async function Login({ searchParams }: { searchParams: Promise<{ destino?: string }> }) {
  const { destino } = await searchParams;
  return (
    <main className="cartao-central">
      <FormularioLogin destino={destinoSeguro(destino)} esqueciDisponivel={await lerSituacaoEsqueci()} />
    </main>
  );
}
