'use client';
// O barrel de @macuxierp/ui traz componentes com hooks; importá-lo num Server Component quebra o build.
// Este invólucro cliente deixa o layout do shell (servidor) usar a AssinaturaErp. Pendência do designer-ux: subpath sem hooks.
import { AssinaturaErp } from '@macuxierp/ui';

export function Assinatura() {
  return <AssinaturaErp />;
}
