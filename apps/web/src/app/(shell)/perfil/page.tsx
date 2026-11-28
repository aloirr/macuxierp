import type { Metadata } from 'next';
import { ROTULOS_PERFIL } from '@macuxierp/platform-sdk';
import { contexto } from '@/lib/sessao';

export const metadata: Metadata = { title: 'Meu perfil' };

/** T-0139: dados cadastrais do usuário, só leitura, do `GET /v1/auth/eu` (sem API nova). */
export default async function Perfil() {
  const { eu } = await contexto();
  return (
    <>
      <h1>Meu perfil</h1>
      <section className="bloco" aria-label="Dados cadastrais">
        <dl className="dados">
          <div><dt>Nome</dt><dd>{eu.usuario.nome}</dd></div>
          <div><dt>Perfil</dt><dd>{ROTULOS_PERFIL[eu.usuario.perfil]}</dd></div>
          <div><dt>Empresa</dt><dd>{eu.empresa.razao_social}</dd></div>
          <div><dt>{eu.filiais.length > 1 ? 'Filiais' : 'Filial'}</dt><dd>{eu.filiais.map((f) => f.nome).join(', ') || '—'}</dd></div>
        </dl>
      </section>
    </>
  );
}
