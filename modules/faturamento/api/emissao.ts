/**
 * Serviço de aplicação da emissão (RF-FAT-01, RF-FAT-08): orquestra as portas, sem SQL nem HTTP. Toda escrita acontece na
 * transação `tx` recebida (número, nota, XML, status e evento confirmam juntos). A SEFAZ é chamada FORA da transação que
 * reserva o número: `emitirNota` termina em `em_autorizacao`; `transmitir` + `processarRetorno` fecham o ciclo.
 */
import { normalizarDocumento, violacao, type Transacao, type Violacao } from '@macuxierp/platform-sdk';
import {
  NotaAutorizadaPayload,
  NotaRejeitadaPayload,
  type EmitirNotaEntrada,
  type StatusNota,
  type TipoEmissao,
} from '../contracts';
import {
  aammManaus,
  destinatarioDoRetrato,
  ErroViolacao,
  gerarCnf,
  gerarXmlNFe,
  instanteManaus,
  interpretarRetorno,
  montarChave,
  montarNota,
  ratearItens,
  validarTransicao,
  type DadosXml,
  type ItemCalculado,
  type NotaMontada,
  type PedidoFaturavel,
  type SituacaoPedido,
} from '../domain';
import type {
  AmbienteFiscalDaFilial,
  AssinadorA1,
  CalculoFiscal,
  ConsultaCadastrosFaturamento,
  ContextoSefaz,
  DadosMudancaStatus,
  FilialEmissora,
  NotaRegistro,
  PedidosAprovados,
  RepositorioNotas,
  RespostaSefaz,
  SefazTransporte,
  SituacaoPedidoParaFaturar,
} from './portas';

export const EVENTO_NOTA_AUTORIZADA = 'faturamento.nota.autorizada@1' as const;
export const EVENTO_NOTA_REJEITADA = 'faturamento.nota.rejeitada@1' as const;

/** Texto fiscal padrão até a configuração por filial existir (ver "Pendências" no README). */
const NAT_OP_PADRAO = 'VENDA DE MERCADORIA';
/** tPag 99 (outros) com xPag, combinado com a T-0015, enquanto a forma de pagamento vier nula (ver README). */
const TPAG_PADRAO = '99';
const XPAG_PADRAO = 'Conforme condição combinada';

export interface DepsEmissao {
  pedidos: PedidosAprovados;
  situacao: SituacaoPedidoParaFaturar;
  cadastros: ConsultaCadastrosFaturamento;
  calculo: CalculoFiscal;
  ambiente: AmbienteFiscalDaFilial;
  notas: RepositorioNotas;
  assinador: AssinadorA1;
  /** Porta pronta por tenant, filial e ambiente (RN-FAT-04: em homologação o destino é o simulador). */
  sefaz: (ctx: ContextoSefaz) => SefazTransporte;
  agora?: () => Date;
  /** Sorteio do cNF (injetável em teste). */
  sorteio?: () => number;
  verProc?: string;
  tpEmis?: TipoEmissao;
}

interface Preparado {
  ok: true;
  pedido: PedidoFaturavel;
  nota: NotaMontada;
  filial: FilialEmissora;
  destinatario: DadosXml['destinatario'];
}

export type ResultadoEmissao =
  | { ok: true; nota: NotaRegistro; /** Na repetição idempotente, o XML assinado já gravado (nada foi refeito). */ xmlAssinado: string | null; repetida: boolean }
  | { ok: false; violacoes: Violacao[] };

export type ResultadoRetorno =
  | { resultado: 'autorizada'; nota: NotaRegistro }
  /** XML autorizado NÃO guardado: sem evento, sem DANFE; reprocessar com `consultarProtocolo` (RN-FAT-03). */
  | { resultado: 'guarda_pendente'; nota: NotaRegistro }
  | { resultado: 'rejeitada'; nota: NotaRegistro; codigo: string; mensagem: string; acao: string }
  | { resultado: 'denegada'; nota: NotaRegistro; codigo: string; mensagem: string }
  /** Duplicidade (204/539): o chamador consulta o protocolo FORA da tx e chama `processarRetorno(tx, nota, consulta, true)`. */
  | { resultado: 'consultar_protocolo'; nota: NotaRegistro; codigo: string; mensagem: string }
  /** Duplicidade que a consulta de protocolo não resolveu: nada muda, nenhum evento. */
  | { resultado: 'duplicidade'; nota: NotaRegistro; codigo: string; mensagem: string }
  | { resultado: 'aguardando'; nota: NotaRegistro; codigo: string; mensagem: string }
  | { resultado: 'ja_processada'; nota: NotaRegistro };

// CNPJ alfanumérico (NT 2025.001): o `normalizarDocumento` do SDK mantém as letras.
const so = normalizarDocumento;

/** Itens solicitados iguais, sem importar a ordem; ausente (nota total do saldo) só é igual a ausente. */
function mesmosItens(a: NotaRegistro['itens_solicitados'] | undefined, b: EmitirNotaEntrada['itens'] | undefined): boolean {
  if (!a || !b) return !a && !b;
  const chave = (l: { sequencia: number; quantidade?: number }[]): string =>
    l.map((i) => `${i.sequencia}:${i.quantidade ?? ''}`).sort().join(',');
  return chave(a) === chave(b);
}

const itensRegistro = (nota: NotaMontada): NotaRegistro['itens'] =>
  nota.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantidade, valor_centavos: i.valor_produto_centavos - i.desconto_centavos }));

const comStatus = (n: NotaRegistro, status: StatusNota, extra: Partial<NotaRegistro> = {}): NotaRegistro => ({ ...n, ...extra, status });

export function criarServicoEmissao(deps: DepsEmissao) {
  const agora = deps.agora ?? ((): Date => new Date());
  const verProc = deps.verProc ?? 'macuxierp-faturamento';
  const tpEmis: TipoEmissao = deps.tpEmis ?? 1;

  async function mudar(tx: Transacao, nota: NotaRegistro, para: StatusNota, dados?: DadosMudancaStatus, extra: Partial<NotaRegistro> = {}): Promise<NotaRegistro> {
    const v = validarTransicao(nota.status, para);
    if (v.length > 0) throw new ErroViolacao(v);
    await deps.notas.mudarStatus(tx, nota.id, nota.status, para, dados);
    return comStatus(nota, para, extra);
  }

  /** Tudo que independe do número: situação com FOR SHARE, ambiente, cálculo fiscal, nota montada e destinatário. */
  async function preparar(
    tx: Transacao,
    pedido_id: string,
    itens: EmitirNotaEntrada['itens'],
    emitidaEm: Date,
  ): Promise<Preparado | { ok: false; violacoes: Violacao[] }> {
    const pedido = await deps.pedidos.obter(tx, pedido_id);
    if (!pedido) return { ok: false, violacoes: [violacao('RF-FAT-01', 'pedido_id', 'Pedido não está na fila de faturamento.')] };
    // FOR SHARE: o pedido não muda de status (nem é cancelado) enquanto esta transação reserva o número (RN-PED-02).
    const situacao: SituacaoPedido | null = await deps.situacao.situacao(tx, pedido_id);
    if (!situacao) return { ok: false, violacoes: [violacao('RF-FAT-01', 'pedido_id', 'Situação do pedido indisponível.')] };
    const filial = await deps.cadastros.filial(tx, pedido.filial_id);
    if (!filial?.emissora || filial.nfe_serie === null) {
      return { ok: false, violacoes: [violacao('RN-FAT-01', 'filial_id', 'Filial não é emissora de NF-e ou está sem série configurada.')] };
    }
    const ambiente = await deps.ambiente.ambiente(tx, pedido.filial_id);

    const base = ratearItens({ pedido, situacao, itens });
    if (!base.ok) return base;
    const calc = await deps.calculo.calcular(tx, {
      ambiente,
      filial_id: pedido.filial_id,
      pedido,
      data_emissao: instanteManaus(emitidaEm).toISOString().slice(0, 10),
      itens: base.itens.map((i) => ({
        sequencia: i.sequencia,
        produto_id: i.produto_id,
        ncm: i.ncm,
        quantidade: i.quantidade,
        preco_unitario_centavos: i.preco_unitario_centavos,
        valor_centavos: i.valor_produto_centavos,
        desconto_centavos: i.desconto_centavos,
        frete_centavos: i.frete_centavos,
        outras_centavos: i.outras_centavos,
      })),
    });
    if (!calc.ok) return { ok: false, violacoes: calc.erros.map((e) => violacao(e.rn, e.item_id ? `itens.${e.item_id}.calculo` : 'calculo', e.mensagem)) };
    const calculo: ItemCalculado[] = calc.saida.itens.map((r) => {
      const sequencia = Number(r.item_id);
      return { sequencia, cfop: calc.cfops[sequencia] ?? '', resultado: r };
    });
    const montada = montarNota({ pedido, situacao, itens, ambiente, calculo, v_nf_fiscal: calc.saida.totais.v_nf });
    if (!montada.ok) return montada;

    const cliente = await deps.cadastros.cliente(tx, pedido.cliente_id);
    const retrato = pedido.pedido.cliente_retrato;
    const enderecoCadastro = cliente?.endereco ?? null;
    const nomeMunicipio = enderecoCadastro ? null : await deps.cadastros.municipioNome(tx, retrato.endereco.municipio_ibge);
    // Endereço do cadastro; sem ele, o endereço principal do retrato (reserva).
    const dest = destinatarioDoRetrato(retrato, enderecoCadastro, nomeMunicipio);
    if (!dest.ok) return dest;
    return { ok: true, pedido, nota: montada.nota, filial, destinatario: dest.destinatario };
  }

  function montarDados(
    p: Preparado,
    fixo: { numero: number; cnf: string; emitida_em: Date },
  ): DadosXml {
    const serie = p.filial.nfe_serie as number;
    return {
      chave: montarChave({ aamm: aammManaus(fixo.emitida_em), cnpj: so(p.filial.cnpj), serie, numero: fixo.numero, tpEmis, cnf: fixo.cnf }),
      cnf: fixo.cnf,
      tpEmis,
      natOp: NAT_OP_PADRAO,
      serie,
      numero: fixo.numero,
      emitida_em: fixo.emitida_em,
      verProc,
      emitente: { cnpj: p.filial.cnpj, nome: p.filial.razao_social, fantasia: p.filial.nome_fantasia, ie: p.filial.ie, crt: p.filial.crt, endereco: p.filial.endereco },
      destinatario: p.destinatario,
      nota: p.nota,
      pagamentos: [{ tPag: TPAG_PADRAO, xPag: XPAG_PADRAO, valor_centavos: p.nota.totais.vNF }],
      infCpl: p.pedido.pedido.observacao,
    };
  }

  /** Gera o XML sem queimar número: a conferência roda com número provisório antes da reserva. */
  function conferir(p: Preparado, emitida_em: Date): Violacao[] {
    try {
      gerarXmlNFe(montarDados(p, { numero: 1, cnf: '12345678', emitida_em }));
      return [];
    } catch (e) {
      if (e instanceof ErroViolacao) return e.violacoes;
      throw e;
    }
  }

  const contexto = (n: NotaRegistro): ContextoSefaz => ({ tenant_id: n.tenant_id, filial_id: n.filial_id, ambiente: n.ambiente });
  const idAssinatura = (chave: string): string => `NFe${chave}`;

  /**
   * RF-FAT-01. Idempotente pela chave: repetir devolve a mesma nota sem reservar outro número (RN-CORE-05). Nasce em `rascunho` e
   * vai a `em_autorizacao` na mesma transação que reserva o número (RN-FAT-01). Violação devolve `ok: false` ANTES da reserva:
   * nenhum número é queimado.
   */
  async function emitirNota(tx: Transacao, tenant_id: string, entrada: EmitirNotaEntrada): Promise<ResultadoEmissao> {
    const existente = await deps.notas.buscarPorIdempotencia(tx, tenant_id, entrada.idempotencia);
    if (existente) {
      // RN-CORE-05: a mesma chave só repete o MESMO pedido e os MESMOS itens (o pedido_id sozinho não basta: há notas parciais).
      if (existente.pedido_id !== entrada.pedido_id || !mesmosItens(existente.itens_solicitados, entrada.itens)) {
        return { ok: false, violacoes: [violacao('RN-CORE-05', 'idempotencia', 'Chave de idempotência já usada com outro pedido ou outros itens.')] };
      }
      return { ok: true, nota: existente, xmlAssinado: await deps.notas.lerXml(tx, existente.id), repetida: true };
    }

    const emitida_em = agora();
    const p = await preparar(tx, entrada.pedido_id, entrada.itens, emitida_em);
    if (!p.ok) return p;
    const violacoes = conferir(p, emitida_em);
    if (violacoes.length > 0) return { ok: false, violacoes };

    const serie = p.filial.nfe_serie as number;
    const inicial = await deps.cadastros.numeroInicial(tx, p.filial.id, serie);
    if (inicial === null) return { ok: false, violacoes: [violacao('RN-FAT-01', 'filial_id', `Série ${serie} sem número inicial cadastrado.`)] };
    const numero = await deps.notas.reservarNumero(tx, tenant_id, p.filial.id, serie, inicial);

    const dados = montarDados(p, { numero, cnf: gerarCnf(numero, deps.sorteio), emitida_em });
    const xmlAssinado = await deps.assinador.assinar({ tenant_id, filial_id: p.filial.id, ambiente: p.nota.ambiente }, gerarXmlNFe(dados), idAssinatura(dados.chave));
    const rascunho = await deps.notas.gravarNota(tx, {
      tenant_id,
      pedido_id: p.nota.pedido_id,
      pedido_uuid: p.pedido.pedido_uuid,
      filial_id: p.nota.filial_id,
      cliente_id: p.nota.cliente_id,
      vendedor_id: p.nota.vendedor_id,
      ambiente: p.nota.ambiente,
      vai_ao_fdv: p.nota.vai_ao_fdv, // RN-FAT-04: falso em homologação
      serie,
      numero,
      cnf: dados.cnf,
      chave_acesso: dados.chave,
      tp_emis: tpEmis,
      emitida_em: emitida_em.toISOString(),
      total_centavos: p.nota.totais.vNF,
      idempotencia: entrada.idempotencia,
      itens_solicitados: entrada.itens ?? null,
      itens: itensRegistro(p.nota),
    });
    await deps.notas.guardarXml(tx, rascunho.id, { tipo: 'assinado', conteudo: xmlAssinado });
    const nota = await mudar(tx, rascunho, 'em_autorizacao');
    return { ok: true, nota, xmlAssinado, repetida: false };
  }

  /**
   * RN-FAT-07: reenvio da `rejeitada` com o MESMO série, número, cNF e chave (nada de reservar outro). O conteúdo é refeito
   * (o faturista pode ter corrigido cadastro) e reassinado; volta a `em_autorizacao`.
   */
  async function reenviarNota(tx: Transacao, nota: NotaRegistro): Promise<ResultadoEmissao> {
    const v = validarTransicao(nota.status, 'em_autorizacao');
    if (v.length > 0) return { ok: false, violacoes: v };
    if (nota.status !== 'rejeitada' && nota.status !== 'rascunho') {
      return { ok: false, violacoes: [violacao('RN-FAT-07', 'status', `Só a nota rejeitada ou em rascunho é reenviada (status "${nota.status}").`)] };
    }
    const emitida_em = new Date(nota.emitida_em);
    const p = await preparar(tx, nota.pedido_id, nota.itens_solicitados ?? undefined, emitida_em);
    if (!p.ok) return p;
    const dados = montarDados(p, { numero: nota.numero, cnf: nota.cnf, emitida_em });
    if (dados.chave !== nota.chave_acesso) {
      return { ok: false, violacoes: [violacao('RN-FAT-07', 'chave', 'O reenvio mudaria a chave de acesso (série, número ou data): reemita ou inutilize.')] };
    }
    const xmlAssinado = await deps.assinador.assinar(contexto(nota), gerarXmlNFe(dados), idAssinatura(dados.chave));
    // Total e itens refeitos entram na nota ANTES de transmitir: o evento autorizado leva o mesmo total do vNF do XML (RN-FAT-07).
    const itens = itensRegistro(p.nota);
    await deps.notas.atualizarConteudo(tx, nota.id, { total_centavos: p.nota.totais.vNF, itens, xml: xmlAssinado });
    const atualizada = await mudar(tx, nota, 'em_autorizacao', undefined, { total_centavos: p.nota.totais.vNF, itens });
    return { ok: true, nota: atualizada, xmlAssinado, repetida: false };
  }

  /** Envia o XML assinado e lê o resultado do recibo. Fora da transação de emissão (rede). O retorno entra em `processarRetorno`. */
  async function transmitir(nota: NotaRegistro, xmlAssinado: string): Promise<RespostaSefaz> {
    const sefaz = deps.sefaz(contexto(nota));
    const envio = await sefaz.autorizar({ xmlAssinado, tpEmis: nota.tp_emis });
    return sefaz.consultarRecibo({ nRec: envio.nRec });
  }

  const base = (n: NotaRegistro, protocolo: string | null): Record<string, unknown> => ({
    pedido_id: n.pedido_id,
    ambiente: n.ambiente,
    nota: {
      id: n.id,
      filial_id: n.filial_id,
      cliente_id: n.cliente_id,
      serie: n.serie,
      numero: n.numero,
      chave_acesso: n.chave_acesso,
      emitida_em: n.emitida_em,
      total_centavos: n.total_centavos,
      protocolo,
    },
    itens: n.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantidade, valor_centavos: i.valor_centavos })),
    vendedor_id: n.vendedor_id,
    quantidade_itens: n.itens.length,
  });

  /**
   * Resposta da SEFAZ (`consultarRecibo` ou `consultarProtocolo`) aplicada à nota.
   * - autorizada: `em_autorizacao` → `autorizada_guarda_pendente` → guarda o XML autorizado → `autorizada` → evento (RN-FAT-03).
   *   Se a guarda falhar, a nota fica em guarda pendente e NENHUM evento sai (reprocesse com `consultarProtocolo`).
   * - rejeitada: publica `nota.rejeitada@1`; a nota pode ser reenviada com o mesmo número (RN-FAT-07).
   * - duplicidade (204/539): nunca vira rejeição; devolve `consultar_protocolo` e o chamador (worker) consulta fora da tx e reinterpreta (`jaConsultou`).
   */
  async function processarRetorno(tx: Transacao, nota: NotaRegistro, resposta: RespostaSefaz, jaConsultou = false): Promise<ResultadoRetorno> {
    if (nota.status !== 'em_autorizacao' && nota.status !== 'autorizada_guarda_pendente') return { resultado: 'ja_processada', nota };
    const r = interpretarRetorno(resposta.cStat, resposta.xMotivo);

    if (r.situacao === 'duplicidade') {
      if (jaConsultou) return { resultado: 'duplicidade', nota, codigo: r.codigo, mensagem: r.mensagem };
      return { resultado: 'consultar_protocolo', nota, codigo: r.codigo, mensagem: r.mensagem };
    }

    if (r.situacao === 'autorizada') {
      const protocolo = resposta.nProt;
      let atual = nota;
      if (atual.status === 'em_autorizacao') {
        atual = await mudar(tx, atual, 'autorizada_guarda_pendente', { protocolo, cStat: r.codigo, xMotivo: r.mensagem }, { protocolo: protocolo ?? null });
      }
      if (!resposta.xml || !protocolo) return { resultado: 'guarda_pendente', nota: atual };
      try {
        await deps.notas.guardarXml(tx, atual.id, { tipo: 'autorizado', conteudo: resposta.xml, protocolo });
      } catch {
        return { resultado: 'guarda_pendente', nota: atual }; // sem evento (RN-FAT-03)
      }
      const autorizada = await mudar(tx, atual, 'autorizada');
      const payload = NotaAutorizadaPayload.parse({ ...base(autorizada, protocolo), pedido_uuid: autorizada.pedido_uuid });
      await deps.notas.publicarEvento(tx, { nome: EVENTO_NOTA_AUTORIZADA, agregado_id: autorizada.id, payload });
      return { resultado: 'autorizada', nota: autorizada };
    }

    if (r.situacao === 'denegada') {
      const negada = await mudar(tx, nota, 'denegada', { cStat: r.codigo, xMotivo: r.mensagem });
      return { resultado: 'denegada', nota: negada, codigo: r.codigo, mensagem: r.mensagem };
    }

    if (r.situacao === 'rejeitada') {
      if (nota.status !== 'em_autorizacao') return { resultado: 'ja_processada', nota };
      const rejeitada = await mudar(tx, nota, 'rejeitada', { cStat: r.codigo, xMotivo: r.mensagem });
      const payload = NotaRejeitadaPayload.parse({ ...base(rejeitada, null), codigo: r.codigo, mensagem: r.mensagem.slice(0, 1000), acao_sugerida: r.acao.slice(0, 500) });
      await deps.notas.publicarEvento(tx, { nome: EVENTO_NOTA_REJEITADA, agregado_id: rejeitada.id, payload });
      return { resultado: 'rejeitada', nota: rejeitada, codigo: r.codigo, mensagem: r.mensagem, acao: r.acao };
    }

    // processamento, indisponivel, lote_processado: nada muda; o worker consulta de novo (ou avalia a contingência, RN-FAT-05).
    return { resultado: 'aguardando', nota, codigo: r.codigo, mensagem: r.mensagem };
  }

  return { emitirNota, reenviarNota, transmitir, processarRetorno };
}

