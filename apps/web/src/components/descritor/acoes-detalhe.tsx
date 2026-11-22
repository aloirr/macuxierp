'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DialogoMotivo, type ResultadoMotivo } from '@macuxierp/ui';
import type { AcaoVista } from '@/lib/descritor/tipos';
import { aposResposta, chaveParaEnvio, novoEstado, type EstadoChave } from '@/lib/descritor/idempotencia';
import { telaDetalhe } from '@/lib/telas';
import { escrever } from '@/app/(shell)/[modulo]/[...pagina]/acoes';

/** Botões de ação do detalhe e o diálogo. A regra do diálogo (motivo, justificativa, texto) é do módulo, via `validarAcao` do descritor. */
export function AcoesDetalhe({ acoes, rota, rotaDaPagina }: { acoes: readonly AcaoVista[]; rota: string; rotaDaPagina: string }) {
  const router = useRouter();
  const tela = telaDetalhe(rotaDaPagina);
  const [aberta, setAberta] = useState<AcaoVista | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const chaves = useRef<Record<string, EstadoChave>>({}); // uma Idempotency-Key por ação

  async function enviar(a: AcaoVista, entrada: ResultadoMotivo) {
    const v = tela?.validarAcao(a, entrada);
    if (!v || !v.ok) return setErro(v && !v.ok ? v.erro : 'Tela não encontrada.');
    setOcupado(true);
    setErro('');
    const gerar = () => tela?.novaChave() ?? globalThis.crypto.randomUUID();
    const estado = chaveParaEnvio(chaves.current[a.id] ?? novoEstado(gerar), v.corpo ?? null, gerar);
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
  return (
    <>
      <div className="barra-acoes" role="group" aria-label="Ações do pedido">
        {acoes.map((x) => <button key={x.id} type="button" className={x.principal ? 'btn' : 'btn btn-sec'} disabled={ocupado || Boolean(x.desabilitada)} aria-describedby={x.desabilitada ? `${x.id}-motivo` : undefined} onClick={() => abrir(x)}>{x.rotulo}</button>)}
      </div>
      {acoes.filter((x) => x.desabilitada).map((x) => <p key={x.id} id={`${x.id}-motivo`} className="apoio">{x.rotulo}: {x.desabilitada}</p>)}
      {!a && erro && <p className="erro" role="alert">{erro}</p>}
      {a && (
        <DialogoMotivo
          titulo={a.rotulo}
          motivos={a.entrada === 'motivo' ? (a.motivos ?? []).map((m) => ({ ...m })) : undefined}
          rotuloTexto={a.entrada === 'justificativa' ? 'Justificativa' : 'Descreva o motivo'}
          textoObrigatorio={a.entrada === 'justificativa' && Boolean(a.justificativaObrigatoria)}
          rotuloConfirmar={ocupado ? 'Enviando…' : 'Confirmar'}
          aviso={a.aviso ?? null}
          validar={(r) => { const v = tela?.validarAcao(a, r); return v && !v.ok ? v.erro : null; }}
          aoConfirmar={(r) => void enviar(a, r)}
          aoCancelar={() => { setAberta(null); setErro(''); }}
        />
      )}
    </>
  );
}
