'use client';
import { useEffect, useState } from 'react';
import { Chip, Dialogo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import type { EntidadeEnvioFdv, LogCadastroFdvTenant } from '@macuxierp/platform-sdk';
import {
  ROTULO_BAIXAR_ERROS, ROTULO_CORRIGIR, ROTULO_ENTIDADE, TEXTO_ESTADO_LOG, colunasDeErrosLog, errosForaDaListaLog, linhasDeEnviosLog, linhasDeErrosLog, textoErrosForaDaLista,
  type LinhaEnvioLog, type LinhaErroLog,
} from '@macuxierp/integracao-fdv/web';
import { lerLogFdv, type ResultadoLogFdv } from '@/app/(shell)/[modulo]/[...pagina]/acoes-log-fdv';

const TOM_CHIP = { ok: 'sucesso', aviso: 'aviso', neutro: 'neutro' } as const;

/** Caminho do download no shell (o token é httpOnly: o arquivo passa pelo proxy `/baixar-erros-fdv`). */
export const caminhoDoDownloadErros = (entidade: EntidadeEnvioFdv): string => `/baixar-erros-fdv?entidade=${encodeURIComponent(entidade)}`;

/** Corpo do Log (puro sobre a resposta): erros por registro com "Corrigir" e envios recentes. Horários no fuso da empresa. */
export function CorpoLogBko({ log, entidade, fuso }: { log: LogCadastroFdvTenant; entidade: EntidadeEnvioFdv; fuso: string }) {
  const linhas = linhasDeErrosLog(log);
  const envios = linhasDeEnviosLog(log, fuso);
  const fora = errosForaDaListaLog(log);
  const colunas: ColunaTabela<LinhaErroLog>[] = colunasDeErrosLog.map((c) =>
    c.id === 'corrigirHref'
      ? { id: c.id, titulo: c.titulo, celula: (l) => (l.corrigirHref ? <a href={l.corrigirHref}>{ROTULO_CORRIGIR}</a> : <span className="apoio">—</span>) }
      : { id: c.id, titulo: c.titulo, celula: (l) => (l[c.id] as string) || '—' },
  );
  const colEnvios: ColunaTabela<LinhaEnvioLog>[] = [
    { id: 'quando', titulo: 'Quando', tipo: 'data', celula: (e) => e.quando },
    { id: 'origem', titulo: 'Origem', celula: (e) => e.origem },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (e) => <Chip tom={TOM_CHIP[e.tom]}>{e.situacao}</Chip> },
    { id: 'registros', titulo: 'Registros', tipo: 'numero', celula: (e) => e.registros },
    { id: 'comErro', titulo: 'Com erro', tipo: 'numero', celula: (e) => e.comErro },
  ];
  return (
    <div className="corpo-log corpo-log-bko" data-entidade={entidade}>
      <h3>Erros abertos: {log.total_erros}</h3>
      {linhas.length === 0
        ? <p className="apoio">{TEXTO_ESTADO_LOG.vazio}</p>
        : <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => `${l.registro}|${l.campo}|${l.motivo}`} textoVazio={TEXTO_ESTADO_LOG.vazio} legenda="Erros por registro" /></div>}
      {fora > 0 && <p className="apoio">{textoErrosForaDaLista(fora)}</p>}
      <h3>Envios recentes</h3>
      {envios.length === 0
        ? <p className="apoio">{TEXTO_ESTADO_LOG.vazioEnvios}</p>
        : <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colEnvios} linhas={envios} chaveLinha={(e) => `${e.quando}|${e.origem}`} textoVazio={TEXTO_ESTADO_LOG.vazioEnvios} legenda="Envios recentes" /></div>}
    </div>
  );
}

/** Corpo por estado: carregando, sem permissão, erro ou o Log. `null` = carregando. */
export function EstadoLog({ r, entidade, fuso }: { r: ResultadoLogFdv | null; entidade: EntidadeEnvioFdv; fuso: string }) {
  if (!r) return <p className="apoio" role="status">{TEXTO_ESTADO_LOG.carregando}</p>;
  if (r.ok) return <CorpoLogBko log={r.log} entidade={entidade} fuso={fuso} />;
  if (r.motivo === 'sem_permissao') return <p className="erro" role="alert">{TEXTO_ESTADO_LOG.semPermissao}</p>;
  return <p className="erro" role="alert">{r.mensagem ?? TEXTO_ESTADO_LOG.erro}</p>;
}

/** Janela do Log de um cadastro: lê o Log ao abrir; "Baixar erros (.csv)" só quando há erro aberto. */
export function JanelaLog({ entidade, fuso, aoFechar, ler = lerLogFdv }: { entidade: EntidadeEnvioFdv; fuso: string; aoFechar: () => void; ler?: (e: string) => Promise<ResultadoLogFdv> }) {
  const [r, setR] = useState<ResultadoLogFdv | null>(null);
  useEffect(() => {
    let vivo = true;
    ler(entidade).then((x) => vivo && setR(x), () => vivo && setR({ ok: false, motivo: 'erro' }));
    return () => { vivo = false; };
  }, [entidade, ler]);
  const comErros = r?.ok === true && r.log.total_erros > 0;
  return (
    <Dialogo
      titulo={`Log: ${ROTULO_ENTIDADE[entidade]}`}
      aoFechar={aoFechar}
      rodape={(
        <div className="rodape-log">
          {comErros && <a className="mx-botao-secundario" href={caminhoDoDownloadErros(entidade)}>{ROTULO_BAIXAR_ERROS}</a>}
          <button type="button" className="mx-botao" onClick={aoFechar}>Fechar</button>
        </div>
      )}
    >
      <EstadoLog r={r} entidade={entidade} fuso={fuso} />
    </Dialogo>
  );
}

/** Botão "Log" da linha do cadastro; escondido sem a permissão `integracao-fdv.ver` (a proteção real é a da API). */
export function BotaoLog({ entidade, fuso, podeVer }: { entidade: EntidadeEnvioFdv; fuso: string; podeVer: boolean }) {
  const [aberto, setAberto] = useState(false);
  if (!podeVer) return null;
  return (
    <>
      <button type="button" className="mx-botao-secundario" onClick={() => setAberto(true)} aria-label={`Log de ${ROTULO_ENTIDADE[entidade]}`}>Log</button>
      {aberto && <JanelaLog entidade={entidade} fuso={fuso} aoFechar={() => setAberto(false)} />}
    </>
  );
}
