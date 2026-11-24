import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu, resolverPagina } from '@/lib/menu';
import { paginasDoMenu } from '@/lib/paginas';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';
import { telaDaRota } from '@/lib/telas';
import { TelaGenerica } from '@/components/descritor/tela-generica';
import { TelaIntegracaoFdv } from './tela-integracao-fdv';
import { PAGINAS_INTEGRACAO_FDV } from '@macuxierp/integracao-fdv/web';

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
  // Páginas visíveis do mesmo item de menu (ex.: as telas da Empresa, no core): o menu leva à primeira; as demais abrem por estas seções.
  const secoes = declarada ? paginasDoMenu(declarada.modulo, declarada.menu, perfil) : [];
  const monitor = PAGINAS_INTEGRACAO_FDV.find((p) => p.tipo === 'monitor');
  const titulo = declarada?.titulo ?? resolvida.rotulo;
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value ?? '';
  return (
    <>
      {/* No detalhe, o h1 é o título do registro (ex.: "Nota 12/1"), desenhado pelo DetalheGenerico: um h1 só por página. */}
      {tela?.tipo !== 'detalhe' && <h1>{titulo}</h1>}
      {secoes.length > 1 && (
        <nav className="secoes" aria-label="Seções">
          {secoes.map((p) => <Link key={p.rota} className="mx-botao-secundario" href={p.rota} aria-current={p.rota === declarada?.rota || (declarada?.ocultaNoMenu && p.rota === secoes[0]?.rota) ? 'page' : undefined}>{p.titulo}</Link>)}
        </nav>
      )}
      {declarada?.aviso && <p className="faixa-aviso" role="status">{declarada.aviso}</p>}
      {monitor && declarada?.rota === monitor.rota && <TelaIntegracaoFdv acesso={acesso} fuso={eu.empresa.fuso} rota={rota} busca={Object.fromEntries(busca)} />}
      {tela && declarada && (
        <TelaGenerica titulo={titulo} tela={tela} rotaDaPagina={declarada.rota} rota={rota} params={resolvida.params ?? {}} busca={busca} perfil={perfil} acesso={acesso} fuso={eu.empresa.fuso} />
      )}
      {!tela && !declarada?.aviso && declarada?.rota !== monitor?.rota && <p className="apoio">Disponível em breve.</p>}
    </>
  );
}

