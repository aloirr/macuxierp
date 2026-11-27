import { AssinaturaErp } from '@macuxierp/ui/marca';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { BotaoMenu } from './botao-menu';
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
        <BotaoMenu />
        <span className="marca"><AssinaturaErp /></span>
        <span className="nome-topo" title={nome}>{nome}</span>
        {eu.filiais.length > 1 && <a className="so-largo" href="/filial">Trocar filial</a>}
        <span className="espaco" />
        <span className="so-largo nome-usuario">{eu.usuario.nome} ({eu.usuario.perfil})</span>
        <LinkTrocarSenha className="so-largo" />
        <BotaoSair />
      </header>
      <NavLateral menu={menu} acessoConfig={eu.acesso_config === true} conta={{ empresa: nome, usuario: `${eu.usuario.nome} (${eu.usuario.perfil})`, trocarFilial: eu.filiais.length > 1 }} />
      <main id="conteudo" className="conteudo"><div id="avisos-conteudo" /><Suspense fallback={null}><AvisoSenhaTrocada /></Suspense>{children}</main>
    </div>
  );
}
