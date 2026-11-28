import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { buscarPagina } from '@/lib/listas';
import { RespostaFonte, opcoesDaResposta, caminhoDaFonte, type Opcao } from '@/lib/descritor/fontes';
import { NaoAutenticado, SemPermissao, ehFalhaDeSessao, getValidado } from '@/lib/api';
import { ROTA_SENHA } from '@/lib/troca-pendente';
import { filtrosDaUrl } from '@macuxierp/platform-sdk/listas';
import { colunasDosFiltros, filtrosParaApi, rotuloDaCelula, textoTodos } from '@/lib/descritor/lista';
import { urlDaLista, urlProxima } from '@/lib/listas-url';
import type { FiltroTela, TelaLista } from '@/lib/descritor/tipos';
import { AcoesDetalhe } from './acoes-detalhe';
import { TabelaVista } from './ui-cliente';
import { FiltrosLista } from './filtros-lista';
import { TEXTO_SEM_PERMISSAO, TEXTO_VAZIO, TEXTO_VAZIO_COM_FILTRO } from '@/lib/telas/comum';

async function opcoesDoFiltro(f: FiltroTela, acesso: string, perfil: Perfil): Promise<readonly Opcao[]> {
  if (f.tipo === 'selecao') return f.opcoes ?? [];
  if (f.tipo !== 'cadastro' || !f.fonte) return [];
  try {
    return opcoesDaResposta(f.fonte, await getValidado(`${caminhoDaFonte(f.fonte)}?limite=200`, RespostaFonte, acesso, 'fonte', true), perfil);
  } catch {
    return []; // o seletor fica vazio; a lista continua (a falha da fonte não derruba a tela)
  }
}

/** Lista genérica a partir do descritor: filtros na URL (formulário GET que funciona sem JS; com JS se aplica ao mudar, RD-2382), tabela densa, paginação por cursor e CSV. */
export async function ListaGenerica({ tela, rota, rotaDaPagina, busca, perfil, acesso, fuso, outrasSecoes = [] }: { outrasSecoes?: readonly { rota: string; titulo: string }[]; tela: TelaLista; rota: string; rotaDaPagina: string; busca: URLSearchParams; perfil: Perfil; acesso: string; fuso: string }) {
  const filtros = filtrosDaUrl(tela.pagina, busca);
  const todasColunas = tela.colunas(perfil, fuso);
  let resultado;
  try {
    resultado = await Promise.all([
      buscarPagina(tela.pagina.api, filtrosParaApi(tela.filtrosTela, filtros, fuso), tela.pagina.item, acesso),
      Promise.all(tela.filtrosTela.map((f) => opcoesDoFiltro(f, acesso, perfil))),
    ]);
  } catch (e) {
    // A lista renderiza fora do try da TelaGenerica: sessão vencida ou senha provisória resolvem aqui, como lá.
    if (ehFalhaDeSessao(e)) redirect(e instanceof NaoAutenticado ? '/sessao/renovar' : ROTA_SENHA);
    // 403 da API (ex.: usuários e auditoria só do administrador, RN-CORE-09): mensagem fixa em vez da tela de erro.
    if (e instanceof SemPermissao) return <p className="erro" role="alert">{TEXTO_SEM_PERMISSAO}</p>;
    throw e;
  }
  const [pagina, opcoes] = resultado;
  // RD-2383: coluna sem nenhum valor nem selo nas linhas (ex.: pendências, selo) não ocupa lugar; sem linhas, todas ficam.
  const textos = pagina.itens.map((l) => ({ t: tela.linha(l as Record<string, unknown>, fuso), s: tela.selos?.(l as Record<string, unknown>, fuso) }));
  const colunas = textos.length === 0 ? todasColunas : todasColunas.filter((c) => textos.some((x) => (x.t[c.id] ?? '') !== '' || (x.s?.[c.id]?.length ?? 0) > 0));
  const largura = colunasDosFiltros([...(tela.pagina.busca ? ['busca' as const] : []), ...tela.filtrosTela.map((f) => (f.tipo === 'data' ? 'data' as const : f.tipo === 'texto' ? 'texto' as const : 'selecao' as const))]);
  const col = (n: number) => `campo filtro-col-${largura[n] ?? 2}`;
  const rotulos = new Map(tela.filtrosTela.flatMap((f, i) => (f.tipo === 'cadastro' ? [[f.chave, new Map((opcoes[i] ?? []).map((o) => [o.valor, o.rotulo] as const))] as const] : [])));
  /** Só filtro real acende o link "Limpar filtros" ao lado dos filtros: cursor e limite são paginação. */
  const filtrada = Object.keys(filtros).some((k) => k !== 'cursor' && k !== 'limite');
  const aoLimpar = urlDaLista(rota, filtros.limite ? { limite: filtros.limite } : {});
  const declarado = tela.pagina.vazio;
  const textoVazio = declarado ? (filtrada ? declarado.comFiltro : declarado.semFiltro) : filtrada ? TEXTO_VAZIO_COM_FILTRO : TEXTO_VAZIO;
  const proxima = urlProxima(rota, filtros, pagina.proximo_cursor);
  const acaoBarra = tela.acaoDaBarra?.acao(perfil) ?? null;
  const iFilial = tela.filtrosTela.findIndex((f) => f.chave === 'filial_id');
  const barra = acaoBarra && acaoBarra.entrada === 'faixa' ? { ...acaoBarra, filiais: iFilial >= 0 ? (opcoes[iFilial] ?? []) : [] } : acaoBarra;
  const novo = tela.novo && (!tela.novo.criar || pode(perfil, tela.novo.criar)) ? tela.novo : null;
  const csv = tela.pagina.csv ? `/exportar-csv?${new URLSearchParams({ rota, ...filtros }).toString()}` : null;
  return (
    <section>
      <FiltrosLista rota={rota}>
        {tela.pagina.busca && (
          <label className={col(0)}><span>Buscar</span><input type="search" name="busca" defaultValue={filtros.busca ?? ''} maxLength={80} {...(tela.rotuloBusca ? { placeholder: tela.rotuloBusca } : {})} /></label>
        )}
        {tela.filtrosTela.map((f, i) => (
          <label key={f.chave} className={col(i + (tela.pagina.busca ? 1 : 0))}>
            <span>{f.rotulo}</span>
            {f.tipo === 'texto' && <input name={f.chave} defaultValue={filtros[f.chave] ?? ''} maxLength={80} />}
            {f.tipo === 'data' && <input type="date" lang="pt-BR" name={f.chave} defaultValue={filtros[f.chave] ?? ''} />}
            {(f.tipo === 'selecao' || f.tipo === 'cadastro') && (
              <select name={f.chave} defaultValue={filtros[f.chave] ?? ''}>
                <option value="">{f.vazio ?? textoTodos(f.rotulo)}</option>
                {(opcoes[i] ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
            )}
          </label>
        ))}
        {/* Sem JS não há aplicar ao mudar: o botão só aparece nesse caso (globals.css, `scripting: none`). */}
        <button className="mx-botao filtros-enviar" type="submit">Filtrar</button>
        {filtrada && <Link className="filtros-limpar" href={aoLimpar}>Limpar filtros</Link>}
      </FiltrosLista>
      <div className="cartao-tabela">
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
      </div>
      {/* RD-2381: uma barra só, no rodapé da página, com as ações da lista e a paginação juntas. */}
      {(novo || csv || barra || proxima || outrasSecoes.length > 0) && (
        <div className="barra-acoes barra-rodape-lista">
          {novo && <Link className="mx-botao" href={novo.rota}>{novo.rotulo}</Link>}
          {csv && <a className="mx-botao-secundario" href={csv}>Exportar CSV</a>}
          {outrasSecoes.map((o) => <Link key={o.rota} className="mx-botao-secundario" href={o.rota}>{o.titulo}</Link>)}
          {barra && <AcoesDetalhe acoes={[barra]} rota={rota} rotaDaPagina={rotaDaPagina} origem="barra" compacta />}
          {proxima && <nav className="paginacao" aria-label="Paginação"><Link className="mx-botao-secundario" href={proxima}>Próxima página</Link></nav>}
        </div>
      )}
    </section>
  );
}
