import { AssinaturaErp } from '@macuxierp/ui/marca';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { NavLateral } from './nav-lateral';
import { BotaoSair } from './botao-sair';

export default async function Casca({ children }: { children: ReactNode }) {
  const { eu, filial } = await contexto();
  if (!filial) redirect('/filial');
  const menu = montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil);

  return (
    <div className="casca">
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <header className="topo mx-fundo-escuro">
        <span className="marca"><AssinaturaErp /></span>
        <span>{eu.empresa.razao_social} · {filial.nome}</span>
        {eu.filiais.length > 1 && <a href="/filial">Trocar filial</a>}
        <span className="espaco" />
        <span>{eu.usuario.nome} ({eu.usuario.perfil})</span>
        <BotaoSair />
      </header>
      <NavLateral menu={menu} />
      <main id="conteudo" className="conteudo">{children}</main>
    </div>
  );
}
