'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DialogoMotivo, type ResultadoMotivo } from '@macuxierp/ui';
import type { AcaoVista, EntradaAcao } from '@/lib/descritor/tipos';
import { aposResposta, chaveParaEnvio, estadoDoClique, type EstadoChave } from '@/lib/descritor/idempotencia';
import { executorDeAcoes, type OrigemDasAcoes } from '@/lib/telas';
import { escrever } from '@/app/(shell)/[modulo]/[...pagina]/acoes';
import { DialogoEscrita, type EntradaDialogo } from './dialogo-escrita';

/**
 * Botões de ação (detalhe ou linha de lista) e o diálogo. A regra do diálogo (motivo, justificativa, texto, valor) é do módulo, via
 * `validarAcao` do descritor. Cada ação tem a própria Idempotency-Key: o reenvio do mesmo corpo reusa a chave (RN-CORE-05).
 */
const entradaDe = (r: EntradaDialogo): EntradaAcao => ({ texto: r.texto, valor: r.valor, data: r.data, filial: r.filial, inicial: r.inicial, final: r.final });

export function AcoesDetalhe({ acoes, rota, rotaDaPagina, compacta = false, origem = 'detalhe' }: { acoes: readonly AcaoVista[]; rota: string; rotaDaPagina: string; compacta?: boolean; origem?: OrigemDasAcoes }) {
  const router = useRouter();
  const executor = executorDeAcoes(rotaDaPagina, origem);
  const [aberta, setAberta] = useState<AcaoVista | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const chaves = useRef<Record<string, EstadoChave>>({}); // uma Idempotency-Key por ação

  async function enviar(a: AcaoVista, entrada: EntradaAcao) {
    if (!executor) return setErro('Tela não encontrada.');
    setOcupado(true);
    setErro('');
    const gerar = () => executor.novaChave();
    // Depois de 4xx definitivo o clique seguinte ganha chave nova; o módulo monta o corpo com ela (ex.: emitir) e o cabeçalho leva a mesma.
    const atual = estadoDoClique(chaves.current[a.id], gerar);
    const v = executor.validarAcao(a, { ...entrada, chave: atual.chave });
    if (!v.ok) {
      setOcupado(false);
      return setErro(v.erro);
    }
    const estado = chaveParaEnvio(atual, v.corpo ?? null, gerar);
    chaves.current[a.id] = estado;
    const r = await escrever({ metodo: a.metodo, caminho: a.caminho, corpo: v.corpo, idempotencia: estado.chave, versao: a.versao, recarregar: rota });
    setOcupado(false);
    setAberta(null);
    if (r.ok) {
      delete chaves.current[a.id];
      router.refresh();
    } else {
      chaves.current[a.id] = aposResposta(estado, Boolean(r.definitivo));
      setErro(r.mensagem); // o diálogo fecha: o erro aparece na página, fora da camada do diálogo
      if (r.desatualizado) router.refresh();
    }
  }

  function abrir(a: AcaoVista) {
    setErro('');
    if (a.entrada === 'nenhum') void enviar(a, { texto: '' });
    else setAberta(a);
  }

  if (acoes.length === 0) return null;
  const a = aberta;
  const aoCancelar = () => { setAberta(null); setErro(''); };
  // Tudo que não é catálogo de motivos usa o diálogo do shell (um só padrão de erro, aviso e botões, com o rótulo de fechar do módulo).
  const dialogoDoShell = a?.entrada !== undefined && a.entrada !== 'motivo';
  return (
    <>
      <div className="barra-acoes" role="group" aria-label="Ações" style={compacta ? { margin: 0 } : undefined}>
        {acoes.map((x) => <button key={x.id} type="button" className={x.principal ? 'mx-botao' : 'mx-botao-secundario'} disabled={ocupado || Boolean(x.desabilitada)} title={x.desabilitada} aria-describedby={x.desabilitada ? `${x.id}-motivo` : undefined} onClick={() => abrir(x)}>{x.rotulo}</button>)}
      </div>
      {!compacta && acoes.filter((x) => x.desabilitada).map((x) => <p key={x.id} id={`${x.id}-motivo`} className="apoio">{x.rotulo}: {x.desabilitada}</p>)}
      {!a && erro && <p className="erro" role="alert">{erro}</p>}
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
          validar={(r) => { const v = executor?.validarAcao(a, entradaDe(r)); return v && !v.ok ? v.erro : null; }}
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
