import type { ModuloId } from '@macuxierp/platform-sdk';
import type { GrupoMenu } from './menu';

export interface AtalhoInicio {
  rotulo: string;
  href: string;
}

/** Os três atalhos do Início (decisão 58): módulo e rótulo do item de menu a que cada um leva. */
const ATALHOS: readonly { modulo: ModuloId; rotulo: string }[] = [
  { modulo: 'pedido', rotulo: 'Pedidos' },
  { modulo: 'faturamento', rotulo: 'Notas fiscais' },
  { modulo: 'cadastros', rotulo: 'Clientes' },
];

/** Atalhos visíveis: saem do mesmo menu do shell (`montarMenu`: licença, manifesto e perfil), sem regra nova. */
export function atalhosDoInicio(menu: readonly GrupoMenu[]): AtalhoInicio[] {
  return ATALHOS.flatMap((a) => {
    const item = menu.find((g) => g.modulo === a.modulo)?.itens.find((i) => i.rotulo === a.rotulo);
    return item ? [{ rotulo: item.rotulo, href: item.href }] : [];
  });
}
