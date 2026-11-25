'use client';
import { SITUACOES_CLIENTE_RECEBIDO_FDV } from '@macuxierp/platform-sdk';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import {
  ROTULO_SITUACAO_RECEBIDO,
  TEXTO_CORRIGIR_NO_FDV,
  filtrosDaTela,
  type ConsultaUrl,
  type LinhaClienteRecebido,
  type VistaClientesRecebidos,
} from '@/lib/clientes-recebidos';
import { urlDaLista, urlInicio, urlProxima } from '@/lib/listas-url';

const colunas: ColunaTabela<LinhaClienteRecebido>[] = [
  { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => <span className={l.classeSelo}>{l.rotuloSituacao}</span> },
  {
    id: 'cliente',
    titulo: 'Cliente',
    celula: (l) => (
      <span>
        {l.cliente}
        {l.hrefCliente && (
          <>
            {' '}
            <a href={l.hrefCliente}>Abrir cliente</a>
          </>
        )}
        {l.situacao === 'recusado' && (
          <details className="recusa-detalhe">
            <summary>Ver motivo</summary>
            {l.motivo && <p className="recusa-motivo">{l.motivo}</p>}
            {l.erros.length > 0 && (
              <ul className="recusa-erros">
                {l.erros.map((e, i) => (
                  <li key={`${e.campo}-${i}`}>
                    {e.mensagem}
                  </li>
                ))}
              </ul>
            )}
            <p className="apoio">{TEXTO_CORRIGIR_NO_FDV}</p>
          </details>
        )}
      </span>
    ),
  },
  { id: 'documento', titulo: 'Documento', celula: (l) => l.documento },
  { id: 'vendedor', titulo: 'Vendedor', celula: (l) => l.vendedor },
  { id: 'recebidoEm', titulo: 'Recebido em', tipo: 'data', celula: (l) => l.recebidoEm },
  { id: 'revisao', titulo: 'Revisão', tipo: 'numero', celula: (l) => (l.revisao === null ? '' : l.revisao) },
  { id: 'retorno', titulo: 'Retorno', celula: (l) => (l.retorno ? <span className="selo selo-aviso">{l.retorno}</span> : '') },
];

/** Seção "Clientes recebidos do FDV" (T-0059): só leitura; filtro e página vão na URL (links, sem script). */
export function SecaoClientesRecebidos({ vista, rota, consulta }: { vista: VistaClientesRecebidos; rota: string; consulta: ConsultaUrl }) {
  const filtros = filtrosDaTela(consulta);
  const proxima = urlProxima(rota, filtros, vista.proximoCursor);
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="h-cli-rec" data-testid="clientes-recebidos">
      <h2 id="h-cli-rec">Clientes recebidos</h2>
      <nav className="filtro-situacao" aria-label="Filtrar por situação">
        <a href={urlDaLista(rota, {})} aria-current={consulta.situacao ? undefined : 'true'}>Todos</a>
        {SITUACOES_CLIENTE_RECEBIDO_FDV.map((s) => (
          <a key={s} href={urlDaLista(rota, { situacao: s })} aria-current={consulta.situacao === s ? 'true' : undefined}>
            {ROTULO_SITUACAO_RECEBIDO[s]}
          </a>
        ))}
      </nav>
      <div className="tabela-rolavel com-sinal-rolagem tabela-recebidos">
        <TabelaDensa colunas={colunas} linhas={vista.linhas} chaveLinha={(l) => l.id} textoVazio="Nenhum cliente recebido." />
      </div>
      <nav className="paginacao" aria-label="Paginação">
        {consulta.cursor && <a className="mx-botao-secundario" href={urlInicio(rota, filtros)}>Voltar ao início</a>}
        {proxima ? <a className="mx-botao-secundario" href={proxima}>Próxima página</a> : vista.linhas.length > 0 ? <span className="apoio">Fim da lista.</span> : null}
      </nav>
    </section>
  );
}
