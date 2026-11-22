import { useState, type ReactNode } from 'react';
import { cor, espaco, numerico, texto } from './estilos.js';
import { centavosParaReais, reaisParaCentavos, textoParaQuantidade } from './entradas.js';

/** Linha mínima do formulário. Valores monetários em centavos (inteiros). O módulo pode estender com campos próprios. */
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

export interface FormularioItensProps<T extends ItemLinha = ItemLinha> {
  itens: T[];
  aoMudar: (itens: T[]) => void;
  /** Cria uma linha vazia com a chave dada (o módulo conhece o formato da sua linha). */
  novoItem: (chave: string) => T;
  /** O chamador injeta o seletor de produto (busca, filtros, dados). */
  renderSeletorProduto: (p: SeletorProdutoProps) => ReactNode;
  /** O chamador formata centavos (ex.: "R$ 1.234,56"). */
  formatarCentavos: (centavos: number) => string;
  /** Total da linha pela regra do módulo (a API revalida). */
  calcularTotal: (item: T) => number;
  desabilitado?: boolean;
  /** Mensagem por chave de linha (erro do domínio). */
  erros?: Record<string, string>;
}

const campo = { ...texto('pequeno'), border: `1px solid ${cor('bordaCinza')}`, padding: espaco.xs, width: '100%', boxSizing: 'border-box' } as const;

interface CampoProps {
  rotulo: string;
  desabilitado?: boolean;
  /** Valor vindo do estado do chamador. */
  valor: number;
  paraTexto: (v: number) => string;
  /** Texto para valor; null se inválido. */
  paraValor: (t: string) => number | null;
  aoValor: (v: number) => void;
  inputMode: 'decimal' | 'numeric';
}

/** Mantém o texto digitado localmente ("1,5", "1." ) e só publica quando é válido. */
function CampoNumerico(p: CampoProps) {
  const [t, setT] = useState(() => p.paraTexto(p.valor));
  const [invalido, setInvalido] = useState(false);
  // Valor mudou por fora (ex.: linha reaproveitada): ressincroniza.
  const atual = p.paraValor(t);
  if (!invalido && atual !== null && atual !== p.valor) setT(p.paraTexto(p.valor));
  return (
    <input
      aria-label={p.rotulo}
      aria-invalid={invalido ? true : undefined}
      inputMode={p.inputMode}
      disabled={p.desabilitado}
      value={t}
      onChange={(e) => {
        const novo = e.target.value;
        setT(novo);
        const v = p.paraValor(novo);
        setInvalido(v === null);
        if (v !== null) p.aoValor(v);
      }}
      style={{ ...campo, ...numerico, ...(invalido ? { borderColor: cor('erroTexto') } : {}) }}
    />
  );
}

export function FormularioItens<T extends ItemLinha = ItemLinha>(p: FormularioItensProps<T>) {
  const { itens, aoMudar, novoItem, renderSeletorProduto, formatarCentavos, calcularTotal, desabilitado, erros = {} } = p;
  const mudar = (chave: string, parte: Partial<ItemLinha>) =>
    aoMudar(itens.map((i) => (i.chave === chave ? ({ ...i, ...parte } as T) : i)));
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
            <th style={{ ...th, ...numerico }}>Preço unit. (R$)</th>
            <th style={{ ...th, ...numerico }}>Desconto (R$)</th>
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
                  <CampoNumerico rotulo={`Quantidade do ${rotulo.toLowerCase()}`} inputMode="decimal" desabilitado={desabilitado} valor={i.quantidade} paraTexto={String} paraValor={textoParaQuantidade} aoValor={(v) => mudar(i.chave, { quantidade: v })} />
                </td>
                <td style={td}>
                  <CampoNumerico rotulo={`Preço unitário do ${rotulo.toLowerCase()}`} inputMode="decimal" desabilitado={desabilitado} valor={i.precoUnitarioCentavos} paraTexto={centavosParaReais} paraValor={reaisParaCentavos} aoValor={(v) => mudar(i.chave, { precoUnitarioCentavos: v })} />
                </td>
                <td style={td}>
                  <CampoNumerico rotulo={`Desconto do ${rotulo.toLowerCase()}`} inputMode="decimal" desabilitado={desabilitado} valor={i.descontoCentavos} paraTexto={centavosParaReais} paraValor={reaisParaCentavos} aoValor={(v) => mudar(i.chave, { descontoCentavos: v })} />
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
