import type { Metadata } from 'next';
import { listarEmpresas } from '@/lib/config/api';
import { CodigoDoErro } from '@/components/codigo-do-erro';
import { ConfigIndisponivel, ConfigNaoAutenticado } from '@/lib/config/erros';
import { exigirTokenConfig, ROTA_ENCERRAR } from '@/lib/config/sessao';
import { redirect } from 'next/navigation';
import { ListaEmpresas } from './lista-empresas';

export const metadata: Metadata = { title: 'Empresas' };

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Empresas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const busca = (um(sp.busca) ?? '').trim().slice(0, 80);
  const token = await exigirTokenConfig();

  let pagina;
  try {
    pagina = await listarEmpresas(token, { busca: busca || undefined });
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) redirect(ROTA_ENCERRAR);
    const href = busca ? `/config?busca=${encodeURIComponent(busca)}` : '/config';
    return (
      <>
        <h1>Empresas</h1>
        <p className="erro">Não foi possível carregar a lista de empresas.</p>
        <CodigoDoErro id={e instanceof ConfigIndisponivel ? e.requestId : undefined} />
        <a className="mx-botao-secundario" href={href}>Recarregar</a>
      </>
    );
  }

  const vazio = busca ? 'Nenhuma empresa com esse código. Limpe a busca.' : 'Nenhuma empresa ainda. Crie a primeira.';
  return (
    <>
      <div className="titulo-linha">
        <h1>Empresas</h1>
        <form method="get" action="/config" className="busca-slug" role="search">
          <label className="campo"><span>Buscar por código</span><input name="busca" defaultValue={busca} maxLength={80} autoComplete="off" /></label>
          <button className="mx-botao-secundario" type="submit">Buscar</button>
          {busca && <a href="/config">Limpar</a>}
        </form>
      </div>
      <div className="cartao-tabela">
      <ListaEmpresas key={busca} empresas={pagina.itens} vazio={vazio} proximo={pagina.proximo_cursor} busca={busca} />
      <div className="barra-acoes">
        <a className="mx-botao" href="/config/empresas/nova">+ Criar empresa</a>
      </div>
      </div>
    </>
  );
}
