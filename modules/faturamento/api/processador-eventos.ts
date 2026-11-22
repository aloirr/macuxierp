/** Trabalhos do worker para eventos, inutilização e consulta (RF-FAT-02, RN-FAT-01 a 03): a API só grava o pedido `pendente`; aqui a porta `EmissorNFe` roda FORA de transação.
 * O fluxo, a ordem das travas e as pendências estão em docs/modulos/faturamento/eventos.md. */
import { PedidoCancelamento, PedidoCartaCorrecao, PedidoInutilizacaoEmissor, type EmissorNFe } from '@macuxierp/nfe-emissor';
import { CUF, Uf, type ProtocoloEvento, type RespostaConsultaProtocolo, type SefazTransporte, type SeletorTransporte } from '@macuxierp/nfe-sefaz';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import { NotaCanceladaPayload } from '../contracts';
import {
  digestValueDoXml, emTransmissao, FUSO_MANAUS_MINUTOS, interpretarRetornoEvento, interpretarRetornoInutilizacao, prazoDeCancelamentoEsgotado, PRAZO_CANCELAMENTO_HORAS, reconciliarConsulta, TAMANHO_JUSTIFICATIVA, type AcaoConsulta, type SituacaoSefaz,
} from '../domain';
import { criarProcessadorRetorno } from './emissao';
import { cancelarTitulosDaNotaCancelada, contaComoRealDaNota, type LogFaturamento, type ResultadoCancelamentoTitulos } from './titulos';
import { baseEventoDaNota, EVENTO_NOTA_CANCELADA } from './eventos';
import type { A1DaFilial, AmbienteFiscalDaFilial, ConsultaCadastrosFaturamento, EventoRegistro, InutilizacaoRegistro, NotaRegistro, RepositorioEventos, RepositorioNotas, RepositorioTitulos, TransmissaoDeEvento } from './portas';
import { justificativaDoProc, montarProcEvento, montarProcInutilizacao, procEventoDaConsulta } from './xml-proc-eventos';
import { abrirA1OuNulo, comA1 as comA1Comum, descarregar as descarregarLog, destinoDoLog, medir as medirChamada } from './sefaz-comum';
import { retornoDaConsulta } from './retorno-sefaz';

export interface DepsProcessadorEventos {
  banco: Banco;
  notas: RepositorioNotas;
  /** Títulos a receber: gerados na autorização reconciliada pela consulta e cancelados com a nota (RF-FAT-07). */
  titulos: RepositorioTitulos;
  /** Log sem dado pessoal (só ids e códigos), OBRIGATÓRIO: a divergência de título com baixa em nota cancelada e a geração de título pendente não podem sumir. */
  log: LogFaturamento;
  eventos: RepositorioEventos;
  cadastros: Pick<ConsultaCadastrosFaturamento, 'filial'>;
  ambiente: AmbienteFiscalDaFilial;
  /** `lerA1DecifradoDaFilial` do core + `abrirA1` do emissor, ligados no worker: `null` = filial sem A1 ativo. */
  lerA1(tx: Transacao, filial_id: string): Promise<A1DaFilial | null>;
  emissor: EmissorNFe;
  /** Fábrica INJETADA (seletor do nfe-sefaz com a trava do simulador, ou o simulador direto no arnês). */
  sefaz: SeletorTransporte;
  agora?: () => Date;
  /** Minutos que vale o lease de transmissão de um pedido (padrão 5): fila e varredura não transmitem juntas, e a varredura só retoma o lease vencido. */
  leaseMin?: number;
  /** Prazo do cancelamento em horas (padrão 24, o mesmo da API; extemporâneo depende da UF, RN-FAT-02). */
  prazoCancelamentoHoras?: number;
}

export type ResultadoEventoProcessado =
  /** `titulos`: só no cancelamento. Baixa em título NÃO bloqueia o cancelamento: `divergentes` vai ao financeiro (titulos.md). */
  | { resultado: 'registrado'; evento: EventoRegistro; nota: NotaRegistro; titulos?: ResultadoCancelamentoTitulos }
  | { resultado: 'rejeitado'; codigo: string; mensagem: string }
  | { resultado: 'ignorada'; motivo: 'evento_inexistente' | 'nao_pendente' | 'nota_inexistente' | 'nota_nao_autorizada' | 'em_processamento' }
  | { resultado: 'sem_certificado' }
  | { resultado: 'ambiente_mudou' };
export type ResultadoInutilizacaoProcessada =
  | { resultado: 'registrada'; protocolo: string }
  | { resultado: 'rejeitada'; codigo: string; mensagem: string }
  /** 563: a SEFAZ já tem a faixa. Fica `pendente` (nunca rejeitada), com o motivo, para o suporte; sem ProcInut as notas não mudam. */
  | { resultado: 'divergente'; codigo: string; motivo: 'ja_inutilizada_na_sefaz' }
  | { resultado: 'ignorada'; motivo: 'inexistente' | 'nao_pendente' | 'em_processamento' }
  | { resultado: 'sem_certificado' }
  | { resultado: 'ambiente_mudou' }
  | { resultado: 'filial_invalida' };
export type ResultadoConsultaNota =
  | { resultado: 'consultada'; situacaoSefaz: SituacaoSefaz; acao: AcaoConsulta | 'processada'; mensagem: string; status: NotaRegistro['status'] }
  | { resultado: 'ignorada'; motivo: 'nota_inexistente' }
  | { resultado: 'sem_certificado' };

const tpAmb = (a: 'homologacao' | 'producao'): 1 | 2 => (a === 'producao' ? 1 : 2);
const cnpjSemMascara = (c: string): string => c.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
const TIPO_SEFAZ = { cancelamento: '110111', cce: '110110' } as const;

export function criarProcessadorEventos(deps: DepsProcessadorEventos) {
  const agora = deps.agora ?? ((): Date => new Date());
  const retorno = criarProcessadorRetorno(deps.notas, deps.titulos, deps.log);

  const leaseMin = deps.leaseMin ?? 5;
  type Base = Pick<TransmissaoDeEvento, 'servico' | 'evento_id' | 'nota_id' | 'inutilizacao_id'>;
  const medir = <T extends { cStat: string; xMotivo: string }>(t: SefazTransporte, chamar: () => Promise<T>, base: Base, log: TransmissaoDeEvento[]): Promise<T> =>
    medirChamada(agora, t, chamar, base, log as (Base & TransmissaoDeEvento)[]);
  /** Fecha o lease com a 1ª chamada do log (uma linha por tentativa); as demais (consulta do 573) entram como linhas novas. */
  const descarregar = async (tx: Transacao, log: TransmissaoDeEvento[], lease: string): Promise<void> => {
    const [primeira, ...resto] = log.splice(0);
    if (primeira) await deps.eventos.concluirTransmissao(tx, lease, primeira);
    await descarregarLog(resto, (l) => deps.eventos.registrarTransmissao(tx, l));
  };
  /** A chamada falhou (transporte, timeout): fecha o lease com o motivo para a próxima volta já poder retomar, sem esperar o vencimento. Sem dado pessoal: só o nome do erro. */
  const abandonar = async (tenant_id: string, lease: string | undefined, e: unknown): Promise<void> => {
    if (!lease) return;
    const t = agora().toISOString();
    await deps.banco.comTenant(tenant_id, (tx) => deps.eventos.concluirTransmissao(tx, lease, { cStat: null, xMotivo: `falha: ${e instanceof Error ? e.name : 'ERRO'}`, respondida_em: t, duracao_ms: 0 }));
  };
  const comA1 = <T extends { a1?: A1DaFilial }>(tenant_id: string, corpo: (tx: Transacao, abrirA1: (filial_id: string) => Promise<A1DaFilial | null>) => Promise<T>): Promise<T> =>
    comA1Comum(deps.banco, deps.lerA1, tenant_id, (tx, abrir) => corpo(tx, (f) => abrirA1OuNulo(abrir, f)));

  // ---------------------------------------------------------------- cancelamento e CC-e
  type PreparoEvento =
    | { tipo: 'fim'; resultado: ResultadoEventoProcessado; a1?: undefined }
    | { tipo: 'enviar'; evento: EventoRegistro; nota: NotaRegistro; uf: Uf; a1: A1DaFilial; pedido: PedidoCancelamento | PedidoCartaCorrecao };

  async function prepararEvento(tenant_id: string, evento_id: string): Promise<PreparoEvento> {
    return comA1(tenant_id, async (tx, abrirA1): Promise<PreparoEvento> => {
      if (!(await deps.notas.travarTransmissao(tx, evento_id))) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'em_processamento' } };
      const evento = await deps.eventos.obterEvento(tx, evento_id);
      if (!evento) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'evento_inexistente' } };
      if (evento.status !== 'pendente') return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'nao_pendente' } };
      const nota = await deps.notas.obter(tx, evento.nota_id);
      if (!nota) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'nota_inexistente' } };
      if (nota.status !== 'autorizada' || !nota.protocolo) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'nota_nao_autorizada' } };
      if ((await deps.ambiente.ambiente(tx, nota.filial_id)) !== nota.ambiente) return { tipo: 'fim', resultado: { resultado: 'ambiente_mudou' } };
      if (evento.tipo === 'cancelamento' && nota.autorizada_em && prazoDeCancelamentoEsgotado(new Date(nota.autorizada_em), agora(), deps.prazoCancelamentoHoras)) {
        // RN-FAT-02/03: o 501 local SÓ vale sem NENHUMA tentativa anterior. Com tentativa, a SEFAZ pode já ter cancelado (timeout depois do registro): transmite e ela responde
        // (o 573 segue pela consulta). Com lease ativo, outro worker está na chamada: o 501 local mudaria o status e o 135 dele se perderia.
        const s = await deps.eventos.situacaoTransmissaoEvento(tx, evento.id, leaseMin);
        if (s.leaseAtivo) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'em_processamento' } };
        if (s.tentativas === 0) {
          const motivo = `Prazo de cancelamento de ${deps.prazoCancelamentoHoras ?? PRAZO_CANCELAMENTO_HORAS} h da autorização esgotado antes do envio (conferido pelo worker, sem chamar a SEFAZ).`;
          await deps.eventos.rejeitarEvento(tx, evento.id, { cStat: '501', xMotivo: motivo });
          return { tipo: 'fim', resultado: { resultado: 'rejeitado', codigo: '501', mensagem: motivo } };
        }
      }
      const conteudo = await deps.notas.lerConteudo(tx, nota.id);
      if (!conteudo) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'nota_inexistente' } };
      const a1 = await abrirA1(nota.filial_id);
      if (!a1) return { tipo: 'fim', resultado: { resultado: 'sem_certificado' } };
      {
        // O pedido guardado: `dhEvento` e `idLote` saem da linha pendente, então a retentativa sai idêntica (mesmo XML, mesmo lote).
        const dhEvento = new Date(Math.floor(new Date(evento.dh_evento).getTime() / 1000) * 1000);
        const base = { chNFe: nota.chave_acesso, cnpj: cnpjSemMascara(conteudo.emitente.cnpj), tpAmb: tpAmb(nota.ambiente), dhEvento, fusoMinutos: FUSO_MANAUS_MINUTOS, idLote: String(dhEvento.getTime()) };
        const pedido = evento.tipo === 'cancelamento'
          ? PedidoCancelamento.parse({ ...base, nProt: nota.protocolo, xJust: evento.texto })
          : PedidoCartaCorrecao.parse({ ...base, nSeqEvento: evento.n_seq_evento, xCorrecao: evento.texto });
        return { tipo: 'enviar', evento, nota, uf: Uf.parse(conteudo.emitente.endereco.uf), a1, pedido };
      }
    });
  }

  async function processarEvento(tenant_id: string, evento_id: string): Promise<ResultadoEventoProcessado> {
    const p = await prepararEvento(tenant_id, evento_id);
    if (p.tipo === 'fim') return p.resultado;
    const { evento, nota, a1 } = p;
    const log: TransmissaoDeEvento[] = [];
    let registro: ProtocoloEvento | undefined;
    let assinado: string;
    let cStat: string;
    let xMotivo: string;
    let lease: string | undefined;
    try {
      const transporte = deps.sefaz({ filial_id: nota.filial_id, ambiente: nota.ambiente, uf: p.uf, modo: 'normal' }, a1.credencial);
      // RN-FAT-01: trava de transmissão numa tx curta ANTES da porta (a advisory lock da tx1 não cobre a chamada fora de transação).
      const l = await deps.banco.comTenant(tenant_id, (tx) => deps.eventos.iniciarTransmissao(tx, { servico: 'evento', evento_id: evento.id, nota_id: nota.id, destino: destinoDoLog(transporte), leaseMin }));
      if (!l) return { resultado: 'ignorada', motivo: 'em_processamento' };
      lease = l.id;
      const base = { servico: 'evento' as const, evento_id: evento.id, nota_id: nota.id };
      const r = evento.tipo === 'cancelamento'
        ? await medir(transporte, () => deps.emissor.cancelar(p.pedido as PedidoCancelamento, a1.certificado, transporte), base, log)
        : await medir(transporte, () => deps.emissor.cartaCorrecao(p.pedido as PedidoCartaCorrecao, a1.certificado, transporte), base, log);
      assinado = r.assinado.xml;
      const doEvento = (e: ProtocoloEvento): boolean => e.chNFe === nota.chave_acesso && e.tpEvento === TIPO_SEFAZ[evento.tipo] && e.nSeqEvento === evento.n_seq_evento;
      registro = r.eventos.find(doEvento);
      cStat = registro?.cStat ?? r.cStat;
      xMotivo = registro?.xMotivo ?? r.xMotivo;
      if (interpretarRetornoEvento(cStat) === 'duplicado') {
        // A SEFAZ já tem o evento (a resposta anterior se perdeu): confirma pela consulta, FORA de transação. O assinado é o mesmo (pedido guardado).
        const c = await medir(transporte, () => transporte.consultarProtocolo({ chNFe: nota.chave_acesso }), { servico: 'evento', evento_id: evento.id, nota_id: nota.id }, log);
        const achado = c.eventos.find((e) => doEvento(e) && interpretarRetornoEvento(e.cStat) === 'registrado' && e.nProt);
        if (achado) {
          registro = achado;
          cStat = achado.cStat;
          xMotivo = achado.xMotivo;
        }
      }
    } catch (e) {
      await abandonar(tenant_id, lease, e);
      throw e;
    } finally {
      a1.credencial.pfx.fill(0);
    }

    return deps.banco.comTenant(tenant_id, async (tx): Promise<ResultadoEventoProcessado> => {
      // Ordem das travas: NOTA antes do evento (como a consulta e a API), para não haver deadlock.
      const travada = await deps.notas.obter(tx, nota.id, { travar: true });
      const atual = await deps.eventos.obterEvento(tx, evento.id, { travar: true });
      if (!atual || atual.status !== 'pendente') return { resultado: 'ignorada', motivo: 'nao_pendente' };
      await descarregar(tx, log, lease as string);
      if (interpretarRetornoEvento(cStat) === 'registrado' && registro?.nProt) {
        // O evento muda o status da nota (cancelamento): a nota já está travada e relida acima, como no retorno da autorização e no reenvio da API.
        if (!travada) return { resultado: 'ignorada', motivo: 'nota_inexistente' };
        // RN-FAT-03: o procEventoNFe é guardado ANTES de qualquer outra coisa; o gatilho do banco registra o evento (e cancela a nota).
        await deps.eventos.guardarXmlEvento(tx, atual, { conteudo: montarProcEvento(assinado, registro.xml), protocolo: registro.nProt, dhRegistro: new Date(registro.dhRegEvento).toISOString() });
        const registrado = (await deps.eventos.obterEvento(tx, atual.id)) ?? atual;
        let depois = (await deps.notas.obter(tx, nota.id)) ?? travada;
        if (atual.tipo === 'cancelamento') {
          depois = { ...depois, status: 'cancelada' };
          await publicarCancelada(tx, depois, registro.nProt, atual.texto);
          const titulos = await aoCancelar(tx, tenant_id, depois);
          return { resultado: 'registrado', evento: registrado, nota: depois, titulos };
        }
        return { resultado: 'registrado', evento: registrado, nota: depois };
      }
      await deps.eventos.rejeitarEvento(tx, atual.id, { cStat, xMotivo });
      return { resultado: 'rejeitado', codigo: cStat, mensagem: xMotivo };
    });
  }

  /** `faturamento.nota.cancelada@1`: só depois da guarda; o pedido devolve as quantidades pelo payload (P-2). */
  async function publicarCancelada(tx: Transacao, nota: NotaRegistro, protocoloCancelamento: string, motivo: string): Promise<void> {
    const payload = NotaCanceladaPayload.parse({ ...baseEventoDaNota(nota, nota.protocolo, contaComoRealDaNota(await deps.notas.lerConteudo(tx, nota.id), nota)), pedido_uuid: nota.pedido_uuid, protocolo_cancelamento: protocoloCancelamento, motivo });
    await deps.notas.publicarEvento(tx, { nome: EVENTO_NOTA_CANCELADA, agregado_id: nota.id, payload });
  }

  /** RN-FAT-06: nota cancelada cancela os títulos abertos sem baixa, na mesma tx do evento; com baixa, o cancelamento segue e o caso vira divergência (log sem dado pessoal). */
  async function aoCancelar(tx: Transacao, tenant_id: string, nota: NotaRegistro): Promise<ResultadoCancelamentoTitulos> {
    const r = await cancelarTitulosDaNotaCancelada(tx, deps, nota.id);
    if (r.divergentes.length > 0) deps.log({ evento: 'faturamento.titulo.divergencia_cancelamento', tenant_id, nota_id: nota.id, titulos_divergentes: r.divergentes.length });
    return r;
  }

  // ---------------------------------------------------------------- inutilização
  type PrepInut = { fim: ResultadoInutilizacaoProcessada; a1?: undefined } | { fim?: undefined; inut: InutilizacaoRegistro; uf: Uf; a1: A1DaFilial; pedido: PedidoInutilizacaoEmissor };
  type PrepConsulta = { fim: ResultadoConsultaNota; a1?: undefined } | { fim?: undefined; nota: NotaRegistro; uf: Uf; a1: A1DaFilial };

  async function processarInutilizacao(tenant_id: string, inutilizacao_id: string): Promise<ResultadoInutilizacaoProcessada> {
    const p = await comA1(tenant_id, async (tx, abrirA1): Promise<PrepInut> => {
      if (!(await deps.notas.travarTransmissao(tx, inutilizacao_id))) return { fim: { resultado: 'ignorada', motivo: 'em_processamento' } };
      const inut = await deps.eventos.obterInutilizacao(tx, inutilizacao_id);
      if (!inut) return { fim: { resultado: 'ignorada', motivo: 'inexistente' } };
      if (inut.status !== 'pendente') return { fim: { resultado: 'ignorada', motivo: 'nao_pendente' } };
      if ((await deps.ambiente.ambiente(tx, inut.filial_id)) !== inut.ambiente) return { fim: { resultado: 'ambiente_mudou' } };
      const filial = await deps.cadastros.filial(tx, inut.filial_id);
      if (!filial) return { fim: { resultado: 'filial_invalida' } };
      const a1 = await abrirA1(inut.filial_id);
      if (!a1) return { fim: { resultado: 'sem_certificado' } };
      {
        const uf = Uf.parse(filial.endereco.uf);
        const pedido = PedidoInutilizacaoEmissor.parse({
          cUF: CUF[uf], tpAmb: tpAmb(inut.ambiente), ano: String(inut.ano).slice(-2), cnpj: cnpjSemMascara(filial.cnpj), serie: inut.serie,
          nNFIni: inut.numero_inicial, nNFFin: inut.numero_final, xJust: inut.justificativa,
        });
        return { inut, uf, a1, pedido };
      }
    });
    if (p.fim) return p.fim;
    const { inut, a1 } = p;
    const log: TransmissaoDeEvento[] = [];
    let r;
    let lease: string | undefined;
    try {
      const transporte = deps.sefaz({ filial_id: inut.filial_id, ambiente: inut.ambiente, uf: p.uf, modo: 'normal' }, a1.credencial);
      const l = await deps.banco.comTenant(tenant_id, (tx) => deps.eventos.iniciarTransmissao(tx, { servico: 'inutilizacao', inutilizacao_id: inut.id, destino: destinoDoLog(transporte), leaseMin }));
      if (!l) return { resultado: 'ignorada', motivo: 'em_processamento' };
      lease = l.id;
      r = await medir(transporte, () => deps.emissor.inutilizar(p.pedido, a1.certificado, transporte), { servico: 'inutilizacao', inutilizacao_id: inut.id }, log);
    } catch (e) {
      await abandonar(tenant_id, lease, e);
      throw e;
    } finally {
      a1.credencial.pfx.fill(0);
    }
    return deps.banco.comTenant(tenant_id, async (tx): Promise<ResultadoInutilizacaoProcessada> => {
      // Notas da faixa (a inutilização muda o status delas) antes da inutilização, na mesma ordem da API e da consulta: nota primeiro.
      await deps.eventos.notasNaFaixa(tx, inut.filial_id, inut.ambiente, inut.serie, inut.numero_inicial, inut.numero_final, { travar: true });
      const atual = await deps.eventos.obterInutilizacao(tx, inut.id, { travar: true });
      if (!atual || atual.status !== 'pendente') return { resultado: 'ignorada', motivo: 'nao_pendente' };
      await descarregar(tx, log, lease as string);
      const situacao = interpretarRetornoInutilizacao(r.cStat);
      if (situacao === 'registrada' && r.nProt) {
        // RN-FAT-03: procInutNFe guardado primeiro; o gatilho registra a inutilização e passa rascunhos e rejeitadas da faixa a `inutilizada`.
        await deps.eventos.guardarXmlInutilizacao(tx, atual, { conteudo: montarProcInutilizacao(r.assinado.xml, r.xml), protocolo: r.nProt, dhRegistro: new Date(r.dhRecbto).toISOString() });
        return { resultado: 'registrada', protocolo: r.nProt };
      }
      if (situacao === 'ja_inutilizada') {
        // RN-FAT-01: 563 NUNCA rejeita (soltaria a faixa como buraco sem ProcInut). Fica pendente, com o motivo, para o suporte (eventos.md, pendências).
        await deps.eventos.registrarDivergenciaInutilizacao(tx, atual.id, { cStat: r.cStat, xMotivo: `ja_inutilizada_na_sefaz: ${r.xMotivo}` });
        return { resultado: 'divergente', codigo: r.cStat, motivo: 'ja_inutilizada_na_sefaz' };
      }
      await deps.eventos.rejeitarInutilizacao(tx, atual.id, { cStat: r.cStat, xMotivo: r.xMotivo });
      return { resultado: 'rejeitada', codigo: r.cStat, mensagem: r.xMotivo };
    });
  }

  // ---------------------------------------------------------------- consulta de protocolo
  async function consultarNota(tenant_id: string, nota_id: string): Promise<ResultadoConsultaNota> {
    const p = await comA1(tenant_id, async (tx, abrirA1): Promise<PrepConsulta> => {
      const nota = await deps.notas.obter(tx, nota_id);
      if (!nota) return { fim: { resultado: 'ignorada', motivo: 'nota_inexistente' } };
      const conteudo = await deps.notas.lerConteudo(tx, nota_id);
      if (!conteudo) return { fim: { resultado: 'ignorada', motivo: 'nota_inexistente' } };
      const a1 = await abrirA1(nota.filial_id);
      if (!a1) return { fim: { resultado: 'sem_certificado' } };
      return { nota, uf: Uf.parse(conteudo.emitente.endereco.uf), a1 };
    });
    if (p.fim) return p.fim;
    const { nota, a1 } = p;
    let c: RespostaConsultaProtocolo;
    let destino: TransmissaoDeEvento['destino'] = 'sefaz_am';
    const inicio = agora();
    try {
      const transporte = deps.sefaz({ filial_id: nota.filial_id, ambiente: nota.ambiente, uf: p.uf, modo: 'normal' }, a1.credencial);
      destino = destinoDoLog(transporte);
      c = await transporte.consultarProtocolo({ chNFe: nota.chave_acesso });
    } finally {
      a1.credencial.pfx.fill(0);
    }
    const fimConsulta = agora();
    return deps.banco.comTenant(tenant_id, async (tx): Promise<ResultadoConsultaNota> => {
      const atual = await deps.notas.obter(tx, nota_id, { travar: true });
      if (!atual) return { resultado: 'ignorada', motivo: 'nota_inexistente' };
      await deps.notas.registrarTransmissao(tx, { nota_id, servico: 'consulta', destino, cStat: c.cStat, xMotivo: c.xMotivo.slice(0, 255), enviada_em: inicio.toISOString(), respondida_em: fimConsulta.toISOString(), duracao_ms: Math.max(0, fimConsulta.getTime() - inicio.getTime()) });
      // O cStat do ENVELOPE da consulta diz a situação da nota (101 cancelada, 110 denegada); o do protNFe é o da autorização original.
      const rec = reconciliarConsulta({ statusNota: atual.status, cStat: c.cStat });
      const fim = (acao: AcaoConsulta | 'processada', mensagem: string, status = atual.status): ResultadoConsultaNota => ({ resultado: 'consultada', situacaoSefaz: rec.situacaoSefaz, acao, mensagem, status });

      if (rec.acao === 'guardar_xml_autorizado' || rec.acao === 'marcar_denegada') {
        if (!emTransmissao(atual.status)) return fim('divergencia', `${rec.mensagem} (a nota está ${atual.status}: tratar pelo reenvio ou pelo suporte)`);
        const ultimo = await deps.notas.ultimoXmlAssinado(tx, nota_id);
        const r = await retorno(tx, atual, retornoDaConsulta(c), { xmlAssinado: ultimo?.xml ?? null, digestValue: ultimo ? digestValueDoXml(ultimo.xml) : null, jaConsultou: true });
        return fim('processada', rec.mensagem, 'nota' in r ? r.nota.status : atual.status);
      }
      if (rec.acao === 'marcar_cancelada') {
        // Cancelada na SEFAZ por evento: guarda o procEventoNFe que a consulta traz ANTES de a nota passar a cancelada (o gatilho exige o evento registrado).
        const proc = procEventoDaConsulta(c.xml, '110111');
        const prot = c.eventos.find((e) => e.tpEvento === '110111' && interpretarRetornoEvento(e.cStat) === 'registrado' && e.nProt);
        const xJust = proc ? justificativaDoProc(proc) : null;
        if (!proc || !prot?.nProt || !xJust || xJust.length < TAMANHO_JUSTIFICATIVA.min) return fim('divergencia', 'Cancelada na SEFAZ, mas o evento não veio completo na consulta: verificar com o suporte.');
        const existente = (await deps.eventos.listarEventos(tx, nota_id)).find((e) => e.tipo === 'cancelamento');
        const evento = !existente
          ? await deps.eventos.criarEvento(tx, { nota_id, tipo: 'cancelamento', n_seq_evento: 1, texto: xJust })
          : existente.status === 'rejeitado' ? await deps.eventos.reabrirEvento(tx, existente.id, xJust) : existente;
        await deps.eventos.guardarXmlEvento(tx, evento, { conteudo: proc, protocolo: prot.nProt, dhRegistro: new Date(prot.dhRegEvento).toISOString() });
        const cancelada: NotaRegistro = { ...atual, status: 'cancelada' };
        await publicarCancelada(tx, cancelada, prot.nProt, xJust);
        await aoCancelar(tx, tenant_id, cancelada);
        return fim('marcar_cancelada', rec.mensagem, 'cancelada');
      }
      return fim(rec.acao, rec.mensagem);
    });
  }

  /** Varredura: pedidos `pendente` parados há mais de `paradasHaMinutos` (padrão 2), um de cada vez; a falha de um não trava os outros. */
  async function processarPendentes(tenant_id: string, limite = 20, paradasHaMinutos = 2): Promise<{ tipo: 'evento' | 'inutilizacao'; id: string; resultado: string }[]> {
    const lista = await deps.banco.comTenant(tenant_id, (tx) => deps.eventos.pendentes(tx, limite, paradasHaMinutos, leaseMin));
    const saida: { tipo: 'evento' | 'inutilizacao'; id: string; resultado: string }[] = [];
    for (const x of lista) {
      try {
        const r = x.tipo === 'evento' ? await processarEvento(tenant_id, x.id) : await processarInutilizacao(tenant_id, x.id);
        saida.push({ ...x, resultado: r.resultado });
      } catch (e) {
        saida.push({ ...x, resultado: e instanceof Error ? e.name : 'ERRO' });
      }
    }
    return saida;
  }

  return { processarEvento, processarInutilizacao, consultarNota, processarPendentes };
}
