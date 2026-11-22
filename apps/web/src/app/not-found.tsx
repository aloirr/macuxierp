import Link from 'next/link';

export default function NaoEncontrada() {
  return (
    <main className="cartao-central">
      <h1>Página não encontrada</h1>
      <p className="apoio">O endereço não existe ou o módulo não está licenciado para a sua empresa.</p>
      <Link href="/">Voltar ao início</Link>
    </main>
  );
}
