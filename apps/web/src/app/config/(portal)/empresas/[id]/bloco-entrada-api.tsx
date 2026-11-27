'use client';
import type { PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { Chip, Dialogo, DialogoMotivo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useReducer, useRef, useState, useTransition } from 'react';
import { botaoDaChave, ehGeracaoIncerta, estadoDaChave, reduzirChave, validarConectorId, vistaEntrada, type EstadoChave, type LinhaLote } from '@/lib/config/entrada';
import * as T from '@/lib/config/entrada-textos';
import { gerarChaveEntradaAcao, revogarChaveEntradaAcao } from '../acoes-entrada';

type Mensagem = { ok: boolean; texto: string } | null;

/**
 * Bloco "Integração via API" da aba Integração (T-0057 A1, docs/design/entrada-cenario-b/README.md, seções A, B e F; sem a
 * coluna "via Conector" e sem a tabela de donos). Gera, troca e revoga a chave, mostra a chave uma vez e lista os lotes.
 * A chave nova só vive no estado do diálogo (`EstadoChave`): sem URL, armazenamento nem log; fechar a descarta.
 */
export function BlocoEntradaApi({ empresaId, dados, fuso }: { empresaId: string; dados: PortalEntradaLeitura | null; fuso: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [chave, despachar] = useReducer(reduzirChave, undefined, estadoDaChave);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [erroCodigo, setErroCodigo] = useState('');
  const [incerta, setIncerta] = useState(false);
  const [pedirTroca, setPedirTroca] = useState(false);
  const [pedirRevogar, setPedirRevogar] = useState(false);
  const idCodigo = useId();
  const campo = useRef<HTMLInputElement>(null);
  const v = vistaEntrada(dados, fuso);
  const botao = botaoDaChave(v.vigente !== null, incerta);

  const codigoDigitado = () => v.vigente?.conectorId ?? campo.current?.value ?? '';

  const gerar = () => {
    setPedirTroca(false);
    const c = validarConectorId(codigoDigitado());
    if (!c.ok) return setErroCodigo(c.erro);
    setErroCodigo('');
    setMensagem(null);
    iniciar(async () => {
      const r = await gerarChaveEntradaAcao(empresaId, c.valor);
      setIncerta(ehGeracaoIncerta(r));
      if (r.ok) {
        despachar({ tipo: 'gerada', chave: r.valor.chave });
        router.refresh();
      } else {
        setErroCodigo(r.campos.conector_id ?? '');
        setMensagem(r.campos.conector_id ? null : { ok: false, texto: r.erro });
      }
    });
  };
  const revogar = () => {
    setPedirRevogar(false);
    setMensagem(null);
    iniciar(async () => {
      const r = await revogarChaveEntradaAcao(empresaId, v.vigente?.conectorId ?? '');
      setMensagem(r.ok ? { ok: true, texto: 'Chave revogada.' } : { ok: false, texto: r.erro });
      if (r.ok) router.refresh();
    });
  };

  return (
    <>
      <section className="bloco" aria-labelledby="h-entrada-api">
        <h2 id="h-entrada-api">{T.TITULO_BLOCO_ENTRADA}</h2>
        {mensagem && <p className={mensagem.ok ? 'faixa-aviso' : 'erro'} role={mensagem.ok ? 'status' : 'alert'}>{mensagem.texto}</p>}
        {v.vigente ? (
          <dl className="ficha" aria-label="Chave de entrada">
            <div><dt>Prefixo da chave</dt><dd className="codigo">{v.vigente.prefixo}</dd></div>
            <div><dt>Versão</dt><dd>{v.vigente.versao}</dd></div>
            <div><dt>Último sinal</dt><dd>{v.vigente.ultimoSinal}</dd></div>
            <div><dt>Chave criada em</dt><dd>{v.vigente.criadaEm}</dd></div>
          </dl>
        ) : (
          <p className="apoio">{T.SEM_CHAVE}</p>
        )}
        <form aria-label="Chave da integração via API" onSubmit={(ev) => { ev.preventDefault(); if (botao.pedeConfirmacao) setPedirTroca(true); else gerar(); }}>
          <label className="campo">
            <span>Código do conector</span>
            <input
              ref={campo}
              name="conector_id"
              defaultValue={v.codigoSugerido}
              readOnly={v.vigente !== null}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={erroCodigo ? true : undefined}
              aria-describedby={`${idCodigo}-ajuda${erroCodigo ? ` ${idCodigo}-erro` : ''}`}
            />
          </label>
          <p id={`${idCodigo}-ajuda`} className="apoio">{v.vigente ? T.AJUDA_CODIGO_FIXO : T.AJUDA_CODIGO_LIVRE}</p>
          {erroCodigo && <p id={`${idCodigo}-erro`} className="erro-campo" role="alert">{erroCodigo}</p>}
          <div className="barra-acoes">
            <button type="submit" className="mx-botao" disabled={pendente}>{botao.rotulo}</button>
            {v.vigente && <button type="button" className="mx-botao-secundario" disabled={pendente} onClick={() => setPedirRevogar(true)}>Revogar chave</button>}
          </div>
        </form>
      </section>
      <section className="bloco" aria-labelledby="h-lotes-entrada">
        <h2 id="h-lotes-entrada">{T.TITULO_LOTES_ENTRADA}</h2>
        <ListaLotes lotes={v.lotes} />
      </section>
      {chave.chave && <DialogoChave estado={chave} aoAcionar={despachar} />}
      {pedirTroca && (
        <DialogoMotivo titulo={T.TITULO_TROCAR} aviso={T.AVISO_TROCAR} semTexto destrutivo rotuloConfirmar="Trocar chave" rotuloFechar="Cancelar" aoConfirmar={gerar} aoCancelar={() => setPedirTroca(false)} />
      )}
      {pedirRevogar && (
        <DialogoMotivo titulo={T.TITULO_REVOGAR} aviso={T.AVISO_REVOGAR} semTexto destrutivo rotuloConfirmar="Revogar chave" rotuloFechar="Cancelar" aoConfirmar={revogar} aoCancelar={() => setPedirRevogar(false)} />
      )}
    </>
  );
}

/** Lista dos lotes recebidos: só contagens e datas (nunca o dado). */
export function ListaLotes({ lotes }: { lotes: LinhaLote[] }) {
  const colunas: ColunaTabela<LinhaLote>[] = [
    { id: 'cadastro', titulo: 'Cadastro', celula: (l) => l.cadastro },
    { id: 'recebidoEm', titulo: 'Recebido em', tipo: 'data', celula: (l) => l.recebidoEm },
    { id: 'recebidos', titulo: 'Recebidos', tipo: 'numero' },
    { id: 'comErro', titulo: 'Com erro', tipo: 'numero' },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => <Chip tom={l.situacao.tom}>{l.situacao.texto}</Chip> },
  ];
  return (
    <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
      <TabelaDensa colunas={colunas} linhas={lotes} chaveLinha={(l) => l.id} textoVazio={T.SEM_LOTES} legenda="Lotes recebidos do cliente pela integração via API" />
    </div>
  );
}

/**
 * Chave mostrada uma vez (README B). Foco inicial no Copiar; Esc e fundo chamam o mesmo `aoFechar`, que, sem Copiar, abre a
 * confirmação "Fechar sem copiar a chave?" (WCAG 2.1.2: Esc nunca fica preso, mas a chave não se perde sem aviso).
 */
export function DialogoChave({ estado, aoAcionar }: { estado: EstadoChave; aoAcionar: (a: Parameters<typeof reduzirChave>[1]) => void }) {
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
