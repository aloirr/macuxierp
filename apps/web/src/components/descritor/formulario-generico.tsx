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
import type { CampoFormulario, ErrosFormulario, ItemFormulario, TelaFormulario, ValoresFormulario } from '@/lib/descritor/tipos';
import { PainelSegredo } from './painel-segredo';
import { escrever } from '@/lib/acoes-cliente';

/** Endereço em duas linhas de 12 colunas (padrão de mercado): CEP 2 + Logradouro 8 + Número 2; Complemento 3 + Bairro 3 + Município 4 + UF 2. Única fonte da largura dos campos end_*: a regex de larguraDoCampo não decide o endereço. */
export const LARGURA_ENDERECO: Readonly<Record<string, string>> = {
  end_cep: ' campo-curto campo-inicio-linha', end_logradouro: ' campo-8', end_numero: ' campo-curto',
  end_complemento: ' campo-3', end_bairro: ' campo-3', end_municipio_ibge: ' campo-medio', end_uf: ' campo-curto',
};

/** Linha da NF-e da filial: Emite NF-e 4 + Série 4 + Número inicial 4 (fecha 12). Mapa próprio; não passa pela regex de serie/numero. */
export const LARGURA_NFE: Readonly<Record<string, string>> = { nfe_serie: ' campo-medio', nfe_numero_inicial: ' campo-medio' };

/** Largura do campo na grade de 12 colunas do formulário (regra 11): curto (2), 3, médio (4), longo (6, padrão), 8 ou largo (12). */
export function larguraDoCampo(c: { nome: string; tipo: string; colunas?: number; colunasSe?: (v: Readonly<Record<string, string>>) => number; inicioLinha?: boolean }, valores?: Readonly<Record<string, string>>): string {
  const base = larguraBase(c.colunasSe && valores ? { ...c, colunas: c.colunasSe(valores) } : c);
  return c.inicioLinha && !base.includes('campo-inicio-linha') ? `${base} campo-inicio-linha` : base;
}

function larguraBase(c: { nome: string; tipo: string; colunas?: number }): string {
  if (c.colunas) return ` campo-col-${c.colunas}`;
  if (c.nome in LARGURA_ENDERECO) return LARGURA_ENDERECO[c.nome] as string;
  if (c.nome in LARGURA_NFE) return LARGURA_NFE[c.nome] as string;
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
  return tela ? <Formulario key={aberto?.versao ?? 'novo'} tela={tela} opcoes={opcoes} produtos={produtos} errosIniciais={errosIniciais} perfil={perfil} campos={perfil && tela.camposDoPerfil ? tela.camposDoPerfil(perfil) : (campos ?? tela.campos)} aberto={aberto} /> : <p className="erro" role="alert">Formulário não encontrado.</p>;
}

/** Registro aberto na edição: valores iniciais, o original (para o diff do PATCH) e o id. */
export interface Aberto { valores: ValoresFormulario; original: unknown; id: string; /** `If-Match` do PUT. */ versao?: string; itens?: readonly ItemFormulario[] }

function Formulario({ tela, opcoes, produtos, errosIniciais, perfil, campos, aberto }: { tela: TelaFormulario; opcoes: Readonly<Record<string, readonly Opcao[]>>; produtos: readonly Opcao[]; errosIniciais?: ErrosFormulario; perfil?: Perfil; campos: readonly CampoFormulario[]; aberto?: Aberto }) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresFormulario>(aberto?.valores ?? {});
  const [itens, setItens] = useState<ItemLinha[]>(() => {
    const t = tela.itens;
    if (!t) return [];
    const doRegistro = aberto?.itens && t.daTexto ? aberto.itens.map((i, n) => (t.daTexto as NonNullable<typeof t.daTexto>)(i, `item-${n + 1}`)) : [];
    return doRegistro.length > 0 ? doRegistro : [t.novoItem('item-1')];
  });
  const [recarregar, setRecarregar] = useState(false); // a versão do registro ficou velha: a barra oferece recarregar
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
    const completo = tela.edicao?.metodo === 'PUT'; // PUT leva o corpo inteiro; PATCH, só o que mudou
    const patch = tela.edicao && !completo && aberto && perfil ? tela.edicao.montarPatch(valores, aberto.original, perfil) : undefined;
    if (tela.edicao && !completo && patch === null) return mostrar(resultadoErro('Nada foi alterado.'));
    setOcupado(true);
    setRecarregar(false);
    const corpo = tela.edicao && !completo ? patch : tela.montar(valores, linhas, perfil);
    const estado = chaveParaEnvio(chave.current ?? novoEstado(tela.novaChave), corpo, tela.novaChave);
    chave.current = estado;
    const r = await escrever({ metodo: tela.edicao && aberto ? (tela.edicao.metodo ?? 'PATCH') : 'POST', caminho: tela.edicao && aberto ? `${tela.api}/${aberto.id}` : tela.api, corpo, idempotencia: estado.chave, ...(completo && aberto?.versao ? { versao: aberto.versao } : {}) });
    chave.current = aposResposta(estado, Boolean(r.definitivo));
    setOcupado(false);
    // Senha provisória (RN-CORE-10): aparece uma vez; a tela só segue depois que a pessoa a anotar.
    if (r.ok && r.segredo) return setSegredo({ valor: r.segredo, destino: r.id ? tela.depois(r.id) : tela.voltar });
    if (r.ok && r.id) return router.push(tela.depois(r.id));
    if (r.ok) return router.push(tela.voltar);
    setErros(r.campos ?? {});
    const falha = tela.edicao?.falha?.(r);
    if (falha?.recarregar) setRecarregar(true);
    mostrar(resultadoErro(falha?.mensagem ?? r.mensagem));
  }

  return (
    <form className="formulario" onSubmit={(ev) => void enviar(ev)} noValidate aria-busy={ocupado}>
      {!tela.itens && <RegiaoErros temErro={temErros(erros) || resultado !== null} />}
      {campos.filter((c) => !c.mostrarSe || c.mostrarSe(valores)).map((c) => {
        const id = `campo-${c.nome}`;
        if (c.tipo === 'cadastro' || c.tipo === 'selecao') {
          const lista = c.tipo === 'cadastro' ? (opcoes[c.nome] ?? []) : (c.opcoes ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo }));
          return <SeletorOpcoes key={c.nome} largura={larguraDoCampo(c, valores)} id={id} rotulo={c.rotulo} valor={valores[c.nome] ?? ''} opcoes={lista} onChange={(v) => trocar(c.nome, v)} erro={erros[c.nome]} obrigatorio={c.obrigatorio} />;
        }
        return (
          <label key={c.nome} className={`campo${larguraDoCampo(c, valores)}`} htmlFor={id}>
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
        {recarregar && <button className="mx-botao-secundario" type="button" onClick={() => router.refresh()}>{tela.edicao?.rotuloRecarregar ?? 'Recarregar'}</button>}
        <Link className="mx-botao-secundario" href={aberto && tela.edicao?.voltarPara ? tela.edicao.voltarPara(aberto.id) : tela.voltar}>Cancelar</Link>
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
