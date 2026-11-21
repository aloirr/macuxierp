import { NOME_PRODUTO } from '@/lib/marca';
import type { Metadata } from 'next';
import { destinoSeguro } from '@/lib/sessao';
import { FormularioLogin } from './formulario';

export const metadata: Metadata = { title: 'Entrar' };

export default async function Login({ searchParams }: { searchParams: Promise<{ destino?: string }> }) {
  const { destino } = await searchParams;
  return (
    <main className="cartao-central">
      <header><span className="marca">{NOME_PRODUTO}</span></header>
      <h1>Entrar</h1>
      <FormularioLogin destino={destinoSeguro(destino)} />
    </main>
  );
}
