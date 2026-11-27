import type { ReactNode } from 'react';
import { SeloTom } from '@/components/selo-tom';
import type { FichaLigacao, Ligacao } from '@/lib/config/ligacoes';

/** Título "De → Para" (docs/design/integracao-duas-ligacoes): a seta é só visual; o leitor ouve "De para o/a Para". */
export function TituloLigacao({ ligacao, id, nivel = 'h2' }: { ligacao: Ligacao; id: string; nivel?: 'h2' | 'h3' }) {
  const Nivel = nivel;
  return (
    <Nivel id={id}>
      {ligacao.de.nome} <span className="seta" aria-hidden="true">→</span>
      <span className="sr-only"> para {ligacao.para.artigo} </span> {ligacao.para.nome}
    </Nivel>
  );
}

/** A ficha única da ligação: Situação (selo com texto, apoio embaixo), Último contato, Código, Chave e, na saída, Ambiente e Ligado a. */
export function FichaDaLigacao({ ficha, rotulo }: { ficha: FichaLigacao; rotulo: string }) {
  return (
    <dl className="ficha" aria-label={rotulo}>
      <div>
        <dt>Situação</dt>
        <dd>
          <SeloTom tom={ficha.situacao.tom}>{ficha.situacao.texto}</SeloTom>
          {ficha.apoio.map((a) => <span key={a} className="apoio apoio-situacao">{a}</span>)}
        </dd>
      </div>
      <div><dt>Último contato</dt><dd>{ficha.ultimoContato}</dd></div>
      {ficha.ligadoA && <div><dt>Ligado a</dt><dd>{ficha.ligadoA}</dd></div>}
      <div><dt>Código</dt><dd className="codigo">{ficha.codigo}</dd></div>
      <div><dt>Chave</dt><dd className="codigo">{ficha.chave}</dd></div>
      {ficha.ambiente && <div><dt>Ambiente</dt><dd>{ficha.ambiente}</dd></div>}
    </dl>
  );
}

/** Cartão de uma ligação: `section.bloco.ligacao` com o título montado. */
export function CartaoLigacao({ ligacao, children }: { ligacao: Ligacao; children: ReactNode }) {
  const id = `h-ligacao-${ligacao.id}`;
  return (
    <section className="bloco ligacao" aria-labelledby={id}>
      <TituloLigacao ligacao={ligacao} id={id} />
      {children}
    </section>
  );
}
