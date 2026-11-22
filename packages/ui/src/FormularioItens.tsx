import type { ReactNode } from 'react';
import { cor, espaco, numerico, texto } from './estilos.js';

/** Linha do formulário. Valores monetários em centavos (inteiros). */
export interface ItemLinha {
  /** Chave local da linha (estável durante a edição). */
  chave: string;
  produtoId: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  descontoCentavos: number;
}

export interface SeletorProdutoProps {
  valor: string | null;
  aoEscolher: (produtoId: string | null) => void;
  /** Para aria-label do campo. */
  rotulo: string;
}

export interface FormularioItensProps {
  itens: ItemLinha[];
  aoMudar: (itens: ItemLinha[]) => void;
  /** O chamador injeta o seletor de produto (busca, filtros, dados). */
  renderSeletorProduto: (p: SeletorProdutoProps) => ReactNode;
  /** O chamador formata centavos (ex.: "R$ 1.234,56"). */
  formatarCentavos: (centavos: number) => string;
  /** Total da linha calculado pela regra do módulo; sem ele usa `totalItemCentavos`. */
  calcularTotal?: (item: ItemLinha) => number;
  desabilitado?: boolean;
  /** Mensagem por chave de linha (erro do domínio). */
  erros?: Record<string, string>;
}

/** Total de exibição: round(qtd × preço) − desconto, nunca negativo. A regra oficial é do domínio (RN) e a API revalida. */
export function totalItemCentavos(i: Pick<ItemLinha, 'quantidade' | 'precoUnitarioCentavos' | 'descontoCentavos'>): number {
  return Math.max(0, Math.round(i.quantidade * i.precoUnitarioCentavos) - i.descontoCentavos);
}

export function novoItem(chave: string): ItemLinha {
  return { chave, produtoId: null, quantidade: 1, precoUnitarioCentavos: 0, descontoCentavos: 0 };
}

const inteiro = (v: string) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const decimal = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const campo = { ...texto('pequeno'), border: `1px solid ${cor('bordaCinza')}`, padding: espaco.xs, width: '100%', boxSizing: 'border-box' } as const;

export function FormularioItens(p: FormularioItensProps) {
  const { itens, aoMudar, renderSeletorProduto, formatarCentavos, calcularTotal = totalItemCentavos, desabilitado, erros = {} } = p;
  const mudar = (chave: string, parte: Partial<ItemLinha>) =>
    aoMudar(itens.map((i) => (i.chave === chave ? { ...i, ...parte } : i)));
  const adicionar = () => {
    let n = itens.length + 1;
    while (itens.some((i) => i.chave === `item-${n}`)) n++;
    aoMudar([...itens, novoItem(`item-${n}`)]);
  };
  const th = { ...texto('pequeno', 'cabecalho-tabela'), textAlign: 'left', padding: espaco.xs, background: cor('nevoa') } as const;
  const td = { padding: espaco.xs, borderBottom: `1px solid ${cor('bordaTabela')}`, verticalAlign: 'top' } as const;

  return (
    <div style={{ display: 'grid', gap: espaco.sm }}>
      <table style={{ ...texto('pequeno'), width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Produto</th>
            <th style={{ ...th, ...numerico }}>Qtd.</th>
            <th style={{ ...th, ...numerico }}>Preço unit. (centavos)</th>
            <th style={{ ...th, ...numerico }}>Desconto (centavos)</th>
            <th style={{ ...th, ...numerico }}>Total</th>
            <th style={th}><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {itens.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ ...td, textAlign: 'center', color: cor('textoApoio') }}>Nenhum item. Adicione o primeiro.</td>
            </tr>
          ) : null}
          {itens.map((i, n) => {
            const rotulo = `Item ${n + 1}`;
            const erro = erros[i.chave];
            return (
              <tr key={i.chave}>
                <td style={td}>
                  {renderSeletorProduto({ valor: i.produtoId, aoEscolher: (id) => mudar(i.chave, { produtoId: id }), rotulo: `Produto do ${rotulo.toLowerCase()}` })}
                  {erro ? <div role="alert" style={{ color: cor('erroTexto') }}>{erro}</div> : null}
                </td>
                <td style={td}>
                  <input aria-label={`Quantidade do ${rotulo.toLowerCase()}`} inputMode="decimal" disabled={desabilitado} value={String(i.quantidade)} onChange={(e) => mudar(i.chave, { quantidade: decimal(e.target.value) })} style={{ ...campo, ...numerico }} />
                </td>
                <td style={td}>
                  <input aria-label={`Preço unitário do ${rotulo.toLowerCase()}`} inputMode="numeric" disabled={desabilitado} value={String(i.precoUnitarioCentavos)} onChange={(e) => mudar(i.chave, { precoUnitarioCentavos: inteiro(e.target.value) })} style={{ ...campo, ...numerico }} />
                </td>
                <td style={td}>
                  <input aria-label={`Desconto do ${rotulo.toLowerCase()}`} inputMode="numeric" disabled={desabilitado} value={String(i.descontoCentavos)} onChange={(e) => mudar(i.chave, { descontoCentavos: inteiro(e.target.value) })} style={{ ...campo, ...numerico }} />
                </td>
                <td style={{ ...td, ...numerico }}>{formatarCentavos(calcularTotal(i))}</td>
                <td style={td}>
                  <button type="button" disabled={desabilitado} aria-label={`Remover ${rotulo.toLowerCase()}`} onClick={() => aoMudar(itens.filter((x) => x.chave !== i.chave))} style={{ ...texto('pequeno'), cursor: 'pointer', color: cor('erroTexto'), background: cor('branco'), border: `1px solid ${cor('bordaCinza')}` }}>
                    Remover
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <button type="button" disabled={desabilitado} onClick={adicionar} style={{ ...texto('pequeno', 'medio'), cursor: 'pointer', padding: `${espaco.xs}px ${espaco.md}px`, background: cor('branco'), border: `1px solid ${cor('bordaCinza')}` }}>
          Adicionar item
        </button>
      </div>
    </div>
  );
}
