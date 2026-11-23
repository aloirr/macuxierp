import type { Metadata } from 'next';
import { listarEmpresas } from '@/lib/config/api';
import { ConfigNaoAutenticado } from '@/lib/config/erros';
import { exigirTokenConfig, ROTA_ENCERRAR } from '@/lib/config/sessao';
import { redirect } from 'next/navigation';
import { ListaEmpresas } from './lista-empresas';

export const metadata: Metadata = { title: 'Empresas' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Empresas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const busca = (um(sp.busca) ?? '').trim().slice(0, 80);
  const cursorBruto = um(sp.cursor);
  const cursor = cursorBruto && UUID.test(cursorBruto) ? cursorBruto : undefined;
  const token = await exigirTokenConfig();

  let pagina;
  try {
    pagina = await listarEmpresas(token, { busca: busca || undefined, cursor });
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    const href = busca ? `/config?busca=${encodeURIComponent(busca)}` : '/config';
    return (
      <>
        <h1>Empresas</h1>
        <p className="erro">Não foi possível carregar. Tente de novo.</p>
        <a className="mx-botao-secundario" href={href}>Tentar de novo</a>
      </>
    );
  }

  const vazio = busca ? 'Nenhuma empresa com esse slug. Limpe a busca.' : 'Nenhuma empresa ainda. Crie a primeira.';
  const proxima = pagina.proximo_cursor ? `/config?${new URLSearchParams({ ...(busca ? { busca } : {}), cursor: pagina.proximo_cursor })}` : null;
  return (
    <>
      <div className="titulo-linha">
        <h1>Empresas</h1>
        <a className="mx-botao" href="/config/empresas/nova">Criar empresa</a>
      </div>
      <form method="get" action="/config" className="busca-slug" role="search">
        <label className="campo"><span>Buscar por slug</span><input name="busca" defaultValue={busca} maxLength={80} autoComplete="off" /></label>
        <button className="mx-botao-secundario" type="submit">Buscar</button>
        {busca && <a href="/config">Limpar</a>}
      </form>
      <ListaEmpresas empresas={pagina.itens} vazio={vazio} />
      <div className="paginacao">
        {cursor && <a href={busca ? `/config?busca=${encodeURIComponent(busca)}` : '/config'}>Voltar ao início</a>}
        {proxima && <a className="mx-botao-secundario" href={proxima}>Carregar mais</a>}
      </div>
    </>
  );
}
