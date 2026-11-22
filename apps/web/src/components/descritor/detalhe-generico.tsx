import Link from 'next/link';
import type { DetalheVista } from '@/lib/descritor/tipos';
import { AcoesDetalhe } from './acoes-detalhe';
import { FaixaPendencias, SeloStatus, TabelaDensa } from './adaptadores';

/** Detalhe genérico a partir da vista: cabeçalho, pendências, tabelas (itens), decisão, histórico e ações. */
export function DetalheGenerico({ vista, rota, voltar }: { vista: DetalheVista; rota: string; voltar: string }) {
  return (
    <article>
      <p><Link href={voltar}>Voltar para a lista</Link></p>
      <h2>{vista.titulo} {vista.selo && <SeloStatus {...vista.selo} />}</h2>
      <dl className="dados">{vista.cabecalho.map((c) => <div key={c.rotulo}><dt>{c.rotulo}</dt><dd>{c.valor || '—'}</dd></div>)}</dl>
      <FaixaPendencias pendencias={vista.pendencias} />
      <AcoesDetalhe acoes={vista.acoes} rota={rota} />
      {vista.tabelas.map((t) => (
        <section key={t.titulo}>
          <h3>{t.titulo}</h3>
          <TabelaDensa legenda={t.titulo} colunas={t.colunas} linhas={t.linhas.map((l, i) => ({ chave: String(i), celulas: l }))} />
        </section>
      ))}
      {vista.decisao && vista.decisao.length > 0 && (
        <section><h3>Decisão</h3><dl className="dados">{vista.decisao.map((c) => <div key={c.rotulo}><dt>{c.rotulo}</dt><dd>{c.valor || '—'}</dd></div>)}</dl></section>
      )}
      <section>
        <h3>Histórico</h3>
        {vista.historico.length === 0 ? <p className="apoio">Sem eventos.</p> : <ol>{vista.historico.map((e, i) => <li key={i}><span className="num">{e.quando}</span> · {e.texto}</li>)}</ol>}
        <p className="apoio">Horários de Manaus.</p>
      </section>
    </article>
  );
}

