'use client';

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="cartao-central" role="alert">
      <h1>Algo deu errado</h1>
      <p className="apoio">Não foi possível concluir a operação. Tente novamente; se continuar, avise o suporte.</p>
      <button className="btn" onClick={reset}>Tentar novamente</button>
    </main>
  );
}
