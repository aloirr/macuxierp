import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { exigirTokenConfig } from '@/lib/config/sessao';
import { FormularioEmpresa } from './formulario';

export const metadata: Metadata = { title: 'Nova empresa' };

export default async function NovaEmpresa() {
  await exigirTokenConfig(); // guarda própria: o layout não é a única barreira (a API revalida)
  // A chave nasce no servidor, por visita: o reenvio do mesmo envio reusa a chave; a página nova gera outra.
  return (
    <>
      <h1>Nova empresa</h1>
      <FormularioEmpresa chaveInicial={randomUUID()} />
    </>
  );
}
