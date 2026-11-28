import { AssinaturaErp } from '@macuxierp/ui/marca';
import { SeloPlataforma } from '@macuxierp/ui';
import { MenuUsuario } from '@/components/menu-usuario';
import { sairConfigAcao } from './sair';

/**
 * Topo do portal: assinatura A negativo sobre grafite, com o selo "Plataforma" fora da área de proteção. NENHUM menu de empresa:
 * o superadmin não tem módulos, filial nem perfil de tenant (ADR 0012). Sem o link "Empresas" (RD-2360): o selo "Plataforma"
 * já diz onde se está e a migalha da ficha volta à lista.
 */
export function TopoPlataforma({ nome }: { nome: string }) {
  return (
    <header className="topo topo-plataforma mx-fundo-escuro">
      <span className="marca"><AssinaturaErp fundo="grafite" /></span>
      <SeloPlataforma />
      <span className="espaco" />
      <MenuUsuario nome={nome} hrefPerfil="/config/perfil" hrefSenha="/config/senha" sair={sairConfigAcao} />
    </header>
  );
}
