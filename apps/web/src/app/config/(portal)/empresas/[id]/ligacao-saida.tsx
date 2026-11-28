'use client';
import type { LigacaoSaida as LigacaoSaidaLida } from '@macuxierp/integracao-fdv/contracts';
import type { IntegracaoFdvPlataforma, MonitorConectorFdv } from '@macuxierp/platform-sdk';
import { Dialogo, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { MSG_SEM_LICENCA } from '@macuxierp/integracao-fdv/contracts';
import { useRouter } from 'next/navigation';
import { cloneElement, useId, useRef, useState, useTransition, type ReactElement, type ReactNode } from 'react';
import { AMBIENTES_FDV } from '@/lib/config/integracao-fdv';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { LIGACAO_SAIDA, ROTULO_DESTINO_FDV, contadoresDaSaida, fichaSaida } from '@/lib/config/ligacoes';
import { RETORNOS_FDV, ROTULOS_FDV, textoDaFalha } from '@/lib/config/operacao-fdv';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { salvarCredencialFdvAcao, testarConexaoFdvAcao } from '@/lib/acoes-cliente';
import { AVISO_TROCAR } from '@/lib/config/entrada-textos';
import { CartaoLigacao, FichaDaLigacao } from './ligacao';

const TITULO_TROCAR_CHAVE_FDV = `Trocar a chave do ${ROTULO_DESTINO_FDV}?`;
/** `aria-label` da ficha e do formulário da chave. */
const ROTULO_FICHA_FDV = `Chave do ${ROTULO_DESTINO_FDV}`;

/**
 * Ligação "ERP → Macuxi FDV" (v0.3.24, docs/design/integracao-duas-ligacoes; juntou "Conexão com o Macuxi FDV" e o Monitor).
 * Sem chave: o formulário Código / Chave / Ambiente e "Salvar chave". Com chave: a ficha (o Monitor vira a Situação) e
 * "Trocar chave" (diálogo com Nova chave e Ambiente; o código fica fixo) e "Testar conexão". A chave fica só no campo até o
 * envio: sem estado, URL, armazenamento nem log; depois de salvar, o campo é limpo.
 */
export function LigacaoSaida({ empresaId, dados, monitor, fuso, lida = null, corpo }: { empresaId: string; dados: IntegracaoFdvPlataforma; monitor: MonitorConectorFdv | null; fuso: string; /** Contadores e cabeçalho do Contato (T-0131); ausente = a ficha de antes, sem contadores. */ lida?: LigacaoSaidaLida | null; /** Registros por lote e a tabela "Cadastros enviados"; recebe a barra do cartão, onde entram o Salvar e o Zerar pedidos (uma barra só, regra 12). */ corpo?: (barra: HTMLElement | null) => ReactNode }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [rChave, kChave, mostrarChave, limparChave] = useResultado();
  const [rTestar, kTestar, mostrarTestar] = useResultado();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [trocar, setTrocar] = useState(false);
  const idForm = useId();
  const [barra, setBarra] = useState<HTMLElement | null>(null);
  const chaves = useRef(new ChavesIdempotencia());
  const ficha = fichaSaida(dados, monitor, fuso, lida);
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
    <CartaoLigacao ligacao={LIGACAO_SAIDA} ficha={ficha}>
      {!dados.modulo_licenciado && <p className="faixa-aviso" role="status">{MSG_SEM_LICENCA}</p>}
      {ficha ? (
        <>
          <FichaDaLigacao ficha={ficha} rotulo={ROTULO_FICHA_FDV} />
          {lida && (
            <dl className="contadores" aria-label="Contadores da ligação">
              {contadoresDaSaida(lida).map((c) => <div key={c.id} className="contador"><dt>{c.rotulo}</dt><dd>{c.valor}</dd></div>)}
            </dl>
          )}
        </>
      ) : (
        <form id={idForm} noValidate aria-label={ROTULO_FICHA_FDV} onSubmit={(ev) => { ev.preventDefault(); salvar(ev.currentTarget); }}>
          <CamposChave campos={campos} codigo={dados.conector_id ?? ''} ambiente={dados.ambiente ?? 'teste'} />
        </form>
      )}
      {corpo?.(barra)}
      <div className="barra-acoes barra-bloco">
        {ficha ? (
          <>
            <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={testar}>Testar conexão</button>
            <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={() => { setCampos({}); setTrocar(true); }}>{ROTULOS_FDV.trocarChave}</button>
          </>
        ) : (
          <button className="mx-botao" type="submit" form={idForm} disabled={bloqueado}>{ROTULOS_FDV.salvarChave}</button>
        )}
        <div ref={setBarra} className="barra-destino" />
      </div>
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
  const campo = (nome: string, rotulo: string, input: ReactElement<Record<string, unknown>>, largura = '') => (
    <>
      <label className={`campo ${largura}`.trim()}>
        <span>{rotulo}</span>
        {cloneElement(input, { 'aria-invalid': campos[nome] ? true : undefined, 'aria-describedby': campos[nome] ? `${id}-${nome}` : undefined })}
      </label>
      {campos[nome] && <p id={`${id}-${nome}`} className="erro-campo" role="alert">{campos[nome]}</p>}
    </>
  );
  // grade de 12 do cartão (regra 11): Código e Ambiente curtos, lado a lado; a Chave na linha toda
  return (
    <div className="formulario">
      {!nova && campo('conector_id', 'Código', <input name="conector_id" defaultValue={codigo} maxLength={64} autoComplete="off" spellCheck={false} />, 'campo-curto')}
      {campo('ambiente', 'Ambiente', <select name="ambiente" defaultValue={ambiente}>{AMBIENTES_FDV.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>, 'campo-curto')}
      {campo('chave', nova ? 'Nova chave' : 'Chave', <input name="chave" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} />, 'campo-largo')}
    </div>
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
