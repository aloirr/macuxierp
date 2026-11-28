'use client';
import { LIMITE_REGISTROS_LOTE_FDV, type EntidadeEnvioFdv, type IntegracaoFdvPlataforma } from '@macuxierp/platform-sdk';
import { DialogoMotivo, MenuAcoes, ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela, type Resultado as ResultadoUi } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { LIMITE_INICIAL_FDV, habilitadasApos, validarLimiteLote, acoesDaLinhaFdv, menuDaLinha, linhasCadastros, avisoLigar, type LinhaCadastroFdv } from '@/lib/config/integracao-fdv';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { colunasStatusFdv } from '@/lib/integracao-fdv';
import { textoZerado } from '@/lib/config/cargas';
import type { Resultado } from '@/lib/config/executar';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { configurarFdvAcao, reprocessarFdvAcao, retomarFdvAcao } from '@/lib/acoes-cliente';
import { RETORNOS_FDV, ROTULOS_FDV, textoDaFalha, textoReprocessarOk } from '@/lib/config/operacao-fdv';
import { textoPedidosZerados } from '@/lib/config/pedidos-zerar';
import { LogCadastro } from './log-cadastro';
import { ZerarCadastro } from './zerar-cadastro';
import { ZerarPedidos } from './zerar-pedidos';

type Pedido = { tipo: 'ligar' | 'desligar' | 'retomar'; linha: LinhaCadastroFdv };

const LEGENDA_ENVIADOS = 'Cadastros enviados';

/**
 * Aba Dados, seção "ERP → Força de vendas" (v0.3.24, docs/design/integracao-duas-ligacoes; era a parte de baixo da aba Integração):
 * Registros por lote, a tabela "Cadastros enviados" com o menu Ações (T-0099) e "Zerar pedidos não faturados". Os retornos seguem a
 * 36 A: cada um logo abaixo do seu botão.
 */
export function SecaoEnvioFdv({ empresaId, dados, fuso, barra }: { empresaId: string; dados: IntegracaoFdvPlataforma; fuso: string; /** A barra única do cartão da ligação (regra 12): o Salvar e o Zerar pedidos entram nela. */ barra?: HTMLElement | null }) {
  const idLimite = useId();
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [rLimite, kLimite, mostrarLimite] = useResultado();
  const [rLinha, kLinha, mostrarLinha] = useResultado();
  const [rZerarPedidos, kZerarPedidos, mostrarZerarPedidos] = useResultado();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [log, setLog] = useState<LinhaCadastroFdv | null>(null);
  const [zerar, setZerar] = useState<LinhaCadastroFdv | null>(null);
  const [zerarPedidos, setZerarPedidos] = useState(false);
  const chaves = useRef(new ChavesIdempotencia());
  const linhas = linhasCadastros(dados, fuso);
  const semCredencial = dados.credencial_id === null;
  const bloqueado = pendente || !dados.modulo_licenciado;

  /** Uma Idempotency-Key por ação e cadastro; só renova depois de resposta definitiva (repetição de rede reaproveita). */
  const chaveDe = (id: string) => chaves.current.de(id);
  const concluir = <T,>(id: string | null, r: Resultado<T>, textoOk: string, mostrar: (x: ResultadoUi) => void, formulario = false) => {
    chaves.current.aposResposta(id, r);
    setCampos(r.ok ? {} : r.campos);
    // Erro só de campo fica embaixo do campo; o ResultadoAcao é para o retorno ou a falha do servidor (RD-1109).
    if (r.ok) mostrar(resultadoSucesso(textoOk));
    else if (!formulario || Object.keys(r.campos).length === 0) mostrar(resultadoErro(textoDaFalha(r.erro, formulario)));
    if (r.ok) router.refresh();
  };

  const salvarLimite = (f: HTMLFormElement) => {
    const v = validarLimiteLote(String(new FormData(f).get('limite_registros_lote') ?? ''));
    if (!v.ok) return setCampos({ limite_registros_lote: v.erro });
    const chave = `lim:${dados.entidades_habilitadas.join(',')}:${v.valor}`;
    iniciar(async () => concluir(chave, await configurarFdvAcao(empresaId, { entidades_habilitadas: dados.entidades_habilitadas, limite_registros_lote: v.valor }, chaveDe(chave)), RETORNOS_FDV.limiteSalvo, mostrarLimite, true));
  };
  /** Reprocessar (só falhas e pendentes): sem confirmação, não apaga nada. 409 com lote em voo vira a mensagem da API. */
  const reprocessar = (l: LinhaCadastroFdv) => {
    const id = `reproc:${l.entidade}`;
    iniciar(async () => {
      const r = await reprocessarFdvAcao(empresaId, l.entidade, chaveDe(id));
      concluir(id, r, r.ok ? textoReprocessarOk(r.valor.falhas, r.valor.pendentes) : '', mostrarLinha);
    });
  };
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

  /** Uma barra só (regra 12): o Salvar dos registros por lote e, à direita e em vermelho, o Zerar pedidos. */
  const botoesDoBloco = (
    <>
      {/* Sem chave salva o único "Salvar" do cartão é o "Salvar chave" (regra 12): este só aparece com a ligação pronta. */}
      {!semCredencial && <button className="mx-botao-secundario" type="submit" form={idLimite} disabled={bloqueado}>Salvar</button>}
      <button type="button" className="mx-botao-secundario botao-perigo-contorno botao-direita" disabled={bloqueado} onClick={() => setZerarPedidos(true)}>Zerar pedidos…</button>
    </>
  );

  const colunas: ColunaTabela<LinhaCadastroFdv>[] = [...colunasStatusFdv<LinhaCadastroFdv>({ falhaSobreNome: true, envioSobreNome: true }), { id: 'acoes', titulo: 'Ações', celula: acoesDaLinha }];

  return (
    <div className="envio-fdv">
      <form id={idLimite} className="formulario" noValidate aria-label="Registros por lote" onSubmit={(ev) => { ev.preventDefault(); salvarLimite(ev.currentTarget); }}>
        <label className="campo campo-curto">
          <span>Registros por lote</span>
          <input name="limite_registros_lote" type="number" inputMode="numeric" min={1} max={LIMITE_REGISTROS_LOTE_FDV} step={1} defaultValue={dados.limite_registros_lote ?? LIMITE_INICIAL_FDV} aria-invalid={campos.limite_registros_lote ? true : undefined} aria-describedby={campos.limite_registros_lote ? 'erro-limite-lote' : undefined} />
        </label>
        {campos.limite_registros_lote && <p id="erro-limite-lote" className="erro-campo" role="alert">{campos.limite_registros_lote}</p>}
      </form>
      <ResultadoAcao resultado={rLimite} chave={kLimite} />
      <div className="tabela-rolavel com-sinal-rolagem tabela-fdv tabela-fdv-config legenda-so-leitor">
        <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.entidade} textoVazio="Nenhum cadastro." legenda={LEGENDA_ENVIADOS} />
      </div>
      <ResultadoAcao resultado={rLinha} chave={kLinha} />
      {/* sem `barra` (uso solto) a barra é própria; com ela, os botões entram na do cartão (null = ainda montando) */}
      {barra === undefined ? <div className="barra-acoes barra-bloco">{botoesDoBloco}</div> : barra && createPortal(botoesDoBloco, barra)}
      <ResultadoAcao resultado={rZerarPedidos} chave={kZerarPedidos} />
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
