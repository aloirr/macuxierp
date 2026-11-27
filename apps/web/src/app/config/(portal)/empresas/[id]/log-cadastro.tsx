'use client';
import { ROTULO_ORIGEM_ENVIO_FDV, ROTULO_SITUACAO_ENVIO_FDV, type EntidadeEnvioFdv, type LogCadastroFdvPlataforma } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { Dialogo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { SeloTom } from '@/components/selo-tom';
import { useEffect, useState } from 'react';
import { TEXTO_MOTIVO_FDV } from '@/lib/integracao-fdv-textos';
import { CAMINHO_BKO_INTEGRACAO_FDV, csvErrosLog, errosNaoListados, nomeCsvErrosFdv, rotuloDoCampoErro, rotuloDoCodigoErro, tomDoMotivoDoLog } from '@/lib/config/operacao-fdv';
import { salvarCsv } from '@/lib/baixar-csv';
import type { Resultado } from '@/lib/config/executar';
import { lerLogFdvAcao } from '@/lib/acoes-cliente';

type Envio = LogCadastroFdvPlataforma['envios'][number];
type Erro = LogCadastroFdvPlataforma['erros'][number];

/** Corpo do Log (puro sobre a resposta): envios recentes, motivo do cadastro e erros por código e campo, só com contagens. */
export function CorpoLog({ log, fuso, entidade }: { log: LogCadastroFdvPlataforma; fuso: string; entidade: EntidadeEnvioFdv }) {
  const naoListados = errosNaoListados(log);
  const colEnvios: ColunaTabela<Envio>[] = [
    { id: 'em', titulo: 'Quando', tipo: 'data', celula: (e) => formatarDataHora(e.em, fuso) },
    { id: 'origem', titulo: 'Origem', celula: (e) => ROTULO_ORIGEM_ENVIO_FDV[e.origem] },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (e) => <SeloTom tom={ROTULO_SITUACAO_ENVIO_FDV[e.situacao].tom}>{ROTULO_SITUACAO_ENVIO_FDV[e.situacao].texto}</SeloTom> },
    { id: 'registros', titulo: 'Registros', tipo: 'numero', celula: (e) => e.registros },
    { id: 'com_erro', titulo: 'Com erro', tipo: 'numero', celula: (e) => e.com_erro },
  ];
  const colErros: ColunaTabela<Erro>[] = [
    // Rótulos em português; os códigos (cnpj_invalido, razao_social) ficam só no CSV de "Baixar erros".
    { id: 'codigo', titulo: 'Erro', celula: (e) => rotuloDoCodigoErro(e.codigo) },
    { id: 'campo', titulo: 'Campo', celula: (e) => rotuloDoCampoErro(e.campo) },
    { id: 'quantidade', titulo: 'Registros', tipo: 'numero', celula: (e) => e.quantidade },
  ];
  return (
    <div className="corpo-log" data-entidade={entidade}>
      {log.motivo && log.motivo !== 'erros_por_linha' && (tomDoMotivoDoLog(log.motivo) === 'erro'
        ? <p className="faixa-erro" role="alert">{TEXTO_MOTIVO_FDV[log.motivo]}</p>
        : <p className="faixa-aviso" role="status">{TEXTO_MOTIVO_FDV[log.motivo]}</p>)}
      <h3>Envios recentes</h3>
      {log.envios.length === 0 ? <p className="apoio">Nenhum envio ainda.</p> : <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colEnvios} linhas={log.envios} chaveLinha={(e) => `${e.em}|${e.origem}`} legenda="Envios recentes" /></div>}
      <h3>Erros abertos: {log.total_erros}</h3>
      {log.erros.length === 0 ? (log.total_erros === 0 ? <p className="apoio">Nenhum erro aberto.</p> : null) : <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor"><TabelaDensa colunas={colErros} linhas={log.erros} chaveLinha={(e) => `${e.codigo}|${e.campo ?? ''}`} legenda="Erros por código e campo" /></div>}
      {naoListados > 0 && <p className="apoio">Mais {naoListados} {naoListados === 1 ? 'erro não aparece' : 'erros não aparecem'} aqui.</p>}
    </div>
  );
}

/** Rodapé: "Baixar erros (.csv)" (só com erros listados) e "Abrir no BKO da empresa" (só o caminho da tela). */
export function RodapeLog({ log, entidade, aoFechar }: { log: LogCadastroFdvPlataforma | null; entidade: EntidadeEnvioFdv; aoFechar: () => void }) {
  return (
    <div className="rodape-log">
      <a className="mx-botao-secundario" href={CAMINHO_BKO_INTEGRACAO_FDV}>Abrir no BKO da empresa</a>
      {log && log.erros.length > 0 && <button type="button" className="mx-botao-secundario" onClick={() => salvarCsv(csvErrosLog(log), nomeCsvErrosFdv(entidade))}>Baixar erros (.csv)</button>}
      <button type="button" className="mx-botao" onClick={aoFechar}>Fechar</button>
    </div>
  );
}

/** Janela do botão Log: lê `GET .../entidades/:entidade/log` ao abrir. */
export function LogCadastro({ empresaId, entidade, rotulo, fuso, aoFechar }: { empresaId: string; entidade: EntidadeEnvioFdv; rotulo: string; fuso: string; aoFechar: () => void }) {
  const [r, setR] = useState<Resultado<LogCadastroFdvPlataforma> | null>(null);
  useEffect(() => {
    let vivo = true;
    void lerLogFdvAcao(empresaId, entidade).then((x) => vivo && setR(x));
    return () => { vivo = false; };
  }, [empresaId, entidade]);
  const log = r?.ok ? r.valor : null;
  return (
    <Dialogo titulo={`Log: ${rotulo}`} aoFechar={aoFechar} rodape={<RodapeLog log={log} entidade={entidade} aoFechar={aoFechar} />}>
      {!r && <p className="apoio" role="status">Carregando…</p>}
      {r && !r.ok && <p className="erro" role="alert">{r.erro || 'Não foi possível carregar o Log. Tente de novo.'}</p>}
      {log && <CorpoLog log={log} fuso={fuso} entidade={entidade} />}
    </Dialogo>
  );
}
