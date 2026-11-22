import Link from 'next/link';
import type { DetalheVista } from '@/lib/descritor/tipos';
import { AcoesDetalhe } from './acoes-detalhe';
import { FaixaPendencias, TabelaVista } from './ui-cliente';

/** Selo do status: os tons `ok` e `neutro` usam as classes do selo ativo e inativo (mesma marca). */
const CLASSE_SELO = { ok: 'selo-ativo', neutro: 'selo-inativo', aviso: 'selo-aviso', erro: 'selo-erro' } as const;

/** Detalhe genérico a partir da vista: cabeçalho, pendências, tabelas (itens), decisão, histórico e ações. */
export function DetalheGenerico({ vista, rota, rotaDaPagina, voltar }: { vista: DetalheVista; rota: string; rotaDaPagina: string; voltar: string }) {
  return (
    <article>
      <p><Link href={voltar}>Voltar para a lista</Link></p>
      <h2>{vista.titulo} {vista.selo && <span className={`selo ${CLASSE_SELO[vista.selo.tom]}`}>{vista.selo.texto}</span>}</h2>
      <dl className="dados">{vista.cabecalho.map((c) => <div key={c.rotulo}><dt>{c.rotulo}</dt><dd>{c.valor || '—'}</dd></div>)}</dl>
      <FaixaPendencias itens={vista.pendencias.map((p) => ({ nivel: p.bloqueante ? 'bloqueante' : 'aceitavel', codigoRn: p.codigoRn, texto: p.texto }))} />
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
      <section>
        <h3>Histórico</h3>
        {vista.historico.length === 0 ? <p className="apoio">Sem eventos.</p> : <ol>{vista.historico.map((e, i) => <li key={i}><span className="num">{e.quando}</span> · {e.texto}</li>)}</ol>}
        <p className="apoio">Horários de Manaus.</p>
      </section>
    </article>
  );
}
