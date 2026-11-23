/**
 * Porta `EstadoSimuladorRepo` no PostgreSQL (T-0045, lote B; schema `sefaz_simulador`, migração 0025). O simulador
 * passa a lembrar das notas, eventos, inutilizações e recibos depois que o worker reinicia, e o `nProt`/`nRec` vem das
 * sequências globais `seq_nprot`/`seq_nrec` (sem CYCLE): nunca repete.
 *
 * - `criarEstadoSimuladorPg(tx)`: a porta presa a UMA transação já aberta no tenant (`banco.comTenant`, papel
 *   `macuxierp_worker`, a RLS filtra). Toda linha nova leva `plataforma.tenant_atual()`; toda leitura filtra por ele
 *   também (vale para o dono, que não tem RLS).
 * - `fonteEstadoSimuladorPg(emTransacao)`: uma transação por operação do simulador (o worker chama a SEFAZ FORA da
 *   transação do faturamento; desenho T-0045 §6).
 * - `purgarEstadoSimulador(tx, antesDe)`: a retenção de 400 dias (LGPD), por tenant.
 *
 * Concorrência (READ COMMITTED):
 * - faixa: `travarFaixa` = `pg_advisory_xact_lock` por (tenant_id, filial_id, modo, cnpj, serie, ano), chamada uma vez
 *   pela inutilização (antes de `faixa_sobreposta(...)`) e pela autorização (antes do 206): o `FOR UPDATE` não trava
 *   faixa que ainda não existe, a trava da transação sim;
 * - autorização da mesma chave: `gravarNota` com SAVEPOINT; no 23505, ROLLBACK TO SAVEPOINT e devolve a nota que
 *   ganhou (204 ou 539);
 * - evento: `notaPorChaveParaAtualizar` (`FOR UPDATE`) serializa os eventos da mesma nota.
 * Esgotamento da sequência (2200H) = `SequenciaSimuladorEsgotadaErro`, permanente.
 * Nada destas tabelas vai a log nem a mensagem de erro: o erro do banco sai só com a operação e o SQLSTATE (o detalhe
 * do Postgres traz valores da linha, e o `<evento>` da CC-e tem o `xCorrecao`, texto livre).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { ErroSefaz, filhoNfe, lerXml, textoNfe, type ProtocoloEvento, type ProtocoloNFe } from '@macuxierp/nfe-sefaz';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import {
  SequenciaSimuladorEsgotadaErro,
  type DestinoDoEstado,
  type EstadoSimuladorRepo,
  type EventoSimulado,
  type FonteEstadoSimulador,
  type NotaSimulada,
  type ReciboSimulado,
  type SituacaoNotaSimulada,
  type TipoNumeroSimulador,
} from './estado';

/** Erro do banco na porta do simulador: só a operação e o SQLSTATE (nunca o detalhe, que traz valores da linha). */
export class ErroEstadoSimuladorPg extends Error {
  override readonly name = 'ErroEstadoSimuladorPg';
  constructor(
    readonly operacao: string,
    readonly sqlstate: string | null,
  ) {
    super(`simulador da SEFAZ: falha no banco em ${operacao}${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
  }
}

const sqlstateDe = (e: unknown): string | null => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) ? c : null;
};

async function consultar<L>(
  tx: Transacao,
  operacao: string,
  sql: string,
  parametros: readonly unknown[],
): Promise<L[]> {
  try {
    return await tx.consultar<L>(sql, parametros);
  } catch (e) {
    throw new ErroEstadoSimuladorPg(operacao, sqlstateDe(e));
  }
}

const TENANT = 'plataforma.tenant_atual()';
/** Filtro do destino em toda leitura: tenant da sessão, filial e modo ($1 e $2). */
const DO_DESTINO = `tenant_id = ${TENANT} AND filial_id = $1 AND modo = $2 AND deleted_at IS NULL`;
const SEQUENCIA: Record<TipoNumeroSimulador, string> = {
  nProt: 'sefaz_simulador.seq_nprot',
  nRec: 'sefaz_simulador.seq_nrec',
};

interface LinhaNota {
  ch_nfe: string;
  cnpj: string;
  serie: number;
  nnf: number;
  dh_emi: Date;
  autorizada_em: Date;
  situacao: SituacaoNotaSimulada;
  n_prot: string;
  dig_val: string | null;
  c_stat: string;
  dh_recbto: string;
  xml_prot: string;
}
const COLUNAS_NOTA =
  'ch_nfe, cnpj, serie, nnf, dh_emi, autorizada_em, situacao, n_prot, dig_val, c_stat, dh_recbto, xml_prot';

interface LinhaEvento {
  ch_nfe: string;
  tp_evento: string;
  n_seq_evento: number;
  n_prot: string | null;
  c_stat: string;
  dh_reg_evento: string;
  xml_ret: string;
  evento_xml: string;
}

/** `tpAmb`, `verAplic` e `xMotivo` não têm coluna: saem do XML do protocolo gravado (sempre do próprio simulador). */
function cabecalhoDoXml(xml: string, raiz: string): { tpAmb: number; verAplic: string; xMotivo: string } {
  const inf = filhoNfe(lerXml(xml)?.documentElement, raiz);
  return {
    tpAmb: Number(textoNfe(inf, 'tpAmb')),
    verAplic: textoNfe(inf, 'verAplic'),
    xMotivo: textoNfe(inf, 'xMotivo'),
  };
}

function notaDaLinha(l: LinhaNota): NotaSimulada {
  const protocolo = {
    ...cabecalhoDoXml(l.xml_prot, 'infProt'),
    chNFe: l.ch_nfe,
    dhRecbto: l.dh_recbto,
    nProt: l.n_prot,
    digVal: l.dig_val,
    cStat: l.c_stat,
    xml: l.xml_prot,
  } as ProtocoloNFe;
  return {
    chNFe: l.ch_nfe,
    cnpj: l.cnpj,
    serie: l.serie,
    nNF: l.nnf,
    dhEmi: l.dh_emi,
    autorizadaEm: l.autorizada_em,
    situacao: l.situacao,
    protocolo,
  };
}

function eventoDaLinha(l: LinhaEvento): EventoSimulado {
  const protocolo = {
    ...cabecalhoDoXml(l.xml_ret, 'infEvento'),
    chNFe: l.ch_nfe,
    tpEvento: l.tp_evento,
    nSeqEvento: l.n_seq_evento,
    dhRegEvento: l.dh_reg_evento,
    nProt: l.n_prot,
    cStat: l.c_stat,
    xml: l.xml_ret,
  } as ProtocoloEvento;
  return { protocolo, eventoXml: l.evento_xml };
}

/** A porta presa a uma transação aberta no tenant (`banco.comTenant`). Vale só enquanto a transação estiver aberta. */
export function criarEstadoSimuladorPg(tx: Transacao): EstadoSimuladorRepo {
  const dst = (d: DestinoDoEstado) => [d.filial_id, d.modo] as const;

  const repo: EstadoSimuladorRepo = {
    async notaPorChave(d, chNFe) {
      const [l] = await consultar<LinhaNota>(
        tx,
        'notaPorChave',
        `SELECT ${COLUNAS_NOTA} FROM sefaz_simulador.nota WHERE ${DO_DESTINO} AND ch_nfe = $3`,
        [...dst(d), chNFe],
      );
      return l ? notaDaLinha(l) : null;
    },
    async notaPorChaveParaAtualizar(d, chNFe) {
      // FOR UPDATE: o 2º evento da mesma nota espera o 1º terminar e relê a linha já atualizada (READ COMMITTED).
      const [l] = await consultar<LinhaNota>(
        tx,
        'notaPorChaveParaAtualizar',
        `SELECT ${COLUNAS_NOTA} FROM sefaz_simulador.nota WHERE ${DO_DESTINO} AND ch_nfe = $3 FOR UPDATE`,
        [...dst(d), chNFe],
      );
      return l ? notaDaLinha(l) : null;
    },
    async notaPorNumero(d, cnpj, serie, nNF) {
      const [l] = await consultar<LinhaNota>(
        tx,
        'notaPorNumero',
        `SELECT ${COLUNAS_NOTA} FROM sefaz_simulador.nota WHERE ${DO_DESTINO} AND cnpj = $3 AND serie = $4 AND nnf = $5`,
        [...dst(d), cnpj, serie, nNF],
      );
      return l ? notaDaLinha(l) : null;
    },
    async gravarNota(d, n) {
      const p = n.protocolo;
      // Savepoint: a outra transação que gravou a mesma chave (ou o mesmo número) primeiro dá 23505 aqui; o
      // ROLLBACK TO SAVEPOINT mantém a transação viva para reler a nota dela (204 ou 539), em vez de abortar o lote.
      await consultar(tx, 'gravarNota', 'SAVEPOINT sefaz_simulador_nota', []);
      try {
        await tx.consultar(
          `INSERT INTO sefaz_simulador.nota (tenant_id, filial_id, modo, ch_nfe, cnpj, serie, nnf, dh_emi, autorizada_em, situacao, n_prot, dig_val,
             c_stat, dh_recbto, xml_prot)
           VALUES (${TENANT}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            ...dst(d),
            n.chNFe,
            n.cnpj,
            n.serie,
            n.nNF,
            n.dhEmi,
            n.autorizadaEm,
            n.situacao,
            p.nProt,
            p.digVal,
            p.cStat,
            p.dhRecbto,
            p.xml,
          ],
        );
      } catch (e) {
        if (sqlstateDe(e) !== '23505') throw new ErroEstadoSimuladorPg('gravarNota', sqlstateDe(e));
        await consultar(tx, 'gravarNota', 'ROLLBACK TO SAVEPOINT sefaz_simulador_nota', []);
        // Statement novo em READ COMMITTED: enxerga a nota que a outra transação acabou de confirmar.
        const existente =
          (await repo.notaPorChave(d, n.chNFe)) ?? (await repo.notaPorNumero(d, n.cnpj, n.serie, n.nNF));
        if (!existente) throw new ErroEstadoSimuladorPg('gravarNota', '23505');
        return existente;
      }
      await consultar(tx, 'gravarNota', 'RELEASE SAVEPOINT sefaz_simulador_nota', []);
      return null;
    },
    async mudarSituacao(d, chNFe, situacao) {
      const r = await consultar(
        tx,
        'mudarSituacao',
        `UPDATE sefaz_simulador.nota SET situacao = $4, updated_at = now() WHERE ${DO_DESTINO} AND ch_nfe = $3 RETURNING 1 AS ok`,
        [...dst(d), chNFe, situacao],
      );
      if (r.length !== 1) throw new ErroEstadoSimuladorPg('mudarSituacao', null);
    },
    async eventosDaNota(d, chNFe) {
      const linhas = await consultar<LinhaEvento>(
        tx,
        'eventosDaNota',
        `SELECT ch_nfe, tp_evento, n_seq_evento, n_prot, c_stat, dh_reg_evento, xml_ret, evento_xml FROM sefaz_simulador.evento
         WHERE ${DO_DESTINO} AND ch_nfe = $3 ORDER BY created_at, tp_evento, n_seq_evento`,
        [...dst(d), chNFe],
      );
      return linhas.map(eventoDaLinha);
    },
    async gravarEvento(d, chNFe, e) {
      const p = e.protocolo;
      await consultar(
        tx,
        'gravarEvento',
        `INSERT INTO sefaz_simulador.evento (tenant_id, filial_id, modo, ch_nfe, tp_evento, n_seq_evento, n_prot, c_stat, dh_reg_evento, xml_ret,
           evento_xml)
         VALUES (${TENANT}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [...dst(d), chNFe, p.tpEvento, p.nSeqEvento, p.nProt, p.cStat, p.dhRegEvento, p.xml, e.eventoXml],
      );
    },
    // RN-FAT-10 (ADR 0011): o simulador do worker atende filial simulada, que não entra em contingência. Sem EPEC no
    // banco (nem tabela para ela): a leitura não acha nada (a nota com tpEmis 4 dá 468) e a gravação recusa.
    async epecPorChave() {
      return null;
    },
    async gravarEpec() {
      throw new ErroSefaz(
        'SEFAZ_CONTINGENCIA_SIMULADA',
        'simulador da SEFAZ (Postgres): filial com NF-e simulada não entra em contingência, EPEC recusada (RN-FAT-10)',
      );
    },
    async numeroInutilizado(d, cnpj, serie, nNF) {
      const r = await consultar(
        tx,
        'numeroInutilizado',
        `SELECT 1 AS ok FROM sefaz_simulador.inutilizacao WHERE ${DO_DESTINO} AND cnpj = $3 AND serie = $4 AND nnf_ini <= $5 AND nnf_fin >= $5 LIMIT 1`,
        [...dst(d), cnpj, serie, nNF],
      );
      return r.length > 0;
    },
    async travarFaixa(d, f) {
      await consultar(
        tx,
        'travarFaixa',
        `SELECT pg_advisory_xact_lock(hashtextextended(concat_ws('|', 'sefaz_simulador.inutilizacao', ${TENANT}::text, $1::text, $2::text, $3::text, $4::text, $5::text), 0))`,
        [...dst(d), f.cnpj, f.serie, f.ano],
      );
    },
    async faixaRepetida(d, f) {
      const r = await consultar(
        tx,
        'faixaRepetida',
        `SELECT 1 AS ok FROM sefaz_simulador.inutilizacao WHERE ${DO_DESTINO} AND cnpj = $3 AND serie = $4 AND ano = $5 AND nnf_ini = $6 AND nnf_fin = $7 LIMIT 1`,
        [...dst(d), f.cnpj, f.serie, f.ano, f.nNFIni, f.nNFFin],
      );
      return r.length > 0;
    },
    async faixaSobreposta(d, f) {
      const [r] = await consultar<{ sobreposta: boolean }>(
        tx,
        'faixaSobreposta',
        'SELECT sefaz_simulador.faixa_sobreposta($1, $2, $3, $4, $5, $6, $7) AS sobreposta',
        [...dst(d), f.cnpj, f.serie, f.ano, f.nNFIni, f.nNFFin],
      );
      return r?.sobreposta === true;
    },
    async numeroUsadoNaFaixa(d, f) {
      const r = await consultar(
        tx,
        'numeroUsadoNaFaixa',
        `SELECT 1 AS ok FROM sefaz_simulador.nota WHERE ${DO_DESTINO} AND cnpj = $3 AND serie = $4 AND nnf BETWEEN $5 AND $6 LIMIT 1`,
        [...dst(d), f.cnpj, f.serie, f.nNFIni, f.nNFFin],
      );
      return r.length > 0;
    },
    async gravarInutilizacao(d, i) {
      await consultar(
        tx,
        'gravarInutilizacao',
        `INSERT INTO sefaz_simulador.inutilizacao (tenant_id, filial_id, modo, cnpj, serie, ano, nnf_ini, nnf_fin, n_prot)
         VALUES (${TENANT}, $1, $2, $3, $4, $5, $6, $7, $8)`,
        [...dst(d), i.cnpj, i.serie, i.ano, i.nNFIni, i.nNFFin, i.nProt],
      );
    },
    async gravarRecibo(d, r) {
      await consultar(
        tx,
        'gravarRecibo',
        `INSERT INTO sefaz_simulador.recibo (tenant_id, filial_id, modo, n_rec, dh_recbto, pronto_em, protocolos)
         VALUES (${TENANT}, $1, $2, $3, $4, $5, $6::jsonb)`,
        [...dst(d), r.nRec, r.dhRecbto, r.prontoEm, JSON.stringify(r.protocolos)],
      );
    },
    async recibo(d, nRec) {
      const [l] = await consultar<{
        n_rec: string;
        dh_recbto: string;
        pronto_em: Date;
        protocolos: ProtocoloNFe[];
      }>(
        tx,
        'recibo',
        `SELECT n_rec, dh_recbto, pronto_em, protocolos FROM sefaz_simulador.recibo WHERE ${DO_DESTINO} AND n_rec = $3`,
        [...dst(d), nRec],
      );
      return l
        ? ({
            nRec: l.n_rec,
            dhRecbto: l.dh_recbto,
            prontoEm: l.pronto_em,
            protocolos: l.protocolos,
          } satisfies ReciboSimulado)
        : null;
    },
    async proximo(tipo) {
      try {
        const [l] = await tx.consultar<{ n: string }>(`SELECT nextval('${SEQUENCIA[tipo]}') AS n`);
        return Number(l?.n);
      } catch (e) {
        // 2200H (sequence_generator_limit_exceeded): MAXVALUE sem CYCLE. Permanente: nunca repete número.
        if (sqlstateDe(e) === '2200H') throw new SequenciaSimuladorEsgotadaErro(tipo);
        throw new ErroEstadoSimuladorPg('proximo', sqlstateDe(e));
      }
    },
  };
  return repo;
}

/** Abre a transação do tenant e entrega o que `fn` devolve (no worker: `(fn) => banco.comTenant(tenant, fn)`). */
export type EmTransacao = <R>(fn: (tx: Transacao) => Promise<R>) => Promise<R>;

/** Uma transação por operação do simulador, com a porta do Postgres presa a ela. */
export function fonteEstadoSimuladorPg(emTransacao: EmTransacao): FonteEstadoSimulador {
  return (fn) => emTransacao((tx) => fn(criarEstadoSimuladorPg(tx)));
}

/**
 * O estado do simulador no Postgres para o worker, que monta o seletor UMA vez e só conhece o tenant no trabalho: o
 * trabalho (ou a varredura) roda dentro de `noTenant(tenant_id, ...)` e toda operação do simulador abre a transação
 * desse tenant (`banco.comTenant`). Operação fora do `noTenant` lança erro (nunca grava sem tenant).
 */
export interface EstadoSimuladorPorTenant {
  readonly fonte: FonteEstadoSimulador;
  noTenant<R>(tenant_id: string, fn: () => Promise<R>): Promise<R>;
}

export function estadoSimuladorPorTenant(banco: Pick<Banco, 'comTenant'>): EstadoSimuladorPorTenant {
  const atual = new AsyncLocalStorage<string>();
  return {
    fonte: (fn) => {
      const tenant = atual.getStore();
      if (!tenant)
        return Promise.reject(
          new Error('simulador da SEFAZ: operação fora do tenant do trabalho (noTenant)'),
        );
      return fonteEstadoSimuladorPg((g) => banco.comTenant(tenant, g))(fn);
    },
    noTenant: (tenant_id, fn) => atual.run(tenant_id, fn),
  };
}

export interface ResultadoPurgaSimulador {
  notas: number;
  eventos: number;
  inutilizacoes: number;
  recibos: number;
}

/**
 * Retenção de 400 dias da memória do simulador (LGPD; a guarda fiscal de 5 anos é o nfeProc do faturamento, não isto).
 * Na transação do tenant (`comTenant`, papel `macuxierp_worker`, que tem DELETE só nestas tabelas), apaga do tenant
 * tudo o que foi criado antes de `antesDe` (`created_at`, pelos índices `*_purga_idx` da 0025): a nota (autorizada,
 * denegada ou cancelada) e os eventos dela, a inutilização e o recibo. O chamador passa `antesDe = agora - 400 dias`,
 * em todos os tenants (inclusive os desativados). Devolve só as contagens.
 */
export async function purgarEstadoSimulador(tx: Transacao, antesDe: Date): Promise<ResultadoPurgaSimulador> {
  const contar = async (operacao: string, sql: string) =>
    Number((await consultar<{ n: string }>(tx, operacao, sql, [antesDe]))[0]?.n ?? 0);
  // Os eventos primeiro (a FK tem ON DELETE CASCADE; apagar antes dá a contagem exata).
  const eventos = await contar(
    'purgarEventos',
    `WITH x AS (
       DELETE FROM sefaz_simulador.evento e USING sefaz_simulador.nota n
       WHERE n.tenant_id = ${TENANT} AND n.created_at < $1
         AND e.tenant_id = n.tenant_id AND e.filial_id = n.filial_id AND e.modo = n.modo AND e.ch_nfe = n.ch_nfe
       RETURNING 1)
     SELECT count(*) AS n FROM x`,
  );
  const notas = await contar(
    'purgarNotas',
    `WITH x AS (DELETE FROM sefaz_simulador.nota WHERE tenant_id = ${TENANT} AND created_at < $1 RETURNING 1) SELECT count(*) AS n FROM x`,
  );
  const inutilizacoes = await contar(
    'purgarInutilizacoes',
    `WITH x AS (DELETE FROM sefaz_simulador.inutilizacao WHERE tenant_id = ${TENANT} AND created_at < $1 RETURNING 1) SELECT count(*) AS n FROM x`,
  );
  const recibos = await contar(
    'purgarRecibos',
    `WITH x AS (DELETE FROM sefaz_simulador.recibo WHERE tenant_id = ${TENANT} AND created_at < $1 RETURNING 1) SELECT count(*) AS n FROM x`,
  );
  return { notas, eventos, inutilizacoes, recibos };
}
