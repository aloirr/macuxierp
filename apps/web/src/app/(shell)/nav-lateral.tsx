'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hrefAtivo, type GrupoMenu } from '@/lib/menu';
import { NOMES_MODULOS } from '@/lib/nomes-modulos';
import { ItemConfiguracao } from './item-configuracao';
import { LinkTrocarSenha } from './link-trocar-senha';

/** O módulo de um item só (T-0056) não ganha seção própria: o item fica sob Conta. */
const MODULO_NA_CONTA = 'integracao-fdv';

/** `acessoConfig` (C1, 45 A): só com `EuResposta.acesso_config === true`; ausente, o item não aparece. */
export interface ContaMenu { empresa: string; usuario: string; trocarFilial: boolean }

/** `conta` (MC-0209): empresa, usuário, "Trocar filial" e "Trocar senha" moram aqui no celular (≤ 800 px, CSS); no desktop ficam no topo. */
export function NavLateral({ menu, acessoConfig = false, conta }: { menu: GrupoMenu[]; acessoConfig?: boolean; conta?: ContaMenu }) {
  const atual = usePathname();
  // O detalhe (`notas/:id`, `titulos/:id`) deixa marcado o item da lista de origem.
  const ativo = hrefAtivo(atual, ['/', ...menu.flatMap((g) => g.itens.map((i) => i.href)), '/licencas']);
  const itensConta = menu.filter((g) => g.modulo === MODULO_NA_CONTA).flatMap((g) => g.itens);
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
      {menu.filter((g) => g.modulo !== MODULO_NA_CONTA).map((g) => {
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
          {itensConta.map((i) => item(i.href, i.rotulo))}
          {acessoConfig && <ItemConfiguracao />}
        </ul>
      </section>
    </nav>
  );
}
