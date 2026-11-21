'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GrupoMenu } from '@/lib/menu';

const NOMES: Record<string, string> = {
  core: 'Plataforma',
  cadastros: 'Cadastros',
  pedido: 'Pedidos',
  faturamento: 'Faturamento',
  fiscal: 'Fiscal',
  'integracao-fdv': 'Integração FDV',
};

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
      {menu.map((g) => (
        <section key={g.modulo} aria-label={NOMES[g.modulo] ?? g.modulo}>
          <h2>{NOMES[g.modulo] ?? g.modulo}</h2>
          <ul>{g.itens.map((i) => item(i.href, i.rotulo))}</ul>
        </section>
      ))}
      <h2>Conta</h2>
      <ul>{item('/licencas', 'Licenças')}</ul>
    </nav>
  );
}
