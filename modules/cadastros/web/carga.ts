/**
 * Página "Carga de cadastros" do BKO (T-0026; desenho seção 7), descrita como dados e funções puras: o shell (apps/web)
 * escolhe os CSVs, chama `POST /v1/cadastros/cargas` e desenha o relatório. A página NÃO guarda o arquivo (D9): o
 * navegador só o envia. A permissão aqui só esconde o botão; a proteção real é a da API (RN-CORE-02).
 */
import { paraCsv, pode, type Perfil } from '@macuxierp/platform-sdk';
import { ENTIDADES_CARGA, MAX_ARQUIVOS_LOTE, MAX_BYTES_LOTE, type ErroCarga, type ModoCarga, type RelatorioCarga, type ResultadoEntidade } from '../contracts';

export const PAGINA_CARGA = {
  id: 'carga',
  menu: 'Carga de cadastros',
  titulo: 'Carga de cadastros',
  /** Convenção do shell: `/<módulo>/<slug do rótulo>` (apps/web/src/lib/menu.ts), para o href do menu bater com a rota. */
  rota: '/cadastros/carga-de-cadastros',
  api: '/v1/cadastros/cargas',
  /** Campo do arquivo no multipart (a API aceita até 16). */
  campoArquivos: 'arquivos',
  maxArquivos: MAX_ARQUIVOS_LOTE,
  maxBytes: MAX_BYTES_LOTE,
} as const;

export const ROTULOS_ENTIDADE: Readonly<Record<ResultadoEntidade['entidade'], string>> = {
  filial: 'Filiais', vendedor: 'Vendedores', forma_pagamento: 'Formas de pagamento', prazo_pagamento: 'Prazos de pagamento', produto: 'Produtos',
  produto_unidade: 'Unidades do produto', preco: 'Preços', estoque: 'Estoque', cliente: 'Clientes', cliente_endereco: 'Endereços de clientes',
  catalogo_no: 'Catálogo', tabela_escalonada: 'Tabela escalonada', transportadora: 'Transportadoras', rota: 'Rotas', titulo: 'Títulos', nota: 'Notas',
};

const SITUACOES: Readonly<Record<ResultadoEntidade['situacao'], string>> = { processado: 'Processado', recusado: 'Arquivo recusado', ignorado: 'Ignorado (fora da v1)' };

export interface AcoesDaCarga {
  /** Vê a página e escolhe arquivos. */
  abrir: boolean;
  validar: boolean;
  /** O Gravar sempre pede confirmação (`textoDeConfirmacao`). */
  gravar: boolean;
}

export function acoesDaCarga(perfil: Perfil): AcoesDaCarga {
  const pode_ = pode(perfil, 'cadastros.carga.executar');
  return { abrir: pode_, validar: pode_, gravar: pode_ };
}

export const textoDeConfirmacao = (n: number): string =>
  `Gravar ${n} arquivo${n === 1 ? '' : 's'} nos cadastros? Linhas iguais ao que já existe não mudam; o resto é criado ou atualizado. Use Validar antes para conferir.`;

export interface ArquivoEscolhido {
  nome: string;
  tamanho: number;
}

/** Confere a seleção no navegador, antes do envio (a API revalida: 413 e 400). Devolve avisos fixos, sem ler o arquivo. */
export function problemasDaSelecao(arquivos: readonly ArquivoEscolhido[]): string[] {
  const p: string[] = [];
  if (arquivos.length === 0) p.push('Escolha ao menos um arquivo .csv');
  if (arquivos.length > PAGINA_CARGA.maxArquivos) p.push(`No máximo ${PAGINA_CARGA.maxArquivos} arquivos por envio`);
  if (arquivos.some((a) => !/\.csv$/i.test(a.nome))) p.push('Só arquivos .csv (no Excel: "Salvar como" > "CSV UTF-8")');
  if (arquivos.reduce((t, a) => t + a.tamanho, 0) > PAGINA_CARGA.maxBytes) p.push(`O envio passa de ${Math.floor(PAGINA_CARGA.maxBytes / 1_048_576)} MB: mande poucos arquivos por vez ou use a linha de comando`);
  return p;
}

/** Corpo multipart do envio: `modo` e os arquivos no campo `arquivos`. */
export function montarFormulario(modo: ModoCarga, arquivos: readonly { nome: string; conteudo: Blob }[]): FormData {
  const f = new FormData();
  f.append('modo', modo);
  for (const a of arquivos) f.append(PAGINA_CARGA.campoArquivos, a.conteudo, a.nome);
  return f;
}

export interface LinhaResumo {
  entidade: string;
  arquivo: string;
  situacao: string;
  lidas: number;
  inseridas: number;
  atualizadas: number;
  sem_mudanca: number;
  recusadas: number;
  avisos: string;
  colunas_ignoradas: string;
}

/** Uma linha por entidade, na ordem de carga (D13); depois os ignorados. */
export function resumoDoRelatorio(r: RelatorioCarga): LinhaResumo[] {
  const posicao = (e: ResultadoEntidade['entidade']) => {
    const i = (ENTIDADES_CARGA as readonly string[]).indexOf(e);
    return i < 0 ? ENTIDADES_CARGA.length : i;
  };
  return [...r.entidades]
    .sort((a, b) => posicao(a.entidade) - posicao(b.entidade))
    .map((e) => ({
      entidade: ROTULOS_ENTIDADE[e.entidade], arquivo: e.arquivo, situacao: SITUACOES[e.situacao], lidas: e.lidas, inseridas: e.inseridas,
      atualizadas: e.atualizadas, sem_mudanca: e.sem_mudanca, recusadas: e.recusadas, avisos: e.avisos.join(' | '), colunas_ignoradas: e.colunas_ignoradas.join(', '),
    }));
}

export interface TotaisCarga {
  lidas: number;
  inseridas: number;
  atualizadas: number;
  sem_mudanca: number;
  recusadas: number;
  erros: number;
}

export function totaisDoRelatorio(r: RelatorioCarga): TotaisCarga {
  const t: TotaisCarga = { lidas: 0, inseridas: 0, atualizadas: 0, sem_mudanca: 0, recusadas: 0, erros: r.erros.length + r.erros_omitidos };
  for (const e of r.entidades) {
    t.lidas += e.lidas;
    t.inseridas += e.inseridas;
    t.atualizadas += e.atualizadas;
    t.sem_mudanca += e.sem_mudanca;
    t.recusadas += e.recusadas;
  }
  return t;
}

/** No modo `validar` os números são previsões: o rótulo muda, nunca a conta. */
export const tituloDoRelatorio = (r: RelatorioCarga): string =>
  r.modo === 'validar' ? 'Validação (nada foi gravado): números previstos' : 'Carga gravada';

/** Erros por arquivo (linha, campo, motivo), na ordem do relatório; o motivo nunca traz o valor digitado. */
export function errosPorArquivo(r: RelatorioCarga): { arquivo: string; erros: ErroCarga[] }[] {
  const mapa = new Map<string, ErroCarga[]>();
  for (const e of r.erros) mapa.set(e.arquivo, [...(mapa.get(e.arquivo) ?? []), e]);
  return [...mapa].map(([arquivo, erros]) => ({ arquivo, erros }));
}

export const descricaoDoLocal = (e: ErroCarga): string => (e.linha === null ? 'Arquivo' : `Linha ${e.linha}`) + (e.campo ? ` · ${e.campo}` : '');

/** CSV dos erros do relatório (Exportar CSV, montado no navegador com o CSV comum do SDK). */
export function csvDosErros(r: RelatorioCarga): string {
  return paraCsv<ErroCarga>(
    [
      { titulo: 'Arquivo', valor: (e) => e.arquivo },
      { titulo: 'Linha', valor: (e) => e.linha },
      { titulo: 'Campo', valor: (e) => e.campo },
      { titulo: 'Código', valor: (e) => e.codigo },
      { titulo: 'Motivo', valor: (e) => e.motivo },
    ],
    r.erros,
  );
}

/** CSV do resumo por entidade. */
export function csvDoResumo(r: RelatorioCarga): string {
  return paraCsv<LinhaResumo>(
    [
      { titulo: 'Entidade', valor: (l) => l.entidade }, { titulo: 'Arquivo', valor: (l) => l.arquivo }, { titulo: 'Situação', valor: (l) => l.situacao },
      { titulo: 'Lidas', valor: (l) => l.lidas }, { titulo: 'Inseridas', valor: (l) => l.inseridas }, { titulo: 'Atualizadas', valor: (l) => l.atualizadas },
      { titulo: 'Sem mudança', valor: (l) => l.sem_mudanca }, { titulo: 'Recusadas', valor: (l) => l.recusadas }, { titulo: 'Avisos', valor: (l) => l.avisos },
      { titulo: 'Colunas ignoradas', valor: (l) => l.colunas_ignoradas },
    ],
    resumoDoRelatorio(r),
  );
}
