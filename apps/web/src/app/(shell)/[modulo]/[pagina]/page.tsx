import { notFound } from 'next/navigation';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu, rotuloDaPagina } from '@/lib/menu';
import { contexto } from '@/lib/sessao';

/** Espaço das telas dos módulos (donos: agentes de módulo). Módulo não licenciado ou sem o perfil: 404. */
export default async function PaginaDoModulo({ params }: { params: Promise<{ modulo: string; pagina: string }> }) {
  const { modulo, pagina } = await params;
  const { eu } = await contexto();
  const menu = montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil);
  const rotulo = rotuloDaPagina(menu, modulo, pagina);
  if (!rotulo) notFound();
  return (
    <>
      <h1>{rotulo}</h1>
      <p className="apoio">Esta tela ainda não foi construída.</p>
    </>
  );
}
