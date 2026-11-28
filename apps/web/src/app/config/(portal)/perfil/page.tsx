import type { Metadata } from 'next';
import { euPlataforma } from '@/lib/config/api';
import { exigirTokenConfig } from '@/lib/config/sessao';

export const metadata: Metadata = { title: 'Meu perfil' };

/** T-0139: dados do superadmin, só leitura, do `GET /auth/eu` da plataforma (sem API nova). */
export default async function PerfilPlataforma() {
  const eu = await euPlataforma(await exigirTokenConfig());
  return (
    <>
      <h1>Meu perfil</h1>
      <section className="bloco" aria-label="Dados cadastrais">
        <dl className="dados">
          <div><dt>Nome</dt><dd>{eu.superadmin.nome}</dd></div>
          <div><dt>Perfil</dt><dd>Plataforma</dd></div>
        </dl>
      </section>
    </>
  );
}
