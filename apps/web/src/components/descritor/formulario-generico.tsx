'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Opcao } from '@/lib/descritor/fontes';
import { ITEM_VAZIO, novaChaveIdempotencia, temErros } from '@/lib/descritor/formulario';
import { telaFormulario } from '@/lib/telas';
import type { ErrosFormulario, ItemFormulario, TelaFormulario, ValoresFormulario } from '@/lib/descritor/tipos';
import { escrever } from '@/app/(shell)/[modulo]/[...pagina]/acoes';
import { FormularioItens, SeletorOpcoes } from './adaptadores';

/** Formulário genérico: campos do descritor, seletores lidos do cadastros (opções vêm do servidor) e itens. A API revalida. */
export function FormularioGenerico({ rota, opcoes, produtos }: { rota: string; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[] }) {
  const tela = telaFormulario(rota);
  return tela ? <Formulario tela={tela} opcoes={opcoes} produtos={produtos} /> : <p className="erro" role="alert">Formulário não encontrado.</p>;
}

function Formulario({ tela, opcoes, produtos }: { tela: TelaFormulario; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[] }) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresFormulario>({});
  const [itens, setItens] = useState<ItemFormulario[]>([{ ...ITEM_VAZIO }]);
  const [erros, setErros] = useState<ErrosFormulario>({});
  const [geral, setGeral] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef(novaChaveIdempotencia()); // uma Idempotency-Key por formulário aberto: reenvio não duplica

  const trocar = (nome: string, v: string) => setValores((x) => ({ ...x, [nome]: v }));

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setGeral('');
    const e = tela.validar(valores, itens);
    setErros(e);
    if (temErros(e)) return;
    setOcupado(true);
    const r = await escrever({ metodo: 'POST', caminho: tela.api, corpo: tela.montar(valores, itens), idempotencia: chave.current });
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
            {c.tipo === 'area' ? <textarea id={id} rows={3} value={valores[c.nome] ?? ''} onChange={(e) => trocar(c.nome, e.target.value)} /> : <input id={id} type={c.tipo === 'data' ? 'date' : 'text'} inputMode={c.tipo === 'numero' ? 'decimal' : undefined} value={valores[c.nome] ?? ''} onChange={(e) => trocar(c.nome, e.target.value)} aria-invalid={erros[c.nome] ? true : undefined} />}
            {c.ajuda && <small className="apoio">{c.ajuda}</small>}
            {erros[c.nome] && <small className="erro-campo" role="alert">{erros[c.nome]}</small>}
          </label>
        );
      })}
      {tela.itens && <FormularioItens itens={itens} produtos={produtos} rotuloProduto={tela.itens.rotuloProduto} onChange={setItens} erros={erros} />}
      <div className="barra-acoes">
        <button className="btn" type="submit" disabled={ocupado}>{ocupado ? 'Enviando…' : tela.enviar}</button>
        <Link className="btn btn-sec" href={tela.voltar}>Cancelar</Link>
      </div>
    </form>
  );
}
