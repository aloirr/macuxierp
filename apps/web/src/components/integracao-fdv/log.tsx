'use client';
import { useEffect, useState } from 'react';
import { Chip, Dialogo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import type { ClienteRecebidoFdv, EntidadeEnvioFdv, LogCadastroFdvTenant } from '@macuxierp/platform-sdk';
import {
  ROTULO_BAIXAR_ERROS, ROTULO_BAIXAR_RECEBIDOS, ROTULO_CORRIGIR, ROTULO_ENTIDADE, TEXTO_ESTADO_LOG, TEXTO_LEGENDA_ERROS_LOG, TEXTO_VAZIO_RECEBIDOS_LOG, TITULO_SECAO_RECEBIDOS_LOG,
  colunasDeErrosLog, colunasDeRecebidosLog, errosForaDaListaLog, linhasDeEnviosLog, linhasDeErrosLog, linhasDeRecebidosLog, textoErrosForaDaLista, textoRecebidosForaDaLista,
  type LinhaEnvioLog, type LinhaErroLog, type LinhaRecebidoLog,
} from '@macuxierp/integracao-fdv/web';
import { ROTULOS_FDV } from '@/lib/config/operacao-fdv';
import { lerLogFdv, type ResultadoLogFdv } from '@/app/(shell)/[modulo]/[...pagina]/acoes-log-fdv';

/** Texto do resumo de erros: "1 erro aberto" / "N erros abertos". */
export const textoErrosAbertos = (n: number): string => `${n} ${n === 1 ? 'erro aberto' : 'erros abertos'}`;

/** Rótulo do botão que recarrega o Log quando a leitura falha. */
export const ROTULO_TENTAR_DE_NOVO = ROTULOS_FDV.tentarDeNovo;

/** Falha de leitura com o botão "Tentar de novo" ao lado: o convite já está no botão, então o texto não o repete. */
export const TEXTO_FALHA_CARGA_LOG = 'Não foi possível carregar o Log.';

/** Em até 640 px de largura (celular): "Corrigir" sobe para a 2ª coluna, para ficar à vista sem rolar. */
function useCelular(): boolean {
  const [celular, setCelular] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia('(max-width: 640px)');
    const atualizar = () => setCelular(m.matches);
    atualizar();
    m.addEventListener('change', atualizar);
    return () => m.removeEventListener('change', atualizar);
  }, []);
  return celular;
}

/** Põe a coluna "Corrigir" em 2º lugar (puro). */
export function corrigirEmSegundo<T extends { id: string }>(cols: T[]): T[] {
  const i = cols.findIndex((c) => c.id === 'corrigirHref');
  if (i < 2) return cols;
  const c = [...cols];
  const [x] = c.splice(i, 1);
  c.splice(1, 0, x as T);
  return c;
}

/** Texto do shell para o Log quando o perfil não pode ver (a API revalida). */
const TEXTO_LOG_SEM_PERMISSAO = 'Seu perfil não pode ver o Log desta integração.';

/** Caminho do download no shell (o token é httpOnly: o arquivo passa pelo proxy `/baixar-erros-fdv`). */
export const caminhoDoDownloadErros = (entidade: EntidadeEnvioFdv): string => `/baixar-erros-fdv?entidade=${encodeURIComponent(entidade)}`;

/** Download do arquivo completo dos recebidos (decisão 21 A) pelo proxy do shell; no corte, a última linha do arquivo avisa. */
const CAMINHO_DOWNLOAD_RECEBIDOS = '/baixar-recebidos-fdv';

/** Seção "Recebidos do FDV" do Log de clientes: aceito, recusado com motivo e reenviado (RN-INF-09). */
export function SecaoRecebidosLog({ recebidos, total, fuso }: { recebidos: readonly ClienteRecebidoFdv[]; total: number; fuso: string }) {
  const linhas = linhasDeRecebidosLog(recebidos, fuso);
  const colunas: ColunaTabela<LinhaRecebidoLog>[] = colunasDeRecebidosLog.map((c) => ({
    id: c.id, titulo: c.titulo, ...(c.id === 'revisao' ? { tipo: 'numero' as const } : c.id === 'recebidoEm' ? { tipo: 'data' as const } : {}), celula: (l) => (l[c.id] === '' ? '—' : l[c.id]),
  }));
  const fora = Math.max(0, total - recebidos.length);
  return (
    <section data-recebidos-fdv>
      {linhas.length === 0
        ? (
          <>
            <h3>{TITULO_SECAO_RECEBIDOS_LOG}</h3>
            <p className="apoio">{TEXTO_VAZIO_RECEBIDOS_LOG}</p>
          </>
        )
        : (
          <>
            <div className="resumo-log">
              <h3>{TITULO_SECAO_RECEBIDOS_LOG}</h3>
              <a className="mx-botao-secundario" href={CAMINHO_DOWNLOAD_RECEBIDOS}>{ROTULO_BAIXAR_RECEBIDOS}</a>
            </div>
            <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => `${l.cliente}|${l.recebidoEm}|${l.revisao}|${l.situacao}`} textoVazio={TEXTO_VAZIO_RECEBIDOS_LOG} legenda={TITULO_SECAO_RECEBIDOS_LOG} /></div>
          </>
        )}
      {fora > 0 && <p className="apoio">{textoRecebidosForaDaLista(recebidos.length, total)}</p>}
    </section>
  );
}

/** Corpo do Log (puro sobre a resposta): erros por registro com "Corrigir" e envios recentes. Horários no fuso da empresa. */
export function CorpoLogBko({ log, entidade, fuso, celular = false }: { log: LogCadastroFdvTenant; entidade: EntidadeEnvioFdv; fuso: string; celular?: boolean }) {
  const linhas = linhasDeErrosLog(log);
  const envios = linhasDeEnviosLog(log, fuso);
  const fora = errosForaDaListaLog(log);
  const todas: ColunaTabela<LinhaErroLog>[] = colunasDeErrosLog.map((c) =>
    c.id === 'corrigirHref'
      ? { id: c.id, titulo: c.titulo, celula: (l) => (l.corrigirHref ? <a href={l.corrigirHref}>{ROTULO_CORRIGIR}</a> : <span className="apoio">—</span>) }
      : { id: c.id, titulo: c.titulo, celula: (l) => (l[c.id] as string) || '—' },
  );
  const colunas = celular ? corrigirEmSegundo(todas) : todas;
  const colEnvios: ColunaTabela<LinhaEnvioLog>[] = [
    { id: 'quando', titulo: 'Quando', tipo: 'data', celula: (e) => e.quando },
    { id: 'origem', titulo: 'Origem', celula: (e) => e.origem },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (e) => <Chip tom={e.tom}>{e.situacao}</Chip> },
    { id: 'registros', titulo: 'Registros', tipo: 'numero', celula: (e) => e.registros },
    { id: 'comErro', titulo: 'Com erro', tipo: 'numero', celula: (e) => e.comErro },
  ];
  return (
    <div className="corpo-log corpo-log-bko" data-entidade={entidade}>
      {log.total_erros > 0 && (
        <div className="resumo-log">
          <h3>{textoErrosAbertos(log.total_erros)}</h3>
          <a className="mx-botao-secundario" href={caminhoDoDownloadErros(entidade)}>{ROTULO_BAIXAR_ERROS}</a>
        </div>
      )}
      {linhas.length === 0
        ? (log.total_erros === 0 && <p className="apoio">{TEXTO_ESTADO_LOG.vazio}</p>)
        : (
          <>
            <p className="apoio" data-legenda-erros>{TEXTO_LEGENDA_ERROS_LOG}</p>
            <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => `${l.registro}|${l.campo}|${l.motivo}`} textoVazio={TEXTO_ESTADO_LOG.vazio} legenda="Erros por registro" /></div>
          </>
        )}
      {fora > 0 && <p className="apoio">{textoErrosForaDaLista(fora)}</p>}
      <h3>Envios recentes</h3>
      {envios.length === 0
        ? <p className="apoio">{TEXTO_ESTADO_LOG.vazioEnvios}</p>
        : <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colEnvios} linhas={envios} chaveLinha={(e) => `${e.quando}|${e.origem}`} textoVazio={TEXTO_ESTADO_LOG.vazioEnvios} legenda="Envios recentes" /></div>}
      {entidade === 'cliente' && <SecaoRecebidosLog recebidos={log.recebidos ?? []} total={log.total_recebidos ?? 0} fuso={fuso} />}
    </div>
  );
}

/** Corpo por estado: carregando, sem permissão, erro ou o Log. `null` = carregando. */
export function EstadoLog({ r, entidade, fuso, celular = false, aoTentarDeNovo }: { r: ResultadoLogFdv | null; entidade: EntidadeEnvioFdv; fuso: string; celular?: boolean; aoTentarDeNovo?: () => void }) {
  if (!r) return <p className="apoio" role="status">{TEXTO_ESTADO_LOG.carregando}</p>;
  if (r.ok) return <CorpoLogBko log={r.log} entidade={entidade} fuso={fuso} celular={celular} />;
  if (r.motivo === 'sem_permissao') return <p className="erro" role="alert">{TEXTO_LOG_SEM_PERMISSAO}</p>;
  return (
    <div className="corpo-log">
      <p className="erro" role="alert">{r.mensagem ?? (aoTentarDeNovo ? TEXTO_FALHA_CARGA_LOG : TEXTO_ESTADO_LOG.erro)}</p>
      {aoTentarDeNovo && <div><button type="button" className="mx-botao-secundario" onClick={aoTentarDeNovo}>{ROTULO_TENTAR_DE_NOVO}</button></div>}
    </div>
  );
}

/** Janela do Log de um cadastro: lê o Log ao abrir; "Baixar erros (.csv)" fica no resumo do topo, só quando há erro aberto. */
export function JanelaLog({ entidade, fuso, aoFechar, ler = lerLogFdv }: { entidade: EntidadeEnvioFdv; fuso: string; aoFechar: () => void; ler?: (e: string) => Promise<ResultadoLogFdv> }) {
  const [r, setR] = useState<ResultadoLogFdv | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const celular = useCelular();
  useEffect(() => {
    let vivo = true;
    ler(entidade).then((x) => vivo && setR(x), () => vivo && setR({ ok: false, motivo: 'erro' }));
    return () => { vivo = false; };
  }, [entidade, ler, tentativa]);
  const tentarDeNovo = () => { setR(null); setTentativa((t) => t + 1); };
  return (
    <Dialogo
      titulo={`Log: ${ROTULO_ENTIDADE[entidade]}`}
      aoFechar={aoFechar}
      rodape={(
        <div className="rodape-log">
          <button type="button" className="mx-botao" onClick={aoFechar}>Fechar</button>
        </div>
      )}
    >
      <EstadoLog r={r} entidade={entidade} fuso={fuso} celular={celular} aoTentarDeNovo={tentarDeNovo} />
    </Dialogo>
  );
}

/** Botão "Log" da linha do cadastro; quem decide mostrá-lo (permissão `integracao-fdv.ver`) é a vista; a proteção real é a da API. */
export function BotaoLog({ entidade, fuso }: { entidade: EntidadeEnvioFdv; fuso: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className="mx-botao-secundario" onClick={() => setAberto(true)} aria-label={`Log de ${ROTULO_ENTIDADE[entidade]}`}>Log</button>
      {aberto && <JanelaLog entidade={entidade} fuso={fuso} aoFechar={() => setAberto(false)} />}
    </>
  );
}
