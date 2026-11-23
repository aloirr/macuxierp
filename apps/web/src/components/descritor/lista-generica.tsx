import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { buscarPagina } from '@/lib/listas';
import { RespostaFonte, opcoesDaResposta, caminhoDaFonte, type Opcao } from '@/lib/descritor/fontes';
import { NaoAutenticado, ehFalhaDeSessao, getValidado } from '@/lib/api';
import { ROTA_SENHA } from '@/lib/troca-pendente';
import { filtrosDaUrl } from '@macuxierp/platform-sdk/listas';
import { rotuloDaCelula, textoTodos } from '@/lib/descritor/lista';
import { urlDaLista, urlProxima } from '@/lib/listas-url';
import type { FiltroTela, TelaLista } from '@/lib/descritor/tipos';
import { AcoesDetalhe } from './acoes-detalhe';
import { TabelaVista } from './ui-cliente';

async function opcoesDoFiltro(f: FiltroTela, acesso: string, perfil: Perfil): Promise<readonly Opcao[]> {
  if (f.tipo === 'selecao') return f.opcoes ?? [];
  if (f.tipo !== 'cadastro' || !f.fonte) return [];
  try {
    return opcoesDaResposta(f.fonte, await getValidado(`${caminhoDaFonte(f.fonte)}?limite=200`, RespostaFonte, acesso, 'fonte', true), perfil);
  } catch {
    return []; // o seletor fica vazio; a lista continua (a falha da fonte não derruba a tela)
  }
}

/** Lista genérica a partir do descritor: filtros na URL (formulário GET, sem JS), tabela densa, paginação por cursor e CSV. */
export async function ListaGenerica({ tela, rota, rotaDaPagina, busca, perfil, acesso, fuso }: { tela: TelaLista; rota: string; rotaDaPagina: string; busca: URLSearchParams; perfil: Perfil; acesso: string; fuso: string }) {
  const filtros = filtrosDaUrl(tela.pagina, busca);
  const colunas = tela.colunas(perfil, fuso);
  let resultado;
  try {
    resultado = await Promise.all([
      buscarPagina(tela.pagina.api, filtros, tela.pagina.item, acesso),
      Promise.all(tela.filtrosTela.map((f) => opcoesDoFiltro(f, acesso, perfil))),
    ]);
  } catch (e) {
    // A lista renderiza fora do try da TelaGenerica: sessão vencida ou senha provisória resolvem aqui, como lá.
    if (ehFalhaDeSessao(e)) redirect(e instanceof NaoAutenticado ? '/sessao/renovar' : ROTA_SENHA);
    throw e;
  }
  const [pagina, opcoes] = resultado;
  const rotulos = new Map(tela.filtrosTela.flatMap((f, i) => (f.tipo === 'cadastro' ? [[f.chave, new Map((opcoes[i] ?? []).map((o) => [o.valor, o.rotulo] as const))] as const] : [])));
  /** Só filtro real acende o "Limpar filtros": cursor e limite são paginação. */
  const filtrada = Object.keys(filtros).some((k) => k !== 'cursor' && k !== 'limite');
  const aoLimpar = urlDaLista(rota, filtros.limite ? { limite: filtros.limite } : {});
  const declarado = tela.pagina.vazio;
  const textoVazio = declarado ? (filtrada ? declarado.comFiltro : declarado.semFiltro) : 'Nenhum registro com estes filtros.';
  const proxima = urlProxima(rota, filtros, pagina.proximo_cursor);
  const acaoBarra = tela.acaoDaBarra?.acao(perfil) ?? null;
  const iFilial = tela.filtrosTela.findIndex((f) => f.chave === 'filial_id');
  const barra = acaoBarra && acaoBarra.entrada === 'faixa' ? { ...acaoBarra, filiais: iFilial >= 0 ? (opcoes[iFilial] ?? []) : [] } : acaoBarra;
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
                <option value="">{textoTodos(f.rotulo)}</option>
                {(opcoes[i] ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
            )}
          </label>
        ))}
        <div className="filtros-acoes">
          <button className="mx-botao" type="submit">Filtrar</button>
          <Link className="mx-botao-secundario" href={rota}>Limpar</Link>
        </div>
      </form>
      <div className="barra-acoes">
        {tela.novo && (!tela.novo.criar || pode(perfil, tela.novo.criar)) && <Link className="mx-botao" href={tela.novo.rota}>{tela.novo.rotulo}</Link>}
        {csv && <a className="mx-botao-secundario" href={csv}>Exportar CSV</a>}
        {barra && <AcoesDetalhe acoes={[barra]} rota={rota} rotaDaPagina={rotaDaPagina} origem="barra" compacta />}
      </div>
      <TabelaVista
        colunas={colunas.map((c) => ({ id: c.id, rotulo: c.rotulo, ...(c.tipo ? { tipo: c.tipo } : {}) }))}
        vazio={textoVazio}
        acoes={tela.acaoDaLinha ? { rota, rotaDaPagina } : undefined}
        linhas={pagina.itens.map((l, i) => {
          const item = l as Record<string, unknown>;
          const texto = tela.linha(item, fuso);
          const selos = tela.selos?.(item, fuso);
          return {
            ...(selos ? { selos } : {}),
            chave: typeof item.id === 'string' ? item.id : String(i),
            celulas: Object.fromEntries(colunas.map((c) => [c.id, rotuloDaCelula(texto[c.id] ?? '', rotulos.get(c.id))])),
            ...(tela.acaoDaLinha ? { acao: tela.acaoDaLinha.acao(item, perfil) ?? undefined, maisAcoes: tela.acaoDaLinha.maisAcoes?.(item, perfil) ?? [] } : {}),
            ...(tela.rotaDaLinha ? { destino: tela.rotaDaLinha(item), rotulo: tela.rotuloDaLinha?.(item) ?? 'Abrir' } : {}),
          };
        })}
      />
      {pagina.itens.length === 0 && filtrada && <p><Link className="mx-botao-secundario" href={aoLimpar}>Limpar filtros</Link></p>}
      <nav className="paginacao" aria-label="Paginação">{proxima ? <Link className="mx-botao-secundario" href={proxima}>Próxima página</Link> : pagina.itens.length > 0 ? <span className="apoio">Fim da lista.</span> : null}</nav>
    </section>
  );
}
