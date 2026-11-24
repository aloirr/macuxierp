/**
 * Carga inicial dos cadastros pelos CSVs do kit (T-0026; docs/desenho/T-0026.md). `POST /v1/cadastros/cargas`: lê (SDK) →
 * confere o layout → mapeia e revalida cada linha (domain, RN-CAD) → confere as referências (banco e lote) → grava na ordem
 * D13, só no modo `gravar`, numa transação só (a da rota) com SAVEPOINT por linha (D7). O arquivo vive só na memória da
 * requisição (D9): o relatório e a auditoria levam contagens e SHA-256, nunca o valor de uma célula.
 */
import {
  definirRota, erros, respostaCsv, sha256Hex,
  type ArquivoRecebido, type ContextoRota, type CsvLido, type RotaModulo, TEMPO_MAXIMO_ROTA_MS,
} from '@macuxierp/platform-sdk';
import {
  CargaCampos, EntidadeCarga as EntidadeCargaZ, MAX_ARQUIVOS_LOTE, MAX_BYTES_LOTE, MAX_ERROS_RELATORIO, MAX_LINHAS_LOTE, RelatorioCarga,
  type EntidadeCarga, type ErroCarga, type LinhasCarga, type ModoCarga, type ResultadoEntidade,
} from '../contracts';
import {
  AVISO_ARQUIVO_IGNORADO, LAYOUT, MOTIVO_SO_ADMINISTRADOR, PADRAO_UF, modeloCsv, nomeArquivoCarga, classificarArquivo,
  conferirDadosDoCliente, mapearLinha, type ErroLinha, type MunicipioOficial,
} from '../domain';
import { gravarLinhas, type EntradaGravacao } from './carga-gravar';
import { novoLoteId, podeCarregar } from './carga-entidades';
import { lerCsvDoLayout, reativarPorPadrao } from './carga-reativar';
import type { Dependencias } from './portas';
import { dataIso } from './util';

type Linha = LinhasCarga[EntidadeCarga];

const COLUNAS_UF: Partial<Record<EntidadeCarga, string>> = { filial: 'uf', cliente: 'endereco.uf' };
const CODIGO_CSV = { CSV_COLUNA_AUSENTE: 'CARGA_OBRIGATORIO' } as const;

class Relatorio {
  readonly erros: ErroCarga[] = [];
  omitidos = 0;
  readonly entidades: ResultadoEntidade[] = [];
  erro(arquivo: string, linha: number | null, campo: string | null, codigo: string, motivo: string, entidadeFaltante?: EntidadeCarga): void {
    if (this.erros.length >= MAX_ERROS_RELATORIO) this.omitidos += 1;
    else this.erros.push({ arquivo, linha, campo, codigo: codigo as ErroCarga['codigo'], motivo: motivo.slice(0, 200), ...(entidadeFaltante ? { entidade_faltante: entidadeFaltante } : {}) });
  }
  erroLinha(arquivo: string, e: ErroLinha): void {
    this.erro(arquivo, e.linha, e.campo, e.codigo, e.motivo, e.entidade_faltante);
  }
}

interface ArquivoCarga {
  entidade: EntidadeCarga;
  nome: string;
  sha256: string;
  bytes: number;
  csv: CsvLido;
  resultado: ResultadoEntidade;
}

const novoResultado = (entidade: ResultadoEntidade['entidade'], arquivo: string, situacao: ResultadoEntidade['situacao'], avisos: string[] = []): ResultadoEntidade => ({
  entidade, arquivo, situacao, lidas: 0, inseridas: 0, atualizadas: 0, sem_mudanca: 0, recusadas: 0, colunas_ignoradas: [], avisos,
});

export async function executarCarga(deps: Dependencias, c: ContextoRota, modo: ModoCarga, recebidos: readonly ArquivoRecebido[], entidade?: EntidadeCarga): Promise<RelatorioCarga> {
  if (entidade && (recebidos.length !== 1 || ![`${entidade}.csv`, nomeArquivoCarga(entidade)].includes(recebidos[0]?.nome.toLowerCase() ?? ''))) {
    throw erros.validacao({ arquivos: `Envie só o arquivo ${nomeArquivoCarga(entidade)} neste botão.` });
  }
  const r = deps.repositorios(c.tx);
  const loteId = novoLoteId();
  const rel = new Relatorio();
  const hoje = dataIso(c.agora);

  // 1. Arquivos: nome (D1), perfil por entidade (D8) e leitura do SDK (D2).
  const arquivos: ArquivoCarga[] = [];
  const vistas = new Set<EntidadeCarga>();
  let total = 0;
  for (const bruto of recebidos) {
    const k = classificarArquivo(bruto.nome);
    // RN-CAD-08 e decisão do PO: `ativo` vazio ou ausente = sim, em toda rota de carga (ponto comum).
    const a = k.classe === 'carga' ? reativarPorPadrao(k.entidade, bruto) : bruto;
    if (k.classe === 'ignorado') {
      rel.entidades.push(novoResultado(k.entidade, a.nome, 'ignorado', [AVISO_ARQUIVO_IGNORADO[k.entidade]].filter((x): x is string => x !== undefined)));
      continue;
    }
    if (k.classe === 'recusado') {
      rel.erro(a.nome, null, null, 'CARGA_FORMATO', 'Nome de arquivo fora do kit: use <entidade>.csv');
      continue;
    }
    if (vistas.has(k.entidade)) {
      rel.erro(a.nome, null, null, 'CARGA_DUPLICADO', 'Entidade enviada em mais de um arquivo: só o primeiro vale');
      continue;
    }
    vistas.add(k.entidade);
    const recusar = (linha: number | null, campo: string | null, codigo: string, motivo: string) => {
      rel.entidades.push(novoResultado(k.entidade, a.nome, 'recusado'));
      rel.erro(a.nome, linha, campo, codigo, motivo);
    };
    if (!podeCarregar(c.sessao.perfil, k.entidade)) {
      recusar(null, null, 'PERFIL_SEM_PERMISSAO', k.entidade === 'filial' ? MOTIVO_SO_ADMINISTRADOR : 'O perfil não pode carregar esta entidade');
      continue;
    }
    const layout = LAYOUT[k.entidade];
    const lido = lerCsvDoLayout(k.entidade, a.conteudo());
    if (!lido.ok) {
      recusar(lido.erro.linha, lido.erro.coluna, CODIGO_CSV[lido.erro.codigo as keyof typeof CODIGO_CSV] ?? 'CARGA_FORMATO', lido.erro.motivo);
      continue;
    }
    total += lido.linhas.length + lido.errosLinha.length;
    const resultado = novoResultado(k.entidade, a.nome, 'processado');
    resultado.lidas = lido.linhas.length + lido.errosLinha.length;
    resultado.colunas_ignoradas = lido.colunas.filter((x) => layout.ignoradas.includes(x));
    rel.entidades.push(resultado);
    arquivos.push({ entidade: k.entidade, nome: a.nome, sha256: sha256Hex(a.conteudo()), bytes: a.tamanho, csv: lido, resultado });
  }
  if (total > MAX_LINHAS_LOTE) throw erros.validacao({ arquivos: `O lote tem mais de ${MAX_LINHAS_LOTE} linhas: envie um arquivo por vez (CLI)` });

  // 2. Municípios: uma consulta por UF do lote (RN-CAD-03).
  const ufs = new Set<string>();
  for (const a of arquivos) {
    const col = COLUNAS_UF[a.entidade];
    if (col) for (const l of a.csv.linhas) if (PADRAO_UF.test((l.celulas[col] ?? '').toUpperCase())) ufs.add((l.celulas[col] as string).toUpperCase());
  }
  const municipios = new Map<string, MunicipioOficial[]>();
  for (const uf of ufs) municipios.set(uf, await r.oficiais.municipiosDaUf(uf, hoje));
  const ctxMapa = { municipiosDaUf: (uf: string): readonly MunicipioOficial[] => municipios.get(uf) ?? [] };

  // 3. Mapeamento e revalidação das linhas (domain); a gravação é a `gravarLinhas`, comum com a /entrada/v1.
  const entradas: EntradaGravacao[] = [];
  for (const a of arquivos) {
    for (const e of a.csv.errosLinha) rel.erro(a.nome, e.linha, null, 'CARGA_FORMATO', e.motivo);
    const ok: Linha[] = [];
    let doArquivo = a.csv.linhas;
    if (a.entidade === 'cliente') {
      // T-0058: as linhas do mesmo cliente têm de trazer os mesmos dados dele; a divergente é recusada antes do mapeamento.
      const conf = conferirDadosDoCliente(doArquivo.map((l) => ({ numero: l.numero, celulas: l.celulas })));
      conf.erros.forEach((e) => rel.erroLinha(a.nome, e));
      doArquivo = doArquivo.filter((l) => !conf.recusadas.has(l.numero));
    }
    for (const l of doArquivo) {
      const m = mapearLinha(a.entidade, l.celulas, l.numero, ctxMapa);
      if (m.ok) ok.push(m.linha as Linha);
      else m.erros.forEach((e) => rel.erroLinha(a.nome, e));
    }
    entradas.push({ entidade: a.entidade, linhas: ok });
  }

  // 4. Agrupamento, referências e gravação na ordem D13.
  const saida = await gravarLinhas(deps, c, modo, loteId, entradas);
  const arquivoDe = new Map(arquivos.map((a) => [a.entidade, a]));
  for (const e of saida.erros) rel.erroLinha((arquivoDe.get(e.entidade) as ArquivoCarga).nome, e.erro);
  for (const a of arquivos) {
    const g = saida.resultados[a.entidade];
    if (!g) continue;
    a.resultado.inseridas = g.inseridas;
    a.resultado.atualizadas = g.atualizadas;
    a.resultado.sem_mudanca = g.sem_mudanca;
    a.resultado.avisos = g.avisos;
  }
  for (const a of arquivos) a.resultado.recusadas = Math.max(0, a.resultado.lidas - a.resultado.inseridas - a.resultado.atualizadas - a.resultado.sem_mudanca);

  if (modo === 'gravar') {
    await c.auditar({
      acao: 'cadastros.carga', entidade: 'carga', entidade_id: loteId, antes: null,
      depois: {
        modo,
        arquivos: arquivos.map((a) => ({ entidade: a.entidade, sha256: a.sha256, bytes: a.bytes })),
        contagens: Object.fromEntries(arquivos.map((a) => [a.entidade, { lidas: a.resultado.lidas, inseridas: a.resultado.inseridas, atualizadas: a.resultado.atualizadas, sem_mudanca: a.resultado.sem_mudanca, recusadas: a.resultado.recusadas }])),
      },
    });
  }
  return RelatorioCarga.parse({
    lote_id: loteId, modo, iniciado_em: c.agora.toISOString(), concluido_em: new Date().toISOString(),
    entidades: rel.entidades, erros: rel.erros, erros_omitidos: rel.omitidos,
  });
}

/** RF-CAD-11: modelo CSV da entidade (cabeçalho só), com a mesma ação da carga. */
export function rotaModeloCarga(): RotaModulo {
  return definirRota({
    metodo: 'GET', caminho: '/cargas/modelos/:entidade', acao: 'cadastros.carga.executar',
    async executar(_c, e) {
      const k = EntidadeCargaZ.safeParse(e.params.entidade);
      if (!k.success) throw erros.naoEncontrado('Modelo');
      return respostaCsv(nomeArquivoCarga(k.data), modeloCsv(k.data));
    },
  });
}

export function rotaCarga(deps: Dependencias): RotaModulo {
  return definirRota({
    metodo: 'POST', caminho: '/cargas', acao: 'cadastros.carga.executar', corpo: CargaCampos,
    multipart: { arquivos: [{ campo: 'arquivos', tamanhoMaximo: MAX_BYTES_LOTE, quantidadeMaxima: MAX_ARQUIVOS_LOTE }], tamanhoMaximoTotal: MAX_BYTES_LOTE },
    idempotencia: 'opcional', tempoMaximoMs: TEMPO_MAXIMO_ROTA_MS,
    async executar(c, e) {
      return { corpo: await executarCarga(deps, c, e.corpo.modo, e.todosArquivos.arquivos ?? [], e.corpo.entidade) };
    },
  });
}