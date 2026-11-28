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

/**
 * A ficha da ligação na grade da simulação aprovada (445e459): Código, Ambiente (só na saída), Último contato e Chave, lado a lado; o
 * destino da saída ("Macuxi FDV") entra como valor. A Situação vai para o selo na linha do título (`SeloDaLigacao`); o apoio fica abaixo.
 */
export function FichaDaLigacao({ ficha, rotulo }: { ficha: FichaLigacao; rotulo: string }) {
  return (
    <>
      <dl className="ficha" aria-label={rotulo}>
        <div><dt>Código</dt><dd className="codigo">{ficha.codigo}</dd></div>
        {ficha.ambiente && <div><dt>Ambiente</dt><dd>{ficha.ambiente}</dd></div>}
        {ficha.ligadoA && <div><dt>Ligado a</dt><dd>{ficha.ligadoA}</dd></div>}
        <div><dt>Último contato</dt><dd>{ficha.ultimoContato}</dd></div>
        <div><dt>Chave</dt><dd className="codigo">{ficha.chave}</dd></div>
      </dl>
      {ficha.apoio.map((a) => <p key={a} className="apoio apoio-situacao">{a}</p>)}
    </>
  );
}

/** Situação da ligação: selo com texto (a cor nunca fala sozinha), à direita do título. Sem chave, não há selo. */
export function SeloDaLigacao({ ficha }: { ficha: FichaLigacao | null }) {
  return ficha ? <SeloTom tom={ficha.situacao.tom}>{ficha.situacao.texto}</SeloTom> : null;
}

/** Cartão de uma ligação: título e selo numa linha, depois o cartão com a ficha, a tabela e UMA barra de botões (regra 12). */
export function CartaoLigacao({ ligacao, ficha = null, children }: { ligacao: Ligacao; ficha?: FichaLigacao | null; children: ReactNode }) {
  const id = `h-ligacao-${ligacao.id}`;
  return (
    <section className="bloco ligacao" aria-labelledby={id}>
      <div className="cabeca-ligacao">
        <TituloLigacao ligacao={ligacao} id={id} />
        <SeloDaLigacao ficha={ficha} />
      </div>
      <div className="cartao-ligacao">{children}</div>
    </section>
  );
}
