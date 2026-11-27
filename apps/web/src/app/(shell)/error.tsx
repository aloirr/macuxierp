'use client';
import { MensagemRecarregar } from '@/components/mensagem-recarregar';
import { ehAcaoAusente } from '@/lib/sistema-atualizado';

/** Falha dentro do shell: o aviso fica no topo da área de conteúdo, com o topo e o menu preservados. */
export default function ErroDoShell({ error, reset }: { error: Error; reset: () => void }) {
  if (ehAcaoAusente(error)) return <MensagemRecarregar />;
  return (
    <div role="alert">
      <h1>Algo deu errado</h1>
      <p className="apoio">Não foi possível concluir a operação. Se continuar, avise o suporte.</p>
      <button className="mx-botao" onClick={reset}>Tentar novamente</button>
    </div>
  );
}
