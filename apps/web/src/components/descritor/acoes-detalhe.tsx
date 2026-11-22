'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AcaoVista } from '@/lib/descritor/tipos';
import { corpoDaAcao, erroDaAcao } from '@/lib/descritor/acoes';
import { novaChaveIdempotencia } from '@/lib/descritor/formulario';
import { escrever } from '@/app/(shell)/[modulo]/[...pagina]/acoes';
import { Dialogo } from './adaptadores';

export function AcoesDetalhe({ acoes, rota }: { acoes: readonly AcaoVista[]; rota: string }) {
  const router = useRouter();
  const [aberta, setAberta] = useState<AcaoVista | null>(null);
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef(novaChaveIdempotencia()); // uma chave por abertura do diálogo/ação

  function abrir(a: AcaoVista) {
    setMotivo('');
    setTexto('');
    setErro('');
    chave.current = novaChaveIdempotencia();
    if (a.entrada === 'nenhum' && !a.aviso) void enviar(a, '', '');
    else setAberta(a);
  }

  async function enviar(a: AcaoVista, m: string, t: string) {
    const e = erroDaAcao(a, m, t);
    if (e) return setErro(e);
    setOcupado(true);
    setErro('');
    const r = await escrever({ metodo: a.metodo, caminho: a.caminho, corpo: corpoDaAcao(a, m, t), idempotencia: chave.current, versao: a.versao, recarregar: rota });
    setOcupado(false);
    if (r.ok) {
      setAberta(null);
      router.refresh();
    } else {
      setErro(r.mensagem);
      if (r.desatualizado) router.refresh();
    }
  }

  if (acoes.length === 0) return null;
  const a = aberta;
  return (
    <>
      <div className="barra-acoes" role="group" aria-label="Ações do pedido">
        {acoes.map((x) => <button key={x.id} type="button" className={x.perigosa ? 'btn btn-sec' : 'btn'} disabled={ocupado || Boolean(x.desabilitada)} title={x.desabilitada} aria-describedby={x.desabilitada ? `${x.id}-motivo` : undefined} onClick={() => abrir(x)}>{x.rotulo}</button>)}
      </div>
      {acoes.filter((x) => x.desabilitada).map((x) => <p key={x.id} id={`${x.id}-motivo`} className="apoio">{x.rotulo}: {x.desabilitada}</p>)}
      {!a && erro && <p className="erro" role="alert">{erro}</p>}
      <Dialogo aberto={a !== null} titulo={a?.rotulo ?? ''} onFechar={() => setAberta(null)}>
        {a && (
          <form onSubmit={(ev) => { ev.preventDefault(); void enviar(a, motivo, texto); }}>
            {(a.aviso || a.avisoPorMotivo?.[motivo]) && <p className="faixa-aviso" role="note">{a.avisoPorMotivo?.[motivo] ?? a.aviso}</p>}
            {a.entrada === 'motivo' && (
              <label className="campo"><span>Motivo *</span>
                <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                  <option value="">Selecione</option>
                  {a.motivos?.map((m) => <option key={m.codigo} value={m.codigo}>{m.rotulo}</option>)}
                </select>
              </label>
            )}
            {(a.entrada === 'justificativa' || (a.entrada === 'motivo' && a.motivos?.find((m) => m.codigo === motivo)?.exigeTexto)) && (
              <label className="campo"><span>{a.entrada === 'justificativa' ? `Justificativa${a.justificativaObrigatoria ? ' *' : ''}` : 'Descreva o motivo *'}</span>
                <textarea rows={3} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </label>
            )}
            {erro && <p className="erro" role="alert">{erro}</p>}
            <div className="barra-acoes">
              <button className="btn" type="submit" disabled={ocupado}>{ocupado ? 'Enviando…' : 'Confirmar'}</button>
              <button className="btn btn-sec" type="button" onClick={() => setAberta(null)}>Voltar</button>
            </div>
          </form>
        )}
      </Dialogo>
    </>
  );
}
