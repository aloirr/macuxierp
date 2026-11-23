import { AssinaturaErp } from '@macuxierp/ui/marca';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { NavLateral } from './nav-lateral';
import { BotaoSair } from './botao-sair';
import { LinkTrocarSenha } from './link-trocar-senha';
import { AvisoSenhaTrocada } from './aviso-senha-trocada';
import { nomeDoTopo } from '@/lib/nome-topo';
import { ROTA_SENHA } from '@/lib/troca-pendente';

export default async function Casca({ children }: { children: ReactNode }) {
  const { eu, filial } = await contexto();
  if (eu.usuario.deve_trocar_senha) redirect(ROTA_SENHA); // troca obrigatória: nada do shell antes dela
  if (!filial) redirect('/filial');
  const nome = nomeDoTopo(eu.empresa.razao_social, filial.nome);
  const menu = montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil);

  return (
    <div className="casca">
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <header className="topo mx-fundo-escuro">
        <span className="marca"><AssinaturaErp /></span>
        <span className="nome-topo" title={nome}>{nome}</span>
        {eu.filiais.length > 1 && <a href="/filial">Trocar filial</a>}
        <span className="espaco" />
        <span>{eu.usuario.nome} ({eu.usuario.perfil})</span>
        <LinkTrocarSenha />
        <BotaoSair />
      </header>
      <NavLateral menu={menu} />
      <main id="conteudo" className="conteudo"><div id="avisos-conteudo" /><Suspense fallback={null}><AvisoSenhaTrocada /></Suspense>{children}</main>
    </div>
  );
}
