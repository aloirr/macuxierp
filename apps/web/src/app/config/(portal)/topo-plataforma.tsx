import { AssinaturaErp } from '@macuxierp/ui/marca';
import { SeloPlataforma } from '@macuxierp/ui';
import { sairConfigAcao } from './sair';

/**
 * Topo do portal: assinatura A negativo sobre grafite, com o selo "Plataforma" fora da área de proteção. NENHUM menu de empresa:
 * o superadmin não tem módulos, filial nem perfil de tenant (ADR 0012); o único destino é a lista de empresas.
 */
export function TopoPlataforma({ nome }: { nome: string }) {
  return (
    <header className="topo topo-plataforma mx-fundo-escuro">
      <span className="marca"><AssinaturaErp fundo="grafite" /></span>
      <SeloPlataforma />
      <nav aria-label="Plataforma"><a href="/config">Empresas</a></nav>
      <span className="espaco" />
      <span>{nome}</span>
      <form action={sairConfigAcao}><button className="link" type="submit">Sair</button></form>
    </header>
  );
}
