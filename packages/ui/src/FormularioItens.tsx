import { useId, useState, type ReactNode } from 'react';
import { botaoSecundario, campoBase, cor, desabilitadoEstilo, espaco, mensagemErro, numerico, tabela } from './estilos.js';
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
  /** O formulário está desabilitado: o seletor não deve aceitar escolha. */
  desabilitado?: boolean;
  /** Id da mensagem de erro do produto, se houver: o chamador liga ao seu campo por `aria-describedby`. */
  idErro?: string;
}

/** Erros por campo de uma linha. */
export type ErrosItem = { produtoId?: string; quantidade?: string; precoUnitarioCentavos?: string; descontoCentavos?: string };

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
  /** Erro do domínio por chave de linha: texto (aparece abaixo do seletor de produto) ou um erro por campo, abaixo de cada um. */
  erros?: Record<string, string | ErrosItem>;
  /** Legenda da tabela (`<caption>`), ex.: "Itens do pedido". */
  legenda?: string;
}

const campo = { ...campoBase, minWidth: 0, width: '100%', boxSizing: 'border-box' } as const;

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
  /** Mensagem abaixo do campo quando o texto não é válido: o problema e a ação. */
  mensagemInvalido: string;
  /** Erro vindo de fora (domínio); o texto inválido local tem prioridade. */
  erro?: string;
}

/** Mantém o texto digitado localmente ("1,5", "1." ) e só publica quando é válido. */
function CampoNumerico(p: CampoProps) {
  const [t, setT] = useState(() => p.paraTexto(p.valor));
  const [invalido, setInvalido] = useState(false);
  // Valor mudou por fora (ex.: linha reaproveitada): ressincroniza.
  const atual = p.paraValor(t);
  if (!invalido && atual !== null && atual !== p.valor) setT(p.paraTexto(p.valor));
  const idErro = useId();
  const mensagem = invalido ? p.mensagemInvalido : p.erro;
  return (
    <div>
      <input
        aria-label={p.rotulo}
        aria-invalid={mensagem ? true : undefined}
        aria-describedby={mensagem ? idErro : undefined}
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
        style={{ ...campo, ...numerico, ...(p.desabilitado ? { ...desabilitadoEstilo(true), background: cor('nevoa') } : {}), ...(mensagem ? { borderColor: cor('erroTexto') } : {}) }}
      />
      {mensagem ? <div id={idErro} role="alert" style={mensagemErro}>{mensagem}</div> : null}
    </div>
  );
}

const thNum = (largura: number, titulo: string) => <th style={{ ...tabela.cabecalho, ...numerico, width: largura }}>{titulo}</th>;

export function FormularioItens<T extends ItemLinha = ItemLinha>(p: FormularioItensProps<T>) {
  const { itens, aoMudar, novoItem, renderSeletorProduto, formatarCentavos, calcularTotal, desabilitado, erros = {}, legenda } = p;
  const base = useId();
  const mudar = (chave: string, parte: Partial<ItemLinha>) =>
    aoMudar(itens.map((i) => (i.chave === chave ? ({ ...i, ...parte } as T) : i)));
  const adicionar = () => {
    let n = itens.length + 1;
    while (itens.some((i) => i.chave === `item-${n}`)) n++;
    aoMudar([...itens, novoItem(`item-${n}`)]);
  };

  return (
    <div style={{ display: 'grid', gap: espaco.sm }}>
      <table style={tabela.raiz}>
        {legenda ? <caption style={tabela.legenda}>{legenda}</caption> : null}
        <thead>
          <tr>
            <th style={tabela.cabecalho}>Produto</th>
            {thNum(88, 'Qtd.')}
            {thNum(120, 'Preço unit. (R$)')}
            {thNum(120, 'Desconto (R$)')}
            {thNum(120, 'Total')}
            <th style={tabela.cabecalho}><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {itens.length === 0 ? (
            <tr>
              <td colSpan={6} style={tabela.vazio}>Nenhum item. Adicione o primeiro.</td>
            </tr>
          ) : null}
          {itens.map((i, n) => {
            const item = `item ${n + 1}`;
            const bruto = erros[i.chave];
            const e: ErrosItem = typeof bruto === 'string' ? { produtoId: bruto } : (bruto ?? {});
            const idProduto = `${base}-${i.chave}-produto`;
            return (
              <tr key={i.chave}>
                <td style={tabela.celula}>
                  {renderSeletorProduto({ valor: i.produtoId, aoEscolher: (id) => mudar(i.chave, { produtoId: id }), rotulo: `Produto do ${item}`, desabilitado, idErro: e.produtoId ? idProduto : undefined })}
                  {e.produtoId ? <div id={idProduto} role="alert" style={mensagemErro}>{e.produtoId}</div> : null}
                </td>
                <td style={tabela.celula}>
                  <CampoNumerico rotulo={`Quantidade do ${item}`} inputMode="decimal" mensagemInvalido="Quantidade inválida. Use só números, até 4 casas, ex.: 1,5." desabilitado={desabilitado} erro={e.quantidade} valor={i.quantidade} paraTexto={String} paraValor={textoParaQuantidade} aoValor={(v) => mudar(i.chave, { quantidade: v })} />
                </td>
                <td style={tabela.celula}>
                  <CampoNumerico rotulo={`Preço unitário do ${item}`} inputMode="decimal" mensagemInvalido="Preço inválido. Digite em reais, ex.: 12,50." desabilitado={desabilitado} erro={e.precoUnitarioCentavos} valor={i.precoUnitarioCentavos} paraTexto={centavosParaReais} paraValor={reaisParaCentavos} aoValor={(v) => mudar(i.chave, { precoUnitarioCentavos: v })} />
                </td>
                <td style={tabela.celula}>
                  <CampoNumerico rotulo={`Desconto do ${item}`} inputMode="decimal" mensagemInvalido="Desconto inválido. Digite em reais, ex.: 5,00." desabilitado={desabilitado} erro={e.descontoCentavos} valor={i.descontoCentavos} paraTexto={centavosParaReais} paraValor={reaisParaCentavos} aoValor={(v) => mudar(i.chave, { descontoCentavos: v })} />
                </td>
                <td style={{ ...tabela.celula, ...tabela.celulaNumerica }}>{formatarCentavos(calcularTotal(i))}</td>
                <td style={tabela.celula}>
                  <button type="button" disabled={desabilitado} aria-label={`Remover ${item}`} onClick={() => aoMudar(itens.filter((x) => x.chave !== i.chave))} style={botaoSecundario(desabilitado)}>
                    Remover
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <button type="button" disabled={desabilitado} onClick={adicionar} style={botaoSecundario(desabilitado)}>
          Adicionar item
        </button>
      </div>
    </div>
  );
}
