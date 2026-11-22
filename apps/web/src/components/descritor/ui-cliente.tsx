'use client';
/**
 * Fronteira cliente dos componentes do `@macuxierp/ui` (usam estado e foco): as telas de servidor importam daqui, com props só de
 * dados serializáveis. O desenho é do pacote (docs/design/componentes-pedido.md); aqui só se mapeia a vista do descritor.
 */
import { useRouter } from 'next/navigation';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import type { AcaoVista, ColunaVista, SeloVista } from '@/lib/descritor/tipos';
import { AcoesDetalhe } from './acoes-detalhe';

export { FaixaPendencias } from '@macuxierp/ui';

/** Os tons `ok` e `neutro` usam as classes do selo ativo e inativo (mesma marca). */
const CLASSE_SELO = { ok: 'selo-ativo', neutro: 'selo-inativo', aviso: 'selo-aviso', erro: 'selo-erro' } as const;

/** Selo com dica (tooltip nativo, `title`); a dica não é a única fonte da informação: o texto do selo já diz o essencial. */
export function Selo({ selo }: { selo: SeloVista }) {
  return <span className={`selo ${CLASSE_SELO[selo.tom]}`} title={selo.dica}>{selo.texto}</span>;
}

interface LinhaDados {
  chave: string;
  celulas: Readonly<Record<string, string>>;
  /** Selos por coluna; a coluna sem selo mostra o texto de `celulas`. */
  selos?: Readonly<Record<string, readonly SeloVista[]>>;
  /** Rota ao clicar na linha (lista); ausente = linha sem clique. */
  destino?: string;
  rotulo?: string;
  /** Ação da linha (ex.: "Emitir nota"); a coluna "Ações" só existe se alguma linha tem. */
  acao?: AcaoVista;
}

/** Tabela densa da ui com linhas em texto. Linha com `destino` abre a rota (mouse, Enter e Espaço). */
export function TabelaVista({ colunas, linhas, vazio, acoes }: { colunas: readonly ColunaVista[]; linhas: readonly LinhaDados[]; vazio: string; acoes?: { rota: string; rotaDaPagina: string } }) {
  const router = useRouter();
  const cols: ColunaTabela<LinhaDados>[] = colunas.map((c) => ({ id: c.id, titulo: c.rotulo, tipo: c.tipo ?? (c.numerica ? 'numero' : 'texto'), ...(c.largura ? { largura: c.largura } : {}), celula: (l) => { const x = l.selos?.[c.id]; return x && x.length > 0 ? <span className="selos">{x.map((v) => <Selo key={v.texto} selo={v} />)}</span> : (l.celulas[c.id] ?? ''); } }));
  if (acoes && linhas.some((l) => l.acao)) {
    cols.push({ id: '__acoes', titulo: 'Ações', celula: (l) => (l.acao ? <AcoesDetalhe acoes={[l.acao]} rota={acoes.rota} rotaDaPagina={acoes.rotaDaPagina} origem="linha" compacta /> : null) });
  }
  const clicavel = linhas.some((l) => l.destino);
  return (
    <TabelaDensa
      colunas={cols}
      linhas={[...linhas]}
      chaveLinha={(l) => l.chave}
      textoVazio={vazio}
      {...(clicavel ? { aoClicarLinha: (l: LinhaDados) => l.destino && router.push(l.destino), rotuloLinha: (l: LinhaDados) => l.rotulo ?? 'Abrir' } : {})}
    />
  );
}
