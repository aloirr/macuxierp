'use client';
/**
 * Fronteira cliente dos componentes do `@macuxierp/ui` (usam estado e foco): as telas de servidor importam daqui, com props só de
 * dados serializáveis. O desenho é do pacote (docs/design/componentes-pedido.md); aqui só se mapeia a vista do descritor.
 */
import { useRouter } from 'next/navigation';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import type { ColunaVista } from '@/lib/descritor/tipos';

export { FaixaPendencias } from '@macuxierp/ui';

interface LinhaDados {
  chave: string;
  celulas: Readonly<Record<string, string>>;
  /** Rota ao clicar na linha (lista); ausente = linha sem clique. */
  destino?: string;
  rotulo?: string;
}

/** Tabela densa da ui com linhas em texto. Linha com `destino` abre a rota (mouse, Enter e Espaço). */
export function TabelaVista({ colunas, linhas, vazio }: { colunas: readonly ColunaVista[]; linhas: readonly LinhaDados[]; vazio: string }) {
  const router = useRouter();
  const cols: ColunaTabela<LinhaDados>[] = colunas.map((c) => ({ id: c.id, titulo: c.rotulo, tipo: c.numerica ? 'numero' : 'texto', celula: (l) => l.celulas[c.id] ?? '' }));
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
