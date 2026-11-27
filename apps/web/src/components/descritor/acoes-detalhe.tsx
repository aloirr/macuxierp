'use client';
import { MensagemRecarregar } from '@/components/mensagem-recarregar';
import { SISTEMA_ATUALIZADO, ehAcaoAusente, mensagemDaFalha } from '@/lib/sistema-atualizado';
import { resultadoErro } from '@/lib/resultado-acao';
import { FALHA } from '@/lib/textos';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DialogoMotivo, MenuAcoes, ResultadoAcao, useResultado, type AcaoMenu, type ResultadoMotivo } from '@macuxierp/ui';
import type { AcaoVista, AmbienteVista, EntradaAcao } from '@/lib/descritor/tipos';
import { aposResposta, chaveParaEnvio, estadoDoClique, type EstadoChave } from '@/lib/descritor/idempotencia';
import { executorDeAcoes, type OrigemDasAcoes } from '@/lib/telas';
import { escrever, ler } from '@/app/(shell)/[modulo]/[...pagina]/acoes';
import { PainelSegredo } from './painel-segredo';
import { DialogoEscrita, type CarregarItens, type EntradaDialogo } from './dialogo-escrita';

/**
 * Botões de ação (detalhe ou linha de lista) e o diálogo. A regra do diálogo (motivo, justificativa, texto, valor) é do módulo, via
 * `validarAcao` do descritor. Cada ação tem a própria Idempotency-Key: o reenvio do mesmo corpo reusa a chave (RN-CORE-05).
 */
const entradaDe = (r: EntradaDialogo): EntradaAcao => ({ texto: r.texto, valor: r.valor, data: r.data, filial: r.filial, inicial: r.inicial, final: r.final, ...(r.itens ? { itens: r.itens } : {}), ...(r.campos ? { campos: r.campos } : {}) });

/** Repartição da linha (T-0099): a primeira ação fica à vista como principal, salvo se for destrutiva (perigo nunca fica solto); o resto vai ao menu "Ações". */
export function repartirAcoes(acoes: readonly AcaoVista[], comPrincipal: boolean): { principal: AcaoVista | undefined; menu: readonly AcaoVista[] } {
  const principal = comPrincipal && !acoes[0]?.destrutivo ? acoes[0] : undefined;
  return { principal, menu: principal ? acoes.slice(1) : acoes };
}
/** `destrutivo` da vista vira `perigo` do menu: por último, em vermelho, depois do traço. */
export const itemDoMenu = (x: AcaoVista): Omit<AcaoMenu, 'aoAcionar'> => ({ chave: x.id, rotulo: x.rotulo, perigo: Boolean(x.destrutivo) });

export function AcoesDetalhe({ acoes, rota, rotaDaPagina, compacta = false, origem = 'detalhe', menu = false, comPrincipal = false, rotuloLinha }: { acoes: readonly AcaoVista[]; rota: string; rotaDaPagina: string; compacta?: boolean; origem?: OrigemDasAcoes; /** Linha de tabela ou cartão: botão "Ações" do `MenuAcoes` em vez da fileira de botões. */ menu?: boolean; /** Com `menu`: a primeira ação fica à vista como principal. */ comPrincipal?: boolean; rotuloLinha?: string }) {
  const router = useRouter();
  const executor = executorDeAcoes(rotaDaPagina, origem);
  const [aberta, setAberta] = useState<AcaoVista | null>(null);
  const [resultado, chave, mostrar, limpar] = useResultado();
  const [atualizado, setAtualizado] = useState(false); // o aviso "sistema atualizado" (com Recarregar) segue no topo, fora do ResultadoAcao
  const falhar = (texto: string) => (texto === SISTEMA_ATUALIZADO ? setAtualizado(true) : mostrar(resultadoErro(texto)));
  const limparErro = () => { limpar(); setAtualizado(false); };
  const [ocupado, setOcupado] = useState(false);
  const chaves = useRef<Record<string, EstadoChave>>({}); // uma Idempotency-Key por ação
  const [segredo, setSegredo] = useState<{ valor: string; aviso: string } | null>(null); // senha provisória: só neste estado, some ao fechar

  async function enviar(a: AcaoVista, entrada: EntradaAcao) {
    if (!executor) return falhar('Tela não encontrada.');
    setOcupado(true);
    limparErro();
    const gerar = () => executor.novaChave();
    // Depois de 4xx definitivo o clique seguinte ganha chave nova; o módulo monta o corpo com ela (ex.: emitir) e o cabeçalho leva a mesma.
    const atual = estadoDoClique(chaves.current[a.id], gerar);
    const v = executor.validarAcao(a, { ...entrada, chave: atual.chave });
    if (!v.ok) {
      setOcupado(false);
      return falhar(v.erro);
    }
    const estado = chaveParaEnvio(atual, v.corpo ?? null, gerar);
    chaves.current[a.id] = estado;
    let r: Awaited<ReturnType<typeof escrever>>;
    try {
      r = await escrever({ metodo: a.metodo, caminho: a.caminho, corpo: v.corpo, idempotencia: estado.chave, versao: a.versao, recarregar: rota });
    } catch (e) {
      if (ehAcaoAusente(e)) return falhar(mensagemDaFalha(e));
      throw e;
    } finally {
      setOcupado(false);
      setAberta(null);
    }
    if (r.ok) {
      delete chaves.current[a.id];
      if (r.segredo) setSegredo({ valor: r.segredo, aviso: a.avisoSegredo ?? '' }); // a lista só recarrega depois que a pessoa anotar
      else router.refresh();
    } else {
      chaves.current[a.id] = aposResposta(estado, Boolean(r.definitivo));
      falhar(r.mensagem); // o diálogo fecha: o erro aparece na página, fora da camada do diálogo
      if (r.desatualizado) router.refresh();
    }
  }

  const leituraItens = aberta?.entrada === 'itens' ? aberta.leitura : undefined;
  const carregarItens = useCallback<CarregarItens>(async () => {
    const itensDe = executor?.itensDaLeitura;
    if (!leituraItens || !itensDe) return { ok: false, erro: 'Tela não encontrada.' };
    const r = await ler(leituraItens);
    if (!r.ok) return { ok: false, erro: r.mensagem };
    try {
      return { ok: true, itens: itensDe(r.dados) };
    } catch {
      return { ok: false, erro: FALHA };
    }
  }, [executor, leituraItens]);

  const modeloAmbiente = aberta?.entrada === 'faixa' ? aberta.ambientePorFilial : undefined;
  const carregarAmbiente = useCallback(async (filial: string): Promise<AmbienteVista | null> => {
    if (!modeloAmbiente || !executor?.ambienteDaLeitura) return null;
    const r = await ler(modeloAmbiente.replace(':id', filial));
    return r.ok ? executor.ambienteDaLeitura(r.dados) : null;
  }, [executor, modeloAmbiente]);

  function abrir(a: AcaoVista) {
    limparErro();
    if (a.entrada === 'nenhum') void enviar(a, { texto: '' });
    else setAberta(a);
  }

  if (acoes.length === 0) return null;
  const { principal, menu: itensMenu } = repartirAcoes(acoes, menu && comPrincipal);
  const a = aberta;
  const aoCancelar = () => { setAberta(null); limparErro(); };
  // Tudo que não é catálogo de motivos usa o diálogo do shell (um só padrão de erro, aviso e botões, com o rótulo de fechar do módulo).
  const dialogoDoShell = a?.entrada !== undefined && a.entrada !== 'motivo';
  return (
    <>
      {menu ? (
        <MenuAcoes
          {...(rotuloLinha ? { rotuloLinha } : {})}
          {...(principal ? { principal: { rotulo: principal.rotulo, desabilitado: ocupado || Boolean(principal.desabilitada), aoAcionar: () => abrir(principal) } } : {})}
          acoes={itensMenu.map((x) => ({ ...itemDoMenu(x), desabilitado: ocupado || Boolean(x.desabilitada), aoAcionar: () => abrir(x) }))}
        />
      ) : (
        <div className="barra-acoes" role="group" aria-label="Ações" style={compacta ? { margin: 0 } : undefined}>
          {acoes.map((x) => <button key={x.id} type="button" className={x.principal ? 'mx-botao' : 'mx-botao-secundario'} disabled={ocupado || Boolean(x.desabilitada)} title={x.desabilitada} aria-describedby={x.desabilitada ? `${x.id}-motivo` : undefined} onClick={() => abrir(x)}>{x.rotulo}</button>)}
        </div>
      )}
      {!compacta && !menu && acoes.filter((x) => x.desabilitada).map((x) => <p key={x.id} id={`${x.id}-motivo`} className="apoio">{x.rotulo}: {x.desabilitada}</p>)}
      {/* 36 A: o erro da ação fica logo abaixo dos botões */}
      {!a && atualizado && <MensagemRecarregar />}
      <ResultadoAcao resultado={a ? null : resultado} chave={chave} />
      {segredo && <PainelSegredo titulo="Senha provisória" rotulo="Entregue esta senha à pessoa:" valor={segredo.valor} aviso={segredo.aviso} aoFechar={() => { setSegredo(null); router.refresh(); }} />}
      {a && dialogoDoShell && (
        <DialogoEscrita
          titulo={a.tituloDialogo ?? a.rotulo}
          aviso={a.aviso ?? null}
          ambiente={a.ambiente}
          limitesTexto={a.limitesTexto}
          rotuloConfirmar={a.rotuloConfirmar ?? 'Confirmar'}
          {...(a.rotuloFechar ? { rotuloFechar: a.rotuloFechar } : {})}
          textoCarregando={a.textoCarregando}
          ocupado={ocupado}
          baixa={a.entrada === 'baixa' ? a.baixa : undefined}
          texto={a.entrada === 'justificativa' ? { rotulo: a.rotuloTexto ?? 'Justificativa', obrigatorio: Boolean(a.justificativaObrigatoria) } : undefined}
          faixa={a.entrada === 'faixa' ? { filiais: a.filiais ?? [], rotuloTexto: a.rotuloTexto ?? 'Justificativa' } : undefined}
          itens={a.entrada === 'itens' ? { carregar: carregarItens } : undefined}
          campos={a.entrada === 'campos' ? a.campos : undefined}
          carregarAmbiente={a.entrada === 'faixa' && a.ambientePorFilial ? carregarAmbiente : undefined}
          validar={(r) => { const v = executor?.validarAcao(a, entradaDe(r)); return v && !v.ok ? (v.erros ? { erro: v.erro, erros: v.erros, errosPartes: v.errosPartes } : v.erro) : null; }}
          aoConfirmar={(r) => void enviar(a, entradaDe(r))}
          aoCancelar={aoCancelar}
        />
      )}
      {a && !dialogoDoShell && (
        <DialogoMotivo
          titulo={a.tituloDialogo ?? a.rotulo}
          motivos={a.entrada === 'motivo' ? (a.motivos ?? []).map((m) => ({ ...m })) : undefined}
          rotuloTexto={a.rotuloTexto ?? (a.entrada === 'justificativa' ? 'Justificativa' : 'Descreva o motivo')}
          textoObrigatorio={a.entrada === 'justificativa' && Boolean(a.justificativaObrigatoria)}
          rotuloConfirmar={ocupado ? (a.textoCarregando ?? 'Enviando…') : (a.rotuloConfirmar ?? 'Confirmar')}
          aviso={a.aviso ?? null}
          rotuloFechar={a.rotuloFechar ?? 'Cancelar'}
          destrutivo={Boolean(a.destrutivo)}
          validar={(r: ResultadoMotivo) => { const v = executor?.validarAcao(a, r); return v && !v.ok ? v.erro : null; }}
          aoConfirmar={(r) => void enviar(a, r)}
          aoCancelar={aoCancelar}
        />
      )}
    </>
  );
}
