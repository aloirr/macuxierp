'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hrefAtivo, type GrupoMenu } from '@/lib/menu';
import { NOMES_MODULOS } from '@/lib/nomes-modulos';
import { ItemConfiguracao } from './item-configuracao';
import { LinkTrocarSenha } from './link-trocar-senha';

/** `acessoConfig` (C1, 45 A): só com `EuResposta.acesso_config === true`; ausente, o item não aparece. */
export interface ContaMenu { empresa: string; usuario: string; trocarFilial: boolean }

/** `conta` (MC-0209): empresa, usuário, "Trocar filial" e "Trocar senha" moram aqui no celular (≤ 800 px, CSS); no desktop ficam no topo. */
export function NavLateral({ menu, acessoConfig = false, conta }: { menu: GrupoMenu[]; acessoConfig?: boolean; conta?: ContaMenu }) {
  const atual = usePathname();
  // O detalhe (`notas/:id`, `titulos/:id`) deixa marcado o item da lista de origem.
  const ativo = hrefAtivo(atual, ['/', ...menu.flatMap((g) => g.itens.map((i) => i.href)), '/licencas']);
  const item = (href: string, rotulo: string) => (
    <li key={href}>
      <Link href={href} aria-current={ativo === href ? 'page' : undefined}>{rotulo}</Link>
    </li>
  );
  return (
    <nav id="menu-principal" className="lateral mx-fundo-escuro" aria-label="Menu principal">
      {conta && (
        <section className="conta-menu" aria-label="Sua conta">
          <p>{conta.empresa}</p>
          <p>{conta.usuario}</p>
          <ul>
            {conta.trocarFilial && <li><a href="/filial">Trocar filial</a></li>}
            <li><LinkTrocarSenha /></li>
          </ul>
        </section>
      )}
      <ul>{item('/', 'Início')}</ul>
      {menu.map((g) => {
        // RD-2379: seção de um item só vira item solto, sem cabeçalho.
        if (g.itens.length === 1) return <ul key={g.modulo}>{item(g.itens[0]!.href, g.itens[0]!.rotulo)}</ul>;
        const nome = NOMES_MODULOS[g.modulo];
        const idTitulo = `menu-${g.modulo}`;
        return (
          <section key={g.modulo} aria-labelledby={idTitulo}>
            <h2 id={idTitulo}>{nome}</h2>
            <ul>{g.itens.map((i) => item(i.href, i.rotulo))}</ul>
          </section>
        );
      })}
      <section aria-labelledby="menu-conta">
        <h2 id="menu-conta">Conta</h2>
        <ul>
          {item('/licencas', 'Licenças')}
          {acessoConfig && <ItemConfiguracao />}
        </ul>
      </section>
    </nav>
  );
}
