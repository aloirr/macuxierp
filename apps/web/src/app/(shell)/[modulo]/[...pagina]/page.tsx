import type { Metadata } from 'next';
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
import { ROTA_BANDEIRA } from '@/lib/telas/bandeira';
import { ROTA_AMBIENTE_FISCAL, ROTA_PERFIS } from '@/lib/telas/core';
import { TelaAmbienteFiscal, TelaBandeira, TelaPerfis } from './telas-quadro';

/** Páginas que têm componente próprio (não passam pelo renderizador genérico nem mostram "Disponível em breve"). */
const QUADROS: ReadonlySet<string> = new Set([ROTA_PERFIS, ROTA_AMBIENTE_FISCAL, ROTA_BANDEIRA]);

/** Título da aba do navegador: o mesmo da página (e do botão da seção), não o nome do item de menu. */
export async function generateMetadata({ params }: { params: Promise<{ modulo: string; pagina: string[] }> }): Promise<Metadata> {
  const { modulo, pagina } = await params;
  const { eu } = await contexto();
  const resolvida = resolverPagina(montarMenu(eu.modulos, MANIFESTOS, eu.usuario.perfil), `/${[modulo, ...pagina].join('/')}`, eu.usuario.perfil);
  const titulo = resolvida?.pagina?.titulo ?? resolvida?.rotulo;
  return titulo ? { title: titulo } : {};
}

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
      {monitor && declarada?.rota === monitor.rota && <TelaIntegracaoFdv acesso={acesso} fuso={eu.empresa.fuso} />}
      {tela && declarada && (
        <TelaGenerica titulo={titulo} tela={tela} rotaDaPagina={declarada.rota} rota={rota} params={resolvida.params ?? {}} busca={busca} perfil={perfil} acesso={acesso} fuso={eu.empresa.fuso} />
      )}
      {/* Quadros com componente próprio (T-0087, T-0088): só leitura, exceto a bandeira (Ligar/Desligar do administrador, pelo executor do quadro). */}
      {declarada?.rota === ROTA_PERFIS && <TelaPerfis acesso={acesso} />}
      {declarada?.rota === ROTA_AMBIENTE_FISCAL && <TelaAmbienteFiscal acesso={acesso} perfil={perfil} />}
      {declarada?.rota === ROTA_BANDEIRA && <TelaBandeira acesso={acesso} perfil={perfil} rota={rota} rotaDaPagina={declarada.rota} />}
      {!tela && !declarada?.aviso && declarada?.rota !== monitor?.rota && !QUADROS.has(declarada?.rota ?? '') && <p className="apoio">Disponível em breve.</p>}
    </>
  );
}

