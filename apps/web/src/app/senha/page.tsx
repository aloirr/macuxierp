import type { Metadata } from 'next';
import { CabecalhoCartao } from '../cabecalho-cartao';
import { entrouComTemporaria, TEXTOS_DESBLOQUEIO } from '@/lib/login-regras';
import { contexto, destinoSeguro } from '@/lib/sessao';
import { BotaoSair } from '../(shell)/botao-sair';
import { FormularioSenhaBko } from './formulario';

export const metadata: Metadata = { title: 'Trocar senha' };

/** Fora do layout do (shell): sem menu. Obrigatória (`deve_trocar_senha`) ou voluntária (com `destino`, para onde voltar). */
export default async function Senha({ searchParams }: { searchParams: Promise<{ destino?: string }> }) {
  const { eu } = await contexto();
  const obrigatoria = eu.usuario.deve_trocar_senha === true;
  const { destino } = await searchParams;
  // Senha temporária do "esqueci" (RN-CORE-13): o 1º campo é a própria temporária, sem senha atual a informar.
  const temporaria = entrouComTemporaria(eu.usuario);
  return (
    <main className="cartao-central">
      {temporaria ? <CabecalhoCartao titulo={TEXTOS_DESBLOQUEIO.titulo} desbloqueada /> : <CabecalhoCartao titulo="Trocar senha" />}
      {obrigatoria && !temporaria && <p className="apoio" role="status">Para continuar, troque a senha provisória por uma senha só sua.</p>}
      <FormularioSenhaBko destino={obrigatoria ? '' : destinoSeguro(destino)} semSenhaAtual={temporaria} />
      <div className="rodape-cartao"><BotaoSair /></div>
    </main>
  );
}
