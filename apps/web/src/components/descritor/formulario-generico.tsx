'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Opcao } from '@/lib/descritor/fontes';
import { FormularioItens, type ItemLinha } from '@macuxierp/ui';
import { temErros } from '@/lib/descritor/formulario';
import { aposResposta, chaveParaEnvio, novoEstado, type EstadoChave } from '@/lib/descritor/idempotencia';
import { telaFormulario } from '@/lib/telas';
import type { ErrosFormulario, TelaFormulario, ValoresFormulario } from '@/lib/descritor/tipos';
import { escrever } from '@/app/(shell)/[modulo]/[...pagina]/acoes';

/** Seletor de opções (cadastro ou lista fixa) com o estilo de campo. */
function SeletorOpcoes({ id, rotulo, valor, opcoes, onChange, erro, obrigatorio }: { id: string; rotulo: string; valor: string; opcoes: readonly Opcao[]; onChange: (v: string) => void; erro?: string; obrigatorio?: boolean }) {
  return (
    <label className="campo" htmlFor={id}>
      <span>{rotulo}{obrigatorio ? ' *' : ''}</span>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined}>
        <option value="">Selecione</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {erro && <small id={`${id}-erro`} className="erro-campo" role="alert">{erro}</small>}
    </label>
  );
}

/** Formulário genérico: campos do descritor, seletores lidos do cadastros (opções vêm do servidor) e itens. A API revalida. */
export function FormularioGenerico({ rota, opcoes, produtos }: { rota: string; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[] }) {
  const tela = telaFormulario(rota);
  return tela ? <Formulario tela={tela} opcoes={opcoes} produtos={produtos} /> : <p className="erro" role="alert">Formulário não encontrado.</p>;
}

function Formulario({ tela, opcoes, produtos }: { tela: TelaFormulario; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[] }) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresFormulario>({});
  const [itens, setItens] = useState<ItemLinha[]>(() => (tela.itens ? [tela.itens.novoItem('item-1')] : []));
  const [erros, setErros] = useState<ErrosFormulario>({});
  const [geral, setGeral] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef<EstadoChave | null>(null); // uma Idempotency-Key por formulário aberto: reenvio do mesmo corpo não duplica

  const trocar = (nome: string, v: string) => setValores((x) => ({ ...x, [nome]: v }));

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setGeral('');
    const linhas = itens.map((i) => tela.itens?.paraTexto(i) ?? { produto_id: '', quantidade: '', preco: '' });
    const e = tela.validar(valores, linhas);
    setErros(e);
    if (temErros(e)) return;
    setOcupado(true);
    const corpo = tela.montar(valores, linhas);
    const estado = chaveParaEnvio(chave.current ?? novoEstado(tela.novaChave), corpo, tela.novaChave);
    chave.current = estado;
    const r = await escrever({ metodo: 'POST', caminho: tela.api, corpo, idempotencia: estado.chave });
    chave.current = aposResposta(estado, Boolean(r.definitivo));
    setOcupado(false);
    if (r.ok && r.id) return router.push(tela.depois(r.id));
    if (r.ok) return router.push(tela.voltar);
    setErros(r.campos ?? {});
    setGeral(r.mensagem);
  }

  return (
    <form className="formulario" onSubmit={(ev) => void enviar(ev)} noValidate aria-busy={ocupado}>
      {geral && <p className="erro" role="alert">{geral}</p>}
      {tela.campos.map((c) => {
        const id = `campo-${c.nome}`;
        if (c.tipo === 'cadastro' || c.tipo === 'selecao') {
          const lista = c.tipo === 'cadastro' ? (opcoes[c.nome] ?? []) : (c.opcoes ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo }));
          return <SeletorOpcoes key={c.nome} id={id} rotulo={c.rotulo} valor={valores[c.nome] ?? ''} opcoes={lista} onChange={(v) => trocar(c.nome, v)} erro={erros[c.nome]} obrigatorio={c.obrigatorio} />;
        }
        return (
          <label key={c.nome} className="campo" htmlFor={id}>
            <span>{c.rotulo}{c.obrigatorio ? ' *' : ''}</span>
            {c.tipo === 'area' ? <textarea id={id} rows={3} value={valores[c.nome] ?? ''} onChange={(e) => trocar(c.nome, e.target.value)} /> : <input id={id} type={c.tipo === 'data' ? 'date' : 'text'} lang="pt-BR" inputMode={c.tipo === 'numero' ? 'decimal' : undefined} value={valores[c.nome] ?? ''} onChange={(e) => trocar(c.nome, e.target.value)} aria-invalid={erros[c.nome] ? true : undefined} />}
            {c.ajuda && <small className="apoio">{c.ajuda}</small>}
            {erros[c.nome] && <small className="erro-campo" role="alert">{erros[c.nome]}</small>}
          </label>
        );
      })}
      {tela.itens && <Itens tela={tela.itens} itens={itens} produtos={produtos} onChange={setItens} erros={erros} />}
      <div className="barra-acoes">
        <button className="btn" type="submit" disabled={ocupado}>{ocupado ? 'Enviando…' : tela.enviar}</button>
        <Link className="btn btn-sec" href={tela.voltar}>Cancelar</Link>
      </div>
    </form>
  );
}

/** Itens do pedido na `FormularioItens` da ui: erros do módulo (`itens.N.campo`) viram mensagem da linha. */
function Itens({ tela, itens, produtos, onChange, erros }: { tela: NonNullable<TelaFormulario['itens']>; itens: ItemLinha[]; produtos: readonly Opcao[]; onChange: (i: ItemLinha[]) => void; erros: ErrosFormulario }) {
  const porLinha: Record<string, string> = {};
  for (const [k, m] of Object.entries(erros)) {
    const n = /^itens\.(\d+)\./.exec(k)?.[1];
    const linha = n === undefined ? undefined : itens[Number(n)];
    if (linha) porLinha[linha.chave] = porLinha[linha.chave] ? `${porLinha[linha.chave]}; ${m}` : m;
  }
  for (const l of itens) {
    const e = tela.erroItem?.(l);
    if (e) porLinha[l.chave] = porLinha[l.chave] ? `${porLinha[l.chave]}; ${e}` : e;
  }
  return (
    <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
      <legend>Itens do pedido</legend>
      {erros.itens && <p className="erro" role="alert">{erros.itens}</p>}
      <FormularioItens
        itens={itens}
        aoMudar={onChange}
        novoItem={tela.novoItem}
        calcularTotal={tela.calcularTotal}
        formatarCentavos={tela.formatarCentavos}
        erros={porLinha}
        renderSeletorProduto={({ valor, aoEscolher, rotulo, desabilitado }) => (
          <select className="entrada" aria-label={rotulo} disabled={desabilitado} value={valor ?? ''} onChange={(e) => aoEscolher(e.target.value || null)}>
            <option value="">Selecione</option>
            {produtos.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
          </select>
        )}
      />
    </fieldset>
  );
}
