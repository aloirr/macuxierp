import { notFound } from 'next/navigation';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu, resolverPagina } from '@/lib/menu';
import { contexto } from '@/lib/sessao';
import { PAGINA_CARGA } from '@macuxierp/cadastros/web';
import { TelaCarga } from './carga';

/**
 * Espaço das telas dos módulos (donos: agentes de módulo). A rota vem das páginas que o módulo declara (mesma fonte do
 * menu). Módulo não licenciado, sem o perfil ou página desconhecida: 404.
 */
export default async function PaginaDoModulo({ params }: { params: Promise<{ modulo: string; pagina: string[] }> }) {
  const { modulo, pagina } = await params;
  const { eu } = await contexto();
  const perfil = eu.usuario.perfil;
  const menu = montarMenu(eu.modulos, MANIFESTOS, perfil);
  const rota = `/${[modulo, ...pagina].join('/')}`;
  const resolvida = resolverPagina(menu, rota, perfil);
  if (!resolvida) notFound();
  const declarada = resolvida.pagina;
  return (
    <>
      <h1>{declarada?.titulo ?? resolvida.rotulo}</h1>
      {declarada?.aviso && <p className="faixa-aviso" role="status">{declarada.aviso}</p>}
      {rota === PAGINA_CARGA.rota && <TelaCarga api="/envio-carga" />}
      {!declarada?.aviso && rota !== PAGINA_CARGA.rota && <p className="apoio">Esta tela ainda não foi construída.</p>}
    </>
  );
}
