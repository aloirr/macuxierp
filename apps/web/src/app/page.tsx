import type { Metadata } from 'next';
import { Casca } from './(shell)/casca';
import { Inicio } from './(shell)/inicio';
import { TelaLogin } from './login/tela';
import { temSessaoBko } from '@/lib/sessao';

/** "/" é a tela de login sem sessão e o BKO com sessão (v0.3.27). Decide a presença dos cookies; a validade fica com a `contexto()` do BKO (acesso vencido passa por /sessao/renovar, que sem refresh válido volta a "/" já sem cookies: sem laço). */
export async function generateMetadata(): Promise<Metadata> {
  return (await temSessaoBko()) ? {} : { title: 'Acesse sua conta' };
}

export default async function Raiz() {
  if (!(await temSessaoBko())) return <TelaLogin />;
  return (
    <Casca>
      <Inicio />
    </Casca>
  );
}
