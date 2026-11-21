import { contexto } from '@/lib/sessao';

export default async function Inicio() {
  const { eu } = await contexto();
  return (
    <>
      <h1>Olá, {eu.usuario.nome}</h1>
      <p className="apoio">Escolha uma opção no menu ao lado. Só aparecem os módulos licenciados para {eu.empresa.razao_social}.</p>
    </>
  );
}
