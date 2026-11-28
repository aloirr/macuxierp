'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { hrefAtivo, type GrupoMenu } from '@/lib/menu';
import { NOMES_MODULOS } from '@/lib/nomes-modulos';
import { ItemConfiguracao } from './item-configuracao';

/** `acessoConfig` (C1, 45 A): só com `EuResposta.acesso_config === true`; ausente, o item não aparece. */
export interface ContaMenu { empresa: string; trocarFilial: boolean }

/** `conta` (MC-0209): empresa e "Trocar filial" moram aqui no celular (≤ 800 px, CSS); no desktop ficam no topo. */
export function NavLateral({ menu, acessoConfig = false, conta }: { menu: GrupoMenu[]; acessoConfig?: boolean; conta?: ContaMenu }) {
  const atual = usePathname();
  // O detalhe (`notas/:id`, `titulos/:id`) deixa marcado o item da lista de origem.
  const ativo = hrefAtivo(atual, ['/', ...menu.flatMap((g) => g.itens.map((i) => i.href)), '/licencas']);
  const item = (href: string, rotulo: string) => (
    <li key={href}>
      <Link href={href} aria-current={ativo === href ? 'page' : undefined}>{rotulo}</Link>
    </li>
  );
  // Acordeão: um grupo aberto por vez; o da tela atual abre sozinho (T-0138). Sem JS (CSS `scripting: none`) tudo fica à mostra.
  const grupoDoAtivo = menu.find((g) => g.itens.length > 1 && g.itens.some((i) => i.href === ativo))?.modulo ?? (ativo === '/licencas' ? 'conta' : null);
  const [aberto, setAberto] = useState<string | null>(grupoDoAtivo);
  useEffect(() => { setAberto(grupoDoAtivo); }, [grupoDoAtivo]);
  const grupo = (id: string, nome: string, filhos: ReactNode) => {
    const idTitulo = `menu-${id}`;
    const idLista = `menu-lista-${id}`;
    const aberta = aberto === id;
    return (
      <section key={id} className="grupo-menu" aria-labelledby={idTitulo}>
        <h2 id={idTitulo}>
          <button type="button" aria-expanded={aberta} aria-controls={idLista} onClick={() => setAberto(aberta ? null : id)}>
            <span>{nome}</span><span className="seta" aria-hidden="true">{aberta ? '⌄' : '›'}</span>
          </button>
        </h2>
        <ul id={idLista} hidden={!aberta}>{filhos}</ul>
      </section>
    );
  };
  return (
    <nav id="menu-principal" className="lateral mx-fundo-escuro" aria-label="Menu principal">
      {conta && (
        <section className="conta-menu" aria-label="Sua conta">
          <p>{conta.empresa}</p>
          {conta.trocarFilial && <ul><li><a href="/filial">Trocar filial</a></li></ul>}
        </section>
      )}
      <ul>{item('/', 'Início')}</ul>
      {menu.map((g) => {
        // RD-2379: seção de um item só vira item solto, sem cabeçalho.
        if (g.itens.length === 1) return <ul key={g.modulo}>{item(g.itens[0]!.href, g.itens[0]!.rotulo)}</ul>;
        return grupo(g.modulo, NOMES_MODULOS[g.modulo], g.itens.map((i) => item(i.href, i.rotulo)));
      })}
      {grupo('conta', 'Conta', <>{item('/licencas', 'Licenças')}{acessoConfig && <ItemConfiguracao />}</>)}
    </nav>
  );
}
