'use client';
import { LIMITE_REGISTROS_LOTE_FDV, type PortalEntradaLeitura, type EntidadeEnvioFdv, type IntegracaoFdvPlataforma, type MonitorConectorFdv } from '@macuxierp/platform-sdk';
import { DialogoMotivo, MenuAcoes, ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela, type Resultado as ResultadoUi } from '@macuxierp/ui';
import { SeloTom } from '@/components/selo-tom';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { AMBIENTES_FDV, LIMITE_INICIAL_FDV, habilitadasApos, validarLimiteLote, acoesDaLinhaFdv, menuDaLinha, linhasCadastros, avisoLigar, type LinhaCadastroFdv } from '@/lib/config/integracao-fdv';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { TEXTO_SEM_LICENCA_FDV } from '@/lib/integracao-fdv-textos';
import { colunasStatusFdv } from '@/lib/integracao-fdv';
import { textoZerado } from '@/lib/config/cargas';
import type { Resultado } from '@/lib/config/executar';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { configurarFdvAcao, lerMonitorFdvAcao, reprocessarFdvAcao, retomarFdvAcao, salvarCredencialFdvAcao, testarConexaoFdvAcao } from '../acoes-integracao-fdv';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { RETORNOS_FDV, ROTULOS_FDV, maisRecente, textoAtualizado, textoReprocessarOk, vistaMonitor } from '@/lib/config/operacao-fdv';
import { BlocoEntradaApi } from './bloco-entrada-api';
import { LogCadastro } from './log-cadastro';
import { ZerarCadastro } from './zerar-cadastro';
import { ZerarPedidos } from './zerar-pedidos';
import { textoPedidosZerados } from '@/lib/config/pedidos-zerar';

type Pedido = { tipo: 'ligar' | 'desligar' | 'retomar'; linha: LinhaCadastroFdv };

/**
 * Aba "Integração" da ficha da empresa (T-0056, ADR 0013, molde: aba Integração do portal do FDV). Só o superadmin chega aqui
 * (todo o /config é do superadmin). v0.3.4: só o grupo 'Macuxi FDV' (cartões 'Conexão com o Macuxi FDV' e 'Cadastros enviados ao Macuxi FDV').
 *
 * LUGAR RESERVADO (cenário B, depois): duas colunas de ENTRADA, "Integração via Conector" e "Integração via API", ao lado deste grupo
 * no desktop e empilhadas abaixo de 768 px (`.integracao-colunas`). Sem tela para elas agora.
 *
 * A chave do conector fica só no campo até o envio: sem estado, URL, armazenamento nem log; depois de salvar, o campo é limpo e a
 * tela mostra só o prefixo e as datas que a API devolve.
 */
export function AbaIntegracao({ empresaId, dados, fuso, monitor: monitorInicial = null, entrada = null }: { empresaId: string; dados: IntegracaoFdvPlataforma; fuso: string; monitor?: MonitorConectorFdv | null; entrada?: PortalEntradaLeitura | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  // 36 A: um resultado por botão, logo abaixo dele (docs/design/resultado-acao/README.md).
  const [rAtualizar, kAtualizar, mostrarAtualizar] = useResultado();
  const [rChave, kChave, mostrarChave] = useResultado();
  const [rTestar, kTestar, mostrarTestar] = useResultado();
  const [rLimite, kLimite, mostrarLimite] = useResultado();
  const [rLinha, kLinha, mostrarLinha] = useResultado(); // menu "Ações" das linhas da tabela
  const [rZerarPedidos, kZerarPedidos, mostrarZerarPedidos] = useResultado();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [lido, setLido] = useState<MonitorConectorFdv | null>(null);
  const [log, setLog] = useState<LinhaCadastroFdv | null>(null);
  const [zerar, setZerar] = useState<LinhaCadastroFdv | null>(null);
  const [zerarPedidos, setZerarPedidos] = useState(false);
  const [trocarChave, setTrocarChave] = useState(false);
  const formChave = useRef<HTMLFormElement | null>(null);
  const monitor = maisRecente(monitorInicial, lido);
  const chaves = useRef(new ChavesIdempotencia());
  const linhas = linhasCadastros(dados, fuso);
  const semCredencial = dados.credencial_id === null;
  const bloqueado = pendente || !dados.modulo_licenciado;

  /** Uma Idempotency-Key por ação e cadastro; só renova depois de resposta definitiva (repetição de rede reaproveita). */
  const chaveDe = (id: string) => chaves.current.de(id);
  const concluir = <T,>(id: string | null, r: Resultado<T>, textoOk: string, mostrar: (x: ResultadoUi) => void) => {
    chaves.current.aposResposta(id, r);
    setCampos(r.ok ? {} : r.campos);
    mostrar(r.ok ? resultadoSucesso(textoOk) : resultadoErro(r.erro || 'Confira os campos.'));
    if (r.ok) router.refresh();
  };

  const salvarCredencial = (f: HTMLFormElement) => {
    const d = new FormData(f);
    iniciar(async () => {
      const r = await salvarCredencialFdvAcao(empresaId, { conector_id: String(d.get('conector_id') ?? ''), chave: String(d.get('chave') ?? ''), ambiente: String(d.get('ambiente') ?? '') });
      if (r.ok) f.reset(); // a chave sai do campo na hora
      concluir(null, r, RETORNOS_FDV.chaveSalva, mostrarChave);
    });
  };
  /** Salvar a 1ª chave grava direto; trocar a que existe pede confirmação (a chave antiga para na hora). A chave segue só no campo: o formulário é guardado, não o valor. */
  const enviarChave = (f: HTMLFormElement) => {
    if (semCredencial) return salvarCredencial(f);
    formChave.current = f;
    setTrocarChave(true);
  };
  const salvarLimite = (f: HTMLFormElement) => {
    const v = validarLimiteLote(String(new FormData(f).get('limite_registros_lote') ?? ''));
    if (!v.ok) return setCampos({ limite_registros_lote: v.erro });
    const chave = `lim:${dados.entidades_habilitadas.join(',')}:${v.valor}`;
    iniciar(async () => concluir(chave, await configurarFdvAcao(empresaId, { entidades_habilitadas: dados.entidades_habilitadas, limite_registros_lote: v.valor }, chaveDe(chave)), RETORNOS_FDV.limiteSalvo, mostrarLimite));
  };
  const testar = () => iniciar(async () => concluir('testar', await testarConexaoFdvAcao(empresaId, chaveDe('testar')), RETORNOS_FDV.testeIniciado, mostrarTestar));
  /** Reprocessar (só falhas e pendentes): sem confirmação, não apaga nada. 409 com lote em voo vira a mensagem da API. */
  const reprocessar = (l: LinhaCadastroFdv) => {
    const id = `reproc:${l.entidade}`;
    iniciar(async () => {
      const r = await reprocessarFdvAcao(empresaId, l.entidade, chaveDe(id));
      concluir(id, r, r.ok ? textoReprocessarOk(r.valor.falhas, r.valor.pendentes) : '', mostrarLinha);
    });
  };
  /** Atualizar: relê o Monitor (com `lido_em`) e a ficha (`router.refresh`, que traz os cadastros e o último sinal). */
  const atualizar = () =>
    iniciar(async () => {
      const r = await lerMonitorFdvAcao(empresaId);
      if (r.ok) setLido(r.valor);
      if (!r.ok) mostrarAtualizar(resultadoErro(r.erro || 'Não foi possível atualizar. Tente de novo.'));
      router.refresh();
    });
  const confirmar = (p: Pedido) => {
    setPedido(null);
    const e: EntidadeEnvioFdv = p.linha.entidade;
    iniciar(async () => {
      if (p.tipo === 'retomar') {
        const r = await retomarFdvAcao(empresaId, e, chaveDe(`retomar:${e}`));
        return concluir(`retomar:${e}`, r, r.ok && !r.valor.retomada ? RETORNOS_FDV.naoEstavaParado : RETORNOS_FDV.envioLiberado, mostrarLinha);
      }
      const ligar = p.tipo === 'ligar';
      const nova = habilitadasApos(dados.entidades_habilitadas, e, ligar);
      return concluir(`cfg:${e}:${nova.join(',')}`, await configurarFdvAcao(empresaId, { entidades_habilitadas: nova, limite_registros_lote: dados.limite_registros_lote ?? LIMITE_INICIAL_FDV }, chaveDe(`cfg:${e}:${nova.join(',')}`)), ligar ? RETORNOS_FDV.ligado : RETORNOS_FDV.desligado, mostrarLinha);
    });
  };

  /** Botão "Ações" da linha (T-0099): a principal muda pela situação (pausada → Tentar de novo; falha → Reprocessar; senão Log); Zerar (perigo) fica por último. */
  const acoesDaLinha = (l: LinhaCadastroFdv) => {
    const fazer: Record<string, () => void> = {
      ligar: () => setPedido({ tipo: l.ligada ? 'desligar' : 'ligar', linha: l }),
      retomar: () => setPedido({ tipo: 'retomar', linha: l }),
      reprocessar: () => reprocessar(l),
      log: () => setLog(l),
      zerar: () => setZerar(l),
    };
    const a = acoesDaLinhaFdv(l, { bloqueado, semCredencial, licenciado: dados.modulo_licenciado });
    return <MenuAcoes rotuloLinha={l.rotulo} {...menuDaLinha(a, fazer)} />;
  };

  const colunas: ColunaTabela<LinhaCadastroFdv>[] = [
    ...colunasStatusFdv<LinhaCadastroFdv>(),
    {
      id: 'acoes',
      titulo: 'Ações',
      celula: acoesDaLinha,
    },
  ];

  return (
    <div className="integracao-colunas">
      {/* T-0057 A1: só o bloco "Integração via API" (a coluna "via Conector" e a tabela de donos entram depois). */}
      <div aria-label="Entrada de dados do cliente" role="group">
        <BlocoEntradaApi empresaId={empresaId} dados={entrada} fuso={fuso} />
      </div>
      <div aria-label="Macuxi FDV" role="group">
        {!dados.modulo_licenciado && <p className="faixa-aviso" role="status">{TEXTO_SEM_LICENCA_FDV}</p>}
      <section className="bloco" aria-labelledby="h-monitor">
        <div className="cabeca-cargas cabeca-monitor">
          <h2 id="h-monitor">Monitor</h2>
          <span className="barra-acoes" style={{ margin: 0 }}>
            {monitor && <span className="apoio atualizado-monitor" data-testid="atualizado-as" aria-live="polite">{textoAtualizado(monitor.lido_em, fuso)}</span>}
            <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={atualizar}>Atualizar</button>
          </span>
        </div>
        <ResultadoAcao resultado={rAtualizar} chave={kAtualizar} />
        {monitor ? <BlocoMonitor monitor={monitor} fuso={fuso} ultimoCodigo={dados.ultimo_sinal?.ultimo_codigo} /> : <p className="apoio" data-testid="monitor-indisponivel">Monitor indisponível agora.</p>}
      </section>
      <section className="bloco" aria-labelledby="h-cred">
        <h2 id="h-cred">Conexão com o Macuxi FDV</h2>
        {dados.credencial_id ? (
          <dl className="ficha">
            <div><dt>Chave</dt><dd>{dados.chave_prefixo}…</dd></div>
            <div><dt>Criada em</dt><dd>{dados.criada_em ? formatarDataHora(dados.criada_em, fuso) : '—'}</dd></div>
          </dl>
        ) : (
          <p className="apoio">Nenhuma chave salva. Informe o código e a chave do conector.</p>
        )}
        <form aria-label="Conexão com o Macuxi FDV" onSubmit={(ev) => { ev.preventDefault(); enviarChave(ev.currentTarget); }}>
          <label className="campo"><span>Código do conector</span><input name="conector_id" defaultValue={dados.conector_id ?? ''} maxLength={64} autoComplete="off" required /></label>
          {campos.conector_id && <p className="erro-campo" role="alert">{campos.conector_id}</p>}
          <label className="campo"><span>Nova chave do conector</span><input name="chave" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} required /></label>
          {campos.chave && <p className="erro-campo" role="alert">{campos.chave}</p>}
          <label className="campo"><span>Ambiente</span><select name="ambiente" defaultValue={dados.ambiente ?? 'teste'}>{AMBIENTES_FDV.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
          {campos.ambiente && <p className="erro-campo" role="alert">{campos.ambiente}</p>}
          <div className="barra-acoes">
            <button className="mx-botao" type="submit" disabled={bloqueado}>{semCredencial ? ROTULOS_FDV.salvarChave : ROTULOS_FDV.trocarChave}</button>
            <button className="mx-botao-secundario" type="button" disabled={bloqueado || semCredencial} onClick={testar}>Testar conexão</button>
            {/* Fila de dois botões: cada um com o seu resultado, na linha de baixo e na ordem dos botões (decisão 36 A). */}
            <ResultadoAcao resultado={rChave} chave={kChave} />
            <ResultadoAcao resultado={rTestar} chave={kTestar} />
          </div>
        </form>
      </section>
      <section className="bloco" aria-labelledby="h-env">
        <h2 id="h-env">Cadastros enviados ao Macuxi FDV</h2>
        <form aria-label="Registros por lote" onSubmit={(ev) => { ev.preventDefault(); salvarLimite(ev.currentTarget); }}>
          <label className="campo"><span>Registros por lote</span><input name="limite_registros_lote" type="number" inputMode="numeric" min={1} max={LIMITE_REGISTROS_LOTE_FDV} step={1} defaultValue={dados.limite_registros_lote ?? LIMITE_INICIAL_FDV} required /></label>
          {campos.limite_registros_lote && <p className="erro-campo" role="alert">{campos.limite_registros_lote}</p>}
          <div className="barra-acoes"><button className="mx-botao-secundario" type="submit" disabled={bloqueado || semCredencial}>Salvar</button><ResultadoAcao resultado={rLimite} chave={kLimite} /></div>
        </form>
        {!linhas.some((l) => l.ligada) && <p className="apoio" data-testid="nenhum-ligado">Nenhum cadastro ligado.</p>}
        <div className="tabela-rolavel com-sinal-rolagem tabela-fdv legenda-so-leitor">
          <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.entidade} textoVazio="Nenhum cadastro." legenda="Envio por cadastro" />
        </div>
        <ResultadoAcao resultado={rLinha} chave={kLinha} />
        <div className="barra-acoes"><button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={() => setZerarPedidos(true)}>Zerar pedidos não faturados</button><ResultadoAcao resultado={rZerarPedidos} chave={kZerarPedidos} /></div>
      </section>
      </div>
      {log && <LogCadastro empresaId={empresaId} entidade={log.entidade} rotulo={log.rotulo} fuso={fuso} aoFechar={() => setLog(null)} />}
      {zerar && (
        <ZerarCadastro
          empresaId={empresaId}
          entidade={zerar.entidade}
          rotulo={zerar.rotulo}
          aoFechar={() => setZerar(null)}
          aoZerar={(mantidos) => {
            setZerar(null);
            mostrarLinha(resultadoSucesso(textoZerado(zerar.rotulo, mantidos)));
            router.refresh();
          }}
        />
      )}
      {zerarPedidos && (
        <ZerarPedidos
          empresaId={empresaId}
          aoFechar={() => setZerarPedidos(false)}
          aoZerar={(r) => {
            setZerarPedidos(false);
            mostrarZerarPedidos(resultadoSucesso(textoPedidosZerados(r)));
            router.refresh();
          }}
        />
      )}
      {trocarChave && (
        <DialogoTrocarChave
          aoConfirmar={() => {
            setTrocarChave(false);
            if (formChave.current) salvarCredencial(formChave.current);
          }}
          aoCancelar={() => setTrocarChave(false)}
        />
      )}
      {pedido && (
        <DialogoMotivo
          titulo={pedido.tipo === 'ligar' ? `Ligar ${pedido.linha.rotulo}?` : pedido.tipo === 'desligar' ? `Desligar ${pedido.linha.rotulo}?` : `${ROTULOS_FDV.tentarDeNovo} o envio de ${pedido.linha.rotulo}?`}
          aviso={pedido.tipo === 'retomar' ? undefined : avisoLigar(pedido.tipo === 'ligar')}
          semTexto
          rotuloConfirmar={pedido.tipo === 'ligar' ? 'Ligar' : pedido.tipo === 'desligar' ? 'Desligar' : ROTULOS_FDV.tentarDeNovo}
          destrutivo={pedido.tipo === 'desligar'}
          aoConfirmar={() => confirmar(pedido)}
          aoCancelar={() => setPedido(null)}
        />
      )}
    </div>
  );
}

/** Confirmação de "Trocar chave" (mesmo padrão do cenário B, `docs/design/entrada-cenario-b/README.md`, seção A): a chave atual para na hora. */
export function DialogoTrocarChave({ aoConfirmar, aoCancelar }: { aoConfirmar: () => void; aoCancelar: () => void }) {
  return (
    <DialogoMotivo
      titulo="Trocar a chave do conector do FDV?"
      aviso="A chave atual para de funcionar agora. Quem usa a chave antiga fica sem enviar até receber a nova."
      semTexto
      destrutivo
      rotuloConfirmar={ROTULOS_FDV.trocarChave}
      aoConfirmar={aoConfirmar}
      aoCancelar={aoCancelar}
    />
  );
}

/** Bloco Monitor, como o do FDV: Identificador, Situação (texto e cor), Versão, Último sinal e Fila (lotes · linhas). */
export function BlocoMonitor({ monitor, fuso, ultimoCodigo }: { monitor: MonitorConectorFdv; fuso: string; ultimoCodigo?: string | null }) {
  const v = vistaMonitor(monitor, fuso, ultimoCodigo);
  return (
    <dl className="ficha" data-testid="monitor">
      <div><dt>Identificador</dt><dd>{v.identificador}</dd></div>
      <div><dt>Situação</dt><dd><SeloTom tom={v.situacao.tom}>{v.situacao.texto}</SeloTom></dd></div>
      <div><dt>Versão</dt><dd>{v.versao}</dd></div>
      <div><dt>Último sinal</dt><dd>{v.ultimoSinal}</dd></div>
      {v.codigo ? <div><dt>Código</dt><dd><code>{v.codigo}</code></dd></div> : null}
      <div><dt>Fila</dt><dd>{v.fila}</dd></div>
    </dl>
  );
}
