'use client';
/**
 * Adaptadores finos para os componentes visuais do pedido. Hoje desenham HTML simples com as classes do shell; quando o
 * `packages/ui` (designer-ux, docs/design/componentes-pedido.md) publicar tabela densa, faixa de pendências, diálogo de
 * motivo e formulário de itens, só este arquivo troca (as telas genéricas não mudam).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { ColunaVista, ItemFormulario, PendenciaVista } from '@/lib/descritor/tipos';
import type { Opcao } from '@/lib/descritor/fontes';

export function TabelaDensa({ legenda, colunas, linhas, vazio = 'Nada a mostrar.' }: { legenda: string; colunas: readonly ColunaVista[]; linhas: readonly { chave: string; celulas: Readonly<Record<string, ReactNode>> }[]; vazio?: string }) {
  if (linhas.length === 0) return <p className="apoio">{vazio}</p>;
  return (
    <div className="tabela-rolavel">
      <table className="tabela-densa">
        <caption className="so-leitor">{legenda}</caption>
        <thead><tr>{colunas.map((c) => <th key={c.id} scope="col" className={c.numerica ? 'num' : undefined}>{c.rotulo}</th>)}</tr></thead>
        <tbody>{linhas.map((l) => <tr key={l.chave}>{colunas.map((c) => <td key={c.id} className={c.numerica ? 'num' : undefined}>{l.celulas[c.id]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Faixa de pendências: bloqueante (impede aprovar) e aceitável (aprova com justificativa). A cor nunca é o único sinal: vai o texto. */
export function FaixaPendencias({ pendencias }: { pendencias: readonly PendenciaVista[] }) {
  if (pendencias.length === 0) return null;
  return (
    <section aria-label="Pendências do pedido" className="faixa-pendencias">
      <ul>
        {pendencias.map((p, i) => (
          <li key={i} className={p.bloqueante ? 'pendencia-bloqueante' : 'pendencia-aceitavel'}>
            <strong>{p.bloqueante ? 'Bloqueante: ' : 'Aceitável: '}</strong>{p.texto}
            {p.detalhe && <span className="apoio"> {p.detalhe}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SeloStatus({ texto, tom }: { texto: string; tom: 'ok' | 'aviso' | 'erro' | 'neutro' }) {
  return <span className={`selo selo-${tom}`}>{texto}</span>;
}

/** Diálogo modal com o `<dialog>` nativo (foco preso e Esc pelo navegador). */
export function Dialogo({ aberto, titulo, onFechar, children }: { aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} className="dialogo" aria-labelledby="dialogo-titulo" onClose={onFechar}>
      <h2 id="dialogo-titulo">{titulo}</h2>
      {children}
    </dialog>
  );
}

export function SeletorOpcoes({ id, rotulo, valor, opcoes, onChange, vazio = 'Selecione', erro, obrigatorio }: { id: string; rotulo: string; valor: string; opcoes: readonly Opcao[]; onChange: (v: string) => void; vazio?: string; erro?: string; obrigatorio?: boolean }) {
  return (
    <label className="campo" htmlFor={id}>
      <span>{rotulo}{obrigatorio ? ' *' : ''}</span>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined}>
        <option value="">{vazio}</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {erro && <small id={`${id}-erro`} className="erro-campo" role="alert">{erro}</small>}
    </label>
  );
}

/** Formulário de itens (produto, quantidade, preço, desconto): linhas editáveis com "Adicionar" e "Remover". */
export function FormularioItens({ itens, produtos, rotuloProduto, onChange, erros }: { itens: readonly ItemFormulario[]; produtos: readonly Opcao[]; rotuloProduto: string; onChange: (itens: ItemFormulario[]) => void; erros: Readonly<Record<string, string>> }) {
  const trocar = (i: number, campo: keyof ItemFormulario, v: string) => onChange(itens.map((it, j) => (j === i ? { ...it, [campo]: v } : it)));
  return (
    <fieldset className="itens">
      <legend>Itens do pedido</legend>
      {Object.entries(erros).filter(([k]) => k === 'itens' || k.startsWith('itens.')).length > 0 && (
        <ul className="erro" role="alert">{Object.entries(erros).filter(([k]) => k === 'itens' || k.startsWith('itens.')).map(([k, m]) => { const [, n, campo] = k.split('.'); return <li key={k}>{n === undefined ? m : `Item ${Number(n) + 1}${campo ? ` (${campo})` : ''}: ${m}`}</li>; })}</ul>
      )}
      <div className="tabela-rolavel">
        <table className="tabela-densa">
          <thead><tr><th scope="col">{rotuloProduto}</th><th scope="col" className="num">Quantidade</th><th scope="col" className="num">Preço unit. (R$)</th><th scope="col" className="num">Desconto (R$)</th><th scope="col"><span className="so-leitor">Ações</span></th></tr></thead>
          <tbody>
            {itens.map((it, i) => (
              <tr key={i}>
                <td><select aria-label={`${rotuloProduto} do item ${i + 1}`} value={it.produto_id} onChange={(e) => trocar(i, 'produto_id', e.target.value)}><option value="">Selecione</option>{produtos.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}</select></td>
                <td><input className="num" inputMode="decimal" aria-label={`Quantidade do item ${i + 1}`} value={it.quantidade} onChange={(e) => trocar(i, 'quantidade', e.target.value)} /></td>
                <td><input className="num" inputMode="decimal" aria-label={`Preço do item ${i + 1}`} value={it.preco} onChange={(e) => trocar(i, 'preco', e.target.value)} /></td>
                <td><input className="num" inputMode="decimal" aria-label={`Desconto do item ${i + 1}`} value={it.desconto ?? ''} onChange={(e) => trocar(i, 'desconto', e.target.value)} /></td>
                <td><button type="button" className="btn btn-sec" disabled={itens.length === 1} onClick={() => onChange(itens.filter((_, j) => j !== i))}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p><button type="button" className="btn btn-sec" onClick={() => onChange([...itens, { produto_id: '', quantidade: '', preco: '', desconto: '' }])}>Adicionar item</button></p>
    </fieldset>
  );
}
