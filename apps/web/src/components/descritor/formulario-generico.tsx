'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Opcao } from '@/lib/descritor/fontes';
import { FormularioItens, RegiaoErros, ResultadoAcao, useResultado, type ItemLinha } from '@macuxierp/ui';
import { resultadoErro } from '@/lib/resultado-acao';
import { temErros } from '@/lib/descritor/formulario';
import { aposResposta, chaveParaEnvio, novoEstado, type EstadoChave } from '@/lib/descritor/idempotencia';
import { telaFormulario } from '@/lib/telas';
import type { Perfil } from '@macuxierp/platform-sdk';
import type { CampoFormulario, ErrosFormulario, TelaFormulario, ValoresFormulario } from '@/lib/descritor/tipos';
import { PainelSegredo } from './painel-segredo';
import { escrever } from '@/lib/acoes-cliente';

/** Largura do campo na grade de 12 colunas do formulário (regra 11): curto (2), médio (4), longo (6, padrão) ou largo (12). */
export function larguraDoCampo(c: { nome: string; tipo: string }): string {
  if (c.tipo === 'area') return ' campo-largo';
  if (c.tipo === 'data' || c.tipo === 'numero' || /(^|_)(codigo|uf|cep|telefone|numero|serie|ncm|cfop|quantidade|preco|latitude|longitude|municipio_ibge)(_|$)/.test(c.nome)) return ' campo-curto';
  if (c.tipo === 'cadastro' || c.tipo === 'selecao') return ' campo-medio';
  if (/(observacao|endereco|logradouro|descricao)/.test(c.nome)) return ' campo-largo';
  return '';
}

/** Seletor de opções (cadastro ou lista fixa) com o estilo de campo. */
function SeletorOpcoes({ id, rotulo, largura = '', valor, opcoes, onChange, erro, obrigatorio }: { id: string; rotulo: string; largura?: string; valor: string; opcoes: readonly Opcao[]; onChange: (v: string) => void; erro?: string; obrigatorio?: boolean }) {
  return (
    <label className={`campo${largura}`} htmlFor={id}>
      <span>{rotulo}{obrigatorio ? ' *' : ''}</span>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined}>
        <option value="">Selecione</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {erro && <span id={`${id}-erro`} className="erro-campo">{erro}</span>}
    </label>
  );
}

/** Formulário genérico: campos do descritor, seletores lidos do cadastros (opções vêm do servidor) e itens. A API revalida. */
export function FormularioGenerico({ rota, opcoes, produtos, errosIniciais, perfil, campos, aberto }: { rota: string; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[]; errosIniciais?: ErrosFormulario; perfil?: Perfil; campos?: readonly CampoFormulario[]; aberto?: Aberto }) {
  const tela = telaFormulario(rota);
  return tela ? <Formulario tela={tela} opcoes={opcoes} produtos={produtos} errosIniciais={errosIniciais} perfil={perfil} campos={perfil && tela.camposDoPerfil ? tela.camposDoPerfil(perfil) : (campos ?? tela.campos)} aberto={aberto} /> : <p className="erro" role="alert">Formulário não encontrado.</p>;
}

/** Registro aberto na edição: valores iniciais, o original (para o diff do PATCH) e o id. */
export interface Aberto { valores: ValoresFormulario; original: unknown; id: string }

function Formulario({ tela, opcoes, produtos, errosIniciais, perfil, campos, aberto }: { tela: TelaFormulario; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[]; errosIniciais?: ErrosFormulario; perfil?: Perfil; campos: readonly CampoFormulario[]; aberto?: Aberto }) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresFormulario>(aberto?.valores ?? {});
  const [itens, setItens] = useState<ItemLinha[]>(() => (tela.itens ? [tela.itens.novoItem('item-1')] : []));
  const [erros, setErros] = useState<ErrosFormulario>(errosIniciais ?? {});
  const [resultado, chaveResultado, mostrar, limpar] = useResultado();
  const [ocupado, setOcupado] = useState(false);
  const [segredo, setSegredo] = useState<{ valor: string; destino: string } | null>(null);
  const chave = useRef<EstadoChave | null>(null); // uma Idempotency-Key por formulário aberto: reenvio do mesmo corpo não duplica

  const foraDosItens = Object.keys(erros).some((k) => !k.startsWith('itens.'));
  const trocar = (nome: string, v: string) => setValores((x) => ({ ...x, [nome]: v }));

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    limpar();
    const linhas = itens.map((i) => tela.itens?.paraTexto(i) ?? { produto_id: '', quantidade: '', preco: '' });
    const e = tela.validar(valores, linhas, perfil);
    setErros(e);
    if (temErros(e)) return;
    // Edição: só o que mudou vai no PATCH; sem mudança não há o que enviar.
    const patch = tela.edicao && aberto && perfil ? tela.edicao.montarPatch(valores, aberto.original, perfil) : undefined;
    if (tela.edicao && patch === null) return mostrar(resultadoErro('Nada foi alterado.'));
    setOcupado(true);
    const corpo = tela.edicao ? patch : tela.montar(valores, linhas, perfil);
    const estado = chaveParaEnvio(chave.current ?? novoEstado(tela.novaChave), corpo, tela.novaChave);
    chave.current = estado;
    const r = await escrever({ metodo: tela.edicao && aberto ? 'PATCH' : 'POST', caminho: tela.edicao && aberto ? `${tela.api}/${aberto.id}` : tela.api, corpo, idempotencia: estado.chave });
    chave.current = aposResposta(estado, Boolean(r.definitivo));
    setOcupado(false);
    // Senha provisória (RN-CORE-10): aparece uma vez; a tela só segue depois que a pessoa a anotar.
    if (r.ok && r.segredo) return setSegredo({ valor: r.segredo, destino: r.id ? tela.depois(r.id) : tela.voltar });
    if (r.ok && r.id) return router.push(tela.depois(r.id));
    if (r.ok) return router.push(tela.voltar);
    setErros(r.campos ?? {});
    mostrar(resultadoErro(r.mensagem));
  }

  return (
    <form className="formulario" onSubmit={(ev) => void enviar(ev)} noValidate aria-busy={ocupado}>
      {!tela.itens && <RegiaoErros temErro={temErros(erros) || resultado !== null} />}
      {campos.filter((c) => !c.mostrarSe || c.mostrarSe(valores)).map((c) => {
        const id = `campo-${c.nome}`;
        if (c.tipo === 'cadastro' || c.tipo === 'selecao') {
          const lista = c.tipo === 'cadastro' ? (opcoes[c.nome] ?? []) : (c.opcoes ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo }));
          return <SeletorOpcoes key={c.nome} largura={larguraDoCampo(c)} id={id} rotulo={c.rotulo} valor={valores[c.nome] ?? ''} opcoes={lista} onChange={(v) => trocar(c.nome, v)} erro={erros[c.nome]} obrigatorio={c.obrigatorio} />;
        }
        return (
          <label key={c.nome} className={`campo${larguraDoCampo(c)}`} htmlFor={id}>
            <span>{c.rotulo}{c.obrigatorio ? ' *' : ''}</span>
            {c.tipo === 'area' ? <textarea id={id} rows={3} value={valores[c.nome] ?? ''} onChange={(e) => trocar(c.nome, e.target.value)} aria-invalid={erros[c.nome] ? true : undefined} aria-describedby={erros[c.nome] ? `${id}-erro` : undefined} /> : <input id={id} type={c.tipo === 'data' ? 'date' : 'text'} lang="pt-BR" inputMode={c.tipo === 'numero' ? 'decimal' : undefined} value={valores[c.nome] ?? ''} onChange={(e) => trocar(c.nome, e.target.value)} aria-invalid={erros[c.nome] ? true : undefined} aria-describedby={erros[c.nome] ? `${id}-erro` : undefined} />}
            {c.ajuda && <small className="apoio">{c.ajuda}</small>}
            {erros[c.nome] && <span id={`${id}-erro`} className="erro-campo">{erros[c.nome]}</span>}
          </label>
        );
      })}
      {tela.itens && <Itens tela={tela.itens} itens={itens} produtos={produtos} onChange={setItens} erros={erros} temErroExterno={foraDosItens || resultado !== null} />}
      {tela.itens?.totalTexto && <p className="total-pedido" aria-live="polite">Total do pedido: <span data-testid="total-pedido">{tela.itens.totalTexto(itens.map((i) => tela.itens?.paraTexto(i) ?? { produto_id: '', quantidade: '', preco: '' }))}</span></p>}
      <div className="barra-acoes">
        <button className="mx-botao" type="submit" disabled={ocupado}>{ocupado ? 'Enviando…' : tela.enviar}</button>
        <Link className="mx-botao-secundario" href={tela.voltar}>Cancelar</Link>
      </div>
      {/* 36 A: o retorno do envio fica logo abaixo da fila do botão Enviar */}
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
      {segredo && <PainelSegredo titulo="Senha provisória" rotulo="Entregue esta senha à pessoa:" valor={segredo.valor} aviso={tela.avisoSegredo ?? ''} aoFechar={() => { const d = segredo.destino; setSegredo(null); router.push(d); }} />}
    </form>
  );
}

/** Itens do pedido na `FormularioItens` da ui: erros do módulo (`itens.N.campo`) viram mensagem da linha. */
function Itens({ tela, itens, produtos, onChange, erros, temErroExterno }: { tela: NonNullable<TelaFormulario['itens']>; itens: ItemLinha[]; produtos: readonly Opcao[]; onChange: (i: ItemLinha[]) => void; erros: ErrosFormulario; temErroExterno: boolean }) {
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
    <div style={{ margin: "0 0 16px" }}>
      {erros.itens && <p className="erro" role="alert">{erros.itens}</p>}
      <FormularioItens
        temErroExterno={temErroExterno}
        itens={itens}
        aoMudar={onChange}
        novoItem={tela.novoItem}
        calcularTotal={tela.calcularTotal}
        formatarCentavos={tela.formatarCentavos}
        erros={porLinha}
        legenda="Itens do pedido"
        renderSeletorProduto={({ valor, aoEscolher, rotulo, desabilitado }) => (
          <select className="entrada" aria-label={rotulo} disabled={desabilitado} value={valor ?? ''} onChange={(e) => aoEscolher(e.target.value || null)}>
            <option value="">Selecione</option>
            {produtos.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
          </select>
        )}
      />
    </div>
  );
}
