/**
 * Gravação da carga de CSV (T-0026, D4 a D6 e D13): um tratador por entidade. Cada um PLANEJA a linha (lê o banco, aplica
 * as regras do domain e decide inserida, atualizada ou sem mudança) e devolve `aplicar`, que só o modo `gravar` chama,
 * dentro do SAVEPOINT da linha. Nada daqui devolve valor digitado: os motivos são mensagens fixas (D9).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ContextoRota } from '@macuxierp/platform-sdk';
import { pode } from '@macuxierp/platform-sdk';
import {
  ClienteDados, CondicaoPagamentoDados, classeForma, EnderecoCliente, FilialDados, ProdutoDados, TabelaPrecoDados, UnidadeDados, VendedorDados,
  type CondicaoPagamento, type EntidadeCarga, type LinhaCliente, type LinhaCondicaoPagamento, type LinhaEstoque, type LinhaFilial,
  type LinhaPreco, type LinhaProduto, type LinhaProdutoUnidade, type LinhaVendedor, type LinhasCarga,
} from '../contracts';
import {
  ajusteDeCarga, bloqueiosDeInativacao, dadosDaForma as dadosFormaDoLote, descontoNaCargaDoPreco, completarParcelasCartao, completarPrazoMedio, derivarParcelasCartao, MOTIVO_FORMA_NAO_ACEITA, MOTIVO_SO_ADMINISTRADOR, camposAlterados, erroDeViolacao, erroLinha, errosDeZod, prepararCriacao, prepararEnderecoNovo, somarSaldos, validarDocumentoCliente,
  validarCondicaoPagamento, faixaSeAplica, validarEnderecoPrincipal, validarFilial, validarIe, violacao, validarFiscalLinhaProduto, validarIndIeDest, violacaoFracao, type ErroLinha, type IdsConhecidos,
  type FatosFilial, type FormaDoLote,
} from '../domain';
import { desativarCondicoesRecusadas } from './formas-recusadas';
import { eventoCliente, eventoEstoque, eventoFilial, eventoPreco, eventoProduto, eventoSimples, eventoTabelaPreco, comExternalIdAnterior, publicarPronto, republicarItensDaTabela, type EventoPronto } from './eventos';
import type { AlvoExterno, Repositorios, RepoSimples } from './portas';
import { agregadoEstoque } from './uuid';
import { violacaoExternalId } from './util';

type Dict = Record<string, unknown>;
export type Efeito = 'inserida' | 'atualizada' | 'sem_mudanca';

/** Resultado do planejamento de uma linha. `aplicar` devolve o `id` do cadastro quando a linha cria ou resolve um. */
export type Saida =
  | { erros: ErroLinha[] }
  | {
    efeito: Efeito; alvo?: { tipo: AlvoExterno; id: string }; aplicar?: () => Promise<string | void>;
    /** T-0058: erros de linhas do grupo (endereços do cliente) que não derrubam o cliente; as linhas deles contam como recusadas. */
    errosParciais?: ErroLinha[];
  };

/** UUID de enchimento: no modo `validar` o cadastro novo do lote ainda não tem id (marca `''`), e o Zod pede um UUID. */
const PENDENTE = '00000000-0000-4000-8000-000000000000';
const ouPendente = (id: string | undefined | null): string | undefined => (id === undefined || id === null ? undefined : id === '' ? PENDENTE : id);

interface TabelaDoLote {
  id: string;
  existente: Dict | null;
  pronta: boolean;
}

export interface Estado {
  c: ContextoRota;
  r: Repositorios;
  gravar: boolean;
  hoje: string;
  loteId: string;
  podeCredito: boolean;
  podeNegativo: boolean;
  /** `external_id` → UUID por cadastro; `''` = vai ser criado neste lote (modo `validar`). */
  ids: Record<AlvoExterno, Map<string, string>>;
  /** Dados gravados de cada forma (pelo `forma_external_id`), lidos das condições dela uma vez por lote. */
  formas: Map<string, { codigo: string | null; nome: string | null; tpag: string | null } | null>;
  descontos: Map<string, number>;
  /** RN-CAD-11: itens de preço gravados sem desconto (nem no produto nem no preço), para o aviso do arquivo de preço. */
  precosSemDesconto: number;
  unidadeDoProduto: Map<string, string>;
  tabelas: Map<string, TabelaDoLote>;
  filialPadrao: { carregada: boolean; id: string | null };
  fatos: Map<string, Promise<boolean>>;
  conhecidos: IdsConhecidos;
}

export const estadoVazio = (p: Pick<Estado, 'c' | 'r' | 'gravar' | 'hoje' | 'loteId' | 'podeCredito' | 'podeNegativo' | 'conhecidos'>): Estado => ({
  ...p,
  ids: { filial: new Map(), vendedor: new Map(), condicao_pagamento: new Map(), produto: new Map(), tabela_preco: new Map(), cliente: new Map() },
  formas: new Map(), descontos: new Map(), precosSemDesconto: 0, unidadeDoProduto: new Map(),
  tabelas: new Map(), filialPadrao: { carregada: false, id: null }, fatos: new Map(),
});

const mover = (linha: number, campo: string, codigo: string, motivo: string): Saida => ({ erros: [erroLinha(linha, campo, codigo, motivo)] });
const conflito = (linha: number, campo: string): Saida =>
  mover(linha, campo, 'CARGA_CONFLITO', 'A chave natural já pertence a outro cadastro com outro external_id');

const violacoes = (linha: number, v: readonly { rn: string; campo: string; mensagem: string }[]): Saida => ({
  erros: v.map((x) => erroDeViolacao(linha, x as never)),
});

/** D4: primeiro o `external_id`; depois a chave natural (adota o cadastro sem `external_id`; com outro, é conflito). */
async function casar<E extends { id: string; external_id?: string | null }, D>(repo: RepoSimples<E, D>, ext: string, campo: 'cnpj' | 'documento' | 'codigo', natural: string | undefined) {
  const porId = await repo.porExternalId(ext);
  if (porId) return { ex: porId, adotar: false, conflito: false };
  if (natural !== undefined) {
    const n = await repo.porCampo(campo, natural);
    if (n) return n.external_id ? { ex: null, adotar: false, conflito: true } : { ex: n, adotar: true, conflito: false };
  }
  return { ex: null, adotar: false, conflito: false };
}

const ativoPatch = (ativo: boolean | undefined): Dict => (ativo === undefined ? {} : { inativo: !ativo });

async function filialPadraoId(st: Estado): Promise<string | null> {
  if (!st.filialPadrao.carregada) {
    st.filialPadrao = { carregada: true, id: (await st.r.filiais.padrao())?.id ?? null };
  }
  return st.filialPadrao.id;
}

async function filialDaLinha(st: Estado, ext: string | undefined, linha: number): Promise<{ id: string } | { erro: Saida }> {
  const id = ext === undefined ? await filialPadraoId(st) : st.ids.filial.get(ext);
  if (id === null || id === undefined) return { erro: mover(linha, 'filial_external_id', 'CARGA_OBRIGATORIO', 'Sem filial na linha e sem filial padrão no ERP') };
  return { id };
}

/** Altera o estado ativo/inativo do cadastro (D6; RN-CAD-08 trata a padrão antes). */
async function aplicarAtivo(repo: { inativar(id: string): Promise<unknown>; reativar(id: string): Promise<unknown> }, id: string, ativo: boolean | undefined, inativoAntes: boolean): Promise<void> {
  if (ativo === false && !inativoAntes) await repo.inativar(id);
  else if (ativo === true && inativoAntes) await repo.reativar(id);
}

const EVENTO_VENDEDOR = (_r: Repositorios, e: { id: string; inativo: boolean }) => eventoSimples('cadastros.vendedor.alterado@1', e);
const EVENTO_CONDICAO = (_r: Repositorios, e: { id: string; inativo: boolean }) => eventoSimples('cadastros.condicao_pagamento.alterada@1', e);

/** Fecha a escrita de um cadastro: ativo/inativo (D6), leitura do estado final e o evento dele na outbox. */
async function concluirEscrita<E extends { id: string }>(
  st: Estado,
  repo: { inativar(id: string): Promise<unknown>; reativar(id: string): Promise<unknown>; obter(id: string): Promise<E | null> },
  id: string,
  ativo: boolean | undefined,
  inativoAntes: boolean,
  evento: (r: Repositorios, e: E) => EventoPronto | Promise<EventoPronto>,
  antes?: unknown,
): Promise<E | null> {
  await aplicarAtivo(repo, id, ativo, inativoAntes);
  const depois = await repo.obter(id);
  // ADR 0010, item 3 / RN-CORE-05: a adoção (nulo → chave do kit) publica external_id_anterior: null
  if (depois) await publicarPronto(st.c, comExternalIdAnterior(await evento(st.r, depois), depois, antes));
  return depois;
}

// ---- filial (RF-CAD-08) ----
async function filial(l: LinhaFilial, st: Estado): Promise<Saida> {
  const repo = st.r.filiais;
  const d = l.dados;
  const e = l.endereco ?? {};
  const { ex, adotar, conflito: cf } = await casar(repo, l.external_id, 'cnpj', d.cnpj);
  if (cf) return conflito(l.linha, 'cnpj');
  if (ex) {
    const alvo = { tipo: 'filial' as const, id: ex.id };
    const patch: Dict = { ...d, ...e, ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}) };
    if (camposAlterados(patch, { ...ex, ...ex.endereco }).length === 0) return { efeito: 'sem_mudanca', alvo };
    const m = { ...ex, ...ex.endereco, ...patch } as Dict;
    const v = validarFilial({
      uf: m.uf as string, municipio_ibge: m.municipio_ibge as string, ie: (m.ie as string | null) ?? null, emissora: ex.emissora,
      nfe_serie: ex.nfe_serie ?? null, nfe_numero_inicial: ex.nfe_numero_inicial ?? null,
      crt: m.crt as FatosFilial['crt'], regime_pis_cofins: (m.regime_pis_cofins as FatosFilial['regime_pis_cofins']) ?? null,
    });
    if (l.ativo === false && !ex.inativo) v.push(...bloqueiosDeInativacao('filial', { padrao: ex.padrao }));
    if (v.length > 0) return violacoes(l.linha, v);
    return {
      efeito: 'atualizada', alvo,
      async aplicar() {
        const parcial: Dict = { ...d, ...(adotar ? { external_id: l.external_id } : {}) };
        if (l.endereco) parcial.endereco = { ...ex.endereco, ...e };
        if (Object.keys(parcial).length > 0) await repo.atualizar(ex.id, parcial as never);
        const depois = await concluirEscrita(st, repo, ex.id, l.ativo, ex.inativo, eventoFilial, ex);
        if (!depois) return ex.id;
        await st.c.auditar({ acao: 'filial.alterar', entidade: 'filial', entidade_id: ex.id, antes: ex, depois });
        return ex.id;
      },
    };
  }
  const p = prepararCriacao('filial', l);
  if (!p.ok) return { erros: p.erros };
  const f = p.linha;
  const temPadrao = (await filialPadraoId(st)) !== null;
  const r = FilialDados.safeParse({
    ...f.dados, ie: f.dados.ie ?? null, endereco: { ...f.endereco, complemento: f.endereco?.complemento ?? null },
    padrao: !temPadrao && l.ativo !== false, emissora: false, external_id: l.external_id,
  });
  if (!r.success) return { erros: errosDeZod(l.linha, r.error.issues) };
  const v = validarFilial({ uf: r.data.endereco.uf, municipio_ibge: r.data.endereco.municipio_ibge, ie: r.data.ie, emissora: false, nfe_serie: null, nfe_numero_inicial: null, crt: r.data.crt, regime_pis_cofins: r.data.regime_pis_cofins });
  if (v.length > 0) return violacoes(l.linha, v);
  // No modo validar nada é gravado: a marca vale já no planejamento. No gravar, só depois do INSERT (e é desfeita se a linha falhar).
  if (r.data.padrao && !st.gravar) st.filialPadrao = { carregada: true, id: '' };
  return {
    efeito: 'inserida',
    async aplicar() {
      const marcaAntes = st.filialPadrao;
      try {
        const criada = await repo.inserir(r.data);
        if (r.data.padrao) st.filialPadrao = { carregada: true, id: criada.id };
        const depois = (await concluirEscrita(st, repo, criada.id, l.ativo, false, eventoFilial)) ?? criada;
        await st.c.auditar({ acao: 'filial.criar', entidade: 'filial', entidade_id: criada.id, antes: null, depois });
        return criada.id;
      } catch (e) {
        st.filialPadrao = marcaAntes;
        throw e;
      }
    },
  };
}

// ---- vendedor (RF-CAD-07) ----
async function vendedor(l: LinhaVendedor, st: Estado): Promise<Saida> {
  const repo = st.r.vendedores;
  const d = l.dados;
  const { ex, adotar, conflito: cf } = await casar(repo, l.external_id, 'codigo', d.codigo ?? (l.external_id.length <= 20 ? l.external_id : undefined));
  if (cf) return conflito(l.linha, 'codigo');
  const filialId = l.refs.filial === undefined ? undefined : st.ids.filial.get(l.refs.filial);
  if (ex) {
    const alvo = { tipo: 'vendedor' as const, id: ex.id };
    const patch: Dict = { ...d, ...(filialId === undefined ? {} : { filial_id: filialId }), ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}) };
    if (camposAlterados(patch, ex as unknown as Dict).length === 0) return { efeito: 'sem_mudanca', alvo };
    return {
      efeito: 'atualizada', alvo,
      async aplicar() {
        const { inativo: _i, ...parcial } = patch;
        if (Object.keys(parcial).length > 0) await repo.atualizar(ex.id, parcial as never);
        await concluirEscrita(st, repo, ex.id, l.ativo, ex.inativo, EVENTO_VENDEDOR, ex);
        return ex.id;
      },
    };
  }
  const p = prepararCriacao('vendedor', l);
  if (!p.ok) return { erros: p.erros };
  const fil = filialId === undefined ? await filialDaLinha(st, undefined, l.linha) : { id: filialId };
  if ('erro' in fil) return fil.erro;
  const r = VendedorDados.safeParse({ ...p.linha.dados, filial_id: ouPendente(fil.id), usuario_id: null, external_id: l.external_id });
  if (!r.success) return { erros: errosDeZod(l.linha, r.error.issues) };
  return {
    efeito: 'inserida',
    async aplicar() {
      const criado = await repo.inserir({ ...r.data, filial_id: fil.id });
      await concluirEscrita(st, repo, criado.id, l.ativo, false, EVENTO_VENDEDOR);
      return criado.id;
    },
  };
}

// ---- condição de pagamento (RF-CAD-09) e a forma dela (RN-CAD-09): na mesma linha, desde a T-0058 ----
async function condicoesDaForma(st: Estado, ext: string): Promise<CondicaoPagamento[]> {
  return st.r.carga.condicoesDaForma(ext);
}

/**
 * A forma é criada ou atualizada pela 1ª linha que a traz (`conferirFormasDoLote`); as condições dela que NÃO estão neste arquivo
 * recebem os dados novos da forma (as do arquivo recebem pela própria linha). Forma recusada (RN-CAD-09) desativa as condições
 * antigas ativas, com aviso. Sem `forma_external_id` não há irmãs a achar.
 */
export async function planejarIrmasDaForma(f: FormaDoLote, st: Estado): Promise<{ erros: ErroLinha[]; avisos: string[]; aplicar?: () => Promise<void> }> {
  if (f.external_id === undefined) return { erros: [], avisos: [] };
  const noArquivo = new Set(f.condicoes);
  const ativas = (await condicoesDaForma(st, f.external_id)).filter((c) => !c.inativo && !noArquivo.has(c.external_id ?? ''));
  if (ativas.length === 0) return { erros: [], avisos: [] };
  const repo = st.r.condicoesPagamento;
  if (f.tpag !== undefined && classeForma(f.tpag) === null) {
    return {
      erros: [], avisos: [`${MOTIVO_FORMA_NAO_ACEITA}: ${ativas.length} condição(ões) desativada(s)`],
      async aplicar() { await desativarCondicoesRecusadas(st.c, st.r, ativas); },
    };
  }
  const d: Dict = dadosFormaDoLote(f);
  const erros: ErroLinha[] = [];
  for (const c of ativas) {
    if (f.tpag === undefined) break;
    const vc = validarCondicaoPagamento({ forma_tpag: f.tpag, prazos_dias: c.prazos_dias, prazo_medio_dias: c.prazo_medio_dias ?? null });
    if (vc.length) erros.push(...vc.map((v) => erroDeViolacao(f.linha, v)));
  }
  if (erros.length > 0) return { erros, avisos: [] };
  // `parcelas_cartao` (legado) acompanha a forma: o cartão tem tantas parcelas quantos os prazos; nas outras formas é nulo.
  const dadosDe = (c: CondicaoPagamento): Dict => ({ ...d, parcelas_cartao: f.tpag === undefined ? c.parcelas_cartao ?? null : derivarParcelasCartao({ forma_tpag: f.tpag, prazos_dias: c.prazos_dias }) });
  const mudam = ativas.filter((c) => camposAlterados(dadosDe(c), c as unknown as Dict).length > 0);
  if (mudam.length === 0) return { erros: [], avisos: [] };
  return {
    erros: [], avisos: [`Forma atualizada em ${mudam.length} condição(ões) que não estão neste arquivo`],
    async aplicar() {
      for (const c of mudam) {
        await repo.atualizar(c.id, dadosDe(c) as never);
        await concluirEscrita(st, repo, c.id, undefined, c.inativo, EVENTO_CONDICAO);
      }
    },
  };
}

async function dadosDaForma(st: Estado, ext: string) {
  if (!st.formas.has(ext)) {
    const c = (await condicoesDaForma(st, ext))[0];
    st.formas.set(ext, c ? { codigo: c.forma_codigo, nome: c.forma_nome, tpag: c.forma_tpag } : null);
  }
  return st.formas.get(ext) ?? null;
}

async function condicao(l: LinhaCondicaoPagamento, st: Estado): Promise<Saida> {
  const repo = st.r.condicoesPagamento;
  const { forma_external_id: formaExt, forma_codigo: formaCodigo, forma_nome: formaNome, forma_tpag: formaTpag, ...d } = l.dados;
  const { ex, adotar, conflito: cf } = await casar(repo, l.external_id, 'codigo', d.codigo);
  if (cf) return conflito(l.linha, 'codigo');
  // Os dados da forma: os da linha (já completados com a 1ª linha da forma) sobre os que a forma já tem gravados.
  const gravada = formaExt === undefined ? null : await dadosDaForma(st, formaExt);
  const f = formaCodigo === undefined && formaNome === undefined && formaTpag === undefined && gravada === null
    ? null
    : { codigo: formaCodigo ?? gravada?.codigo ?? null, nome: formaNome ?? gravada?.nome ?? null, tpag: formaTpag ?? gravada?.tpag ?? null };
  const campoForma: Dict = {
    ...(formaExt === undefined ? {} : { forma_external_id: formaExt }),
    ...(f === null ? {} : { forma_codigo: f.codigo, forma_nome: f.nome, ...(f.tpag ? { forma_tpag: f.tpag } : {}) }),
  };
  if (ex) {
    const alvo = { tipo: 'condicao_pagamento' as const, id: ex.id };
    const tpagFinal = (campoForma.forma_tpag as string | undefined) ?? ex.forma_tpag;
    // RN-CAD-15 (decisão 14 A): `completarPrazoMedio`; na carga a origem manda: célula vazia com parcelas na linha calcula (decisão 17 B)
    const base = completarParcelasCartao({ ...d, forma_tpag: tpagFinal }, ex);
    const comPrazo = d.prazos_dias === undefined ? base : completarPrazoMedio({ ...base, prazo_medio_dias: d.prazo_medio_dias ?? null }, ex);
    const { prazo_medio_calculado: marca, ...comPrazoSemMarca } = comPrazo as Dict;
    const patch: Dict = { ...comPrazoSemMarca, ...(marca === undefined ? {} : { prazo_medio_calculado: marca }), ...campoForma, ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}) };
    const vc = validarCondicaoPagamento({
      forma_tpag: (patch.forma_tpag ?? ex.forma_tpag) as string, prazos_dias: (patch.prazos_dias ?? ex.prazos_dias) as number[],
      parcelas_cartao: (patch.parcelas_cartao === undefined ? ex.parcelas_cartao : patch.parcelas_cartao) as number | null,
      prazo_medio_dias: (patch.prazo_medio_dias === undefined ? ex.prazo_medio_dias ?? null : patch.prazo_medio_dias) as number | null,
      inativa: l.ativo === false,
      // RN-CAD-15: faixaSeAplica
      semFaixa: !faixaSeAplica({ gravada: ex as unknown as Dict, nova: patch }),
    });
    if (vc.length) return violacoes(l.linha, vc);
    if (camposAlterados(patch, ex as unknown as Dict).length === 0) return { efeito: 'sem_mudanca', alvo };
    return {
      efeito: 'atualizada', alvo,
      async aplicar() {
        const { inativo: _i, ...parcial } = patch;
        await repo.atualizar(ex.id, parcial as never);
        await concluirEscrita(st, repo, ex.id, l.ativo, ex.inativo, EVENTO_CONDICAO, ex);
        return ex.id;
      },
    };
  }
  const p = prepararCriacao('condicao_pagamento', { ...l, dados: { ...l.dados, ...(f?.nome ? { forma_nome: f.nome } : {}), ...(f?.tpag ? { forma_tpag: f.tpag } : {}) } });
  if (!p.ok) return { erros: p.erros };
  if (!f?.tpag) return mover(l.linha, 'forma_codigo', 'CARGA_OBRIGATORIO', 'Forma de pagamento sem dados para criar a condição');
  const comDescricao = { ...d, ...(p.linha.dados.descricao === undefined ? {} : { descricao: p.linha.dados.descricao }) };
  // RN-CAD-15: os dias são os digitados; `parcelas_cartao` (legado) é derivada dos prazos.
  const comPrazo = completarPrazoMedio(completarParcelasCartao({ ...comDescricao, forma_tpag: f.tpag }));
  const r = CondicaoPagamentoDados.safeParse({ ...comPrazo, ...campoForma, external_id: l.external_id });
  if (!r.success) return { erros: errosDeZod(l.linha, r.error.issues) };
  const vc = validarCondicaoPagamento({ ...r.data, inativa: l.ativo === false });
  if (vc.length) return violacoes(l.linha, vc);
  return {
    efeito: 'inserida',
    async aplicar() {
      const criada = await repo.inserir({ ...r.data, ...(comPrazo.prazo_medio_calculado === undefined ? {} : { prazo_medio_calculado: comPrazo.prazo_medio_calculado }) } as never);
      await concluirEscrita(st, repo, criada.id, l.ativo, false, EVENTO_CONDICAO);
      return criada.id;
    },
  };
}

// ---- produto (RF-CAD-04, RN-CAD-04) ----
function fato(st: Estado, chave: string, consulta: () => Promise<boolean>): Promise<boolean> {
  let p = st.fatos.get(chave);
  if (!p) {
    p = consulta();
    st.fatos.set(chave, p);
  }
  return p;
}

async function produto(l: LinhaProduto, st: Estado): Promise<Saida> {
  const repo = st.r.produtos;
  const d = l.dados;
  const { ex, adotar, conflito: cf } = await casar(repo, l.external_id, 'codigo', d.codigo);
  if (cf) return conflito(l.linha, 'codigo');
  if (l.desconto_maximo_bp !== undefined) st.descontos.set(l.external_id, l.desconto_maximo_bp);
  const fiscal = async (ncm: string, cest: string | null): Promise<ErroLinha[]> => {
    const o = st.r.oficiais;
    const data = st.hoje;
    return validarFiscalLinhaProduto(l.linha, {
      ncm, cest,
      ncmVigente: await fato(st, `ncm:${ncm}`, () => o.ncmVigente(ncm, data)),
      ncmExigeCest: await fato(st, `exige:${ncm}`, () => o.ncmExigeCest(ncm, data)),
      cestVigente: cest === null ? true : await fato(st, `cest:${cest}`, () => o.cestVigente(cest, data)),
      cestCombinaComNcm: cest === null ? true : await fato(st, `par:${cest}:${ncm}`, () => o.cestCombinaComNcm(cest, ncm, data)),
    });
  };
  if (ex) {
    const alvo = { tipo: 'produto' as const, id: ex.id };
    st.unidadeDoProduto.set(l.external_id, d.unidade_comercial ?? ex.unidade_comercial);
    const patch: Dict = { ...d, ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}) };
    const descontoMudou = l.desconto_maximo_bp !== undefined && l.desconto_maximo_bp !== (await st.r.carga.descontoDoProduto(ex.id));
    if (camposAlterados(patch, ex as unknown as Dict).length === 0 && !descontoMudou) return { efeito: 'sem_mudanca', alvo };
    if (d.ncm !== undefined || d.cest !== undefined) {
      const erros = await fiscal(d.ncm ?? ex.ncm, d.cest ?? ex.cest ?? null);
      if (erros.length > 0) return { erros };
    }
    return {
      efeito: 'atualizada', alvo,
      async aplicar() {
        const { inativo: _i, ...parcial } = patch;
        if (Object.keys(parcial).length > 0) await repo.atualizar(ex.id, parcial as never);
        await aplicarAtivo(repo, ex.id, l.ativo, ex.inativo);
        await publicarProdutoPorId(st, ex.id, ex);
        await propagarDesconto(st, ex.id, l.desconto_maximo_bp);
        return ex.id;
      },
    };
  }
  const p = prepararCriacao('produto', l);
  if (!p.ok) return { erros: p.erros };
  const f = p.linha.dados;
  const r = ProdutoDados.safeParse({ ...f, cest: f.cest ?? null, unidade_tributavel: f.unidade_comercial, fator_tributavel: 10_000, ean: f.ean ?? null, marca: f.marca ?? null, custo_centavos: f.custo_centavos ?? null, external_id: l.external_id });
  if (!r.success) return { erros: errosDeZod(l.linha, r.error.issues) };
  const erros = await fiscal(r.data.ncm, r.data.cest);
  if (erros.length > 0) return { erros };
  st.unidadeDoProduto.set(l.external_id, r.data.unidade_comercial);
  return {
    efeito: 'inserida',
    async aplicar() {
      const criado = await repo.inserir(r.data);
      await aplicarAtivo(repo, criado.id, l.ativo, false);
      await publicarProdutoPorId(st, criado.id);
      await propagarDesconto(st, criado.id, l.desconto_maximo_bp);
      return criado.id;
    },
  };
}

/** RN-CAD-11: grava o desconto no produto e republica ao FDV os itens de preço herdados que mudaram. */
async function propagarDesconto(st: Estado, produtoId: string, bp: number | undefined): Promise<void> {
  if (bp === undefined) return;
  const itens = await st.r.carga.gravarDescontoProduto(produtoId, bp);
  const tabelas = new Map<string, Awaited<ReturnType<Repositorios['tabelasPreco']['obter']>>>();
  for (const item of itens) {
    if (!tabelas.has(item.tabela_preco_id)) tabelas.set(item.tabela_preco_id, await st.r.tabelasPreco.obter(item.tabela_preco_id));
    const tabela = tabelas.get(item.tabela_preco_id);
    if (tabela) await publicarPronto(st.c, eventoPreco(item, { ...tabela, inativo: tabela.inativo }));
  }
}

async function publicarProdutoPorId(st: Estado, id: string, antes?: unknown): Promise<void> {
  const p = await st.r.produtos.obter(id);
  if (p) await publicarPronto(st.c, comExternalIdAnterior(await eventoProduto(st.r, p), p, antes));
}

// ---- unidades do produto ----
async function unidade(l: LinhaProdutoUnidade, st: Estado): Promise<Saida> {
  const carga = st.r.carga;
  const paiId = st.ids.produto.get(l.refs.produto as string) as string;
  const d = l.dados;
  let ex = await carga.filhoPorExternalId('produto_unidade', l.external_id);
  let adotar = false;
  if (!ex && paiId && d.unidade !== undefined) {
    const n = await carga.unidadePorChave(paiId, d.unidade);
    if (n) {
      if (n.external_id) return conflito(l.linha, 'unidade');
      ex = n;
      adotar = true;
    }
  }
  if (ex) {
    if (paiId && ex.pai_id !== paiId) return conflito(l.linha, 'produto_external_id');
    const patch: Dict = { ...d, ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}) };
    if (camposAlterados(patch, { ...ex.atual, inativo: ex.inativo, external_id: ex.external_id }).length === 0) return { efeito: 'sem_mudanca' };
    const exa = ex;
    return {
      efeito: 'atualizada',
      async aplicar() {
        const parcial = { ...d, ...(adotar ? { external_id: l.external_id } : {}) };
        if (Object.keys(parcial).length > 0) await st.r.produtos.unidades.atualizar(exa.pai_id, exa.id, parcial as never);
        if (l.ativo === false && !exa.inativo) await st.r.produtos.unidades.inativar(exa.pai_id, exa.id);
        else if (l.ativo === true && exa.inativo) await carga.reativarFilho('produto_unidade', exa.id);
        await publicarProdutoPorId(st, exa.pai_id);
      },
    };
  }
  const p = prepararCriacao('produto_unidade', l);
  if (!p.ok) return { erros: p.erros };
  const r = UnidadeDados.safeParse({ ...p.linha.dados, ean: p.linha.dados.ean ?? null });
  if (!r.success) return { erros: errosDeZod(l.linha, r.error.issues) };
  return {
    efeito: 'inserida',
    async aplicar() {
      const criada = await st.r.produtos.unidades.inserir(paiId, { ...r.data, external_id: l.external_id } as never);
      if (l.ativo === false) await st.r.produtos.unidades.inativar(paiId, criada.id);
      await publicarProdutoPorId(st, paiId);
    },
  };
}

// ---- preço (RF-CAD-05, RN-CAD-06) ----
async function preco(l: LinhaPreco, st: Estado): Promise<Saida> {
  const extTab = l.tabela.external_id;
  const extProd = l.refs.produto as string;
  let tab = st.tabelas.get(extTab);
  if (!tab) {
    const existente = (await st.r.tabelasPreco.porExternalId(extTab)) as unknown as Dict | null;
    tab = { id: (existente?.id as string | undefined) ?? '', existente, pronta: false };
    st.tabelas.set(extTab, tab);
    st.ids.tabela_preco.set(extTab, tab.id);
  }
  const t = tab;
  if (t.existente === null && !t.pronta) {
    // Guarda RD-0317 (ver domain/external-id.ts): a tabela que a carga cria leva extTab no external_id
    const v = await violacaoExternalId(st.r, 'tabela_preco', extTab);
    if (v) return mover(l.linha, 'tabela_external_id', 'CARGA_CONFLITO', v.mensagem);
  }
  const prodId = st.ids.produto.get(extProd) as string;
  const fil = await filialDaLinha(st, l.refs.filial, l.linha);
  if ('erro' in fil) return fil.erro;
  if (l.unidade !== undefined) {
    const comercial = st.unidadeDoProduto.get(extProd) ?? (prodId ? (await st.r.produtos.obter(prodId))?.unidade_comercial : undefined);
    st.unidadeDoProduto.set(extProd, comercial ?? l.unidade);
    if (comercial !== undefined && comercial.toUpperCase() !== l.unidade.toUpperCase()) {
      return mover(l.linha, 'unidade', 'CARGA_FORMATO', 'Preço por unidade diferente da comercial não é aceito na v1');
    }
  }
  const dados = { nome: l.tabela.nome, vigencia_inicio: l.tabela.vigencia_inicio, vigencia_fim: l.tabela.vigencia_fim };
  const tabelaMudou = !t.pronta && t.existente !== null && camposAlterados(dados, t.existente).length > 0;
  const carga = st.r.carga;
  let ex = await carga.itemPrecoPorExternalId(l.external_id);
  let adotar = false;
  if (!ex && t.id && prodId && fil.id) {
    const n = await carga.itemPrecoPorChave(t.id, fil.id, prodId);
    if (n) {
      if (n.external_id) return conflito(l.linha, 'external_id');
      ex = n;
      adotar = true;
    }
  }
  // RN-CAD-11: o desconto do produto (deste lote ou já gravado) vale em qualquer ordem de carga; o item de desconto próprio não muda.
  const descontoProduto = st.descontos.get(extProd) ?? (prodId ? await carga.descontoDoProduto(prodId) : null);
  const desc = descontoNaCargaDoPreco(ex, descontoProduto);
  if (desc.semDesconto) st.precosSemDesconto += 1;
  const patch: Dict = {
    preco_centavos: l.preco_centavos, desconto_maximo_bp: desc.desconto_maximo_bp, ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}),
  };
  const itemMuda = ex === null || camposAlterados(patch, ex as unknown as Dict).length > 0 || ex.desconto_herdado !== desc.desconto_herdado;
  if (!itemMuda && !tabelaMudou) return { efeito: 'sem_mudanca' };
  const efeito: Efeito = ex === null ? 'inserida' : 'atualizada';
  return {
    efeito,
    async aplicar() {
      const antes = { ...t };
      try {
        if (!t.pronta) {
          if (t.existente === null) {
            const criada = await st.r.tabelasPreco.inserir(TabelaPrecoDados.parse({ ...dados, padrao: false, external_id: extTab }));
            t.id = criada.id;
            t.existente = criada as unknown as Dict;
            await publicarPronto(st.c, eventoTabelaPreco(criada));
          } else if (tabelaMudou) {
            const atualizada = await st.r.tabelasPreco.atualizar(t.id, dados);
            if (atualizada) {
              await publicarPronto(st.c, eventoTabelaPreco(atualizada));
              await republicarItensDaTabela(st.c, st.r, atualizada);
            }
          }
          t.pronta = true;
          st.ids.tabela_preco.set(extTab, t.id);
        }
        const inativo = l.ativo === undefined ? (ex?.inativo ?? false) : !l.ativo;
        const item = await carga.gravarItemPreco({
          tabelaId: t.id, filialId: fil.id, produtoId: prodId, preco_centavos: l.preco_centavos, desconto_maximo_bp: desc.desconto_maximo_bp, desconto_herdado: desc.desconto_herdado,
          externalId: l.external_id, inativo,
        });
        const tabela = await st.r.tabelasPreco.obter(t.id);
        if (tabela) await publicarPronto(st.c, comExternalIdAnterior(eventoPreco(item, { ...tabela, inativo: inativo || tabela.inativo }), item, ex));
      } catch (e) {
        Object.assign(t, antes);
        throw e;
      }
    },
  };
}

// ---- estoque (RF-CAD-06, RN-CAD-07): o arquivo é a foto; saldo = soma por (filial, produto) ----
export interface SaidaEstoque {
  linhas: number[];
  saida: Saida;
}

export async function planejarEstoque(linhas: readonly LinhaEstoque[], st: Estado): Promise<SaidaEstoque[]> {
  const saidas: SaidaEstoque[] = [];
  for (const g of somarSaldos(linhas)) {
    const primeira = g.linhas[0] as number;
    const fil = await filialDaLinha(st, g.filial, primeira);
    if ('erro' in fil) {
      saidas.push({ linhas: g.linhas, saida: fil.erro });
      continue;
    }
    const prodId = st.ids.produto.get(g.produto) as string;
    const real = prodId !== '' && fil.id !== '';
    // Modo gravar: trava a linha do saldo antes de calcular o delta (como a rota manual, `FOR UPDATE`); validar só lê.
    const existente = real ? (await st.r.estoque.saldos({ filial_id: fil.id, produto_id: prodId }))[0]?.quantidade : undefined;
    const atual = real && st.gravar ? await st.r.estoque.saldoParaAtualizar(fil.id, prodId) : existente;
    // RN-CAD-17: saldo fracionário só em produto de unidade KG ou M
    // (a unidade vem do produto do próprio lote, se ele foi lido nele, ou do gravado)
    const unidade = st.unidadeDoProduto.get(g.produto) ?? (prodId ? (await st.r.produtos.obter(prodId))?.unidade_comercial : undefined);
    if (unidade) st.unidadeDoProduto.set(g.produto, unidade);
    const fracao = unidade ? violacaoFracao('saldo', unidade, g.saldo) : null;
    if (fracao) {
      saidas.push({ linhas: g.linhas, saida: { erros: [erroLinha(primeira, 'saldo', 'RN-CAD-17', fracao.mensagem)] } });
      continue;
    }
    const aj = ajusteDeCarga({ atual: atual ?? 0, novo: g.saldo, podeNegativo: st.podeNegativo, linha: primeira });
    if (!aj.ok) {
      saidas.push({ linhas: g.linhas, saida: { erros: [aj.erro] } });
      continue;
    }
    if (aj.delta === 0 || (existente === undefined && g.saldo === 0)) {
      saidas.push({ linhas: g.linhas, saida: { efeito: 'sem_mudanca' } });
      continue;
    }
    saidas.push({
      linhas: g.linhas,
      saida: {
        efeito: existente === undefined ? 'inserida' : 'atualizada',
        async aplicar() {
          const externo = `carga:${createHash('sha1').update(`${st.loteId}|${fil.id}|${prodId}`).digest('hex')}`;
          await st.r.estoque.gravarMovimento({ filial_id: fil.id, produto_id: prodId, tipo: 'ajuste', quantidade: aj.delta, motivo: 'carga CSV', external_id: externo, usuario_id: st.c.sessao.usuario_id || null }, g.saldo);
          await publicarPronto(st.c, eventoEstoque(agregadoEstoque(fil.id, prodId), { filial_id: fil.id, produto_id: prodId, quantidade: g.saldo }));
        },
      },
    });
  }
  return saidas;
}

// ---- cliente (RF-CAD-01) e os endereços dele (T-0058: vêm no mesmo cliente.csv) ----
interface PlanoEnderecos {
  /** Passos da gravação, na ordem das linhas. */
  passos: (() => Promise<void>)[];
  erros: ErroLinha[];
}

/**
 * Planeja os endereços do cliente (um por linha do arquivo). `ex` = cliente gravado (ou nulo na criação). O endereço é achado pelo
 * `external_id` derivado; o principal sem `external_id` do BKO é adotado. Linha com problema vira erro parcial: o cliente segue.
 */
async function planejarEnderecos(l: LinhaCliente, st: Estado, ex: { id: string; enderecos: readonly Dict[] } | null): Promise<PlanoEnderecos> {
  const plano: PlanoEnderecos = { passos: [], erros: [] };
  const principalGravado = ex?.enderecos.find((x) => x.tipo === 'principal') as (Dict & { id: string }) | undefined;
  for (const e of l.enderecos) {
    const gravado = ex ? await st.r.carga.filhoPorExternalId('cliente_endereco', e.external_id) : null;
    if (gravado) {
      if (ex && gravado.pai_id !== ex.id) {
        plano.erros.push(erroLinha(e.linha, 'external_id', 'CARGA_CONFLITO', 'A chave natural já pertence a outro cadastro com outro external_id'));
        continue;
      }
      if (gravado.atual.tipo !== e.tipo) {
        plano.erros.push(erroLinha(e.linha, 'tipo_endereco', 'RN-CAD-03', 'O tipo do endereço não muda pela carga: use outra seq'));
        continue;
      }
      const mudou = camposAlterados(e.dados as Dict, gravado.atual).length > 0;
      if (mudou || gravado.inativo) {
        plano.passos.push(async () => {
          if (Object.keys(e.dados).length > 0) await st.r.clientes.enderecos.atualizar(gravado.pai_id, gravado.id, e.dados as never);
          if (gravado.inativo) await st.r.carga.reativarFilho('cliente_endereco', gravado.id);
        });
      }
      continue;
    }
    if (ex && e.tipo === 'principal' && principalGravado) {
      // O principal gravado pelo BKO (sem external_id da carga) é adotado: recebe o external_id derivado e os campos da linha.
      const patch = { ...e.dados, external_id: e.external_id };
      if (camposAlterados(patch as Dict, principalGravado).length > 0) plano.passos.push(async () => { await st.r.clientes.enderecos.atualizar(ex.id, principalGravado.id, patch as never); });
      continue;
    }
    const novo = prepararEnderecoNovo(e);
    if (!novo.ok) {
      plano.erros.push(...novo.erros);
      continue;
    }
    const r = EnderecoCliente.safeParse({ ...novo.dados, complemento: novo.dados.complemento ?? null, tipo: e.tipo });
    if (!r.success) {
      plano.erros.push(...errosDeZod(e.linha, r.error.issues));
      continue;
    }
    plano.passos.push(async () => { await st.r.clientes.enderecos.inserir(ex ? ex.id : (st.ids.cliente.get(l.external_id) as string), { ...r.data, external_id: e.external_id } as never); });
  }
  return plano;
}

async function cliente(l: LinhaCliente, st: Estado): Promise<Saida> {
  const repo = st.r.clientes;
  const d = l.dados;
  const { ex, adotar, conflito: cf } = await casar(repo, l.external_id, 'documento', d.documento);
  if (cf) return conflito(l.linha, 'documento');
  const refs = {
    ...(l.refs.filial === undefined ? {} : { filial_id: st.ids.filial.get(l.refs.filial) }),
    ...(l.refs.vendedor === undefined ? {} : { vendedor_id: st.ids.vendedor.get(l.refs.vendedor) }),
    ...(l.refs.tabela_preco === undefined ? {} : { tabela_preco_id: st.ids.tabela_preco.get(l.refs.tabela_preco) }),
    ...(l.refs.condicao_pagamento === undefined ? {} : { condicao_pagamento_id: st.ids.condicao_pagamento.get(l.refs.condicao_pagamento) }),
  };
  const negaCredito = (atual: number | null) => d.limite_credito_centavos !== undefined && d.limite_credito_centavos !== (atual ?? 0) && !st.podeCredito;
  const semCredito = mover(l.linha, 'limite_credito_cents', 'PERFIL_SEM_PERMISSAO', MOTIVO_SO_ADMINISTRADOR);
  const principalDaLinha = l.enderecos.find((e) => e.tipo === 'principal');
  if (ex) {
    if (negaCredito(ex.limite_credito_centavos)) return semCredito;
    const alvo = { tipo: 'cliente' as const, id: ex.id };
    const principal = ex.enderecos.find((x) => (x as Dict).tipo === 'principal') as (Dict & { id: string }) | undefined;
    const ufP = principalDaLinha?.dados.uf ?? (principal?.uf as string | undefined) ?? '';
    const viol = [];
    // RN-CAD-02: a IE vale pela UF do endereço principal da linha ou, sem ela, pela do principal gravado; sem nenhuma, recusa.
    let ie = d.ie;
    if (d.ie !== undefined && d.ie !== null) {
      if (ufP === '') viol.push(violacao('RN-CAD-02', 'inscricao_estadual', 'IE sem UF: o cliente não tem endereço principal gravado'));
      else {
        const v = validarIe(ufP, d.ie);
        if (v.ok) ie = v.ie ?? undefined;
        else viol.push(v.violacao);
      }
    }
    const patch: Dict = { ...d, ...(ie === undefined ? {} : { ie }), ...refs, ...ativoPatch(l.ativo), ...(adotar ? { external_id: l.external_id } : {}) };
    const dadosMudam = camposAlterados(patch, ex as unknown as Dict).length > 0;
    const plano = await planejarEnderecos(l, st, { id: ex.id, enderecos: ex.enderecos as unknown as Dict[] });
    if (!dadosMudam && plano.passos.length === 0 && viol.length === 0) return { efeito: 'sem_mudanca', alvo, ...(plano.erros.length > 0 ? { errosParciais: plano.erros } : {}) };
    const m = { ...ex, ...patch } as Dict;
    if (d.documento !== undefined || d.tipo_pessoa !== undefined) {
      const dc = validarDocumentoCliente(m.tipo_pessoa as 'PJ' | 'PF', m.documento as string);
      if (!dc.ok) viol.push(dc.violacao);
    }
    if (viol.length === 0) {
      const ind = validarIndIeDest({ ind_ie_dest: m.ind_ie_dest as '1' | '2' | '9', ie: (m.ie as string | null) ?? null, uf: ufP });
      if (!ind.ok) viol.push(ind.violacao);
    }
    if (l.ativo === false && !ex.inativo) viol.push(...bloqueiosDeInativacao('cliente', { padrao: false }));
    if (viol.length > 0) return violacoes(l.linha, viol);
    return {
      efeito: 'atualizada', alvo, ...(plano.erros.length > 0 ? { errosParciais: plano.erros } : {}),
      async aplicar() {
        const { inativo: _i, ...parcial } = patch;
        if (Object.keys(parcial).length > 0) await repo.atualizar(ex.id, parcial as never);
        for (const passo of plano.passos) await passo();
        await concluirEscrita(st, repo, ex.id, l.ativo, ex.inativo, eventoCliente, ex);
        if (d.limite_credito_centavos !== undefined && d.limite_credito_centavos !== ex.limite_credito_centavos) {
          await st.c.auditar({ acao: 'cliente.limite_credito_centavos.alterar', entidade: 'cliente', entidade_id: ex.id, antes: { limite_credito_centavos: ex.limite_credito_centavos }, depois: { limite_credito_centavos: d.limite_credito_centavos } });
        }
        return ex.id;
      },
    };
  }
  if (negaCredito(null)) return semCredito;
  const p = prepararCriacao('cliente', l);
  if (!p.ok) return { erros: p.erros };
  const fil = l.refs.filial === undefined ? await filialDaLinha(st, undefined, l.linha) : { id: refs.filial_id as string };
  if ('erro' in fil) return fil.erro;
  const f = p.linha;
  const principalNovo = f.enderecos.find((e) => e.tipo === 'principal') as NonNullable<typeof principalDaLinha>;
  const enderecos = [{ ...principalNovo.dados, complemento: principalNovo.dados.complemento ?? null, tipo: 'principal' as const }];
  // RN-CAD-02: sem a UF do principal na linha base, a IE só se valida aqui (a linha base pode ser entrega ou cobrança).
  let ieNormalizada = f.dados.ie;
  const vIe: ReturnType<typeof violacao>[] = [];
  if (f.dados.ie !== undefined && f.dados.ie !== null && principalNovo.dados.uf !== undefined) {
    const v = validarIe(principalNovo.dados.uf, f.dados.ie);
    if (v.ok) ieNormalizada = v.ie ?? undefined;
    else vIe.push(v.violacao);
  }
  if (vIe.length > 0) return violacoes(l.linha, vIe);
  const r = ClienteDados.safeParse({
    ...f.dados, ie: ieNormalizada ?? null, nome_fantasia: f.dados.nome_fantasia ?? null, email_nfe: f.dados.email_nfe ?? null,
    limite_credito_centavos: f.dados.limite_credito_centavos ?? 0, filial_id: ouPendente(fil.id),
    vendedor_id: ouPendente(refs.vendedor_id) ?? null, tabela_preco_id: ouPendente(refs.tabela_preco_id) ?? null,
    condicao_pagamento_id: ouPendente(refs.condicao_pagamento_id) ?? null, enderecos, external_id: l.external_id,
  });
  if (!r.success) return { erros: errosDeZod(l.linha, r.error.issues) };
  const viol = [];
  const unico = validarEnderecoPrincipal(r.data.enderecos);
  if (!unico.ok) viol.push(unico.violacao);
  const dc = validarDocumentoCliente(r.data.tipo_pessoa, r.data.documento);
  if (!dc.ok) viol.push(dc.violacao);
  const ind = validarIndIeDest({ ind_ie_dest: r.data.ind_ie_dest, ie: r.data.ie, uf: r.data.enderecos[0]?.uf ?? '' });
  if (!ind.ok) viol.push(ind.violacao);
  if (viol.length > 0) return violacoes(l.linha, viol);
  // Os endereços entram depois do cliente, cada um com o seu `external_id` derivado; o principal vai primeiro.
  const plano = await planejarEnderecos(f, st, null);
  return {
    efeito: 'inserida', ...(plano.erros.length > 0 ? { errosParciais: plano.erros } : {}),
    async aplicar() {
      const criado = await repo.inserir({
        ...r.data, enderecos: [], filial_id: fil.id, vendedor_id: (refs.vendedor_id as string | undefined) ?? null, tabela_preco_id: (refs.tabela_preco_id as string | undefined) ?? null,
        condicao_pagamento_id: (refs.condicao_pagamento_id as string | undefined) ?? null,
      });
      st.ids.cliente.set(l.external_id, criado.id);
      for (const passo of plano.passos) await passo();
      await concluirEscrita(st, repo, criado.id, l.ativo, false, eventoCliente);
      if (r.data.limite_credito_centavos !== 0) {
        await st.c.auditar({ acao: 'cliente.limite_credito_centavos.alterar', entidade: 'cliente', entidade_id: criado.id, antes: { limite_credito_centavos: null }, depois: { limite_credito_centavos: r.data.limite_credito_centavos } });
      }
      return criado.id;
    },
  };
}

export const TRATADORES: { [E in Exclude<EntidadeCarga, 'estoque'>]: (l: LinhasCarga[E], st: Estado) => Promise<Saida> } = {
  filial, vendedor, condicao_pagamento: condicao, produto, produto_unidade: unidade, preco, cliente,
};

/** Ação de edição que cada arquivo exige além de `cadastros.carga.executar` (D8). */
export const ACAO_DA_ENTIDADE = {
  filial: 'cadastros.filial.editar', vendedor: 'cadastros.vendedor.editar', condicao_pagamento: 'cadastros.condicao_pagamento.editar',
  produto: 'cadastros.produto.editar', produto_unidade: 'cadastros.produto.editar',
  preco: 'cadastros.preco.editar', estoque: 'cadastros.estoque.movimentar', cliente: 'cadastros.cliente.editar',
} as const;

export const podeCarregar = (perfil: Parameters<typeof pode>[0], e: EntidadeCarga): boolean => pode(perfil, ACAO_DA_ENTIDADE[e]);
export const novoLoteId = (): string => randomUUID();
