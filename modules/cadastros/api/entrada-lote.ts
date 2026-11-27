/**
 * T-0057 C3 (ADR 0014 §1 e §3): o worker que processa o lote recebido em `POST /entrada/v1/lotes`. Um trabalho `cadastros.entrada_lote`
 * por lote; ele trava a fila da entidade do conector, processa os lotes `recebido` dela do mais antigo até o do trabalho (um por vez,
 * na ordem de chegada, para o cursor não pular) e, em cada um: valida pelo Zod do SDK e adapta (`adaptarLote`), confere as referências e
 * grava por `gravarLinhas` (a mesma gravação da carga de CSV, com SAVEPOINT por linha), guarda o resultado por linha SEM o dado (só
 * índice, `external_id`, campo e código; LGPD, RN-INT-01), zera o corpo e avança o cursor da entidade.
 *
 * Premissas (o desenho não fecha): o conector é identidade de máquina, não tem sessão; grava com crédito liberado (o limite é do
 * payload, `ClienteHub.limite_credito_cents`) e sem saldo negativo (RN-CAD-07); eventos e auditoria saem com autor "sistema".
 */
import {
  TRABALHO_ENTRADA_LOTE, auditar, criarEvento,
  type ContextoRota, type DestinoAuditoria, type ExecutorTrabalho, type FilaDeTrabalhos, type Outbox, type Trabalho, type Transacao,
} from '@macuxierp/platform-sdk';
import { CorpoLote, LIMITE_ERROS_RESPOSTA_MAX, type CorpoLote as CorpoLoteTipo } from '@macuxierp/platform-sdk/hub-v1';
import { z } from 'zod';
import type { ResultadoEntidade } from '../contracts';
import {
  PADRAO_UF, adaptarLote, agruparClientes, conferirFormasDoLote, cursorDoLote, cursorDepoisDoLote, errosDoLote, obsoletosDoLote, estadoFinalDoLote, idsVazios, repetidosNoLote,
  tpagGuardadoDaForma, type ErroGuardado, type ErroLinha, type FormaDoLote, type MunicipioOficial,
} from '../domain';
import { estadoVazio } from './carga-entidades';
import { aplicarIrmasDaForma, gravarLinhas, type Linha } from './carga-gravar';
import type { FormaGuardada, RepositorioEntrada, LotePendente } from './entrada-sql';
import type { Repositorios } from './portas';
import { dataIso } from './util';

const PayloadEntradaLote = z.object({ lote_id: z.string().uuid() });

interface DependenciasEntradaLote {
  repositorios(tx: Transacao): Repositorios;
  entrada(tx: Transacao): RepositorioEntrada;
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  /** Para pedir novo trabalho quando o lote que travou a fila é outro (ver `aoDesistir`). */
  fila: FilaDeTrabalhos;
  agora?: () => Date;
}

const ARQUIVO = 'lote';

/** Autor da auditoria: sistema (sem usuário), no trabalho do worker. */
const atorDoWorker = (trabalho: Trabalho) => ({ tenant_id: trabalho.tenant_id, usuario_id: null, request_id: trabalho.id });

/** Contexto de rota sem sessão de usuário: os eventos e a auditoria da gravação saem com autor "sistema" (premissa acima). */
function contextoDoWorker(d: DependenciasEntradaLote, tx: Transacao, trabalho: Trabalho, agora: Date): ContextoRota {
  return {
    sessao: { usuario_id: '', tenant_id: trabalho.tenant_id, perfil: 'administrador', filial_ids: [] },
    tx, request_id: trabalho.id, agora,
    async publicar(e) {
      const evento = criarEvento({ nome: e.nome, tenant_id: trabalho.tenant_id, agregado_id: e.agregado_id, ator: 'sistema', request_id: trabalho.id, payload: e.payload }, agora);
      return { ...evento, versao: await d.outbox.gravar(tx, evento) };
    },
    async auditar(dados) {
      await auditar(d.auditoria, tx, atorDoWorker(trabalho), dados, agora);
    },
    async enfileirar() {
      throw new Error('a gravação do lote da entrada não enfileira trabalho');
    },
  };
}

/** UFs dos registros (filial, cliente e endereço): uma consulta de municípios por UF do lote (RN-CAD-03). */
function ufsDosRegistros(registros: readonly Record<string, unknown>[]): Set<string> {
  const ufs = new Set<string>();
  const ver = (v: unknown) => {
    if (typeof v === 'string' && PADRAO_UF.test(v)) ufs.add(v);
  };
  for (const r of registros) {
    ver(r.uf);
    const e = r.endereco;
    if (e && typeof e === 'object') ver((e as Record<string, unknown>).uf);
  }
  return ufs;
}

async function processarUm(d: DependenciasEntradaLote, tx: Transacao, trabalho: Trabalho, lote: LotePendente, agora: Date): Promise<void> {
  const entrada = d.entrada(tx);
  const ator = atorDoWorker(trabalho);
  const lido = CorpoLote.safeParse(lote.corpo);
  if (!lido.success) {
    await entrada.falhar(lote.id, 'corpo_invalido', agora);
    return;
  }
  const corpo: CorpoLoteTipo = lido.data;
  const r = d.repositorios(tx);
  const registros = corpo.registros as Record<string, unknown>[];
  const municipios = new Map<string, MunicipioOficial[]>();
  for (const uf of ufsDosRegistros(registros)) municipios.set(uf, await r.oficiais.municipiosDaUf(uf, dataIso(agora)));
  // Forma de pagamento conhecida do banco (RN-CAD-09): a da condição (tPag da condição) ou a do lote de formas sem condição (entrada_forma, 0074).
  const formas = new Map<string, FormaGuardada>();
  if (corpo.entidade === 'prazo_pagamento') {
    for (const ext of new Set(registros.map((x) => x.forma_external_id).filter((x): x is string => typeof x === 'string'))) {
      const c = (await r.carga.condicoesDaForma(ext))[0];
      if (c?.forma_codigo && c.forma_nome) formas.set(ext, { codigo: c.forma_codigo, nome: c.forma_nome, tpag: c.forma_tpag });
      else {
        const f = await entrada.lerForma(ext);
        if (f) formas.set(ext, f);
      }
    }
  }
  const adaptado = adaptarLote(
    { entidade: corpo.entidade, modo: corpo.modo, registros },
    { municipiosDaUf: (uf) => municipios.get(uf) ?? [], formas },
  );
  if (!adaptado.ok) {
    await entrada.falhar(lote.id, adaptado.codigo.toLowerCase(), agora);
    return;
  }
  await entrada.marcarProcessando(lote.id, agora);

  const externos: (string | null)[] = corpo.registros.map((x) => x.external_id);
  const errosCarga: ErroLinha[] = [];
  const rel = { erroLinha: (_arquivo: string, e: ErroLinha) => void errosCarga.push(e) };
  // Obsoleto (ADR 0014 §3): versão anterior ao cursor da entidade do conector não grava; conta em `obsoletas` e o cursor não recua.
  const cursorGuardado = (await entrada.lerCursor(lote.conector_id, lote.entidade))?.cursor ?? null;
  const pares = corpo.registros.map((x, indice) => ({ indice, alterado_em: x.alterado_em, external_id: x.external_id }));
  const obsoletos = obsoletosDoLote(pares, cursorGuardado);
  const boas: { indice: number; linha: Linha }[] = [];
  adaptado.resultados.forEach((x, indice) => (x.ok ? boas.push({ indice, linha: x.linha as Linha }) : void errosCarga.push(...x.erros)));
  const aplicaveis = boas.filter((b) => !obsoletos.has(b.indice));
  const repetidos = repetidosNoLote(aplicaveis.map((b) => ({ indice: b.indice, external_id: externos[b.indice] as string })));
  let linhas: Linha[] = aplicaveis.filter((b) => !repetidos.has(b.indice)).map((b) => b.linha);
  const lidas = linhas.length;
  let formasDoLote: FormaDoLote[] = [];
  let resultado: ResultadoEntidade | null = null;
  if (adaptado.entidade !== null) {
    if (adaptado.entidade === 'cliente') {
      const g = agruparClientes(linhas as never[]);
      errosCarga.push(...g.erros);
      linhas = g.clientes as Linha[];
    } else if (adaptado.entidade === 'condicao_pagamento') {
      const f = conferirFormasDoLote(linhas as never[]);
      errosCarga.push(...f.erros);
      linhas = f.linhas as Linha[];
      formasDoLote = f.formas;
    }
    resultado = { entidade: adaptado.entidade, arquivo: ARQUIVO, situacao: 'processado', lidas, inseridas: 0, atualizadas: 0, sem_mudanca: 0, recusadas: 0, colunas_ignoradas: [], avisos: [] };
    const st = estadoVazio({
      c: contextoDoWorker(d, tx, trabalho, agora), r, gravar: true, hoje: dataIso(agora), loteId: lote.id, conhecidos: idsVazios(),
      podeCredito: true, podeNegativo: false,
    });
    await gravarLinhas(st, [{ entidade: adaptado.entidade, nome: ARQUIVO, linhas, formas: formasDoLote, resultado }], rel);
  }

  // Lote de formas (RN-CAD-09, 0074): a forma é gravada em `entrada_forma` (casa por tenant e external_id) e, se já há condições dela, as
  // condições irmãs também são atualizadas. tPag: `tpagGuardadoDaForma` (dicionário pelo código; sem resolução = nulo, também nas irmãs; o prazo
  // que usar essa forma é recusado até a forma ter tPag). Contagem: forma nova = `novas`; alterada (aqui ou nas irmãs) = `atualizadas`.
  let formasNovas = 0;
  let formasAtualizadas = 0;
  let formasObsoletas = 0;
  if (corpo.entidade === 'forma_pagamento') {
    const st = estadoVazio({
      c: contextoDoWorker(d, tx, trabalho, agora), r, gravar: true, hoje: dataIso(agora), loteId: lote.id, conhecidos: idsVazios(), podeCredito: true, podeNegativo: false,
    });
    for (const f of adaptado.formas) {
      if (obsoletos.has(f.indice)) {
        formasObsoletas += 1;
        continue;
      }
      const tpag = tpagGuardadoDaForma(f); // o mesmo valor nas irmãs e na entrada_forma (RN-CAD-09)
      const o = await aplicarIrmasDaForma({ chave: f.external_id, external_id: f.external_id, codigo: f.codigo, nome: f.nome, ...(tpag === null ? {} : { tpag }), linha: f.linha, condicoes: [] }, st);
      errosCarga.push(...o.erros);
      const g = await entrada.gravarForma({ conector_id: lote.conector_id, external_id: f.external_id, codigo: f.codigo, nome: f.nome, tpag, ativo: f.ativo });
      if (g === 'nova') formasNovas += 1;
      else if (g === 'alterada' || o.aplicada) formasAtualizadas += 1;
    }
  }

  const doLote = errosDoLote(errosCarga, externos);
  // Linhas que o Conector já recusou antes de enviar (M5): contam como erro, depois dos registros.
  const doConector: ErroGuardado[] = corpo.linhas_invalidas.map((x, i) => ({
    indice: corpo.registros.length + i, external_id: x.external_id, campo: x.campo ?? null, codigo: x.codigo, origem: 'conector' as const,
  }));
  const erros = [...doLote.erros, ...doConector].slice(0, LIMITE_ERROS_RESPOSTA_MAX);
  const comErro = doLote.indicesComErro.size + doConector.length;
  const total = doLote.total + doConector.length;
  const contagens = {
    recebidas: lote.recebidos, duplicadas_no_lote: repetidos.size, com_erro: comErro,
    novas: (resultado?.inseridas ?? 0) + formasNovas, atualizadas: (resultado?.atualizadas ?? 0) + formasAtualizadas,
    inalteradas: (resultado?.sem_mudanca ?? 0) + Math.max(0, adaptado.formas.length - formasNovas - formasAtualizadas - formasObsoletas),
    obsoletas: obsoletos.size, erros_total: total, invalidas_omitidas: corpo.linhas_invalidas_omitidas,
  };
  const cursor = cursorDepoisDoLote(
    cursorDoLote(pares, new Set([...doLote.indicesComErro, ...obsoletos])),
    cursorGuardado,
  );
  const estado = estadoFinalDoLote(comErro);
  await entrada.concluir(lote.id, { estado, com_erro: comErro, contagens, erros, cursor }, agora);
  if (cursor) await entrada.avancarCursor(lote.conector_id, lote.entidade, cursor, lote.id);
  await auditar(d.auditoria, tx, ator, {
    acao: 'cadastros.entrada_lote.processar', entidade: 'entrada_lote', entidade_id: lote.id,
    depois: { entidade: lote.entidade, estado, novas: contagens.novas, atualizadas: contagens.atualizadas, inalteradas: contagens.inalteradas, com_erro: comErro },
  }, agora);
}

export function criarExecutorEntradaLote(d: DependenciasEntradaLote): ExecutorTrabalho {
  const agora = d.agora ?? (() => new Date());
  return {
    tipo: TRABALHO_ENTRADA_LOTE,
    maxTentativas: 3,
    async executar(trabalho, tx) {
      const { lote_id } = PayloadEntradaLote.parse(trabalho.payload);
      const entrada = d.entrada(tx);
      let processados = 0;
      for (;;) {
        // Trava a fila do conector e da entidade e devolve o mais antigo `recebido`: o do trabalho só sai depois dos anteriores.
        const lote = await entrada.proximoDaFila(lote_id);
        if (!lote) break;
        await processarUm(d, tx, trabalho, lote, agora());
        processados += 1;
        if (lote.id === lote_id) break;
      }
      return { processados };
    },
    /**
     * Esgotadas as tentativas: o lote que travava a fila (o mais antigo `recebido`) vira `falhou` com `falha_processamento`, para a fila
     * andar. Se não era o do trabalho, o do trabalho ganha novo trabalho (o dele já se esgotou).
     */
    async aoDesistir(trabalho, tx) {
      const { lote_id } = PayloadEntradaLote.parse(trabalho.payload);
      const lote = await d.entrada(tx).proximoDaFila(lote_id);
      if (!lote) return;
      await d.entrada(tx).falhar(lote.id, 'falha_processamento', agora());
      if (lote.id !== lote_id) {
        await d.fila.enfileirar(tx, { tipo: TRABALHO_ENTRADA_LOTE, tenant_id: trabalho.tenant_id, payload: { lote_id }, external_id: `${lote_id}:retomar:${lote.id}` });
      }
    },
  };
}
