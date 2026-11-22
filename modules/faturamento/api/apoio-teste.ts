/**
 * Apoio dos testes da api (não é exportado pelo pacote): repositório em memória que imita os gatilhos da 0013 (guardar o XML
 * autorizado leva a nota a `autorizada`), massa de pedido e cálculo no formato real dos contracts, e a porta `SefazTransporte`
 * real (`@macuxierp/nfe-sefaz`) com respostas no formato real e contagem de chamadas.
 */
import { abrirA1, criarEmissorNFe, type CertificadoA1EmMemoria, type EmissorNFe, type NotaParaEmissaoEntrada } from '@macuxierp/nfe-emissor';
import {
  escolherDestinoSefaz,
  type ProtocoloNFe,
  type RespostaAutorizacao,
  type RespostaConsultaProtocolo,
  type RespostaConsultaRecibo,
  type SefazTransporte,
} from '@macuxierp/nfe-sefaz';
import { CNPJ_EMITENTE_DE_TESTE, INSTANTE_DE_TESTE, VALIDADE_DE_TESTE, gerarA1DeTeste } from '@macuxierp/nfe-sefaz/teste';
import type { Transacao } from '@macuxierp/platform-sdk';
import { paginar } from '@macuxierp/platform-sdk';
import type { Ambiente, BaixaTituloResumo, StatusNota, TituloResumo } from '../contracts';
import { digestValueDoXml, emTransmissao, calcularTotais, interpretarRetorno, nfeVaiAoFdv, resumoDoItem, type ConteudoNota } from '../domain';
import { calc, IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import type { DepsEmissao } from './emissao';
import type { DepsEventos } from './eventos';
import type { A1DaFilial, EventoRegistro, InutilizacaoRegistro, NotaRegistro, RepositorioEventos, RepositorioNotas, RepositorioTitulos, ConfiguracaoFaturamento, TransmissaoDeEvento, TransmissaoRegistrada } from './portas';

export const tx = {} as Transacao;
export const TENANT = IDS.tenant;
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const NPROT = '113260000000001';
export const DIGVAL = 'ZGlnZXN0b2RhYXNzaW5hdHVyYQ==';

/** Repositório em memória: `log` guarda a ordem das escritas (a mesma tx). */
export function repoFake() {
  const notas = new Map<string, NotaRegistro>();
  const conteudos = new Map<string, ConteudoNota>();
  const xmls: { id: string; conteudo: string; protocolo: string }[] = [];
  const eventos: { nome: string; payload: Record<string, unknown>; agregado_id?: string }[] = [];
  const transmissoes: TransmissaoRegistrada[] = [];
  const assinados: { id: string; versao: number; xml: string; sha256: string }[] = [];
  const atualizadaEm = new Map<string, Date>();
  const motivos = new Map<string, string>();
  const dadosStatus: { para: StatusNota; dados: unknown }[] = [];
  const log: string[] = [];
  const estado = { proximo: 0, reservas: 0, falharGuarda: false, ambienteReserva: '' as string, travadas: new Set<string>(), relogio: new Date('2026-11-21T14:30:00Z'), agoraBanco: new Date('2026-11-21T15:30:00Z') };
  const repo: RepositorioNotas = {
    async travarIdempotencia() {
      log.push('trava');
    },
    async buscarPorIdempotencia(_t, _tenant, idem) {
      return [...notas.values()].find((n) => n.idempotencia === idem) ?? null;
    },
    async obter(_t, id) {
      const n = notas.get(id);
      return n ? { ...n } : null;
    },
    async lerConteudo(_t, id) {
      return conteudos.get(id) ?? null;
    },
    async reservarNumero(_t, _tenant, _filial, ambiente, _serie, inicial) {
      estado.reservas++;
      estado.ambienteReserva = ambiente;
      estado.proximo = estado.proximo === 0 ? inicial : estado.proximo + 1;
      log.push(`numero:${estado.proximo}`);
      return estado.proximo;
    },
    async gravarNota(_t, n, conteudo) {
      const nota: NotaRegistro = {
        ...n,
        id: uuid(notas.size + 1),
        status: 'rascunho',
        protocolo: null,
        autorizada_em: null,
        recibo: null,
        vai_ao_fdv: nfeVaiAoFdv(n.ambiente),
        revisao: 1,
        itens: conteudo.itens.map((i) => ({ ...resumoDoItem(i), produto_id: i.produto_id })),
      };
      notas.set(nota.id, nota);
      atualizadaEm.set(nota.id, estado.relogio);
      conteudos.set(nota.id, conteudo);
      log.push('gravar');
      return { ...nota };
    },
    async atualizarConteudo(_t, id, conteudo) {
      const n = notas.get(id) as NotaRegistro;
      if (n.status !== 'rejeitada' && n.status !== 'rascunho') throw new Error(`status ${n.status} não aceita novo conteúdo`);
      notas.set(id, {
        ...n,
        total_centavos: calcularTotais(conteudo.itens).vNF,
        recibo: null,
        revisao: n.revisao + 1,
        itens: conteudo.itens.map((i) => ({ ...resumoDoItem(i), produto_id: i.produto_id })),
      });
      atualizadaEm.set(id, estado.relogio);
      conteudos.set(id, conteudo);
      motivos.delete(id); // o reenvio limpa o motivo pendente (a transporte é regravada)
      log.push('conteudo');
    },
    async registrarMotivoEnvio(_t, id, motivo) {
      const n = notas.get(id) as NotaRegistro;
      if (n.status !== 'rascunho' && n.status !== 'rejeitada') return;
      motivos.set(id, motivo);
      atualizadaEm.set(id, estado.relogio);
      log.push('motivo');
    },
    async mudarStatus(_t, id, de, para, dados) {
      const n = notas.get(id) as NotaRegistro;
      if (para === 'autorizada') throw new Error('autorizada só por guardarXmlAutorizado (gatilho do banco)');
      if (n.status !== de) throw new Error(`status atual ${n.status}, esperado ${de}`);
      if (dados?.revisao !== undefined && n.revisao !== dados.revisao) throw new Error(`revisão atual ${n.revisao}, esperada ${dados.revisao}`);
      notas.set(id, { ...n, status: para, protocolo: dados?.protocolo ?? n.protocolo, recibo: dados?.recibo ?? n.recibo, autorizada_em: dados?.autorizadaEm ?? n.autorizada_em });
      atualizadaEm.set(id, estado.relogio);
      dadosStatus.push({ para, dados });
      log.push(`status:${para}`);
    },
    async registrarRecibo(_t, id, recibo) {
      const n = notas.get(id) as NotaRegistro;
      notas.set(id, { ...n, recibo });
      log.push('recibo');
    },
    async guardarXmlAutorizado(_t, id, xml) {
      if (estado.falharGuarda) throw new Error('falha de armazenamento');
      if (xmls.some((x) => x.id === id)) throw new Error('RN-FAT-03: o XML guardado é imutável');
      xmls.push({ id, ...xml });
      const n = notas.get(id) as NotaRegistro;
      if (n.status === 'autorizada_guarda_pendente') notas.set(id, { ...n, status: 'autorizada' }); // o gatilho do banco
      log.push('xml:autorizado');
    },
    async travarTransmissao(_t, id) {
      return !estado.travadas.has(id);
    },
    async gravarXmlAssinado(_t, id, xml, sha256) {
      // Regras da migração 0020: só com a nota em rascunho, rejeitada ou emitida_contingencia, e a chave da nota igual à do XML.
      const n = notas.get(id) as NotaRegistro;
      if (!['rascunho', 'rejeitada', 'emitida_contingencia'].includes(n.status)) throw new Error(`0020: nfe_assinada não entra com a nota em ${n.status}`);
      if (!xml.includes(`Id="NFe${n.chave_acesso}"`)) throw new Error('0020: a chave da nota difere da chave do XML');
      const versao = Math.max(0, ...assinados.filter((a) => a.id === id).map((a) => a.versao)) + 1;
      assinados.push({ id, versao, xml, sha256 });
      log.push(`xml:assinado:${versao}`);
      return versao;
    },
    async ultimoXmlAssinado(_t, id) {
      const a = assinados.filter((x) => x.id === id).sort((x, y) => y.versao - x.versao)[0];
      return a ? { versao: a.versao, xml: a.xml } : null;
    },
    async registrarTransmissao(_t, t) {
      transmissoes.push(t);
    },
    async publicarEvento(_t, e) {
      eventos.push({ nome: e.nome, payload: e.payload, agregado_id: e.agregado_id });
      log.push(`evento:${e.nome}`);
    },
    async listar(_t, f) {
      const linhas = [...notas.values()]
        .filter((n) => (!f.status || n.status === f.status) && (!f.pedido_id || n.pedido_id === f.pedido_id))
        .map((n) => ({ id: n.id, filial_id: n.filial_id, cliente_id: n.cliente_id, pedido_id: n.pedido_id, ambiente: n.ambiente, serie: n.serie, numero: n.numero, chave_acesso: n.chave_acesso, status: n.status, emitida_em: n.emitida_em, total_centavos: n.total_centavos, protocolo: n.protocolo, c_stat: null, x_motivo: null }));
      return paginar(linhas, f.limite);
    },
    async detalhar(_t, id) {
      const n = notas.get(id);
      return n
        ? { id: n.id, filial_id: n.filial_id, cliente_id: n.cliente_id, pedido_id: n.pedido_id, ambiente: n.ambiente, serie: n.serie, numero: n.numero, chave_acesso: n.chave_acesso, status: n.status, emitida_em: n.emitida_em, total_centavos: n.total_centavos, protocolo: n.protocolo, c_stat: null, x_motivo: null, natureza_operacao: 'VENDA DE MERCADORIA', tipo_emissao: n.tp_emis, recibo: n.recibo, itens: n.itens }
        : null;
    },
    async lerXmlAutorizado(_t, id) {
      const x = xmls.find((v) => v.id === id);
      const n = notas.get(id);
      return x && n ? { xml: x.conteudo, protocolo: x.protocolo, chave_acesso: n.chave_acesso } : null;
    },
    async listarRejeicoes(_t, f) {
      const linhas = [...notas.values()]
        .filter((n) => n.status === 'rejeitada')
        .map((n) => ({ id: n.id, filial_id: n.filial_id, pedido_id: n.pedido_id, serie: n.serie, numero: n.numero, codigo: '778', mensagem: 'Rejeicao: NCM inexistente', rejeitada_em: n.emitida_em, acao_sugerida: interpretarRetorno('778', '').acao }));
      return paginar(linhas, f.limite);
    },
    async pendentesDeTransmissao(_t, limite, paradasHaMinutos, esperaEnvioPendenteMin) {
      const parada = (id: string): number => estado.agoraBanco.getTime() - (atualizadaEm.get(id) as Date).getTime();
      const semAssinada = (id: string): boolean => !assinados.some((a) => a.id === id);
      return [...notas.values()]
        .filter((n) => (emTransmissao(n.status) && parada(n.id) > paradasHaMinutos * 60_000) || (n.status === 'rascunho' && semAssinada(n.id) && parada(n.id) > (motivos.has(n.id) ? esperaEnvioPendenteMin : paradasHaMinutos) * 60_000))
        .slice(0, limite)
        .map((n) => ({ id: n.id, status: n.status }));
    },
    async numeradasNaoEnviadas(_t, antesDe) {
      return [...notas.values()]
        .filter((n) => (n.status === 'rascunho' || n.status === 'rejeitada') && new Date(n.emitida_em).getTime() < antesDe.getTime())
        .map((n) => ({ id: n.id, filial_id: n.filial_id, ambiente: n.ambiente, serie: n.serie, numero: n.numero, status: n.status as 'rascunho' | 'rejeitada', emitida_em: n.emitida_em }));
    },
  };
  return { repo, notas, conteudos, motivos, xmls, assinados, eventos, transmissoes, dadosStatus, log, estado };
}

export type RepoFake = ReturnType<typeof repoFake>;

/**
 * Repositório de eventos em memória: imita os gatilhos da 0013 (evento só em nota autorizada, CC-e na sequência, um cancelamento; XML guardado
 * registra o evento e cancela a nota; faixa até proximo+99, sem sobreposição, só rascunho ou rejeitada; registrada inutiliza a faixa). Divide o
 * mapa de notas e o `log` com o `repoFake`, para conferir a ORDEM das escritas.
 */
export function eventosFake(r: RepoFake, relogio: () => Date = () => r.estado.relogio) {
  const eventos = new Map<string, EventoRegistro>();
  const inutilizacoes = new Map<string, InutilizacaoRegistro>();
  const xmls: { tipo: string; id: string; conteudo: string; protocolo: string }[] = [];
  const transmissoes: TransmissaoDeEvento[] = [];
  /** Leases de transmissão: `aberto` até o retorno ser gravado; `vencido` imita o relógio passando de `leaseMin`. */
  const leases = new Map<string, { chave: string; aberto: boolean; vencido: boolean; base: Omit<TransmissaoDeEvento, 'cStat' | 'xMotivo' | 'enviada_em' | 'respondida_em' | 'duracao_ms'> }>();
  const vencerLeases = (): void => {
    for (const l of leases.values()) l.vencido = true;
  };
  let n = 5000;
  const iso = (): string => relogio().toISOString();
  const proximo = (): number => (r.estado.proximo === 0 ? 100 : r.estado.proximo + 1);
  const repo: RepositorioEventos = {
    async listarEventos(_t, nota_id) {
      return [...eventos.values()].filter((e) => e.nota_id === nota_id).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.n_seq_evento - b.n_seq_evento).map((e) => ({ ...e }));
    },
    async obterEvento(_t, id) {
      const e = eventos.get(id);
      return e ? { ...e } : null;
    },
    async criarEvento(_t, e) {
      const nota = r.notas.get(e.nota_id);
      if (nota?.status !== 'autorizada') throw new Error(`RN-FAT-03: evento só em nota autorizada com o XML guardado (status ${nota?.status ?? 'inexistente'})`);
      const mesmos = [...eventos.values()].filter((x) => x.nota_id === e.nota_id && x.tipo === e.tipo);
      if (e.tipo === 'cancelamento' && mesmos.length > 0) throw new Error('duplicate key value violates unique constraint "nota_evento_seq_uq"');
      const prox = Math.max(0, ...mesmos.map((x) => x.n_seq_evento)) + 1;
      if (e.tipo === 'cce' && e.n_seq_evento !== prox) throw new Error(`RN-FAT-02: a CC-e desta nota é a sequência ${prox}`);
      if (e.tipo === 'cce' && e.n_seq_evento > 20) throw new Error('new row for relation "nota_evento" violates check constraint');
      const reg: EventoRegistro = { id: uuid(++n), ...e, status: 'pendente', protocolo: null, c_stat: null, x_motivo: null, registrado_em: null, criado_em: iso(), dh_evento: iso() };
      eventos.set(reg.id, reg);
      r.log.push(`evento:pendente:${e.tipo}`);
      return { ...reg };
    },
    async reabrirEvento(_t, id, texto) {
      const e = eventos.get(id) as EventoRegistro;
      if (e.status !== 'rejeitado') throw new Error('RN-FAT-02: só o evento rejeitado volta a pendente');
      const novo = { ...e, status: 'pendente' as const, texto, c_stat: null, x_motivo: null, dh_evento: iso() };
      eventos.set(id, novo);
      return { ...novo };
    },
    async rejeitarEvento(_t, id, x) {
      const e = eventos.get(id) as EventoRegistro;
      if (e.status !== 'pendente') throw new Error('RN-FAT-02: o evento não está pendente');
      eventos.set(id, { ...e, status: 'rejeitado', c_stat: Number(x.cStat), x_motivo: x.xMotivo });
      r.log.push('evento:rejeitado');
    },
    async guardarXmlEvento(_t, e, xml) {
      const atual = eventos.get(e.id) as EventoRegistro;
      if (atual.status !== 'pendente') throw new Error('RN-FAT-03: o XML do evento entra só no evento pendente do mesmo tipo');
      xmls.push({ tipo: `evento_${e.tipo}`, id: e.id, conteudo: xml.conteudo, protocolo: xml.protocolo });
      r.log.push(`xml:evento_${e.tipo}`);
      eventos.set(e.id, { ...atual, status: 'registrado', protocolo: xml.protocolo, registrado_em: xml.dhRegistro });
      if (e.tipo === 'cancelamento') {
        r.notas.set(e.nota_id, { ...(r.notas.get(e.nota_id) as NotaRegistro), status: 'cancelada' }); // o gatilho nota_evento_depois
        r.log.push('status:cancelada');
      }
    },
    async listarInutilizacoes() {
      return [...inutilizacoes.values()];
    },
    async obterInutilizacao(_t, id) {
      const i = inutilizacoes.get(id);
      return i ? { ...i } : null;
    },
    async criarInutilizacao(_t, i) {
      const prox = proximo();
      if (i.numero_inicial > prox) throw new Error(`RN-FAT-01: a inutilização começa no máximo no próximo número (${prox})`);
      if (i.numero_final > prox + 99) throw new Error(`RN-FAT-01: a inutilização vai no máximo até o número ${prox + 99} (100 a partir do próximo)`);
      if ([...inutilizacoes.values()].some((x) => x.filial_id === i.filial_id && x.serie === i.serie && x.status !== 'rejeitado' && x.numero_inicial <= i.numero_final && x.numero_final >= i.numero_inicial))
        throw new Error('RN-FAT-01: faixa já inutilizada (sobreposição)');
      if ([...r.notas.values()].some((x) => x.serie === i.serie && x.numero >= i.numero_inicial && x.numero <= i.numero_final && x.status !== 'rejeitada' && x.status !== 'rascunho'))
        throw new Error('RN-FAT-01: a faixa tem nota que não está rejeitada nem em rascunho');
      if (i.numero_final >= prox) r.estado.proximo = i.numero_final;
      const reg: InutilizacaoRegistro = { id: uuid(++n), ...i, status: 'pendente', protocolo: null, c_stat: null, x_motivo: null, registrado_em: null, criado_em: iso() };
      inutilizacoes.set(reg.id, reg);
      r.log.push('inutilizacao:pendente');
      return { ...reg };
    },
    async rejeitarInutilizacao(_t, id, x) {
      const i = inutilizacoes.get(id) as InutilizacaoRegistro;
      inutilizacoes.set(id, { ...i, status: 'rejeitado', c_stat: Number(x.cStat), x_motivo: x.xMotivo });
      r.log.push('inutilizacao:rejeitada');
    },
    async guardarXmlInutilizacao(_t, i, xml) {
      const atual = inutilizacoes.get(i.id) as InutilizacaoRegistro;
      if (atual.status !== 'pendente') throw new Error('RN-FAT-03: o XML da inutilização entra só na inutilização pendente');
      xmls.push({ tipo: 'inutilizacao', id: i.id, conteudo: xml.conteudo, protocolo: xml.protocolo });
      r.log.push('xml:inutilizacao');
      inutilizacoes.set(i.id, { ...atual, status: 'registrado', protocolo: xml.protocolo, registrado_em: xml.dhRegistro });
      for (const x of r.notas.values())
        if (x.serie === i.serie && x.numero >= i.numero_inicial && x.numero <= i.numero_final && (x.status === 'rascunho' || x.status === 'rejeitada')) r.notas.set(x.id, { ...x, status: 'inutilizada' });
    },
    async proximoNumero(_t, _f, _a, _s) {
      return proximo();
    },
    async notasNaFaixa(_t, _f, _a, serie, ini, fim) {
      return [...r.notas.values()].filter((x) => x.serie === serie && x.numero >= ini && x.numero <= fim).map((x) => ({ numero: x.numero, status: x.status }));
    },
    async registrarTransmissao(_t, t) {
      transmissoes.push(t);
    },
    async situacaoTransmissaoEvento(_t, evento_id) {
      const meus = [...leases.values()].filter((x) => x.chave === `evento:${evento_id}`);
      return { tentativas: meus.length + transmissoes.filter((x) => x.evento_id === evento_id && !meus.length).length, leaseAtivo: meus.some((x) => x.aberto && !x.vencido) };
    },
    async iniciarTransmissao(_t, l) {
      const chave = `${l.servico}:${l.evento_id ?? l.inutilizacao_id}`;
      const p = l.servico === 'evento' ? eventos.get(l.evento_id as string) : inutilizacoes.get(l.inutilizacao_id as string);
      if (p?.status !== 'pendente') return null;
      if ([...leases.values()].some((x) => x.chave === chave && x.aberto && !x.vencido)) return null;
      const id = uuid(++n);
      const { leaseMin: _m, ...base } = l;
      leases.set(id, { chave, aberto: true, vencido: false, base });
      return { id };
    },
    async concluirTransmissao(_t, id, x) {
      const l = leases.get(id);
      if (!l) return;
      l.aberto = false;
      transmissoes.push({ ...l.base, ...x, enviada_em: x.respondida_em });
    },
    async registrarDivergenciaInutilizacao(_t, id, x) {
      const i = inutilizacoes.get(id) as InutilizacaoRegistro;
      if (i.status !== 'pendente') throw new Error('RN-FAT-01: a inutilização não está pendente');
      inutilizacoes.set(id, { ...i, c_stat: Number(x.cStat), x_motivo: x.xMotivo });
      r.log.push('inutilizacao:divergente');
    },
    async pendentes() {
      const ativo = (chave: string): boolean => [...leases.values()].some((x) => x.chave === chave && x.aberto && !x.vencido);
      return [
        ...[...eventos.values()].filter((e) => e.status === 'pendente' && !ativo(`evento:${e.id}`)).map((e) => ({ tipo: 'evento' as const, id: e.id })),
        ...[...inutilizacoes.values()].filter((i) => i.status === 'pendente' && i.c_stat !== 563 && !ativo(`inutilizacao:${i.id}`)).map((i) => ({ tipo: 'inutilizacao' as const, id: i.id })),
      ];
    },
  };
  return { repo, eventos, inutilizacoes, xmls, transmissoes, vencerLeases };
}

/** CNPJ do A1 de teste: o emitente das notas dos testes (a SEFAZ confere o CNPJ do certificado com o do emitente). */
export const CNPJ_EMITENTE = CNPJ_EMITENTE_DE_TESTE;
/** IE do emitente com DV válido no AM. */
export const IE_EMITENTE = '041234561';

/**
 * A porta `EmissorNFe` REAL (`criarEmissorNFe` do `@macuxierp/nfe-emissor`) com espiões: guarda as entradas montadas e os XMLs assinados.
 * Um objeto por teste (o teste pode trocar `montar` sem vazar para os outros).
 */
export function emissorEspiao() {
  const real = criarEmissorNFe();
  const montagens: NotaParaEmissaoEntrada[] = [];
  const assinaturas: string[] = [];
  const emissor: EmissorNFe = {
    ...real,
    montar: (nota, opcoes) => {
      montagens.push(nota);
      return real.montar(nota, opcoes);
    },
    assinar: (xml, a1) => {
      const r = real.assinar(xml, a1);
      assinaturas.push(r.xml);
      return r;
    },
  };
  return { emissor, montagens, assinaturas };
}

let a1Gerado: ReturnType<typeof gerarA1DeTeste> | undefined;
let a1Aberto: CertificadoA1EmMemoria | undefined;
/**
 * A1 de teste gerado em tempo de execução (nada de certificado em arquivo), com o CNPJ só no SAN ICP-Brasil, como as ACs emitem.
 * A geração do par RSA é cara: gera uma vez e entrega uma CÓPIA do pfx a cada chamada (o transmissor zera o pfx ao fim).
 */
export function a1DeTeste(): A1DaFilial {
  a1Gerado ??= gerarA1DeTeste({ ...VALIDADE_DE_TESTE, cnpjNoTitular: 'san' });
  a1Aberto ??= abrirA1(a1Gerado.pfx, a1Gerado.senha, INSTANTE_DE_TESTE);
  return { certificado: a1Aberto, credencial: { pfx: Uint8Array.from(a1Gerado.pfx), senha: a1Gerado.senha } };
}

/** Abre o A1 de teste DEPOIS da validade: lança o `ErroCertificadoA1` real (`A1_FORA_DA_VALIDADE`), como o `lerA1` do worker faria com o A1 vencido. */
export function a1VencidoDeTeste(): never {
  a1DeTeste();
  const g = a1Gerado as ReturnType<typeof gerarA1DeTeste>;
  abrirA1(Uint8Array.from(g.pfx), g.senha, new Date('2099-01-01T00:00:00Z'));
  throw new Error('o A1 de teste não deveria abrir em 2099');
}

/** Dependências da emissão em memória: dois itens (R$ 20,00 e R$ 25,00), emitente em Manaus, boleto em duas parcelas. */
export function depsFake(opc: { ambiente?: Ambiente; status?: string; r?: RepoFake; semA1?: boolean } = {}) {
  const r = opc.r ?? repoFake();
  const pedido = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
  pedido.pedido.condicao_pagamento_id = uuid(77);
  const situacao = {
    status: (opc.status ?? 'aprovado') as 'aprovado',
    itens: [
      { sequencia: 1, quantidade: 20_000, quantidade_faturada: 0 },
      { sequencia: 2, quantidade: 10_000, quantidade_faturada: 0 },
    ],
  };
  const espiao = emissorEspiao();
  const ev = eventosFake(r);
  const deps: DepsEmissao & Pick<DepsEventos, 'eventos'> = {
    emissor: espiao.emissor,
    pedidos: { obter: async () => pedido, gravar: async () => 'novo' },
    situacao: { situacao: async () => situacao },
    cadastros: {
      filial: async () => ({
        id: IDS.filial,
        cnpj: CNPJ_EMITENTE,
        razao_social: 'EMITENTE LTDA',
        nome_fantasia: null,
        ie: IE_EMITENTE,
        crt: 3,
        endereco: { logradouro: 'Rua E', numero: '1', bairro: 'Centro', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69000-000' },
        emissora: true,
        nfe_serie: 1,
      }),
      cliente: async () => null,
      condicao: async () => ({ forma_tpag: '15', prazos_dias: [30, 60] }),
      numeroInicial: async () => 100,
    },
    calculo: {
      calcular: async (_t, e) => ({
        ok: true,
        cfops: Object.fromEntries(e.itens.map((i) => [i.sequencia, '5102'])),
        saida: {
          operacao: 'interna',
          itens: e.itens.map(
            (i) =>
              // Valores coerentes (o emissor confere vBC × alíquota = valor, tolerância de R$ 0,01).
              calc(i.sequencia, {
                icms: { orig: i.origem as '0', cst: '00', mod_bc: 3, v_bc: i.valor_centavos, p_icms: 200_000, v_icms: Math.round(i.valor_centavos * 0.2) },
                pis: { cst: '01', v_bc: i.valor_centavos, p_aliq: 16_500, v_valor: Math.round(i.valor_centavos * 0.0165) },
                cofins: { cst: '01', v_bc: i.valor_centavos, p_aliq: 76_000, v_valor: Math.round(i.valor_centavos * 0.076) },
              }).resultado,
          ),
          totais: { v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: e.itens.reduce((a, i) => a + i.valor_centavos - i.desconto_centavos + i.frete_centavos + i.outras_centavos, 0), v_cred_icms_sn: 0 },
        },
      }),
    },
    ambiente: { ambiente: async () => opc.ambiente ?? 'producao' },
    notas: r.repo,
    certificado: { temA1Ativo: async () => (opc.semA1 ? { valido: false, motivo: 'sem_certificado', mensagem: 'Filial sem certificado A1 ativo: cadastre o A1 antes de emitir.' } : { valido: true, valido_ate: '2027-11-21T00:00:00.000Z', dias_para_vencer: 365 }) },
    agora: () => INSTANTE_DE_TESTE,
    sorteio: () => 48_213_705,
    eventos: ev.repo,
  };
  return { deps, r, ev, pedido, emissor: espiao.emissor, recebidas: espiao.montagens, assinadas: espiao.assinaturas };
}

// ---- A porta real SefazTransporte, com respostas no formato real e contagem de chamadas ----

/** `DigestValue` da assinatura de cada NF-e que chegou ao transporte: a SEFAZ o devolve no `digVal` do protocolo. */
const DIGESTS = new Map<string, string>();

export const protocolo = (chNFe: string, extra: Partial<ProtocoloNFe> = {}): ProtocoloNFe => ({
  tpAmb: 2,
  verAplic: 'SIMULADOR',
  cStat: '100',
  xMotivo: 'Autorizado o uso da NF-e',
  chNFe,
  dhRecbto: '2026-11-21T10:31:02-04:00',
  nProt: NPROT,
  digVal: DIGESTS.get(chNFe) ?? DIGVAL,
  xml: `<protNFe versao="4.00"><infProt><chNFe>${chNFe}</chNFe><nProt>${NPROT}</nProt></infProt></protNFe>`,
  ...extra,
});

export interface Roteiro {
  /** Resultado de `consultarRecibo` e de `consultarProtocolo`: por padrão, autorizada. */
  recibo?: (chave: string) => ProtocoloNFe | null;
  autorizar?: (chave: string) => ProtocoloNFe | 'recibo' | { cStat: string; xMotivo: string };
  consulta?: (chave: string) => ProtocoloNFe | null;
}

/** Transporte com o contrato real: lê a chave do `infNFe Id` do XML enviado. Conta as chamadas em `chamadas`. */
export function transporteFake(roteiro: Roteiro = {}, filial = IDS.filial) {
  const chamadas: string[] = [];
  const base = { tpAmb: 2 as const, verAplic: 'SIMULADOR', cUF: 13 };
  const chaveDe = (xml: string): string => /Id="NFe(\w{44})"/.exec(xml)?.[1] ?? '0'.repeat(44);
  let ultimaChave = '0'.repeat(44);
  const t: SefazTransporte = {
    destino: escolherDestinoSefaz({ filial_id: filial, ambiente: 'homologacao', uf: 'AM' }, { transporte: 'simulador' }),
    async autorizar(p): Promise<RespostaAutorizacao> {
      chamadas.push('autorizar');
      ultimaChave = chaveDe(p.nfes[0] ?? '');
      DIGESTS.set(ultimaChave, digestValueDoXml(p.nfes[0] ?? '') ?? DIGVAL);
      const r = roteiro.autorizar?.(ultimaChave) ?? 'recibo';
      const comum = { ...base, dhRecbto: '2026-11-21T10:31:00-04:00', xml: '<retEnviNFe/>' };
      if (r === 'recibo') return { ...comum, cStat: '103', xMotivo: 'Lote recebido com sucesso', recibo: { nRec: '131000000000001', tMed: 1 }, protocolos: [] };
      if ((r as { chNFe?: string }).chNFe) return { ...comum, cStat: '104', xMotivo: 'Lote processado', recibo: null, protocolos: [r as ProtocoloNFe] };
      return { ...comum, cStat: r.cStat, xMotivo: r.xMotivo, recibo: null, protocolos: [] };
    },
    async consultarRecibo(): Promise<RespostaConsultaRecibo> {
      chamadas.push('consultarRecibo');
      const p = roteiro.recibo ? roteiro.recibo(ultimaChave) : protocolo(ultimaChave);
      const comum = { ...base, nRec: '131000000000001', dhRecbto: '2026-11-21T10:31:01-04:00', xml: '<retConsReciNFe/>' };
      return p ? { ...comum, cStat: '104', xMotivo: 'Lote processado', protocolos: [p] } : { ...comum, cStat: '105', xMotivo: 'Lote em processamento', protocolos: [] };
    },
    async consultarProtocolo(p): Promise<RespostaConsultaProtocolo> {
      chamadas.push('consultarProtocolo');
      const pr = roteiro.consulta ? roteiro.consulta(p.chNFe) : protocolo(p.chNFe);
      const comum = { ...base, chNFe: p.chNFe, dhRecbto: '2026-11-21T10:31:03-04:00', eventos: [], xml: '<retConsSitNFe/>' };
      return pr ? { ...comum, cStat: pr.cStat, xMotivo: pr.xMotivo, protocolo: pr } : { ...comum, cStat: '217', xMotivo: 'NF-e nao consta na base de dados da SEFAZ', protocolo: null };
    },
    async statusServico() {
      chamadas.push('statusServico');
      return { ...base, cStat: '107', xMotivo: 'Servico em operacao', dhRecbto: '2026-11-21T10:31:03-04:00', tMed: null, dhRetorno: null, xObs: null, xml: '<retConsStatServ/>' };
    },
    async cancelar() {
      throw new Error('fora do lote 1c');
    },
    async cartaCorrecao() {
      throw new Error('fora do lote 1c');
    },
    async inutilizar() {
      throw new Error('fora do lote 1c');
    },
  };
  return { transporte: t, chamadas };
}

/**
 * Títulos em memória (imita os gatilhos da 0013): parcela única por (nota, parcela), saldo = valor − baixas não estornadas, status pelo saldo,
 * baixa só em título aberto, cancelamento só do aberto.
 */
/** `notasBoleto`: ids das notas autorizadas de boleto (o banco real consulta `nota`); a varredura devolve as que não têm título. */
export function titulosFake(notasBoleto: () => Iterable<string> = () => [], notaComoReal: (nota_id: string) => boolean = () => false) {
  const titulos = new Map<string, TituloResumo>();
  const baixas = new Map<string, BaixaTituloResumo>();
  let n = 0;
  const recalcular = (t: TituloResumo): TituloResumo => {
    const saldo = t.valor_centavos - [...baixas.values()].filter((b) => b.titulo_id === t.id && b.estornada_em === null).reduce((a, b) => a + b.valor_centavos, 0);
    const novo: TituloResumo = { ...t, saldo_centavos: saldo, status: t.status === 'cancelado' ? 'cancelado' : saldo === 0 ? 'baixado' : 'aberto' };
    titulos.set(t.id, novo);
    return novo;
  };
  const repo: RepositorioTitulos = {
    async inserirParcelas(_t, nota, parcelas) {
      const novos: TituloResumo[] = [];
      for (const p of parcelas) {
        if ([...titulos.values()].some((t) => t.nota_id === nota.id && t.parcela === p.parcela)) continue;
        const t: TituloResumo = { id: uuid(9000 + ++n), nota_id: nota.id, numero: 100, filial_id: nota.filial_id, cliente_id: nota.cliente_id, cliente_razao_social: 'CLIENTE TESTE', ambiente: p.ambiente, parcela: p.parcela, total_parcelas: p.total_parcelas, vencimento: p.vencimento, valor_centavos: p.valor_centavos, saldo_centavos: p.valor_centavos, status: 'aberto' };
        titulos.set(t.id, t);
        novos.push(t);
      }
      return novos;
    },
    async listarDaNota(_t, nota_id) { return [...titulos.values()].filter((t) => t.nota_id === nota_id).sort((a, b) => a.parcela - b.parcela); },
    async obter(_t, id) { return titulos.get(id) ?? null; },
    async baixasDoTitulo(_t, id) { return [...baixas.values()].filter((b) => b.titulo_id === id); },
    async registrarBaixa(_t, titulo_id, b) {
      const t = titulos.get(titulo_id);
      if (!t || t.status !== 'aberto') throw new Error('RN-FAT-06: baixa só em título aberto');
      const baixa: BaixaTituloResumo = { id: uuid(9500 + ++n), titulo_id, valor_centavos: b.valor_centavos, forma: b.forma, baixado_em: b.baixado_em.toISOString(), estornada_em: null };
      baixas.set(baixa.id, baixa);
      recalcular(t);
      return baixa;
    },
    async estornarBaixa(_t, baixa_id, em) {
      const b = baixas.get(baixa_id);
      if (!b || b.estornada_em) throw new Error('RN-FAT-06: baixa inexistente ou já estornada');
      baixas.set(baixa_id, { ...b, estornada_em: em.toISOString() });
      recalcular(titulos.get(b.titulo_id) as TituloResumo);
    },
    async emSavepoint(_t, fn) {
      try { return { ok: true, valor: await fn() }; } catch (erro) { return { ok: false, erro }; }
    },
    async notasBoletoSemTitulo(_t, { limite }) {
      const com = new Set([...titulos.values()].map((t) => t.nota_id));
      return [...notasBoleto()].filter((id) => !com.has(id)).slice(0, limite);
    },
    async cancelar(_t, ids) { for (const id of ids) { const t = titulos.get(id); if (t?.status === 'aberto') titulos.set(id, { ...t, status: 'cancelado' }); } },
    async listar(_t, f) {
      const l = [...titulos.values()].filter((t) => (!f.cliente_id || t.cliente_id === f.cliente_id) && (!f.status || t.status === f.status) && (!f.vencimento_de || t.vencimento >= f.vencimento_de) && (!f.vencimento_ate || t.vencimento <= f.vencimento_ate)).sort((a, b) => a.id.localeCompare(b.id));
      return paginar(l, f.limite);
    },
    async detalhar(_t, id) { const t = titulos.get(id); return t ? { ...t, baixas: [...baixas.values()].filter((b) => b.titulo_id === id) } : null; },
    async saldoAbertoCliente(_t, cliente_id) { return [...titulos.values()].filter((t) => t.cliente_id === cliente_id && t.status === 'aberto' && (t.ambiente === 'producao' || notaComoReal(t.nota_id))).reduce((a, t) => a + t.saldo_centavos, 0); },
  };
  return { repo, titulos, baixas };
}

/** Bandeira "faturamento real com NF-e simulada" em memória: sem linha = desligada. */
export function configuracaoFake(inicial: Record<string, boolean> = {}) {
  const linhas = new Map<string, { ligada: boolean; alterado_por: string }>(Object.entries(inicial).map(([k, v]) => [k, { ligada: v, alterado_por: 'teste' }]));
  const repo: ConfiguracaoFaturamento = {
    async faturamentoRealComNfeSimulada(_t, filial_id) { return linhas.get(filial_id)?.ligada ?? false; },
    async definir(_t, filial_id, ligada, usuario_id) { linhas.set(filial_id, { ligada, alterado_por: usuario_id }); },
    async lerBandeiraSegura(_t, filial_id, avisar) {
      try { return await repo.faturamentoRealComNfeSimulada(_t, filial_id); } catch { avisar('falha ao ler a bandeira (fake)'); return false; }
    },
  };
  return { repo, linhas };
}
