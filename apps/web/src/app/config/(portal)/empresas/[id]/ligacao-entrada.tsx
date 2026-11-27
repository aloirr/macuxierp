'use client';
import type { PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { Dialogo, DialogoMotivo, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useReducer, useRef, useState, useTransition } from 'react';
import { botaoDaChave, ehGeracaoIncerta, estadoDaChave, reduzirChave, validarConectorId, codigoSugerido, type AcaoChave, type EstadoChave } from '@/lib/config/entrada';
import { LIGACAO_ENTRADA, fichaEntrada } from '@/lib/config/ligacoes';
import { CartaoLigacao, FichaDaLigacao } from './ligacao';
import * as T from '@/lib/config/entrada-textos';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { gerarChaveEntradaAcao, revogarChaveEntradaAcao } from '@/lib/acoes-cliente';

/**
 * Ligação "Sistema do cliente → ERP" da aba Integração (v0.3.24, docs/design/integracao-duas-ligacoes; era o bloco "Integração via
 * API", T-0057 A1). Sem chave: só o formulário (Código e Gerar chave). Com chave: a ficha (Situação, Último contato, Código, Chave) e
 * Trocar chave / Revogar chave. Os lotes recebidos foram para a aba Dados ("Cadastros recebidos", RD-1103).
 * A chave nova só vive no estado do diálogo (`EstadoChave`): sem URL, armazenamento nem log; fechar a descarta.
 */
export function LigacaoEntrada({ empresaId, dados, fuso }: { empresaId: string; dados: PortalEntradaLeitura | null; fuso: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [chave, despachar] = useReducer(reduzirChave, undefined, estadoDaChave);
  // 36 A: o retorno de Gerar/Trocar e o de Revogar ficam abaixo da fila de botões, um por botão.
  const [rGerar, kGerar, mostrarGerar, limparGerar] = useResultado();
  const [rRevogar, kRevogar, mostrarRevogar, limparRevogar] = useResultado();
  const [erroCodigo, setErroCodigo] = useState('');
  const [incerta, setIncerta] = useState(false);
  const [pedirTroca, setPedirTroca] = useState(false);
  const [pedirRevogar, setPedirRevogar] = useState(false);
  const idCodigo = useId();
  const campo = useRef<HTMLInputElement>(null);
  const ficha = fichaEntrada(dados, fuso);
  // Depois de falha incerta na troca, a ligação volta a "Gerar chave" com o código fixo (a chave nova substitui a anterior).
  const botao = botaoDaChave(ficha !== null, incerta);

  const gerar = () => {
    setPedirTroca(false);
    const c = validarConectorId(ficha?.codigo ?? campo.current?.value ?? '');
    if (!c.ok) return setErroCodigo(c.erro);
    setErroCodigo('');
    limparGerar();
    iniciar(async () => {
      const r = await gerarChaveEntradaAcao(empresaId, c.valor);
      setIncerta(ehGeracaoIncerta(r));
      if (r.ok) {
        despachar({ tipo: 'gerada', chave: r.valor.chave });
        router.refresh();
      } else {
        setErroCodigo(r.campos.conector_id ?? '');
        if (!r.campos.conector_id) mostrarGerar(resultadoErro(r.erro));
      }
    });
  };
  const revogar = () => {
    setPedirRevogar(false);
    limparRevogar();
    iniciar(async () => {
      const r = await revogarChaveEntradaAcao(empresaId, ficha?.codigo ?? '');
      mostrarRevogar(r.ok ? resultadoSucesso(T.RETORNO_REVOGADA) : resultadoErro(r.erro));
      if (r.ok) router.refresh();
    });
  };

  return (
    <CartaoLigacao ligacao={LIGACAO_ENTRADA}>
      {ficha ? (
        <>
          <FichaDaLigacao ficha={ficha} rotulo={T.TITULO_CHAVE} />
          <div className="barra-acoes">
            <button type="button" className="mx-botao-secundario" disabled={pendente} onClick={() => (botao.pedeConfirmacao ? setPedirTroca(true) : gerar())}>{botao.rotulo}</button>
            <button type="button" className="mx-botao-secundario" disabled={pendente} onClick={() => setPedirRevogar(true)}>{T.ROTULOS_ENTRADA.revogar}</button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={(ev) => { ev.preventDefault(); gerar(); }}>
          <label className="campo">
            <span>Código</span>
            <input
              ref={campo}
              name="conector_id"
              defaultValue={codigoSugerido(dados)}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={erroCodigo ? true : undefined}
              aria-describedby={`${idCodigo}-ajuda${erroCodigo ? ` ${idCodigo}-erro` : ''}`}
            />
          </label>
          <p id={`${idCodigo}-ajuda`} className="apoio">{T.AJUDA_CODIGO_LIVRE}</p>
          {erroCodigo && <p id={`${idCodigo}-erro`} className="erro-campo" role="alert">{erroCodigo}</p>}
          <div className="barra-acoes">
            <button type="submit" className="mx-botao" disabled={pendente}>{T.ROTULOS_ENTRADA.gerar}</button>
          </div>
        </form>
      )}
      <ResultadoAcao resultado={rGerar} chave={kGerar} />
      <ResultadoAcao resultado={rRevogar} chave={kRevogar} />
      {chave.chave && <DialogoChave estado={chave} aoAcionar={despachar} />}
      {pedirTroca && (
        <DialogoMotivo titulo={T.TITULO_TROCAR} aviso={T.AVISO_TROCAR} semTexto destrutivo rotuloConfirmar={T.ROTULOS_ENTRADA.trocar} aoConfirmar={gerar} aoCancelar={() => setPedirTroca(false)} />
      )}
      {pedirRevogar && (
        <DialogoMotivo titulo={T.TITULO_REVOGAR} aviso={T.AVISO_REVOGAR} semTexto destrutivo rotuloConfirmar={T.ROTULOS_ENTRADA.revogar} aoConfirmar={revogar} aoCancelar={() => setPedirRevogar(false)} />
      )}
    </CartaoLigacao>
  );
}

/**
 * Chave mostrada uma vez (README B). Foco inicial no Copiar; Esc e fundo chamam o mesmo `aoFechar`, que, sem Copiar, abre a
 * confirmação "Fechar sem copiar a chave?" (WCAG 2.1.2: Esc nunca fica preso, mas a chave não se perde sem aviso).
 */
export function DialogoChave({ estado, aoAcionar }: { estado: EstadoChave; aoAcionar: (a: AcaoChave) => void }) {
  const copiar = useRef<HTMLButtonElement>(null);
  const confirmando = estado.confirmandoFechar;
  useEffect(() => {
    // ao abrir e ao voltar da confirmação o foco fica no Copiar (o Dialogo da confirmação devolveria ao fundo se o clique fosse nele)
    if (!confirmando) copiar.current?.focus();
  }, [confirmando]);

  const copiarChave = async () => {
    try {
      await navigator.clipboard.writeText(estado.chave ?? '');
      aoAcionar({ tipo: 'copiou', ok: true });
    } catch {
      aoAcionar({ tipo: 'copiou', ok: false });
    }
  };

  return (
    <>
      <Dialogo
        titulo={T.TITULO_CHAVE}
        aviso={T.AVISO_CHAVE}
        tomAviso="aviso"
        aoFechar={() => aoAcionar({ tipo: 'fechar' })}
        rodape={<button type="button" className="mx-botao" onClick={() => aoAcionar({ tipo: 'ja-copiei' })}>Já copiei</button>}
      >
        <p className="apoio">{T.AJUDA_CHAVE}</p>
        <code className="segredo" data-segredo style={{ wordBreak: 'break-all' }}>{estado.chave}</code>
        <div className="barra-acoes">
          <button type="button" className="mx-botao-secundario" ref={copiar} onClick={() => void copiarChave()}>Copiar</button>
          <p className="apoio" role="status" style={{ margin: 0 }}>{estado.copiou === 'sim' ? T.COPIADA : estado.copiou === 'falhou' ? T.COPIA_FALHOU : ''}</p>
        </div>
      </Dialogo>
      {confirmando && (
        <DialogoMotivo
          titulo={T.TITULO_FECHAR_SEM_COPIAR}
          aviso={T.AVISO_FECHAR_SEM_COPIAR}
          semTexto
          destrutivo
          rotuloConfirmar="Fechar sem copiar"
          rotuloFechar="Voltar"
          aoConfirmar={() => aoAcionar({ tipo: 'descartar' })}
          aoCancelar={() => aoAcionar({ tipo: 'voltar' })}
        />
      )}
    </>
  );
}
