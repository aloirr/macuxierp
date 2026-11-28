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

  const vazio = busca ? 'Nenhuma empresa com esse nome ou código. Limpe a busca.' : 'Nenhuma empresa ainda. Crie a primeira.';
  return <ListaEmpresas key={busca} empresas={pagina.itens} vazio={vazio} proximo={pagina.proximo_cursor} busca={busca} />;
}
