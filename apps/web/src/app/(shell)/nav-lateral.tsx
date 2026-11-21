'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GrupoMenu } from '@/lib/menu';
import { NOMES_MODULOS } from '@/lib/nomes-modulos';

export function NavLateral({ menu }: { menu: GrupoMenu[] }) {
  const atual = usePathname();
  const item = (href: string, rotulo: string) => (
    <li key={href}>
      <Link href={href} aria-current={atual === href ? 'page' : undefined}>{rotulo}</Link>
    </li>
  );
  return (
    <nav className="lateral" aria-label="Menu principal">
      <ul>{item('/', 'Início')}</ul>
      {menu.map((g) => {
        const nome = NOMES_MODULOS[g.modulo];
        const unico = g.itens.length === 1 && g.itens[0]?.rotulo === nome;
        if (unico) return <ul key={g.modulo}>{g.itens.map((i) => item(i.href, i.rotulo))}</ul>;
        const idTitulo = `menu-${g.modulo}`;
        return (
          <section key={g.modulo} aria-labelledby={idTitulo}>
            <h2 id={idTitulo}>{nome}</h2>
            <ul>{g.itens.map((i) => item(i.href, i.rotulo))}</ul>
          </section>
        );
      })}
      <h2>Conta</h2>
      <ul>{item('/licencas', 'Licenças')}</ul>
    </nav>
  );
}
