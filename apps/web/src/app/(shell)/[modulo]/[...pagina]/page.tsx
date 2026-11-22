import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { PAGINA_CARGA } from '@macuxierp/cadastros/web';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu, resolverPagina } from '@/lib/menu';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';
import { telaDaRota } from '@/lib/telas';
import { TelaGenerica } from '@/components/descritor/tela-generica';
import { TelaCarga } from './carga';

/**
 * Espaço das telas dos módulos. A rota vem das páginas que o módulo declara (mesma fonte do menu), com `:id` para o detalhe.
 * Módulo não licenciado, sem o perfil ou página desconhecida: 404. Página com descritor de tela (`lib/telas`) usa o renderizador genérico.
 */
export default async function PaginaDoModulo({ params, searchParams }: { params: Promise<{ modulo: string; pagina: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { modulo, pagina } = await params;
  const { eu } = await contexto();
  const perfil = eu.usuario.perfil;
  const menu = montarMenu(eu.modulos, MANIFESTOS, perfil);
  const rota = `/${[modulo, ...pagina].join('/')}`;
  const resolvida = resolverPagina(menu, rota, perfil);
  if (!resolvida) notFound();
  const declarada = resolvida.pagina;
  const tela = declarada ? telaDaRota(declarada.rota) : undefined;
  const busca = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') busca.set(k, v);
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value ?? '';
  return (
    <>
      <h1>{declarada?.titulo ?? resolvida.rotulo}</h1>
      {declarada?.aviso && <p className="faixa-aviso" role="status">{declarada.aviso}</p>}
      {rota === PAGINA_CARGA.rota && <TelaCarga api="/envio-carga" />}
      {tela && declarada && (
        <TelaGenerica tela={tela} rotaDaPagina={declarada.rota} rota={rota} params={resolvida.params ?? {}} busca={busca} perfil={perfil} acesso={acesso} fuso={eu.empresa.fuso} />
      )}
      {!tela && !declarada?.aviso && rota !== PAGINA_CARGA.rota && <p className="apoio">Esta tela ainda não foi construída.</p>}
    </>
  );
}

