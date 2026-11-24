import type { Metadata } from 'next';
import { AssinaturaErp } from '@macuxierp/ui/marca';
import { euPlataforma } from '@/lib/config/api';
import { exigirTokenConfig } from '@/lib/config/sessao';
import { FormularioSenha } from './formulario';

export const metadata: Metadata = { title: 'Defina uma senha nova' };

/** `deve_trocar_senha`: tela única, fora do layout do portal (só `eu`, `senha` e `sair` respondem até a troca). */
export default async function Senha() {
  const token = await exigirTokenConfig();
  // Senha temporária do "esqueci" (RN-CORE-13, `motivo_troca` do `eu`): sem senha atual a informar. Falha ao ler o `eu` = campo normal.
  const eu = await euPlataforma(token).catch(() => null);
  const temporaria = eu?.deve_trocar_senha === true && eu.motivo_troca === 'temporaria';
  return (
    <main className="cartao-central cartao-plataforma">
      <div className="marca-login"><AssinaturaErp variante="C" fundo="perola" altura={100} /></div>
      <h1>Defina uma senha nova</h1>
      <FormularioSenha semSenhaAtual={temporaria} />
    </main>
  );
}
