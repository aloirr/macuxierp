import { NOME_PRODUTO } from '@/lib/marca';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { NavLateral } from './nav-lateral';
import { sairAction } from './sair';

export default async function Casca({ children }: { children: ReactNode }) {
  const { eu, filial } = await contexto();
  if (!filial) redirect('/filial');
  const menu = montarMenu(MANIFESTOS, eu.modulos.map((m) => m.id), eu.perfil);

  return (
    <div className="casca">
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <header className="topo">
        <span className="marca">{NOME_PRODUTO}</span>
        <span>{eu.empresa.razao_social} · {filial.nome}</span>
        {eu.filiais.length > 1 && <a href="/filial">Trocar filial</a>}
        <span className="espaco" />
        <span>{eu.usuario.nome} ({eu.perfil})</span>
        <form action={sairAction}><button className="btn btn-sec" type="submit">Sair</button></form>
      </header>
      <NavLateral menu={menu} />
      <main id="conteudo" className="conteudo">{children}</main>
    </div>
  );
}
