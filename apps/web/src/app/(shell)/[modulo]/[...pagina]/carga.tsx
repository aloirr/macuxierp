'use client';
import { useState } from 'react';
import { ROTULOS_ENTIDADE, csvDosErros, csvDoResumo, resumoDoRelatorio, textoDeConfirmacao, tituloDoRelatorio, totaisDoRelatorio } from '@macuxierp/cadastros/web';
import type { EntidadeCarga, ModoCarga, RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { plural } from '@macuxierp/platform-sdk';
import { baixarCsv } from '@/lib/baixar-csv';
import { BOTOES_CARGA, arquivoDaEntidade, dependenciasPorArquivo, enderecoDoModelo, errosDaTabela, formularioDaEntidade, podeGravar, problemaDoArquivo } from '@/lib/carga-entidade';
import { ROTA_SENHA } from '@/lib/troca-pendente';
import { CARGA_NAO_CONCLUIDA } from '@/lib/textos';

type LinhaResumo = ReturnType<typeof resumoDoRelatorio>[number];
type LinhaErro = RelatorioCarga['erros'][number];
const COLUNAS_RESUMO: ColunaTabela<LinhaResumo>[] = [
  { id: 'entidade', titulo: 'Cadastro' }, { id: 'situacao', titulo: 'Situação' },
  { id: 'lidas', titulo: 'Lidas', tipo: 'numero' }, { id: 'inseridas', titulo: 'Inseridas', tipo: 'numero' },
  { id: 'atualizadas', titulo: 'Atualizadas', tipo: 'numero' }, { id: 'sem_mudanca', titulo: 'Sem mudança', tipo: 'numero' },
  { id: 'recusadas', titulo: 'Recusadas', tipo: 'numero' }, { id: 'avisos', titulo: 'Avisos', celula: (l) => l.avisos || '—' },
];
const COLUNAS_ERROS: ColunaTabela<LinhaErro>[] = [
  { id: 'linha', titulo: 'Linha', tipo: 'numero', celula: (e) => e.linha ?? '—' },
  { id: 'campo', titulo: 'Campo', celula: (e) => e.campo ?? '—' }, { id: 'motivo', titulo: 'Motivo' },
];

/** Aviso dos erros que o relatório não traz (RF-CAD-11): diz quantos faltam e o que fazer. */
export function textoErrosOmitidos(n: number): string {
  return `Há mais ${plural(n, 'erro', 'erros')} que ${n === 1 ? 'não aparece' : 'não aparecem'} aqui. Corrija estes e valide de novo.`;
}

/** Prévia ou resultado de uma entidade: resumo, dependências agrupadas e erros por linha (o motivo vem da API, sem o valor digitado). */
export function PreviaDaCarga({ relatorio }: { relatorio: RelatorioCarga }) {
  const totais = totaisDoRelatorio(relatorio);
  const dependencias = dependenciasPorArquivo(relatorio);
  const tabelas = errosDaTabela(relatorio);
  return (
    <div role="status">
      <h3>{tituloDoRelatorio(relatorio)}</h3>
      <div className="tabela-rolavel"><TabelaDensa colunas={COLUNAS_RESUMO} linhas={resumoDoRelatorio(relatorio)} chaveLinha={(l) => l.arquivo} legenda="Resumo da carga por cadastro" /></div>
      {dependencias.map((d) => (
        <div key={d.arquivo} className="faixa-aviso" role="alert">
          <ul>{d.motivos.map((m) => <li key={m}>{d.arquivo} — {m}</li>)}</ul>
          {d.faltam.length > 0 && (
            <p>{d.faltam.map((e) => <a key={e} className="mx-botao-secundario" href={`#carga-${e}`}>Ir para {ROTULOS_ENTIDADE[e]}</a>)}</p>
          )}
        </div>
      ))}
      {tabelas.map((g) => (
        <div key={g.arquivo} className="tabela-rolavel"><TabelaDensa colunas={COLUNAS_ERROS} linhas={g.erros} chaveLinha={(e) => `${e.arquivo}-${e.linha}-${e.campo}-${e.motivo}`} legenda={`Erros de ${g.arquivo}`} /></div>
      ))}
      {totais.erros === 0 && <p className="apoio">Nenhum erro.</p>}
      {relatorio.erros_omitidos > 0 && <p className="apoio">{textoErrosOmitidos(relatorio.erros_omitidos)}</p>}
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
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; relatorio?: RelatorioCarga; erro?: string; redirecionar?: string } | null;
      if (r.status === 403 && corpo?.redirecionar === ROTA_SENHA) { window.location.assign(ROTA_SENHA); return; }
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
        <button className="mx-botao-secundario" type="button" disabled={enviando} onClick={() => void enviar('validar')}>{enviando ? 'Enviando…' : 'Validar'}</button>{' '}
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
      <p className="apoio">Carregue na ordem abaixo. Em cada cadastro: baixe o modelo, preencha, escolha o arquivo, valide e grave.</p>
      {BOTOES_CARGA.map((b) => <CartaoEntidade key={b.entidade} entidade={b.entidade} api={api} />)}
    </section>
  );
}
