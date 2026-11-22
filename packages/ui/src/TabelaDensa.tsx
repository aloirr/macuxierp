import { useState, type ReactNode } from 'react';
import { cor, espaco, numerico, texto } from './estilos.js';

export type DirecaoOrdem = 'asc' | 'desc';
export type TipoColuna = 'texto' | 'numero' | 'dinheiro' | 'data' | 'status';

export interface ColunaTabela<T> {
  /** Identificador estável da coluna (também a chave de ordenação). */
  id: string;
  titulo: string;
  /** `numero` e `dinheiro` alinham à direita com algarismos tabulares. */
  tipo?: TipoColuna;
  /** O chamador formata (ex.: centavos em R$). Sem `celula`, usa `String(linha[id])`. */
  celula?: (linha: T) => ReactNode;
  /** Valor usado na ordenação; sem ele a coluna não ordena. Centavos entram como número. */
  valorOrdem?: (linha: T) => string | number;
  largura?: number | string;
}

export interface OrdemTabela {
  colunaId: string;
  direcao: DirecaoOrdem;
}

export interface TabelaDensaProps<T> {
  colunas: ColunaTabela<T>[];
  linhas: T[];
  /** Chave única da linha. */
  chaveLinha: (linha: T) => string;
  /** Linha clicável (também por Enter/Espaço). */
  aoClicarLinha?: (linha: T) => void;
  /** Rótulo acessível da linha clicável (ex.: "Abrir pedido 123"). */
  rotuloLinha?: (linha: T) => string;
  /** Ordem controlada (ex.: vinda da URL). Sem ela, a tabela ordena sozinha. */
  ordem?: OrdemTabela | null;
  aoOrdenar?: (ordem: OrdemTabela) => void;
  /** Texto do estado vazio: o problema e a ação. */
  textoVazio?: string;
  legenda?: string;
}

/** Ordena sem mutar; números por valor, textos em pt-BR. Estável. */
export function ordenarLinhas<T>(linhas: T[], coluna: ColunaTabela<T> | undefined, direcao: DirecaoOrdem): T[] {
  const f = coluna?.valorOrdem;
  if (!f) return [...linhas];
  const sinal = direcao === 'asc' ? 1 : -1;
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const x = f(a.l);
      const y = f(b.l);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
      return c !== 0 ? c * sinal : a.i - b.i;
    })
    .map((p) => p.l);
}

/** Próxima ordem ao clicar no cabeçalho: asc, depois desc, depois asc de novo. */
export function proximaOrdem(atual: OrdemTabela | null | undefined, colunaId: string): OrdemTabela {
  return atual?.colunaId === colunaId && atual.direcao === 'asc' ? { colunaId, direcao: 'desc' } : { colunaId, direcao: 'asc' };
}

const celulaBase = { padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}` } as const;

export function TabelaDensa<T>(props: TabelaDensaProps<T>) {
  const { colunas, linhas, chaveLinha, aoClicarLinha, rotuloLinha, aoOrdenar, textoVazio = 'Nada por aqui ainda.', legenda } = props;
  const [ordemInterna, setOrdemInterna] = useState<OrdemTabela | null>(null);
  const ordem = props.ordem !== undefined ? props.ordem : ordemInterna;
  const visiveis = ordenarLinhas(linhas, colunas.find((c) => c.id === ordem?.colunaId), ordem?.direcao ?? 'asc');
  const direita = (c: ColunaTabela<T>) => c.tipo === 'numero' || c.tipo === 'dinheiro';

  const ordenar = (c: ColunaTabela<T>) => {
    const nova = proximaOrdem(ordem, c.id);
    if (props.ordem === undefined) setOrdemInterna(nova);
    aoOrdenar?.(nova);
  };

  return (
    <table style={{ ...texto('pequeno'), width: '100%', borderCollapse: 'collapse', background: cor('branco') }}>
      {legenda ? <caption style={{ ...texto('pequeno', 'medio'), textAlign: 'left', padding: espaco.sm }}>{legenda}</caption> : null}
      <thead>
        <tr style={{ background: cor('nevoa') }}>
          {colunas.map((c) => {
            const ativa = ordem?.colunaId === c.id;
            const ordenavel = !!c.valorOrdem;
            return (
              <th
                key={c.id}
                scope="col"
                aria-sort={ativa ? (ordem?.direcao === 'asc' ? 'ascending' : 'descending') : ordenavel ? 'none' : undefined}
                style={{ ...celulaBase, ...texto('pequeno', 'cabecalho-tabela'), ...(direita(c) ? numerico : { textAlign: 'left' }), width: c.largura }}
              >
                {ordenavel ? (
                  <button
                    type="button"
                    onClick={() => ordenar(c)}
                    style={{ all: 'unset', cursor: 'pointer', ...texto('pequeno', 'cabecalho-tabela') }}
                  >
                    {c.titulo}
                    {ativa ? (ordem?.direcao === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  c.titulo
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {visiveis.length === 0 ? (
          <tr>
            <td colSpan={colunas.length} style={{ ...celulaBase, textAlign: 'center', color: cor('textoApoio'), padding: espaco.xl }}>
              {textoVazio}
            </td>
          </tr>
        ) : (
          visiveis.map((l) => (
            <tr
              key={chaveLinha(l)}
              tabIndex={aoClicarLinha ? 0 : undefined}
              aria-label={aoClicarLinha ? rotuloLinha?.(l) : undefined}
              onClick={aoClicarLinha ? () => aoClicarLinha(l) : undefined}
              onKeyDown={
                aoClicarLinha
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        aoClicarLinha(l);
                      }
                    }
                  : undefined
              }
              style={{ cursor: aoClicarLinha ? 'pointer' : undefined }}
            >
              {colunas.map((c) => (
                <td key={c.id} style={{ ...celulaBase, ...(direita(c) ? numerico : {}) }}>
                  {c.celula ? c.celula(l) : String((l as Record<string, unknown>)[c.id] ?? '')}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
