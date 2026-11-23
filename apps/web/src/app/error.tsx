'use client';
import { MensagemRecarregar } from '@/components/mensagem-recarregar';
import { SISTEMA_ATUALIZADO, ehAcaoAusente } from '@/lib/sistema-atualizado';

export default function Erro({ error, reset }: { error: Error; reset: () => void }) {
  if (ehAcaoAusente(error)) {
    return (
      <main className="cartao-central">
        <h1>Atualização</h1>
        <MensagemRecarregar texto={SISTEMA_ATUALIZADO} className="apoio" />
      </main>
    );
  }
  return (
    <main className="cartao-central" role="alert">
      <h1>Algo deu errado</h1>
      <p className="apoio">Não foi possível concluir a operação. Se continuar, avise o suporte.</p>
      <button className="mx-botao" onClick={reset}>Tentar novamente</button>
    </main>
  );
}
