/**
 * Carga inicial dos cadastros pelos CSVs do kit (T-0026; docs/desenho/T-0026.md). `POST /v1/cadastros/cargas`: lê (SDK) →
 * confere o layout → mapeia e revalida cada linha (domain, RN-CAD) → confere as referências (banco e lote) → grava na ordem
 * D13, só no modo `gravar`, numa transação só (a da rota) com SAVEPOINT por linha (D7). O arquivo vive só na memória da
 * requisição (D9): o relatório e a auditoria levam contagens e SHA-256, nunca o valor de uma célula.
 */
import {
  ErroApi, definirRota, erros, respostaCsv, sha256Hex, pode,
  type ArquivoRecebido, type ContextoRota, type CsvLido, type RotaModulo, TEMPO_MAXIMO_ROTA_MS,
} from '@macuxierp/platform-sdk';
import {
  CargaCampos, ENTIDADES_CARGA, EntidadeCarga as EntidadeCargaZ, MAX_ARQUIVOS_LOTE, MAX_BYTES_LOTE, MAX_ERROS_RELATORIO, MAX_LINHAS_LOTE, RelatorioCarga,
  type EntidadeCarga, type ErroCarga, type LinhasCarga, type ModoCarga, type ResultadoEntidade,
} from '../contracts';
import {
  LAYOUT, MOTIVO_SO_ADMINISTRADOR, PADRAO_UF, modeloCsv, REFS_CARGA, acrescentarIdsDoLote, alvoCriado, classificarArquivo, conferirReferencias, conferirVigenciaDaTabela, erroLinha, idsVazios, mapearLinha, separarDuplicados,
  type ErroLinha, type MunicipioOficial,
} from '../domain';
import {
  TRATADORES, estadoVazio, novoLoteId, planejarEstoque, podeCarregar, type Estado, type Saida,
} from './carga-entidades';
import { lerCsvDoLayout, reativarPorPadrao } from './carga-reativar';
import { tratarCartaoSemParcelas } from './formas-recusadas';
import type { Dependencias, Repositorios, TabelaChave } from './portas';
import { ENTIDADES_RESOLVIDAS } from './resolvedor-chave';
import { dataIso, violacaoExternalId } from './util';

type Linha = LinhasCarga[EntidadeCarga];

const COLUNAS_UF: Partial<Record<EntidadeCarga, string>> = { filial: 'uf', cliente: 'endereco.uf', cliente_endereco: 'uf' };
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
  linhas: Linha[];
}

const novoResultado = (entidade: ResultadoEntidade['entidade'], arquivo: string, situacao: ResultadoEntidade['situacao'], avisos: string[] = []): ResultadoEntidade => ({
  entidade, arquivo, situacao, lidas: 0, inseridas: 0, atualizadas: 0, sem_mudanca: 0, recusadas: 0, colunas_ignoradas: [], avisos,
});

/** Erro do banco numa linha: o SAVEPOINT já desfez só ela. O tempo esgotado (503) derruba a chamada inteira. */
function erroDeExcecao(linha: number, e: unknown): ErroLinha {
  if (e instanceof ErroApi) {
    if (e.status === 503) throw e;
    if (e.status === 422 && e.codigo === 'RN-CAD-09') return erroLinha(linha, 'parcelas_cartao', 'RN-CAD-09', e.message);
    if (e.status === 409) return erroLinha(linha, null, 'CARGA_CONFLITO', 'Conflito com um cadastro existente (documento, código ou identificador externo)');
  }
  return erroLinha(linha, null, 'CARGA_BANCO', 'Erro do banco ao gravar a linha: nada foi gravado para ela');
}

export async function executarCarga(deps: Dependencias, c: ContextoRota, modo: ModoCarga, recebidos: readonly ArquivoRecebido[], entidade?: EntidadeCarga): Promise<RelatorioCarga> {
  if (entidade && (recebidos.length !== 1 || recebidos[0]?.nome.toLowerCase() !== `${entidade}.csv`)) {
    throw erros.validacao({ arquivos: `Envie só o arquivo ${entidade}.csv neste botão.` });
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
      rel.entidades.push(novoResultado(k.entidade, a.nome, 'ignorado'));
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
    arquivos.push({ entidade: k.entidade, nome: a.nome, sha256: sha256Hex(a.conteudo()), bytes: a.tamanho, csv: lido, resultado, linhas: [] });
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

  // 3. Mapeamento e revalidação das linhas (domain).
  const st = estadoVazio({
    c, r, gravar: modo === 'gravar', hoje, loteId, conhecidos: idsVazios(),
    podeCredito: pode(c.sessao.perfil, 'cadastros.cliente.credito'), podeNegativo: pode(c.sessao.perfil, 'cadastros.estoque.negativo'),
  });
  for (const a of arquivos) {
    for (const e of a.csv.errosLinha) rel.erro(a.nome, e.linha, null, 'CARGA_FORMATO', e.motivo);
    const ok: Linha[] = [];
    for (const l of a.csv.linhas) {
      const m = mapearLinha(a.entidade, l.celulas, l.numero, ctxMapa);
      if (m.ok) ok.push(m.linha as Linha);
      else m.erros.forEach((e) => rel.erroLinha(a.nome, e));
    }
    const { unicas, erros: dup } = separarDuplicados(ok);
    dup.forEach((e) => rel.erroLinha(a.nome, e));
    a.linhas = unicas;
    if (a.entidade === 'prazo_pagamento') for (const l of unicas as LinhasCarga['prazo_pagamento'][]) if (l.refs.forma) st.prazosNoLote.add(l.refs.forma);
  }

  // 4. Referências e gravação na ordem D13.
  for (const entidade of ENTIDADES_CARGA) {
    const a = arquivos.find((x) => x.entidade === entidade);
    if (!a) continue;
    await carregarReferencias(st, entidade, a.linhas);
    const ref = conferirReferencias(entidade, a.linhas as never[], st.conhecidos) as { validas: Linha[]; erros: ErroLinha[] };
    ref.erros.forEach((e) => rel.erroLinha(a.nome, e));
    let linhas = ref.validas;
    if (entidade === 'preco') {
      const vig = conferirVigenciaDaTabela(linhas as LinhasCarga['preco'][]);
      vig.forEach((e) => rel.erroLinha(a.nome, e));
      const ruins = new Set(vig.map((e) => e.linha));
      linhas = linhas.filter((l) => !ruins.has(l.linha));
    }
    const boas: Linha[] = [];
    const avisos = new Set<string>();
    const contar = (efeito: 'inserida' | 'atualizada' | 'sem_mudanca', n = 1) => {
      if (efeito === 'inserida') a.resultado.inseridas += n;
      else if (efeito === 'atualizada') a.resultado.atualizadas += n;
      else a.resultado.sem_mudanca += n;
    };
    const executar = async (saida: Saida, numeros: number[], externo: string | undefined): Promise<boolean> => {
      if ('erros' in saida) {
        for (const e of saida.erros) for (const n of numeros) rel.erroLinha(a.nome, { ...e, linha: n });
        return false;
      }
      let id = saida.alvo?.id;
      if (st.gravar && saida.aplicar) {
        try {
          const aplicar = saida.aplicar;
          const novo = await r.carga.comSavepoint(() => aplicar());
          if (typeof novo === 'string') id = novo;
        } catch (e) {
          const erro = erroDeExcecao(numeros[0] as number, e);
          for (const n of numeros) rel.erroLinha(a.nome, { ...erro, linha: n });
          return false;
        }
      } else if (saida.efeito === 'inserida') id = '';
      const alvo = alvoCriado(entidade);
      if (alvo && alvo !== 'forma' && id !== undefined && externo !== undefined) st.ids[alvo].set(externo, id);
      contar(saida.efeito, numeros.length);
      return true;
    };
    if (entidade === 'estoque') {
      const porLinha = new Map(linhas.map((l) => [l.linha, l]));
      for (const g of await planejarEstoque(linhas as LinhasCarga['estoque'][], st)) {
        if (await executar(g.saida, g.linhas, undefined)) for (const n of g.linhas) boas.push(porLinha.get(n) as Linha);
      }
    } else {
      for (const l of linhas) {
        const tratar = TRATADORES[entidade] as (l: Linha, st: Estado) => Promise<Saida>;
        const colisao = await colisaoComId(r, entidade, l.external_id);
        const ok = await executar(colisao ?? (await tratar(l, st)), [l.linha], l.external_id);
        l.avisos.forEach((x) => avisos.add(x));
        if (ok) boas.push(l);
      }
    }
    acrescentarIdsDoLote(st.conhecidos, entidade, boas as never[]);
    a.resultado.avisos = [...avisos].map((x) => x.slice(0, 200)).slice(0, 50);
  }
  const produto = arquivos.find((x) => x.entidade === 'produto');
  if (produto && [...st.descontos.keys()].some((p) => !st.produtosNoPreco.has(p))) {
    produto.resultado.avisos.push('Desconto máximo de produto sem preço no lote: não foi aplicado');
  }
  if (st.gravar) {
    // RN-CAD-09: nada fica "cartão sem parcelas" (preenche quando os prazos são 30×N; senão desativa).
    const limpeza = await tratarCartaoSemParcelas(c, r, await r.carga.condicoesAtivasCartaoSemParcelas());
    const destino = arquivos.find((x) => x.entidade === 'prazo_pagamento') ?? arquivos.find((x) => x.entidade === 'forma_pagamento');
    if (destino && limpeza.preenchidas.total + limpeza.desativadas.total > 0) {
      destino.resultado.avisos.push(`Cartão sem parcelas: ${limpeza.preenchidas.total} preenchida(s), ${limpeza.desativadas.total} desativada(s)`);
    }
  }
  for (const a of arquivos) a.resultado.recusadas = Math.max(0, a.resultado.lidas - a.resultado.inseridas - a.resultado.atualizadas - a.resultado.sem_mudanca);

  if (st.gravar) {
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

/** Tabela de cada entidade da carga que grava `external_id` (a forma de pagamento e o estoque não têm tabela própria). */
const TABELA_DA_ENTIDADE: Partial<Record<EntidadeCarga, TabelaChave>> = { ...ENTIDADES_RESOLVIDAS, produto_unidade: 'produto_unidade', preco: 'tabela_preco_item' };

/** Guarda RD-0317 (ver domain/external-id.ts): vira `CARGA_CONFLITO` da linha. */
async function colisaoComId(r: Repositorios, entidade: EntidadeCarga, externalId: unknown): Promise<Saida | null> {
  const tabela = TABELA_DA_ENTIDADE[entidade];
  const v = tabela ? await violacaoExternalId(r, tabela, externalId) : null;
  return v ? { erros: [erroLinha(0, 'external_id', 'CARGA_CONFLITO', v.mensagem)] } : null;
}

/** Referências que a entidade cita e ainda não são conhecidas (nem do lote, nem do banco): uma consulta por alvo. */
async function carregarReferencias(st: Estado, entidade: EntidadeCarga, linhas: readonly Linha[]): Promise<void> {
  for (const [campo, alvo] of Object.entries(REFS_CARGA[entidade])) {
    const faltam = new Set<string>();
    for (const l of linhas) {
      const v = ((l as { refs?: Record<string, string | undefined> }).refs ?? {})[campo];
      if (v !== undefined && !st.conhecidos[alvo].has(v)) faltam.add(v);
    }
    if (faltam.size === 0) continue;
    if (alvo === 'forma') {
      for (const ext of faltam) if ((await st.r.carga.condicoesDaForma(ext)).length > 0) st.conhecidos.forma.add(ext);
      continue;
    }
    for (const [ext, id] of await st.r.chaves.idsPorExternalId(alvo, [...faltam], true)) {
      st.ids[alvo].set(ext, id);
      st.conhecidos[alvo].add(ext);
    }
  }
}

/** RF-CAD-11: modelo CSV da entidade (cabeçalho só), com a mesma ação da carga. */
export function rotaModeloCarga(): RotaModulo {
  return definirRota({
    metodo: 'GET', caminho: '/cargas/modelos/:entidade', acao: 'cadastros.carga.executar',
    async executar(_c, e) {
      const k = EntidadeCargaZ.safeParse(e.params.entidade);
      if (!k.success) throw erros.naoEncontrado('Modelo');
      return respostaCsv(`${k.data}.csv`, modeloCsv(k.data));
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
