import Link from 'next/link';
import type { DetalheVista } from '@/lib/descritor/tipos';
import { AcoesDetalhe } from './acoes-detalhe';
import { FaixaPendencias, Selo, TabelaVista } from './ui-cliente';

/** Detalhe genérico a partir da vista: cabeçalho, pendências, tabelas (itens), decisão, histórico e ações. */
export function DetalheGenerico({ vista, rota, rotaDaPagina, voltar }: { vista: DetalheVista; rota: string; rotaDaPagina: string; voltar: string }) {
  return (
    <article>
      <p><Link href={voltar}>Voltar para a lista</Link></p>
      {vista.faixa && <p className="faixa-aviso faixa-homologacao" role="status">{vista.faixa}</p>}
      <h1>{vista.titulo} {vista.selo && <Selo selo={vista.selo} />}</h1>
      <dl className="dados">{vista.cabecalho.map((c) => <div key={c.rotulo} className={c.linhaInteira ? 'dado-linha-inteira' : undefined}><dt>{c.rotulo}</dt><dd className={c.numerico ? 'num' : undefined}>{c.valor || '—'}</dd></div>)}</dl>
      <FaixaPendencias itens={vista.pendencias.map((p) => ({ nivel: p.bloqueante ? 'bloqueante' : 'aceitavel', codigoRn: p.codigoRn, texto: p.texto }))} />
      {vista.downloads && vista.downloads.length > 0 && (
        <>
        <div className="downloads" role="group" aria-label="Arquivos da nota">
          {vista.downloads.map((d, i) => d.desabilitado
            ? <button key={d.rotulo} type="button" className="mx-botao-secundario" disabled aria-describedby={`download-${i}-motivo`} title={d.desabilitado}>{d.rotulo}</button>
            : <a key={d.rotulo} className={d.principal ? 'mx-botao' : 'mx-botao-secundario'} href={`/baixar-arquivo?${new URLSearchParams({ caminho: d.href }).toString()}`}>{d.rotulo}</a>)}
        </div>
        {vista.downloads.map((d, i) => d.desabilitado && <p key={d.rotulo} id={`download-${i}-motivo`} className="apoio">{d.rotulo}: {d.desabilitado}</p>)}
        </>
      )}
      <AcoesDetalhe acoes={vista.acoes} rota={rota} rotaDaPagina={rotaDaPagina} />
      {vista.tabelas.map((t) => (
        <section key={t.titulo}>
          <h3>{t.titulo}</h3>
          <TabelaVista colunas={t.colunas} linhas={t.linhas.map((l, i) => ({ chave: String(i), celulas: l }))} vazio="Nada a mostrar." />
        </section>
      ))}
      {vista.decisao && vista.decisao.length > 0 && (
        <section><h3>Decisão</h3><dl className="dados">{vista.decisao.map((c) => <div key={c.rotulo}><dt>{c.rotulo}</dt><dd>{c.valor || '—'}</dd></div>)}</dl></section>
      )}
      {vista.historico && (
      <section>
        <h3>Histórico</h3>
        {vista.historico.length === 0 ? <p className="apoio">Sem eventos.</p> : <ol>{vista.historico.map((e, i) => <li key={i}><span className="num">{e.quando}</span> · {e.texto}</li>)}</ol>}
      </section>
      )}
    </article>
  );
}
