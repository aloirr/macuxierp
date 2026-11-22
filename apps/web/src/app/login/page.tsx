import { CabecalhoCartao } from '../cabecalho-cartao';
import type { Metadata } from 'next';
import { destinoSeguro } from '@/lib/sessao';
import { FormularioLogin } from './formulario';

export const metadata: Metadata = { title: 'Acesse sua conta' };

export default async function Login({ searchParams }: { searchParams: Promise<{ destino?: string }> }) {
  const { destino } = await searchParams;
  return (
    <main className="cartao-central">
      <CabecalhoCartao titulo="Acesse sua conta" />
      <FormularioLogin destino={destinoSeguro(destino)} />
    </main>
  );
}
