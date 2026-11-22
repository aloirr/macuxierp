import Link from 'next/link';
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { buscarPagina } from '@/lib/listas';
import { RespostaFonte, opcoesDaResposta, caminhoDaFonte, type Opcao } from '@/lib/descritor/fontes';
import { getValidado } from '@/lib/api';
import { filtrosDaUrl } from '@macuxierp/platform-sdk/listas';
import { rotuloDaCelula } from '@/lib/descritor/lista';
import { urlProxima } from '@/lib/listas-url';
import type { FiltroTela, TelaLista } from '@/lib/descritor/tipos';
import { TabelaVista } from './ui-cliente';

async function opcoesDoFiltro(f: FiltroTela, acesso: string): Promise<readonly Opcao[]> {
  if (f.tipo === 'selecao') return f.opcoes ?? [];
  if (f.tipo !== 'cadastro' || !f.fonte) return [];
  try {
    return opcoesDaResposta(f.fonte, await getValidado(`${caminhoDaFonte(f.fonte)}?limite=200`, RespostaFonte, acesso, 'fonte', true));
  } catch {
    return []; // o seletor fica vazio; a lista continua (a falha da fonte não derruba a tela)
  }
}

/** Lista genérica a partir do descritor: filtros na URL (formulário GET, sem JS), tabela densa, paginação por cursor e CSV. */
export async function ListaGenerica({ tela, rota, busca, perfil, acesso, fuso }: { tela: TelaLista; rota: string; busca: URLSearchParams; perfil: Perfil; acesso: string; fuso: string }) {
  const filtros = filtrosDaUrl(tela.pagina, busca);
  const colunas = tela.colunas(perfil);
  const [pagina, opcoes] = await Promise.all([
    buscarPagina(tela.pagina.api, filtros, tela.pagina.item, acesso),
    Promise.all(tela.filtrosTela.map((f) => opcoesDoFiltro(f, acesso))),
  ]);
  const rotulos = new Map(tela.filtrosTela.flatMap((f, i) => (f.tipo === 'cadastro' ? [[f.chave, new Map((opcoes[i] ?? []).map((o) => [o.valor, o.rotulo] as const))] as const] : [])));
  const proxima = urlProxima(rota, filtros, pagina.proximo_cursor);
  const csv = tela.pagina.csv ? `/exportar-csv?${new URLSearchParams({ rota, ...filtros }).toString()}` : null;
  return (
    <section>
      <form method="get" action={rota} className="filtros" role="search" aria-label="Filtros">
        {tela.pagina.busca && (
          <label className="campo"><span>{tela.rotuloBusca ?? 'Busca'}</span><input name="busca" defaultValue={filtros.busca ?? ''} maxLength={80} /></label>
        )}
        {tela.filtrosTela.map((f, i) => (
          <label key={f.chave} className="campo">
            <span>{f.rotulo}</span>
            {f.tipo === 'texto' && <input name={f.chave} defaultValue={filtros[f.chave] ?? ''} maxLength={80} />}
            {f.tipo === 'data' && <input type="date" lang="pt-BR" name={f.chave} defaultValue={filtros[f.chave] ?? ''} />}
            {(f.tipo === 'selecao' || f.tipo === 'cadastro') && (
              <select name={f.chave} defaultValue={filtros[f.chave] ?? ''}>
                <option value="">Todos</option>
                {(opcoes[i] ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
            )}
          </label>
        ))}
        <button className="btn" type="submit">Filtrar</button>
        <Link className="btn btn-sec" href={rota}>Limpar</Link>
      </form>
      <div className="barra-acoes">
        {tela.novo && (!tela.novo.criar || pode(perfil, tela.novo.criar)) && <Link className="btn" href={tela.novo.rota}>{tela.novo.rotulo}</Link>}
        {csv && <a className="btn btn-sec" href={csv}>Exportar CSV</a>}
      </div>
      <TabelaVista
        colunas={colunas.map((c) => ({ id: c.id, rotulo: c.rotulo }))}
        vazio="Nenhum registro com estes filtros."
        linhas={pagina.itens.map((l, i) => {
          const item = l as Record<string, unknown>;
          const texto = tela.linha(item, fuso);
          return {
            chave: typeof item.id === 'string' ? item.id : String(i),
            celulas: Object.fromEntries(colunas.map((c) => [c.id, rotuloDaCelula(texto[c.id] ?? '', rotulos.get(c.id))])),
            ...(tela.rotaDaLinha ? { destino: tela.rotaDaLinha(item), rotulo: tela.rotuloDaLinha?.(item) ?? 'Abrir' } : {}),
          };
        })}
      />
      <nav className="paginacao" aria-label="Paginação">{proxima ? <Link className="btn btn-sec" href={proxima}>Próxima página</Link> : <span className="apoio">Fim da lista.</span>}</nav>
    </section>
  );
}
