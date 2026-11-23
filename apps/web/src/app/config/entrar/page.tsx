import { AssinaturaErp } from '@macuxierp/ui/marca';
import type { Metadata } from 'next';
import { FormularioEntrar } from './formulario';

export const metadata: Metadata = { title: 'Entrar' };

/** Login da plataforma: sem seletor de empresa; a C positivo sobre pérola (spec do portal, tela 1). */
export default function Entrar() {
  return (
    <main className="cartao-central cartao-plataforma">
      <div className="marca-login"><AssinaturaErp variante="C" fundo="perola" altura={100} /></div>
      <h1>Plataforma Macuxi ERP</h1>
      <FormularioEntrar />
      <p className="apoio"><a href="/login">Sou de uma empresa</a></p>
    </main>
  );
}
