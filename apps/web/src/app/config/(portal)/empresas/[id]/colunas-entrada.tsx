'use client';
import { AlertaBloqueante, Dialogo, DialogoMotivo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  CADASTROS_ENTRADA, decidirConfirmacao, definirDono, gerarCredencial,
  type CanalEntrada, type ConfirmacaoPendente, type CredencialEntrada, type DonoEntrada, type EntradaPortal, type Enviar,
} from '@/lib/config/entrada-provisorio';
import { ROTULO_DONO, TEXTOS_ENTRADA, avisoDono, hora, linhasEntrada, textoApoioTrava, textoTrava, type LinhaEntrada } from '@/lib/config/entrada';
import { ROTULO_ENTIDADE } from '@macuxierp/integracao-fdv/web';
import type { EntidadeEnvioFdv } from '@macuxierp/platform-sdk';

/** Cenário B (ADR 0014 §5, §14 e §3). Contrato provisório: ver `lib/config/entrada-provisorio.ts`. */

/**
 * A chave só existe nesta prop (estado do pai): nunca em URL, armazenamento ou log. "Já copiei" fecha sempre; Esc e fundo fecham,
 * mas antes de usar "Copiar" pedem confirmação ("Fechar sem copiar a chave?"). O foco inicial cai em "Copiar" (primeiro foco do Dialogo).
 */
export function DialogoChave({ chave, aoCopiar, aoConcluir }: { chave: string; aoCopiar: () => void; aoConcluir: () => void }) {
  const [copiou, setCopiou] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const fechar = () => (copiou ? aoConcluir() : setConfirmando(true));
  return (
    <>
      <Dialogo
        titulo="Chave gerada"
        aoFechar={fechar}
        aviso={TEXTOS_ENTRADA.avisoChave}
        rodape={<button type="button" className="mx-botao" onClick={aoConcluir}>Já copiei</button>}
      >
        <div>
          <button type="button" className="mx-botao-secundario" onClick={() => { setCopiou(true); aoCopiar(); }}>Copiar</button>
        </div>
        <code data-chave-gerada style={{ overflowWrap: 'anywhere' }}>{chave}</code>
      </Dialogo>
      {confirmando && (
        <DialogoMotivo
          titulo={TEXTOS_ENTRADA.fecharSemCopiarTitulo}
          semTexto
          destrutivo
          rotuloConfirmar="Fechar sem copiar"
          rotuloFechar="Voltar"
          aoConfirmar={aoConcluir}
          aoCancelar={() => setConfirmando(false)}
        />
      )}
    </>
  );
}

export function DialogoDono({ rotulo, para, aoConfirmar, aoCancelar }: { rotulo: string; para: DonoEntrada; aoConfirmar: () => void; aoCancelar: () => void }) {
  return (
    <Dialogo
      titulo={`Passar ${rotulo} para ${para === 'cliente' ? 'o servidor do cliente' : 'o Macuxi ERP'}?`}
      aoFechar={aoCancelar}
      rodape={<><button type="button" className="mx-botao-secundario" onClick={aoCancelar}>Cancelar</button><button type="button" className="mx-botao" onClick={aoConfirmar}>Passar</button></>}
    >
      <p>{para === 'cliente' ? TEXTOS_ENTRADA.paraCliente : TEXTOS_ENTRADA.paraErp}</p>
    </Dialogo>
  );
}

/** Trava de 30%. Foco inicial em "Cancelar". Recusar não pede segunda confirmação. */
export function DialogoTrava({ cadastro, pendente, fuso, aoInativar, aoRecusar, aoCancelar }: { cadastro: EntidadeEnvioFdv; pendente: ConfirmacaoPendente; fuso: string; aoInativar: () => void; aoRecusar: () => void; aoCancelar: () => void }) {
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelar.current?.focus(); }, []);
  return (
    <Dialogo
      titulo={`Confirmar inativação de ${ROTULO_ENTIDADE[cadastro]}`}
      aoFechar={aoCancelar}
      tomAviso="erro"
      aviso={textoTrava(cadastro, pendente)}
      rodape={<>
        <button type="button" className="mx-botao-destrutivo" onClick={aoInativar}>Inativar</button>
        <button type="button" className="mx-botao-secundario" onClick={aoRecusar}>Recusar lote</button>
        <button type="button" className="mx-botao-secundario" ref={cancelar} onClick={aoCancelar}>Cancelar</button>
      </>}
    >
      <p>{TEXTOS_ENTRADA.avisoTrava}</p>
      <p className="apoio">{textoApoioTrava(pendente.expira_em, fuso)}</p>
    </Dialogo>
  );
}

export function ColunaCredencial({ titulo, cred, fuso, ocupado, erroCampo, aoGerar }: { titulo: string; cred: CredencialEntrada | null; fuso: string; ocupado: boolean; erroCampo: string | null; aoGerar: (conectorId: string) => void }) {
  const id = useId();
  const [codigo, setCodigo] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const gerar = () => { setConfirmando(false); aoGerar(cred ? cred.conector_id : codigo.trim()); };
  return (
    <section className="bloco" aria-label={titulo}>
      <h2>{titulo}</h2>
      {cred ? (
        <dl className="ficha">
          <div><dt>Código do conector</dt><dd>{cred.conector_id}</dd></div>
          <div><dt>Chave</dt><dd>{cred.prefixo_chave}…</dd></div>
          <div><dt>Chave criada em</dt><dd>{hora(cred.criada_em, fuso)}</dd></div>
          <div><dt>Último sinal</dt><dd>{hora(cred.ultimo_sinal_em, fuso)}</dd></div>
          <div><dt>Versão</dt><dd>{cred.versao ?? '—'}</dd></div>
        </dl>
      ) : (
        <>
          <p className="apoio">{TEXTOS_ENTRADA.semCredencial}</p>
          <div className="campo">
            <label htmlFor={`${id}-codigo`}>Código do conector</label>
            <input id={`${id}-codigo`} className="entrada" value={codigo} maxLength={100} onChange={(e) => setCodigo(e.target.value)} aria-invalid={erroCampo ? true : undefined} aria-describedby={erroCampo ? `${id}-erro` : undefined} />
          </div>
        </>
      )}
      {erroCampo && <span id={`${id}-erro`} className="erro-campo">{erroCampo}</span>}
      {confirmando ? (
        <>
          <p className="faixa-aviso" role="status">{TEXTOS_ENTRADA.trocaChave}</p>
          <div className="barra-acoes">
            <button type="button" className="mx-botao-secundario" onClick={() => setConfirmando(false)}>Cancelar</button>
            <button type="button" className="mx-botao-destrutivo" disabled={ocupado} onClick={gerar}>Trocar chave</button>
          </div>
        </>
      ) : (
        <div className="barra-acoes">
          <button type="button" className="mx-botao-secundario" disabled={ocupado || (!cred && codigo.trim() === '')} onClick={cred ? () => setConfirmando(true) : gerar}>{cred ? 'Trocar chave' : 'Gerar chave'}</button>
        </div>
      )}
    </section>
  );
}

export function ListaCadastrosEntrada({ linhas, ocupado, aoTrocarDono, aoConfirmarPendente }: { linhas: LinhaEntrada[]; ocupado: boolean; aoTrocarDono: (c: EntidadeEnvioFdv, para: DonoEntrada) => void; aoConfirmarPendente: (c: EntidadeEnvioFdv) => void }) {
  const id = useId();
  const colunas: ColunaTabela<LinhaEntrada>[] = [
    { id: 'rotulo', titulo: 'Cadastro', celula: (l) => (l.segue ? <span style={{ paddingLeft: 16 }}>{l.rotulo}</span> : l.rotulo) },
    {
      id: 'dono', titulo: 'Dono',
      celula: (l) => {
        if (l.segue) return <span>{l.segue}</span>;
        const preso = l.pendente !== null;
        const descr = `${id}-${l.cadastro}-preso`;
        return (
          <>
            <select aria-label={`Dono: ${l.rotulo}`} value={l.dono} disabled={ocupado || preso} aria-describedby={preso ? descr : undefined} onChange={(e) => aoTrocarDono(l.cadastro, e.target.value as DonoEntrada)}>
              <option value="erp">{ROTULO_DONO.erp}</option>
              <option value="cliente">{ROTULO_DONO.cliente}</option>
            </select>
            {preso && <span id={descr} className="so-leitor">{TEXTOS_ENTRADA.donoPendente}</span>}
          </>
        );
      },
    },
    { id: 'lote', titulo: 'Último lote', celula: (l) => l.ultimoLote },
    { id: 'erros', titulo: 'Erros', tipo: 'numero', celula: (l) => String(l.erros) },
    {
      id: 'situacao', titulo: 'Situação',
      celula: (l) => l.pendente
        ? <button type="button" className="mx-botao-secundario" disabled={ocupado} onClick={() => aoConfirmarPendente(l.cadastro)} aria-label={`Confirmar inativação: ${l.rotulo}`}>Confirmar inativação</button>
        : (l.erros > 0 ? 'Com erros' : 'Em dia'),
    },
  ];
  return (
    <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
      <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.cadastro} textoVazio="Nenhum cadastro." legenda="Entrada por cadastro" />
    </div>
  );
}

type Dono = { cadastro: EntidadeEnvioFdv; para: DonoEntrada };
type ErroCampo = { canal: CanalEntrada; texto: string };

export function ColunasEntrada({ empresaId, entrada, fuso, enviar }: { empresaId: string; entrada: EntradaPortal | null; fuso: string; enviar?: Enviar }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  const [chave, setChave] = useState<string | null>(null);
  const [troca, setTroca] = useState<Dono | null>(null);
  const [trava, setTrava] = useState<EntidadeEnvioFdv | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<ErroCampo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vencido, setVencido] = useState(false);
  const idem = useRef(new Map<string, string>());
  const chaveIdem = (k: string) => { const v = idem.current.get(k) ?? crypto.randomUUID(); idem.current.set(k, v); return v; };
  const feito = (k: string) => idem.current.delete(k);
  const limpar = () => { setErro(null); setErroCampo(null); setAviso(null); setVencido(false); };

  const gerar = (canal: CanalEntrada, conectorId: string) => iniciar(async () => {
    const k = `credencial:${canal}`;
    limpar();
    const r = await gerarCredencial(empresaId, canal, conectorId, chaveIdem(k), enviar);
    if (r.ok) { feito(k); return setChave(r.valor.chave); }
    feito(k);
    if (r.status === 503) return setErro(TEXTOS_ENTRADA.erro503);
    if (r.status === 409) return setErroCampo({ canal, texto: TEXTOS_ENTRADA.erro409Codigo });
    if (r.status === 400) return setErroCampo({ canal, texto: TEXTOS_ENTRADA.erro400Codigo });
    if (r.status === 0) { setErro(TEXTOS_ENTRADA.erroRedeChave); return router.refresh(); }
    setErro(r.erro);
  });
  const copiar = () => { if (chave) void navigator.clipboard?.writeText(chave).catch(() => setErro('Não foi possível copiar. Selecione a chave e copie.')); };
  const concluirChave = () => { setChave(null); router.refresh(); };
  const trocarDono = (t: Dono) => { setTroca(null); iniciar(async () => {
    const k = `dono:${t.cadastro}:${t.para}`;
    limpar();
    const r = await definirDono(empresaId, t.cadastro, t.para, chaveIdem(k), enviar);
    if (!r.ok) {
      feito(k);
      if (r.status === 409) return setErro(TEXTOS_ENTRADA.donoEmAndamento);
      if (r.status === 422) router.refresh();
      return setErro(r.erro);
    }
    feito(k); setAviso(avisoDono(ROTULO_ENTIDADE[t.cadastro], r.valor.carga_completa_pedida === true)); router.refresh();
  }); };
  const decidir = (loteId: string, decisao: 'aprovar' | 'recusar') => { setTrava(null); iniciar(async () => {
    const k = `confirmacao:${loteId}:${decisao}`;
    limpar();
    const r = await decidirConfirmacao(empresaId, loteId, decisao, chaveIdem(k), enviar);
    if (r.ok) { feito(k); if (decisao === 'recusar') setAviso(TEXTOS_ENTRADA.loteRecusado); return router.refresh(); }
    feito(k);
    if (r.status === 410) { setVencido(true); return router.refresh(); }
    if (r.status === 404) router.refresh();
    setErro(r.erro);
  }); };

  const linhas = linhasEntrada(entrada?.cadastros ?? [], fuso);
  const pendente = trava ? linhas.find((l) => l.cadastro === trava)?.pendente ?? null : null;
  const trocaRotulo = troca ? ROTULO_ENTIDADE[troca.cadastro] : '';
  const campo = (canal: CanalEntrada) => (erroCampo?.canal === canal ? erroCampo.texto : null);
  return (
    <div data-testid="entrada" className="entrada-colunas">
      {erro && <p className="erro" role="alert">{erro}</p>}
      {aviso && <p className="faixa-aviso" role="status">{aviso}</p>}
      {vencido && <AlertaBloqueante titulo={TEXTOS_ENTRADA.prazoTitulo}>{TEXTOS_ENTRADA.prazoCorpo}</AlertaBloqueante>}
      <div className="entrada-duas">
        <ColunaCredencial titulo={TEXTOS_ENTRADA.tituloConector} cred={entrada?.credenciais.conector ?? null} fuso={fuso} ocupado={ocupado} erroCampo={campo('conector')} aoGerar={(id) => gerar('conector', id)} />
        <ColunaCredencial titulo={TEXTOS_ENTRADA.tituloApi} cred={entrada?.credenciais.api ?? null} fuso={fuso} ocupado={ocupado} erroCampo={campo('api')} aoGerar={(id) => gerar('api', id)} />
      </div>
      <section className="bloco" aria-label="Cadastros de entrada">
        <h2>{TEXTOS_ENTRADA.tituloCadastros}</h2>
        {entrada && linhas.length === CADASTROS_ENTRADA.length
          ? <ListaCadastrosEntrada linhas={linhas} ocupado={ocupado} aoTrocarDono={(c, para) => setTroca({ cadastro: c, para })} aoConfirmarPendente={setTrava} />
          : <p className="apoio" data-testid="entrada-vazia">{TEXTOS_ENTRADA.semDados}</p>}
      </section>
      {chave && <DialogoChave chave={chave} aoCopiar={copiar} aoConcluir={concluirChave} />}
      {troca && <DialogoDono rotulo={trocaRotulo} para={troca.para} aoConfirmar={() => trocarDono(troca)} aoCancelar={() => setTroca(null)} />}
      {trava && pendente && <DialogoTrava cadastro={trava} pendente={pendente} fuso={fuso} aoInativar={() => decidir(pendente.lote_id, 'aprovar')} aoRecusar={() => decidir(pendente.lote_id, 'recusar')} aoCancelar={() => setTrava(null)} />}
    </div>
  );
}
