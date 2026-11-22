'use client';
import { useState } from 'react';
import {
  csvDosErros, csvDoResumo, descricaoDoLocal, errosPorArquivo, montarFormulario, problemasDaSelecao, resumoDoRelatorio, textoDeConfirmacao,
  tituloDoRelatorio, totaisDoRelatorio,
} from '@macuxierp/cadastros/web';
import type { ModoCarga, RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { CARGA_NAO_CONCLUIDA } from '@/lib/textos';

function baixar(nome: string, texto: string) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tela da carga de cadastros: escolhe os CSVs, valida ou grava e mostra o relatório. O arquivo não é guardado no navegador além do envio. */
export function TelaCarga({ api }: { api: string }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [relatorio, setRelatorio] = useState<RelatorioCarga | null>(null);
  const [enviando, setEnviando] = useState(false);


  async function enviar(modo: ModoCarga) {
    const p = problemasDaSelecao(arquivos.map((a) => ({ nome: a.name, tamanho: a.size })));
    setProblemas(p);
    if (p.length > 0) return;
    if (modo === 'gravar' && !window.confirm(textoDeConfirmacao(arquivos.length))) return;
    setEnviando(true);
    setErro('');
    try {
      const r = await fetch(api, { method: 'POST', body: montarFormulario(modo, arquivos.map((a) => ({ nome: a.name, conteudo: a }))) });
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; relatorio?: RelatorioCarga; erro?: string } | null;
      if (corpo?.ok && corpo.relatorio) setRelatorio(corpo.relatorio);
      else {
        setRelatorio(null);
        setErro(corpo?.erro ?? CARGA_NAO_CONCLUIDA);
      }
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  const totais = relatorio ? totaisDoRelatorio(relatorio) : null;
  return (
    <section aria-busy={enviando}>
      <p className="apoio">Envie os arquivos .csv do kit de carga (um por entidade). Validar confere sem gravar; Gravar cria ou atualiza os cadastros.</p>
      <label className="campo">
        <span>Arquivos .csv</span>
        <input type="file" accept=".csv,text/csv" multiple onChange={(e) => { setArquivos([...(e.target.files ?? [])]); setProblemas([]); setRelatorio(null); }} />
      </label>
      {problemas.length > 0 && <ul className="erro" role="alert">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <p>
        <button className="btn" type="button" disabled={enviando} onClick={() => void enviar('validar')}>{enviando ? 'Enviando…' : 'Validar'}</button>{' '}
        <button className="btn" type="button" disabled={enviando} onClick={() => void enviar('gravar')}>Gravar</button>
      </p>
      {relatorio && totais && (
        <div role="status">
          <h2>{tituloDoRelatorio(relatorio)}</h2>
          <p>
            Lidas {totais.lidas} · Inseridas {totais.inseridas} · Atualizadas {totais.atualizadas} · Sem mudança {totais.sem_mudanca} · Recusadas {totais.recusadas} · Erros {totais.erros}
          </p>
          <table>
            <thead><tr><th>Entidade</th><th>Arquivo</th><th>Situação</th><th>Lidas</th><th>Inseridas</th><th>Atualizadas</th><th>Sem mudança</th><th>Recusadas</th></tr></thead>
            <tbody>
              {resumoDoRelatorio(relatorio).map((l) => (
                <tr key={l.arquivo}><td>{l.entidade}</td><td>{l.arquivo}</td><td>{l.situacao}</td><td>{l.lidas}</td><td>{l.inseridas}</td><td>{l.atualizadas}</td><td>{l.sem_mudanca}</td><td>{l.recusadas}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Erros por linha, campo e motivo</h3>
          {totais.erros === 0 ? <p className="apoio">Nenhum erro.</p> : errosPorArquivo(relatorio).map((g) => (
            <table key={g.arquivo}>
              <caption>{g.arquivo}</caption>
              <thead><tr><th>Local</th><th>Motivo</th></tr></thead>
              <tbody>{g.erros.map((e, i) => <tr key={`${e.linha}-${e.campo}-${i}`}><td>{descricaoDoLocal(e)}</td><td>{e.motivo}</td></tr>)}</tbody>
            </table>
          ))}
          {relatorio.erros_omitidos > 0 && <p className="apoio">Mais {relatorio.erros_omitidos} erros não aparecem aqui. Corrija estes e valide de novo.</p>}
          <p>
            <button className="btn" type="button" onClick={() => baixar('carga-resumo.csv', csvDoResumo(relatorio))}>Exportar resumo CSV</button>{' '}
            <button className="btn" type="button" disabled={relatorio.erros.length === 0} onClick={() => baixar('carga-erros.csv', csvDosErros(relatorio))}>Exportar erros CSV</button>
          </p>
        </div>
      )}
    </section>
  );
}
