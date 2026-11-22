'use client';
import { contadorDeCaracteres } from '@macuxierp/faturamento/web';
import { useEffect, useId, useRef, useState } from 'react';
import type { AmbienteVista, ItemDoDialogo, ItemEscolhido } from '@/lib/descritor/tipos';

/**
 * Diálogo simples do shell para as ações que não são "motivo/justificativa" (o `DialogoMotivo` é do packages/ui): confirmação com
 * aviso, a baixa de título (valor em reais e data) e a inutilização (filial, faixa de números e justificativa). Foco preso, Esc
 * cancela, erro em `role="alert"`. Padrão de erro dos diálogos: caixa `.erro` e o aviso com borda (`.faixa-aviso`), como aqui. Só dados serializáveis; a regra (limites, saldo, data futura, faixa) é do módulo, via `validar`.
 */
export interface EntradaDialogo { valor: string; data: string; filial: string; inicial: string; final: string; texto: string; itens?: ItemEscolhido[] }

/** Itens do pedido (nota parcial): `carregar` busca no servidor; o campo de cada item começa no saldo. */
export type CarregarItens = () => Promise<{ ok: true; itens: readonly ItemDoDialogo[] } | { ok: false; erro: string }>;

export interface DialogoEscritaProps {
  titulo: string;
  aviso?: string | null;
  /** Linha "Ambiente: ..." (RN-FAT-04): texto neutro na homologação, caixa de aviso quando `alerta`. Na faixa, só depois de escolher a filial. */
  ambiente?: { texto: string; tom: 'neutro' | 'alerta' | 'ok' | 'erro' } | undefined;
  /** Mostra o contador do módulo abaixo do campo de texto. */
  limitesTexto?: { min: number; max: number } | undefined;
  rotuloConfirmar: string;
  /** Botão que fecha sem agir; sem ele, "Cancelar". */
  rotuloFechar?: string;
  textoCarregando?: string;
  ocupado: boolean;
  /** Presente = pede valor e data (baixa de título). */
  baixa?: { saldo: string; valorInicial: string; hoje: string };
  /** Presente = pede só um texto livre (justificativa, texto da correção); `obrigatorio` sem texto recusa antes da regra do módulo. */
  texto?: { rotulo: string; obrigatorio: boolean };
  /** Presente = pede filial, número inicial e final e justificativa (inutilizar). */
  faixa?: { filiais: readonly { valor: string; rotulo: string }[]; rotuloTexto: string };
  /** Presente = pede uma quantidade por item, carregados por `carregar` (nota parcial). */
  itens?: { carregar: CarregarItens };
  /** Em `faixa`: busca o ambiente da filial escolhida; `null` = sem leitura (vale o texto de `ambiente`). */
  carregarAmbiente?: (filial: string) => Promise<AmbienteVista | null>;
  validar: (r: EntradaDialogo) => string | null;
  aoConfirmar: (r: EntradaDialogo) => void;
  aoCancelar: () => void;
}

const FOCAVEIS = 'button:not([disabled]), input, select, textarea, [href]';

export function DialogoEscrita({ titulo, aviso = null, ambiente, limitesTexto, rotuloConfirmar, rotuloFechar = 'Cancelar', textoCarregando = 'Enviando…', ocupado, baixa, texto: pedeTexto, faixa, itens: pedeItens, carregarAmbiente, validar, aoConfirmar, aoCancelar }: DialogoEscritaProps) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [valor, setValor] = useState(baixa?.valorInicial ?? '');
  const [data, setData] = useState(baixa?.hoje ?? '');
  const [filial, setFilial] = useState(faixa?.filiais.length === 1 ? (faixa.filiais[0]?.valor ?? '') : '');
  const [inicial, setInicial] = useState('');
  const [final, setFinal] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<readonly ItemDoDialogo[] | null>(null);
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [falhaItens, setFalhaItens] = useState<string | null>(null);
  const [ambienteDaFilial, setAmbienteDaFilial] = useState<AmbienteVista | null>(null);

  const carregarItens = pedeItens?.carregar;
  useEffect(() => {
    if (!carregarItens) return;
    let vivo = true;
    void carregarItens().then((r) => {
      if (!vivo) return;
      if (!r.ok) return setFalhaItens(r.erro);
      setLinhas(r.itens);
      setQuantidades(Object.fromEntries(r.itens.map((i) => [i.sequencia, i.saldoCampo])));
    });
    return () => { vivo = false; };
  }, [carregarItens]);

  useEffect(() => {
    setAmbienteDaFilial(null);
    if (!carregarAmbiente || !filial) return;
    let vivo = true;
    void carregarAmbiente(filial).then((a) => { if (vivo) setAmbienteDaFilial(a); });
    return () => { vivo = false; };
  }, [carregarAmbiente, filial]);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    raiz.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
    return () => anterior?.focus?.();
  }, []);

  function confirmar() {
    const r: EntradaDialogo = { valor, data, filial, inicial, final, texto: texto.trim(), ...(linhas ? { itens: linhas.map((i) => ({ sequencia: i.sequencia, descricao: i.descricao, saldo: i.saldo, quantidade: quantidades[i.sequencia] ?? '' })) } : {}) };
    const e = validar(r) ?? (pedeTexto?.obrigatorio && r.texto === '' ? 'O detalhe está vazio. Descreva o motivo.' : null);
    setErro(e);
    if (!e) aoConfirmar(r);
  }

  /** Corrigir um campo tira a mensagem de erro anterior (ela volta, se ainda valer, ao confirmar). */
  function edita(set: (v: string) => void, v: string) {
    set(v);
    setErro(null);
  }

  function teclado(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!ocupado) aoCancelar();
    } else if (e.key === 'Tab') {
      const itens = Array.from(raiz.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []);
      if (itens.length === 0) return;
      const i = itens.indexOf(document.activeElement as HTMLElement);
      const prox = e.shiftKey ? (i <= 0 ? itens.length - 1 : i - 1) : (i + 1) % itens.length;
      e.preventDefault();
      itens[prox]?.focus();
    }
  }

  const contador = limitesTexto ? <small className="apoio" data-contador>{contadorDeCaracteres(texto, limitesTexto.min, limitesTexto.max)}</small> : null;
  const amb = ambienteDaFilial ?? ambiente;
  const linhaAmbiente = amb && (!faixa || filial) ? <p data-ambiente className={amb.tom === 'alerta' ? 'faixa-aviso' : 'apoio'}>{amb.texto}</p> : null;
  const invalido = erro ? true : undefined;
  const descreve = erro ? `${id}-erro` : undefined;
  return (
    <div className="dialogo-fundo" data-fundo-dialogo>
      <div aria-hidden="true" className="dialogo-cortina" onClick={() => !ocupado && aoCancelar()} />
      <div ref={raiz} className="dialogo" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={aviso ? `${id}-aviso` : undefined} onKeyDown={teclado}>
        <h2 id={`${id}-t`}>{titulo}</h2>
        {baixa && (
          <>
            <label className="campo">
              <span>Valor da baixa (R$). Saldo: {baixa.saldo}</span>
              <input className="entrada" inputMode="decimal" value={valor} onChange={(e) => edita(setValor, e.target.value)} aria-invalid={invalido} aria-describedby={descreve} />
            </label>
            <label className="campo">
              <span>Data da baixa</span>
              <input className="entrada" type="date" lang="pt-BR" value={data} max={baixa.hoje} onChange={(e) => edita(setData, e.target.value)} />
            </label>
          </>
        )}
        {pedeItens && <ItensDoDialogo linhas={linhas} falha={falhaItens} quantidades={quantidades} invalido={invalido} aoMudar={(sequencia, v) => { setQuantidades({ ...quantidades, [sequencia]: v }); setErro(null); }} />}
        {pedeTexto && (
          <label className="campo">
            <span>{pedeTexto.rotulo}{pedeTexto.obrigatorio ? '' : ' (opcional)'}</span>
            <textarea className="entrada" rows={3} value={texto} onChange={(e) => edita(setTexto, e.target.value)} aria-invalid={invalido} aria-describedby={descreve} required={pedeTexto.obrigatorio} aria-required={pedeTexto.obrigatorio} />
            {contador}
          </label>
        )}
        {faixa && (
          <>
            <label className="campo">
              <span>Filial</span>
              <select className="entrada" value={filial} onChange={(e) => edita(setFilial, e.target.value)}>
                <option value="">Escolha a filial</option>
                {faixa.filiais.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
              </select>
            </label>
            <div className="campos-linha">
              <label className="campo">
                <span>Número inicial</span>
                <input className="entrada" inputMode="numeric" value={inicial} onChange={(e) => edita(setInicial, e.target.value)} aria-invalid={invalido} />
              </label>
              <label className="campo">
                <span>Número final</span>
                <input className="entrada" inputMode="numeric" value={final} onChange={(e) => edita(setFinal, e.target.value)} aria-invalid={invalido} />
              </label>
            </div>
            <label className="campo">
              <span>{faixa.rotuloTexto}</span>
              <textarea className="entrada" rows={3} value={texto} onChange={(e) => edita(setTexto, e.target.value)} aria-invalid={invalido} aria-describedby={descreve} />
              {contador}
            </label>
          </>
        )}
        {linhaAmbiente}
        {aviso && <p id={`${id}-aviso`} className="faixa-aviso">{aviso}</p>}
        {erro && <p id={`${id}-erro`} role="alert" className="erro">{erro}</p>}
        <div className="barra-acoes dialogo-botoes">
          <button type="button" className="mx-botao-secundario" disabled={ocupado} onClick={aoCancelar}>{rotuloFechar}</button>
          <button type="button" className="mx-botao" disabled={ocupado || (Boolean(pedeItens) && !linhas)} onClick={confirmar}>{ocupado ? textoCarregando : rotuloConfirmar}</button>
        </div>
      </div>
    </div>
  );
}

/** Itens da nota parcial: descrição, saldo e um campo de quantidade por item (o padrão é o saldo; 0 tira o item). */
export function ItensDoDialogo({ linhas, falha, quantidades, invalido, aoMudar }: { linhas: readonly ItemDoDialogo[] | null; falha: string | null; quantidades: Readonly<Record<number, string>>; invalido?: true | undefined; aoMudar: (sequencia: number, valor: string) => void }) {
  return (
    <div className="itens-parcial">
      {!linhas && !falha && <p className="apoio" role="status">Carregando os itens…</p>}
      {falha && <p className="erro" role="alert">{falha}</p>}
      {linhas && (
        <table>
          <thead><tr><th scope="col">Item</th><th scope="col">Saldo</th><th scope="col">Quantidade</th></tr></thead>
          <tbody>
            {linhas.map((i) => (
              <tr key={i.sequencia}>
                <th scope="row">{i.descricao}</th>
                <td className="num sem-quebra">{i.saldoTexto}</td>
                <td><input className="entrada" inputMode="decimal" aria-label={`Quantidade de ${i.descricao}`} value={quantidades[i.sequencia] ?? ''} onChange={(e) => aoMudar(i.sequencia, e.target.value)} aria-invalid={invalido} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
