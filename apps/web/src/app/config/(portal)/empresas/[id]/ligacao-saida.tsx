'use client';
import type { IntegracaoFdvPlataforma, MonitorConectorFdv } from '@macuxierp/platform-sdk';
import { Dialogo, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { MSG_SEM_LICENCA } from '@macuxierp/integracao-fdv/contracts';
import { useRouter } from 'next/navigation';
import { cloneElement, useId, useRef, useState, useTransition, type ReactElement } from 'react';
import { AMBIENTES_FDV } from '@/lib/config/integracao-fdv';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { LIGACAO_SAIDA, ROTULO_DESTINO_FDV, fichaSaida } from '@/lib/config/ligacoes';
import { RETORNOS_FDV, ROTULOS_FDV, textoDaFalha } from '@/lib/config/operacao-fdv';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { salvarCredencialFdvAcao, testarConexaoFdvAcao } from '../acoes-integracao-fdv';
import { AVISO_TROCAR } from '@/lib/config/entrada-textos';
import { CartaoLigacao, FichaDaLigacao } from './ligacao';

const TITULO_TROCAR_CHAVE_FDV = `Trocar a chave do ${ROTULO_DESTINO_FDV}?`;
/** `aria-label` da ficha e do formulário da chave. */
const ROTULO_FICHA_FDV = `Chave do ${ROTULO_DESTINO_FDV}`;

/**
 * Ligação "ERP → Força de vendas" (v0.3.24, docs/design/integracao-duas-ligacoes; juntou "Conexão com o Macuxi FDV" e o Monitor).
 * Sem chave: o formulário Código / Chave / Ambiente e "Salvar chave". Com chave: a ficha (o Monitor vira a Situação) e
 * "Trocar chave" (diálogo com Nova chave e Ambiente; o código fica fixo) e "Testar conexão". A chave fica só no campo até o
 * envio: sem estado, URL, armazenamento nem log; depois de salvar, o campo é limpo.
 */
export function LigacaoSaida({ empresaId, dados, monitor, fuso }: { empresaId: string; dados: IntegracaoFdvPlataforma; monitor: MonitorConectorFdv | null; fuso: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [rChave, kChave, mostrarChave, limparChave] = useResultado();
  const [rTestar, kTestar, mostrarTestar] = useResultado();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [trocar, setTrocar] = useState(false);
  const chaves = useRef(new ChavesIdempotencia());
  const ficha = fichaSaida(dados, monitor, fuso);
  const bloqueado = pendente || !dados.modulo_licenciado;

  /** Salvar a 1ª chave ou trocar a que existe: o erro de campo fica embaixo do campo; o geral, embaixo do botão (só falha do servidor). */
  const salvar = (f: HTMLFormElement, aoSalvar?: () => void) => {
    const d = new FormData(f);
    limparChave();
    iniciar(async () => {
      const r = await salvarCredencialFdvAcao(empresaId, { conector_id: String(d.get('conector_id') ?? dados.conector_id ?? ''), chave: String(d.get('chave') ?? ''), ambiente: String(d.get('ambiente') ?? '') });
      setCampos(r.ok ? {} : r.campos);
      if (r.ok) {
        f.reset(); // a chave sai do campo na hora
        aoSalvar?.();
        mostrarChave(resultadoSucesso(RETORNOS_FDV.chaveSalva));
        router.refresh();
      } else if (Object.keys(r.campos).length === 0) mostrarChave(resultadoErro(textoDaFalha(r.erro, true)));
    });
  };
  const testar = () =>
    iniciar(async () => {
      const r = await testarConexaoFdvAcao(empresaId, chaves.current.de('testar'));
      chaves.current.aposResposta('testar', r);
      mostrarTestar(r.ok ? resultadoSucesso(RETORNOS_FDV.testeIniciado) : resultadoErro(textoDaFalha(r.erro, false)));
      if (r.ok) router.refresh();
    });

  return (
    <CartaoLigacao ligacao={LIGACAO_SAIDA}>
      {!dados.modulo_licenciado && <p className="faixa-aviso" role="status">{MSG_SEM_LICENCA}</p>}
      {ficha ? (
        <>
          <FichaDaLigacao ficha={ficha} rotulo={ROTULO_FICHA_FDV} />
          <div className="barra-acoes">
            <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={() => { setCampos({}); setTrocar(true); }}>{ROTULOS_FDV.trocarChave}</button>
            <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={testar}>Testar conexão</button>
          </div>
        </>
      ) : (
        <form noValidate aria-label={ROTULO_FICHA_FDV} onSubmit={(ev) => { ev.preventDefault(); salvar(ev.currentTarget); }}>
          <CamposChave campos={campos} codigo={dados.conector_id ?? ''} ambiente={dados.ambiente ?? 'teste'} />
          <div className="barra-acoes"><button className="mx-botao" type="submit" disabled={bloqueado}>{ROTULOS_FDV.salvarChave}</button></div>
        </form>
      )}
      {/* 36 A: um retorno por botão, logo abaixo da fila, na ordem dos botões. */}
      <ResultadoAcao resultado={rChave} chave={kChave} />
      <ResultadoAcao resultado={rTestar} chave={kTestar} />
      {trocar && <DialogoTrocarChaveFdv campos={campos} ambiente={dados.ambiente ?? 'teste'} pendente={pendente} aoConfirmar={(f) => salvar(f, () => setTrocar(false))} aoCancelar={() => setTrocar(false)} />}
    </CartaoLigacao>
  );
}

/** Campos da chave. O erro de campo só aparece depois do envio (`campos` vem da resposta), com `aria-invalid` e logo abaixo. */
function CamposChave({ campos, codigo, ambiente, nova = false }: { campos: Record<string, string>; codigo?: string; ambiente: string; nova?: boolean }) {
  const id = useId();
  const campo = (nome: string, rotulo: string, input: ReactElement<Record<string, unknown>>) => (
    <>
      <label className="campo">
        <span>{rotulo}</span>
        {cloneElement(input, { 'aria-invalid': campos[nome] ? true : undefined, 'aria-describedby': campos[nome] ? `${id}-${nome}` : undefined })}
      </label>
      {campos[nome] && <p id={`${id}-${nome}`} className="erro-campo" role="alert">{campos[nome]}</p>}
    </>
  );
  return (
    <>
      {!nova && campo('conector_id', 'Código', <input name="conector_id" defaultValue={codigo} maxLength={64} autoComplete="off" spellCheck={false} />)}
      {campo('chave', nova ? 'Nova chave' : 'Chave', <input name="chave" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} />)}
      {campo('ambiente', 'Ambiente', <select name="ambiente" defaultValue={ambiente}>{AMBIENTES_FDV.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>)}
    </>
  );
}

/** "Trocar chave" com chave salva: Nova chave e Ambiente; o código fica fixo. A chave atual para na hora (aviso de irreversível). */
export function DialogoTrocarChaveFdv({ campos, ambiente, pendente = false, aoConfirmar, aoCancelar }: { campos: Record<string, string>; ambiente: string; pendente?: boolean; aoConfirmar: (f: HTMLFormElement) => void; aoCancelar: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <Dialogo
      titulo={TITULO_TROCAR_CHAVE_FDV}
      aviso={AVISO_TROCAR}
      tomAviso="erro"
      aoFechar={aoCancelar}
      rodape={
        <div className="barra-acoes">
          <button type="button" className="mx-botao-secundario" onClick={aoCancelar}>Cancelar</button>
          <button type="button" className="mx-botao-destrutivo" data-destrutivo="true" disabled={pendente} onClick={() => form.current && aoConfirmar(form.current)}>{ROTULOS_FDV.trocarChave}</button>
        </div>
      }
    >
      <form ref={form} noValidate aria-label={TITULO_TROCAR_CHAVE_FDV} onSubmit={(ev) => { ev.preventDefault(); aoConfirmar(ev.currentTarget); }}>
        <CamposChave campos={campos} ambiente={ambiente} nova />
      </form>
    </Dialogo>
  );
}
