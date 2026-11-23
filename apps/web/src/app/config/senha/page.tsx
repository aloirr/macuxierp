import type { Metadata } from 'next';
import { AssinaturaErp } from '@macuxierp/ui/marca';
import { exigirTokenConfig } from '@/lib/config/sessao';
import { FormularioSenha } from './formulario';

export const metadata: Metadata = { title: 'Defina uma senha nova' };

/** `deve_trocar_senha`: tela única, fora do layout do portal (só `eu`, `senha` e `sair` respondem até a troca). */
export default async function Senha() {
  await exigirTokenConfig();
  return (
    <main className="cartao-central cartao-plataforma">
      <div className="marca-login"><AssinaturaErp variante="C" fundo="perola" altura={100} /></div>
      <h1>Defina uma senha nova</h1>
      <FormularioSenha />
    </main>
  );
}
