'use client';
import { useState } from 'react';
import { ROTULOS_ENTIDADE, csvDosErros, csvDoResumo, resumoDoRelatorio, textoDeConfirmacao, tituloDoRelatorio, totaisDoRelatorio } from '@macuxierp/cadastros/web';
import type { EntidadeCarga, ModoCarga, RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { baixarCsv } from '@/lib/baixar-csv';
import { BOTOES_CARGA, arquivoDaEntidade, dependenciasPorArquivo, enderecoDoModelo, errosDaTabela, formularioDaEntidade, podeGravar, problemaDoArquivo } from '@/lib/carga-entidade';
import { CARGA_NAO_CONCLUIDA } from '@/lib/textos';

/** Prévia ou resultado de uma entidade: resumo, dependências agrupadas e erros por linha (o motivo vem da API, sem o valor digitado). */
export function PreviaDaCarga({ relatorio }: { relatorio: RelatorioCarga }) {
  const totais = totaisDoRelatorio(relatorio);
  const dependencias = dependenciasPorArquivo(relatorio);
  const tabelas = errosDaTabela(relatorio);
  return (
    <div role="status">
      <h3>{tituloDoRelatorio(relatorio)}</h3>
      <table>
        <thead><tr><th>Entidade</th><th>Situação</th><th>Lidas</th><th>Inseridas</th><th>Atualizadas</th><th>Sem mudança</th><th>Recusadas</th><th>Avisos</th></tr></thead>
        <tbody>
          {resumoDoRelatorio(relatorio).map((l) => (
            <tr key={l.arquivo}><td>{l.entidade}</td><td>{l.situacao}</td><td>{l.lidas}</td><td>{l.inseridas}</td><td>{l.atualizadas}</td><td>{l.sem_mudanca}</td><td>{l.recusadas}</td><td>{l.avisos || '—'}</td></tr>
          ))}
        </tbody>
      </table>
      {dependencias.map((d) => (
        <div key={d.arquivo} className="faixa-aviso" role="alert">
          <ul>{d.motivos.map((m) => <li key={m}>{d.arquivo} — {m}</li>)}</ul>
          {d.faltam.length > 0 && (
            <p>{d.faltam.map((e) => <a key={e} className="mx-botao-secundario" href={`#carga-${e}`}>Ir para {ROTULOS_ENTIDADE[e]}</a>)}</p>
          )}
        </div>
      ))}
      {tabelas.map((g) => (
        <table key={g.arquivo}>
          <caption>Erros de {g.arquivo}</caption>
          <thead><tr><th>Arquivo</th><th>Linha</th><th>Campo</th><th>Motivo</th></tr></thead>
          <tbody>{g.erros.map((e, i) => <tr key={`${e.linha}-${e.campo}-${i}`}><td>{e.arquivo}</td><td>{e.linha ?? '—'}</td><td>{e.campo ?? '—'}</td><td>{e.motivo}</td></tr>)}</tbody>
        </table>
      ))}
      {totais.erros === 0 && <p className="apoio">Nenhum erro.</p>}
      {relatorio.erros_omitidos > 0 && <p className="apoio">e mais {relatorio.erros_omitidos} erros. Corrija estes e valide de novo.</p>}
      <p>
        <button className="mx-botao-secundario" type="button" onClick={() => baixarCsv('carga-resumo.csv', csvDoResumo(relatorio))}>Exportar resumo CSV</button>{' '}
        <button className="mx-botao-secundario" type="button" disabled={relatorio.erros.length === 0} onClick={() => baixarCsv('carga-erros.csv', csvDosErros(relatorio))}>Exportar erros CSV</button>
      </p>
    </div>
  );
}

function CartaoEntidade({ entidade, api }: { entidade: EntidadeCarga; api: string }) {
  const rotulo = ROTULOS_ENTIDADE[entidade];
  const nomeArquivo = arquivoDaEntidade(entidade);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [problema, setProblema] = useState('');
  const [erro, setErro] = useState('');
  const [relatorio, setRelatorio] = useState<RelatorioCarga | null>(null);
  /** Arquivo da última validação sem erro: o Gravar vale só para ele (trocar o arquivo desliga). */
  const [validado, setValidado] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(modo: ModoCarga) {
    const p = problemaDoArquivo(entidade, arquivo ? { nome: arquivo.name, tamanho: arquivo.size } : undefined);
    setProblema(p ?? '');
    if (p || !arquivo) return;
    if (modo === 'gravar' && !window.confirm(textoDeConfirmacao(1))) return;
    setEnviando(true);
    setErro('');
    try {
      const r = await fetch(api, { method: 'POST', body: formularioDaEntidade(modo, entidade, arquivo) });
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; relatorio?: RelatorioCarga; erro?: string } | null;
      if (corpo?.ok && corpo.relatorio) {
        setRelatorio(corpo.relatorio);
        setValidado(modo === 'validar' && podeGravar(corpo.relatorio, entidade) ? arquivo : null);
      } else {
        setRelatorio(null);
        setValidado(null);
        setErro(corpo?.erro ?? CARGA_NAO_CONCLUIDA);
      }
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <fieldset id={`carga-${entidade}`} className="carga-cartao" aria-busy={enviando}>
      <legend>{rotulo}</legend>
      <p>
        <a className="mx-botao-secundario" href={enderecoDoModelo(entidade)} download>Baixar modelo</a>
      </p>
      <label className="campo">
        <span>Enviar {nomeArquivo}</span>
        <input type="file" disabled={enviando} accept=".csv,text/csv" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setProblema(''); setErro(''); setRelatorio(null); setValidado(null); }} />
      </label>
      {problema && <p className="erro" role="alert">{problema}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <p>
        <button className="mx-botao" type="button" disabled={enviando} onClick={() => void enviar('validar')}>{enviando ? 'Enviando…' : 'Validar'}</button>{' '}
        <button className="mx-botao" type="button" disabled={enviando || !arquivo || validado !== arquivo} onClick={() => void enviar('gravar')}>Gravar</button>
      </p>
      {relatorio && <PreviaDaCarga relatorio={relatorio} />}
    </fieldset>
  );
}

/** Tela da carga de cadastros: um cartão por entidade, na ordem do D13. O arquivo não é guardado no navegador além do envio. */
export function TelaCarga({ api }: { api: string }) {
  return (
    <section>
      <p className="apoio">Carregue na ordem abaixo: cada arquivo depende dos de cima. Em cada entidade, baixe o modelo, preencha, escolha o arquivo e use Validar; o Gravar só liga depois de uma validação sem erro.</p>
      {BOTOES_CARGA.map((b) => <CartaoEntidade key={b.entidade} entidade={b.entidade} api={api} />)}
    </section>
  );
}
