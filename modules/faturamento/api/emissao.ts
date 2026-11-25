/**
 * Serviço de aplicação da emissão (RF-FAT-01, RF-FAT-08), FASE DA API: orquestra as portas, sem SQL nem HTTP. Toda escrita acontece na
 * transação `tx` recebida (número, nota, itens e conteúdo confirmam juntos). A API NÃO fala com a SEFAZ, NÃO lê o A1 decifrado (o
 * `macuxierp_app` não tem SELECT nas colunas cifradas, ADR 0005 item 4, RN-CORE-06) e NÃO assina: confere só que a filial tem A1 ATIVO
 * (`temA1Ativo`, metadados) e deixa a nota em `rascunho`, com conteúdo, chave, cNF e dhEmi gravados. O worker (`transmissor.ts`) remonta,
 * assina, guarda a `nfe_assinada` e leva a `em_autorizacao` na mesma transação (a migração 0020 só aceita a `nfe_assinada` em rascunho,
 * rejeitada ou emitida_contingencia). O reenvio da rejeitada refaz o conteúdo e mantém o status; o worker reassina (versão = max+1).
 */
import { ErroMontagemNFe, type EmissorNFe, type NotaParaEmissaoEntrada } from '@macuxierp/nfe-emissor';
import { montarNfeProc } from '@macuxierp/nfe-sefaz';
import { EPEC_DA_UF } from '@macuxierp/nfe-sefaz/contingencia';
import { violacao, type Transacao, type Violacao } from '@macuxierp/platform-sdk';
import { baseEventoDaNota } from './eventos';
import {
  NotaAutorizadaPayload,
  NotaRejeitadaPayload,
  type EmitirNotaEntrada,
  type StatusNota,
  type TipoEmissao,
} from '../contracts';
import {
  cfopDoItem,
  destinatarioDoRetrato,
  emTransmissao,
  ErroViolacao,
  dataCivilManaus,
  interpretarRetorno,
  modFreteDoPedido,
  montarNota,
  montarPagamento,
  contaComoReal,
  aplicarContingenciaAoConteudo,
  EPEC_LIGADA,
  MENSAGEM_EPEC_DESLIGADA,
  modalidadeDaUf,
  TP_EMIS_DA_MODALIDADE,
  type ContingenciaDaNota,
  validarTitulosDoBoleto,
  notaParaEmissaoDe,
  filaAceitaNota,
  podeEditar,
  ratearItens,
  resumoDoItem,
  validarTransicao,
  type ConteudoNota,
  type DestinatarioNota,
  type IdentidadeNota,
  type ItemCalculado,
  type NotaMontada,
  type PedidoFaturavel,
  type SituacaoPedido,
} from '../domain';
import type {
  AmbienteFiscalDaFilial,
  CalculoFiscal,
  ConsultaA1Ativo,
  ConsultaCadastrosFaturamento,
  DadosMudancaStatus,
  FilialEmissora,
  NotaRegistro,
  PedidosAprovados,
  RepositorioContingencia,
  RepositorioNotas,
  ConfiguracaoFaturamento,
  RepositorioTitulos,
  RetornoSefaz,
  SituacaoPedidoDoPedido,
} from './portas';
import { contaComoRealDaNota, gerarTitulosSeguro, type LogFaturamento } from './titulos';

export const EVENTO_NOTA_AUTORIZADA = 'faturamento.nota.autorizada@1' as const;
/** RN-FAT-07/08: EPEC registrada (evento 110140, cStat 136), NF-e ainda não autorizada. */
export const EVENTO_NOTA_EMITIDA_CONTINGENCIA = 'faturamento.nota.emitida_contingencia@1' as const;
export const EVENTO_NOTA_REJEITADA = 'faturamento.nota.rejeitada@1' as const;

/** Texto fiscal padrão até a configuração por filial existir (ver "Pendências" no README). */
const NAT_OP_PADRAO = 'VENDA DE MERCADORIA';

/** Dependências da FASE DA API: sem `lerA1` e sem assinatura (o tipo impede ligar o A1 decifrado na API). */
export interface DepsEmissao {
  /** Porta `EmissorNFe` (`criarEmissorNFe`), SÓ o `montar`: a API confere o documento com número provisório e grava a chave e o cNF; o worker assina. */
  emissor: Pick<EmissorNFe, 'montar'>;
  pedidos: PedidosAprovados;
  situacao: SituacaoPedidoDoPedido;
  cadastros: ConsultaCadastrosFaturamento;
  calculo: CalculoFiscal;
  ambiente: AmbienteFiscalDaFilial;
  notas: RepositorioNotas;
  /** A filial tem A1 ATIVO e dentro da validade? Só metadados do core (sem decifrar). Sem A1: violação ANTES da reserva do número. */
  certificado: ConsultaA1Ativo;
  agora?: () => Date;
  /** Sorteio do cNF (inteiro em [0, 100000000), injetável em teste); sem ele, o emissor sorteia. */
  sorteio?: () => number;
  tpEmis?: TipoEmissao;
  /**
   * RN-FAT-05/08 (ADR 0011): contingência por filial e ambiente. Havendo uma ABERTA svc_an/svc_rs no ambiente da filial, a nota nasce com tpEmis 6/7, `dhCont` (início, UTC) e `xJust` (motivo),
   * na mesma série e sequência. Sem a porta, ou sem contingência aberta, a emissão é a de sempre. Aberta `epec`: tpEmis 4 (o worker envia o evento 110140 em vez da NF-e; RN-FAT-08).
   */
  contingencia?: Pick<RepositorioContingencia, 'aberta'>;
  /** Bandeira "faturamento real com NF-e simulada": lida na EMISSÃO e guardada no conteúdo da nota (`conta_como_real`); ausente = desligada. */
  configuracao?: ConfiguracaoFaturamento;
  /** Log sem dado pessoal, OBRIGATÓRIO (falha ao ler a bandeira; pendência de título). */
  log: LogFaturamento;
  /**
   * RN-FAT-04: emissão em PRODUÇÃO fiscal só com esta flag ligada; padrão `false`. O engenheiro liga `false` até a T-0046 (transporte real homologado):
   * sem transporte real a nota de produção ficaria numerada e parada. Recusa ANTES de reservar o número (a série não anda).
   */
  emissaoProducaoHabilitada?: boolean;
  /** EPEC ligada (padrão `EPEC_LIGADA`, false na v0.3.0). Com `epec` aberta e a bandeira desligada a emissão recusa (RN-FAT-05) antes de reservar o número. */
  epecLigada?: boolean;
  /**
   * RN-FAT-10: existe transporte capaz de enviar a nota SVC (tpEmis 6/7) neste ambiente? Padrão (porta não injetada) = SEMPRE `false`: sem transporte a nota SVC ficaria numerada e parada
   * (ex.: o simulador do worker recusa modo diferente de `normal`). Checada ANTES de reservar o número (emissão) e ao abrir a contingência (rota). O engenheiro liga a porta real em `apps/api/src/modulos.ts`.
   */
  svcDisponivel?: PortaSvcDisponivel;
}

/** `modo` é o da modalidade aberta: `svc_an` -> 'svc-an', `svc_rs` -> 'svc-rs'. */
export type PortaSvcDisponivel = (e: { filialId: string; ambiente: 'homologacao' | 'producao'; uf: string; modo: 'svc-an' | 'svc-rs' }) => boolean | Promise<boolean>;
export const MENSAGEM_SVC_INDISPONIVEL = 'A contingência SVC não está disponível neste ambiente.';

interface Preparado {
  ok: true;
  pedido: PedidoFaturavel;
  nota: NotaMontada;
  filial: FilialEmissora;
  destinatario: DestinatarioNota;
  /** Da condição de pagamento do pedido (nulos = sem condição: tPag 99). */
  forma_tpag: string | null;
  prazos_dias: number[] | null;
  /** RN-FAT-04: bandeira da filial E homologação, calculada agora e guardada no conteúdo. */
  conta_como_real: boolean;
  /** tpEmis da nota: o da contingência aberta (6/7), o da própria nota no reenvio ou o padrão. */
  tpEmis: TipoEmissao;
  /** Contingência SVC aberta na emissão nova (vira dhCont e xJust no conteúdo). */
  contingenciaAberta: ContingenciaDaNota | null;
  /** Reenvio: a contingência já gravada no conteúdo da nota (tpEmis, dhCont e xJust não mudam; a chave os leva). */
  contingenciaDaNota: ConteudoNota['contingencia'];
}

export type ResultadoEmissao = { ok: true; nota: NotaRegistro; repetida: boolean } | { ok: false; violacoes: Violacao[] };

/** Como o retorno ficou aplicado; o worker decide o que fazer em seguida (consultar protocolo, reagendar, nada). */
export type ResultadoRetorno =
  /** `titulos_pendentes`: motivo (sem dado pessoal) de a geração dos títulos ter falhado; a nota está autorizada e a varredura gera depois. */
  | { resultado: 'autorizada'; nota: NotaRegistro; titulos_pendentes?: string }
  /** XML autorizado NÃO guardado: sem evento, sem DANFE; reprocessar com `consultarProtocolo` (RN-FAT-03). */
  | { resultado: 'guarda_pendente'; nota: NotaRegistro; motivo: 'sem_xml' | 'sem_digest' | 'falha_na_guarda' | 'digest_diferente' }
  | { resultado: 'rejeitada'; nota: NotaRegistro; codigo: string; mensagem: string; acao: string }
  | { resultado: 'denegada'; nota: NotaRegistro; codigo: string; mensagem: string }
  /** Duplicidade (204/539): o chamador consulta o protocolo FORA da tx e chama `processarRetorno(tx, nota, consulta, { jaConsultou: true })`. */
  | { resultado: 'consultar_protocolo'; nota: NotaRegistro; codigo: string; mensagem: string }
  /** Duplicidade que a consulta de protocolo não resolveu: nada muda, nenhum evento. */
  | { resultado: 'duplicidade'; nota: NotaRegistro; codigo: string; mensagem: string }
  | { resultado: 'aguardando'; nota: NotaRegistro; codigo: string; mensagem: string }
  | { resultado: 'ja_processada'; nota: NotaRegistro };

export interface OpcoesRetorno {
  /** A resposta já é a da consulta de protocolo disparada por uma duplicidade. */
  jaConsultou?: boolean;
  /** NF-e assinada que foi enviada (a `nfe_assinada` guardada): forma o `nfeProc` guardado junto do `<protNFe>`. */
  xmlAssinado?: string | null;
  /** `DigestValue` da assinatura: tem de ser o `digVal` do protocolo, senão o XML guardado não é o autorizado. Sem ele (ou sem `digVal`), nada é guardado. */
  digestValue?: string | null;
}

/** Itens solicitados iguais, sem importar a ordem; ausente (nota total do saldo) só é igual a ausente. */
function mesmosItens(a: NotaRegistro['itens_solicitados'] | undefined, b: EmitirNotaEntrada['itens'] | undefined): boolean {
  if (!a || !b) return !a && !b;
  const chave = (l: { sequencia: number; quantidade?: number }[]): string =>
    l.map((i) => `${i.sequencia}:${i.quantidade ?? ''}`).sort().join(',');
  return chave(a) === chave(b);
}

const comStatus = (n: NotaRegistro, status: StatusNota, extra: Partial<NotaRegistro> = {}): NotaRegistro => ({ ...n, ...extra, status });

/** Os campos de `IdentidadeNota` que a nota fixa na reserva do número: `NotaRegistro` e `NotaMontada` os trazem com estes nomes. */
type BaseIdentidade = Pick<IdentidadeNota, 'serie' | 'tpEmis' | 'ambiente' | 'pedido_id' | 'filial_id' | 'cliente_id' | 'vendedor_id'>;
const identidadeNota = (base: BaseIdentidade, fixo: Pick<IdentidadeNota, 'numero' | 'cnf' | 'emitida_em'>): IdentidadeNota => ({
  serie: base.serie,
  tpEmis: base.tpEmis,
  ambiente: base.ambiente,
  pedido_id: base.pedido_id,
  filial_id: base.filial_id,
  cliente_id: base.cliente_id,
  vendedor_id: base.vendedor_id,
  numero: fixo.numero,
  cnf: fixo.cnf,
  emitida_em: fixo.emitida_em,
});
const identidadeDe = (n: NotaRegistro): IdentidadeNota =>
  identidadeNota({ ...n, tpEmis: n.tp_emis }, { numero: n.numero, cnf: n.cnf, emitida_em: new Date(n.emitida_em) });

/**
 * XML (sem assinatura) montado pelo emissor do conteúdo gravado (RN-FAT-02). É o que o WORKER assina (com o A1 decifrado) na primeira transmissão e no reenvio da
 * rejeitada; retries com a nota em `em_autorizacao` reutilizam o assinado guardado. Série, número, dhEmi e cNF não mudam: a chave e o cNF que o emissor devolve
 * têm de ser os da nota.
 */
export function xmlDaNota(emissor: Pick<EmissorNFe, 'montar'>, nota: NotaRegistro, conteudo: ConteudoNota): string {
  const e = notaParaEmissaoDe(identidadeDe(nota), conteudo);
  if (!e.ok) throw new ErroViolacao(e.violacoes);
  const r = emissor.montar(e.nota);
  const divergencia = conferirIdentidade(r, nota);
  if (divergencia) throw new Error(`RN-FAT-07: ${divergencia.mensagem}`);
  return r.xml;
}

/** RN-FAT-07: a remontagem tem de dar a chave e o cNF gravados na nota; `null` = confere. Usada pelo reenvio (API) e pela remontagem do worker. */
export function conferirIdentidade(montada: { chave: string; cNF: string }, nota: Pick<NotaRegistro, 'chave_acesso' | 'cnf'>): { campo: 'chave' | 'cNF'; mensagem: string } | null {
  if (montada.chave !== nota.chave_acesso) return { campo: 'chave', mensagem: 'a chave refeita difere da chave da nota (série, número ou data mudariam): reemita ou inutilize' };
  if (montada.cNF !== nota.cnf) return { campo: 'cNF', mensagem: 'o cNF refeito difere do cNF da nota' };
  return null;
}

export async function mudarNota(notas: RepositorioNotas, tx: Transacao, nota: NotaRegistro, para: StatusNota, dados?: DadosMudancaStatus, extra: Partial<NotaRegistro> = {}): Promise<NotaRegistro> {
  const v = validarTransicao(nota.status, para);
  if (v.length > 0) throw new ErroViolacao(v);
  await notas.mudarStatus(tx, nota.id, nota.status, para, dados);
  return comStatus(nota, para, extra);
}

export function criarServicoEmissao(deps: DepsEmissao) {
  const agora = deps.agora ?? ((): Date => new Date());
  const tpEmisPadrao: TipoEmissao = deps.tpEmis ?? 1;

  /** Tudo que independe do número: situação com FOR SHARE, ambiente, cálculo fiscal, nota montada, destinatário e pagamento. */
  async function preparar(
    tx: Transacao,
    pedido_id: string,
    itens: EmitirNotaEntrada['itens'],
    emitidaEm: Date,
    exceto_nota_id?: string,
    daNota?: { tpEmis: TipoEmissao; contingencia: ConteudoNota['contingencia'] },
  ): Promise<Preparado | { ok: false; violacoes: Violacao[] }> {
    const pedido = await deps.pedidos.obter(tx, pedido_id);
    if (!pedido) return { ok: false, violacoes: [violacao('RF-FAT-01', 'pedido_id', 'Pedido não está na fila de faturamento.')] };
    // Trava a fila do pedido: duas emissões do mesmo pedido não leem o saldo juntas (RN-FAT-01).
    await deps.notas.travarPedido(tx, pedido_id);
    // Saldo pelo próprio faturamento: a quantidade_faturada do pedido só anda quando o worker consome o evento.
    const ja_faturadas = await deps.notas.quantidadesJaFaturadas(tx, pedido_id, exceto_nota_id);
    // FOR SHARE: o pedido não muda de status (nem é cancelado) enquanto esta transação reserva o número (RN-PED-02).
    const situacao: SituacaoPedido | null = await deps.situacao.situacao(tx, pedido_id);
    if (!situacao) return { ok: false, violacoes: [violacao('RF-FAT-01', 'pedido_id', 'Situação do pedido indisponível.')] };
    const filial = await deps.cadastros.filial(tx, pedido.filial_id);
    if (!filial?.emissora || filial.nfe_serie === null) {
      return { ok: false, violacoes: [violacao('RN-FAT-01', 'filial_id', 'Filial não é emissora de NF-e ou está sem série configurada.')] };
    }
    if (!filial.ie.trim()) return { ok: false, violacoes: [violacao('RF-FAT-01', 'filial_id', 'Cadastre a inscrição estadual da filial emissora.')] };
    const ambiente = await deps.ambiente.ambiente(tx, pedido.filial_id);
    if (ambiente === 'producao' && !deps.emissaoProducaoHabilitada) {
      return { ok: false, violacoes: [violacao('RN-FAT-04', 'filial_id', 'Emissão em produção ainda não habilitada (homologação real pendente, T-0046).')] };
    }
    // RN-CAD-10: pedido zerado no /config (linha `cancelado`) não é faturado, mesmo que o pedido ainda conste aprovado.
    const statusFila = await deps.pedidos.statusNaFila(tx, pedido_id);
    if (statusFila && !filaAceitaNota(statusFila)) {
      return { ok: false, violacoes: [violacao('RN-CAD-10', 'pedido_id', 'Pedido cancelado ou zerado na fila de faturamento não pode ser faturado.')] };
    }

    const base = ratearItens({ pedido, situacao, itens, ja_faturadas });
    if (!base.ok) return base;
    const calc = await deps.calculo.calcular(tx, {
      ambiente,
      filial_id: pedido.filial_id,
      pedido,
      data_emissao: dataCivilManaus(emitidaEm),
      itens: base.itens.map((i) => ({
        sequencia: i.sequencia,
        produto_id: i.produto_id,
        ncm: i.ncm,
        origem: i.origem,
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
      return { sequencia, cfop: cfopDoItem(r, calc.cfops[sequencia]), resultado: r };
    });
    const montada = montarNota({ pedido, situacao, ja_faturadas, itens, ambiente, calculo, v_nf_fiscal: calc.saida.totais.v_nf });
    if (!montada.ok) return montada;

    const cliente = await deps.cadastros.cliente(tx, pedido.cliente_id);
    // Endereço do cadastro; sem ele, o endereço principal do retrato (reserva), com o `municipio_nome` do próprio retrato.
    const dest = destinatarioDoRetrato(pedido.pedido.cliente_retrato, cliente?.endereco ?? null);
    if (!dest.ok) return dest;

    let prazos: number[] | null = null;
    let forma = pedido.pedido.forma_tpag;
    if (pedido.pedido.condicao_pagamento_id) {
      const condicao = await deps.cadastros.condicao(tx, pedido.pedido.condicao_pagamento_id);
      if (!condicao) return { ok: false, violacoes: [violacao('RF-FAT-01', 'condicao_pagamento_id', 'Condição de pagamento do pedido não encontrada.')] };
      prazos = condicao.prazos_dias;
      forma = forma ?? condicao.forma_tpag;
    }
    // RN-FAT-05/08: contingência SVC aberta da filial no ambiente vigente (só na emissão nova; o reenvio mantém o tpEmis, o dhCont e o xJust da nota, que estão na chave).
    let contingenciaAberta: ContingenciaDaNota | null = null;
    if (!daNota && deps.contingencia) {
      const aberta = await deps.contingencia.aberta(tx, pedido.filial_id, ambiente);
      if (aberta) {
        // A SVC é a da UF da filial (SVC_DA_UF do pacote): outra, o seletor recusaria depois de o número ser reservado. A EPEC (tpEmis 4) vale para a UF com EPEC no ERP (EPEC_DA_UF).
        const daUf = aberta.modalidade === 'epec' ? (EPEC_DA_UF[filial.endereco.uf as keyof typeof EPEC_DA_UF] ? 'epec' : null) : modalidadeDaUf(filial.endereco.uf);
        if (aberta.modalidade === 'epec' && !(deps.epecLigada ?? EPEC_LIGADA)) {
          return { ok: false, violacoes: [violacao('RN-FAT-05', 'contingencia', MENSAGEM_EPEC_DESLIGADA)] };
        }
        if (aberta.modalidade !== 'epec' && !(await (deps.svcDisponivel?.({ filialId: pedido.filial_id, ambiente, uf: filial.endereco.uf, modo: aberta.modalidade === 'svc_an' ? 'svc-an' : 'svc-rs' }) ?? false))) {
          return { ok: false, violacoes: [violacao('RN-FAT-10', 'contingencia', MENSAGEM_SVC_INDISPONIVEL)] };
        }
        if (daUf !== aberta.modalidade) {
          return { ok: false, violacoes: [violacao('RN-FAT-05', 'contingencia', `A contingência aberta (${aberta.modalidade}) não é a que atende a UF ${filial.endereco.uf}; encerre e abra a correta.`)] };
        }
        contingenciaAberta = { modalidade: aberta.modalidade, motivo: aberta.motivo, inicioEm: new Date(aberta.inicio_em) };
      }
    }
    const tpEmis: TipoEmissao = daNota ? daNota.tpEmis : contingenciaAberta ? TP_EMIS_DA_MODALIDADE[contingenciaAberta.modalidade] : tpEmisPadrao;
    // RN-FAT-06, ANTES de reservar o número: boleto sem prazos ou com total menor que as parcelas não gera título; a nota não nasce assim.
    const semTitulos = validarTitulosDoBoleto({ forma_tpag: forma, prazos_dias: prazos, total_centavos: montada.nota.totais.vNF });
    if (semTitulos.length > 0) return { ok: false, violacoes: semTitulos };
    // Bandeira com leitura segura (erro, como tabela inexistente, vale false com log): nunca derruba a emissão.
    const bandeira = deps.configuracao
      ? await deps.configuracao.lerBandeiraSegura(tx, pedido.filial_id, (motivo) => deps.log({ evento: 'faturamento.bandeira.leitura_falhou', motivo }))
      : false;
    return { ok: true, pedido, nota: montada.nota, filial, destinatario: dest.destinatario, forma_tpag: forma, prazos_dias: prazos, conta_como_real: contaComoReal(ambiente, bandeira), tpEmis, contingenciaAberta, contingenciaDaNota: daNota?.contingencia ?? null };
  }

  function montarConteudo(p: Preparado, numero: number, emitida_em: Date, itensSolicitados: EmitirNotaEntrada['itens']): ConteudoNota {
    const pag = montarPagamento({ forma_tpag: p.forma_tpag, prazos_dias: p.prazos_dias, total_centavos: p.nota.totais.vNF, emissao: emitida_em, numero });
    const conteudo: ConteudoNota = {
      natOp: NAT_OP_PADRAO,
      emitente: { cnpj: p.filial.cnpj, nome: p.filial.razao_social, fantasia: p.filial.nome_fantasia, ie: p.filial.ie, crt: p.filial.crt, endereco: p.filial.endereco },
      destinatario: p.destinatario,
      modFrete: modFreteDoPedido(p.pedido.pedido.frete),
      infCpl: p.pedido.pedido.observacao,
      itensSolicitados: itensSolicitados ?? null,
      pagamentos: pag.pagamentos,
      cobranca: pag.cobranca,
      prazos_dias: p.prazos_dias,
      conta_como_real: p.conta_como_real,
      itens: p.nota.itens,
    };
    // RN-FAT-08: tpEmis 6/7, dhCont (ISO UTC com Z) e xJust só nas notas em contingência; as normais ficam sem o campo.
    if (p.contingenciaAberta) return aplicarContingenciaAoConteudo(conteudo, p.contingenciaAberta);
    return p.contingenciaDaNota ? { ...conteudo, contingencia: p.contingenciaDaNota } : conteudo;
  }

  const identidade = (p: Preparado, fixo: Pick<IdentidadeNota, 'numero' | 'cnf' | 'emitida_em'>): IdentidadeNota =>
    identidadeNota({ ...p.nota, tpEmis: p.tpEmis, serie: p.filial.nfe_serie as number }, fixo);

  const opcoesMontagem = deps.sorteio ? { aleatorio: (max: number): number => (deps.sorteio as () => number)() % max } : undefined;

  /**
   * Conferência ÚNICA da nota antes de gravar ou reenviar: regras do domain (`notaParaEmissaoDe`) e o emissor, que lança
   * `ErroMontagemNFe` (só caminhos e regras, sem conteúdo) onde a SEFAZ rejeitaria. Não queima número: serve com número provisório.
   * Devolve a montagem (chave, cNF e dhEmi) quando passa.
   */
  function conferir(id: IdentidadeNota, conteudo: ConteudoNota): { ok: true; nota: NotaParaEmissaoEntrada; montada: ReturnType<EmissorNFe['montar']> } | { ok: false; violacoes: Violacao[] } {
    const e = notaParaEmissaoDe(id, conteudo);
    if (!e.ok) return e;
    try {
      return { ok: true, nota: e.nota, montada: deps.emissor.montar(e.nota, opcoesMontagem) };
    } catch (err) {
      if (err instanceof ErroMontagemNFe) {
        return {
          ok: false,
          violacoes: err.ocorrencias.map((o) => {
            const i = o.indexOf(': ');
            return violacao('RF-FAT-01', i < 0 ? 'nota' : o.slice(0, i), i < 0 ? o : o.slice(i + 2));
          }),
        };
      }
      throw err;
    }
  }

  /** Filial sem A1 ativo e válido: violação ANTES da reserva do número (nenhum número queimado por filial sem certificado). */
  async function violacaoSemA1(tx: Transacao, filial_id: string): Promise<Violacao[] | null> {
    const r = await deps.certificado.temA1Ativo(tx, filial_id);
    if (r.valido) return null;
    return [violacao('RN-CORE-06', 'filial_id', r.mensagem)];
  }

  /**
   * RF-FAT-01. Idempotente pela chave: repetir devolve a mesma nota sem reservar outro número (RN-CORE-05). Nasce em `rascunho` e
   * assim fica na mesma transação que reserva o número (RN-FAT-01); o worker a leva a `em_autorizacao`. Violação devolve `ok: false` ANTES da reserva:
   * nenhum número é queimado.
   */
  async function emitirNota(tx: Transacao, tenant_id: string, entrada: EmitirNotaEntrada): Promise<ResultadoEmissao> {
    await deps.notas.travarIdempotencia(tx, tenant_id, entrada.idempotencia);
    const existente = await deps.notas.buscarPorIdempotencia(tx, tenant_id, entrada.idempotencia);
    if (existente) {
      // RN-CORE-05: a mesma chave só repete o MESMO pedido e os MESMOS itens (o pedido_id sozinho não basta: há notas parciais).
      if (existente.pedido_id !== entrada.pedido_id || !mesmosItens(existente.itens_solicitados, entrada.itens)) {
        return { ok: false, violacoes: [violacao('RN-CORE-05', 'idempotencia', 'Chave de idempotência já usada com outro pedido ou outros itens.')] };
      }
      return { ok: true, nota: existente, repetida: true };
    }

    const emitida_em = agora();
    const p = await preparar(tx, entrada.pedido_id, entrada.itens, emitida_em);
    if (!p.ok) return p;
    const provisoria = conferir(identidade(p, { numero: 1, cnf: null, emitida_em }), montarConteudo(p, 1, emitida_em, entrada.itens));
    if (!provisoria.ok) return provisoria;
    const semA1 = await violacaoSemA1(tx, p.filial.id);
    if (semA1) return { ok: false, violacoes: semA1 };
    return reservarEGravar(tx, tenant_id, entrada, p, emitida_em);
  }

  async function reservarEGravar(tx: Transacao, tenant_id: string, entrada: EmitirNotaEntrada, p: Preparado, emitida_em: Date): Promise<ResultadoEmissao> {
    const serie = p.filial.nfe_serie as number;
    const inicial = await deps.cadastros.numeroInicial(tx, p.filial.id, serie);
    if (inicial === null) return { ok: false, violacoes: [violacao('RN-FAT-01', 'filial_id', `Série ${serie} sem número inicial cadastrado.`)] };
    const numero = await deps.notas.reservarNumero(tx, tenant_id, p.filial.id, p.nota.ambiente, serie, inicial);

    // O emissor sorteia o cNF e devolve a chave e o dhEmi (segundos): a nota grava os três e os reenvia IGUAIS (RN-FAT-07).
    const conteudo = montarConteudo(p, numero, emitida_em, entrada.itens);
    const definitiva = conferir(identidade(p, { numero, cnf: null, emitida_em }), conteudo);
    if (!definitiva.ok) throw new ErroViolacao(definitiva.violacoes); // só o número mudou desde a conferência: não deveria falhar
    const { montada } = definitiva;
    const id = identidade(p, { numero, cnf: montada.cNF, emitida_em: new Date(montada.dhEmi) });
    const rascunho = await deps.notas.gravarNota(
      tx,
      {
        tenant_id,
        pedido_id: id.pedido_id,
        pedido_uuid: p.pedido.pedido_uuid,
        filial_id: id.filial_id,
        cliente_id: id.cliente_id,
        vendedor_id: id.vendedor_id,
        ambiente: id.ambiente,
        serie,
        numero,
        cnf: montada.cNF,
        chave_acesso: montada.chave,
        tp_emis: p.tpEmis,
        emitida_em: id.emitida_em.toISOString(),
        total_centavos: p.nota.totais.vNF,
        idempotencia: entrada.idempotencia,
        itens_solicitados: entrada.itens ?? null,
      },
      conteudo,
    );
    // A nota FICA em rascunho: o worker assina, guarda a nfe_assinada e a leva a em_autorizacao (ADR 0005 item 4).
    return { ok: true, nota: rascunho, repetida: false };
  }

  /**
   * RN-FAT-07: reenvio da `rejeitada` (ou do `rascunho` que o worker não pôde assinar) com o MESMO série, número, cNF e chave (nada de reservar outro).
   * O conteúdo é refeito (o faturista pode ter corrigido cadastro, e a `revisao` sobe); a API só confere (`emissor.montar`) e grava; o worker assina.
   */
  async function reenviarNota(tx: Transacao, nota: NotaRegistro): Promise<ResultadoEmissao> {
    const v = validarTransicao(nota.status, 'em_autorizacao');
    if (v.length > 0) return { ok: false, violacoes: v };
    if (!podeEditar(nota.status)) {
      return { ok: false, violacoes: [violacao('RN-FAT-07', 'status', `Só a nota rejeitada ou em rascunho é reenviada (status "${nota.status}").`)] };
    }
    const emitida_em = new Date(nota.emitida_em);
    // O conteúdo gravado guarda dhCont e xJust da nota em contingência: o reenvio mantém o tpEmis e os dois (a chave leva o tpEmis).
    const gravado = await deps.notas.lerConteudo(tx, nota.id);
    const p = await preparar(tx, nota.pedido_id, nota.itens_solicitados ?? undefined, emitida_em, nota.id, { tpEmis: nota.tp_emis, contingencia: gravado?.contingencia ?? null });
    if (!p.ok) return p;
    const id = identidade(p, { numero: nota.numero, cnf: nota.cnf, emitida_em });
    const conteudo = montarConteudo(p, nota.numero, emitida_em, nota.itens_solicitados ?? undefined);
    const conferida = conferir(id, conteudo);
    if (!conferida.ok) return conferida;
    const divergencia = conferirIdentidade(conferida.montada, nota);
    if (divergencia) return { ok: false, violacoes: [violacao('RN-FAT-07', divergencia.campo, `Reenvio recusado: ${divergencia.mensagem}.`)] };
    const semA1 = await violacaoSemA1(tx, p.filial.id);
    if (semA1) return { ok: false, violacoes: semA1 };
    // Total e itens refeitos entram na nota ANTES de transmitir: o evento autorizado leva o mesmo total do vNF do XML (RN-FAT-07).
    // O status NÃO muda: o worker remonta, reassina (nfe_assinada versão = max+1, a 0020 exige rejeitada ou rascunho) e só então vai a em_autorizacao.
    await deps.notas.atualizarConteudo(tx, nota.id, conteudo);
    const itens = conteudo.itens.map(resumoDoItem);
    return { ok: true, nota: { ...nota, total_centavos: p.nota.totais.vNF, itens, recibo: null, revisao: nota.revisao + 1 }, repetida: false };
  }

  // O retorno da SEFAZ é do worker (`criarProcessadorRetorno` com `titulos` e `log`): a API não o expõe, para a geração de títulos não ficar sem a porta.
  return { emitirNota, reenviarNota };
}

/**
 * Aplica o retorno da SEFAZ (autorização, recibo ou consulta) à nota: único caminho que leva a nota a autorizada, denegada ou rejeitada.
 * Só precisa do repositório: o worker o usa direto, sem as portas da emissão.
 */
export function criarProcessadorRetorno(notas: RepositorioNotas, titulos: RepositorioTitulos, log: LogFaturamento) {
  const mudar = (tx: Transacao, nota: NotaRegistro, para: StatusNota, dados?: DadosMudancaStatus, extra: Partial<NotaRegistro> = {}): Promise<NotaRegistro> =>
    mudarNota(notas, tx, nota, para, dados, extra);
  const base = baseEventoDaNota;

  /**
   * Retorno da SEFAZ (autorização, recibo ou consulta, já normalizado) aplicado à nota.
   * - autorizada: `em_autorizacao` → `autorizada_guarda_pendente` (protocolo, cStat, xMotivo, recibo e data no MESMO UPDATE) → guarda o
   *   nfeProc em `nota_xml` → o gatilho do banco leva a `autorizada` → evento (RN-FAT-03). Se a guarda falhar, a nota fica em guarda
   *   pendente e NENHUM evento sai (reprocesse com `consultarProtocolo`).
   * - rejeitada: publica `nota.rejeitada@1`; a nota pode ser reenviada com o mesmo número (RN-FAT-07).
   * - duplicidade (204/539): nunca vira rejeição; devolve `consultar_protocolo` e o chamador (worker) consulta fora da tx e reinterpreta.
   */
  return async function processarRetorno(tx: Transacao, nota: NotaRegistro, retorno: RetornoSefaz, opcoes: OpcoesRetorno = {}): Promise<ResultadoRetorno> {
    if (!emTransmissao(nota.status)) return { resultado: 'ja_processada', nota };
    const r = interpretarRetorno(retorno.cStat, retorno.xMotivo);

    if (r.situacao === 'duplicidade') {
      if (opcoes.jaConsultou) return { resultado: 'duplicidade', nota, codigo: r.codigo, mensagem: r.mensagem };
      return { resultado: 'consultar_protocolo', nota, codigo: r.codigo, mensagem: r.mensagem };
    }
    // A consulta disparada pela duplicidade só vale se autorizou ou denegou; "não consta" ou rejeição não mudam nada (RN-FAT-07).
    if (opcoes.jaConsultou && (r.situacao === 'rejeitada' || r.situacao === 'processamento' || r.situacao === 'lote_processado' || r.situacao === 'indisponivel')) {
      return { resultado: 'duplicidade', nota, codigo: r.codigo, mensagem: r.mensagem };
    }

    if (r.situacao === 'autorizada') {
      const protocolo = retorno.nProt;
      let atual = nota;
      if (atual.status === 'em_autorizacao') {
        const dados: DadosMudancaStatus = { cStat: r.codigo, xMotivo: r.mensagem };
        if (protocolo) dados.protocolo = protocolo;
        if (retorno.nRec) dados.recibo = retorno.nRec;
        if (retorno.dhRecbto) dados.autorizadaEm = new Date(retorno.dhRecbto).toISOString();
        atual = await mudar(tx, atual, 'autorizada_guarda_pendente', dados, { protocolo: protocolo ?? null });
      }
      if (!retorno.xmlProtocolo || !protocolo || !opcoes.xmlAssinado) return { resultado: 'guarda_pendente', nota: atual, motivo: 'sem_xml' };
      // O XML assinado só vale se for o que a SEFAZ autorizou: o digest da assinatura é o digVal do protocolo. Sem um dos dois, não guarda.
      if (!opcoes.digestValue || !retorno.digVal) return { resultado: 'guarda_pendente', nota: atual, motivo: 'sem_digest' };
      if (opcoes.digestValue !== retorno.digVal) return { resultado: 'guarda_pendente', nota: atual, motivo: 'digest_diferente' };
      // Lido ANTES da guarda: depois dela nada pode lançar (um erro faria o rollback do nfeProc, RN-FAT-03).
      const conteudo = await notas.lerConteudo(tx, atual.id);
      try {
        await notas.guardarXmlAutorizado(tx, atual.id, { conteudo: montarNfeProc(opcoes.xmlAssinado, retorno.xmlProtocolo), protocolo });
      } catch {
        return { resultado: 'guarda_pendente', nota: atual, motivo: 'falha_na_guarda' }; // sem evento (RN-FAT-03)
      }
      // Guardar o XML levou a nota a `autorizada` por gatilho do banco: nenhum `mudarStatus` depois.
      const autorizada = comStatus(atual, 'autorizada');
      const payload = NotaAutorizadaPayload.parse({ ...base(autorizada, protocolo, contaComoRealDaNota(conteudo, autorizada)), pedido_uuid: autorizada.pedido_uuid });
      await notas.publicarEvento(tx, { nome: EVENTO_NOTA_AUTORIZADA, agregado_id: autorizada.id, payload });
      // RF-FAT-07: títulos na MESMA tx, depois da guarda do nfeProc e do evento, num SAVEPOINT (RN-FAT-03): se a geração falhar, a nota segue autorizada com o
      // nfeProc guardado, a pendência vai ao log e ao resultado, e a varredura gera depois.
      const g = await gerarTitulosSeguro(tx, { titulos, notas }, autorizada, log);
      return { resultado: 'autorizada', nota: autorizada, ...(!g.ok ? { titulos_pendentes: g.motivo } : {}) };
    }

    if (r.situacao === 'denegada') {
      if (nota.status !== 'em_autorizacao') return { resultado: 'ja_processada', nota };
      const dados: DadosMudancaStatus = { cStat: r.codigo, xMotivo: r.mensagem };
      if (retorno.nProt) dados.protocolo = retorno.nProt;
      if (retorno.dhRecbto) dados.autorizadaEm = new Date(retorno.dhRecbto).toISOString();
      const negada = await mudar(tx, nota, 'denegada', dados);
      return { resultado: 'denegada', nota: negada, codigo: r.codigo, mensagem: r.mensagem };
    }

    if (r.situacao === 'rejeitada') {
      if (nota.status !== 'em_autorizacao') return { resultado: 'ja_processada', nota };
      const rejeitada = await mudar(tx, nota, 'rejeitada', { cStat: r.codigo, xMotivo: r.mensagem });
      const payload = NotaRejeitadaPayload.parse({ ...base(rejeitada, null), codigo: r.codigo, mensagem: r.mensagem.slice(0, 1000), acao_sugerida: r.acao.slice(0, 500) });
      await notas.publicarEvento(tx, { nome: EVENTO_NOTA_REJEITADA, agregado_id: rejeitada.id, payload });
      return { resultado: 'rejeitada', nota: rejeitada, codigo: r.codigo, mensagem: r.mensagem, acao: r.acao };
    }

    // processamento, indisponivel, lote_processado: nada muda; o worker consulta de novo (ou avalia a contingência, RN-FAT-05).
    return { resultado: 'aguardando', nota, codigo: r.codigo, mensagem: r.mensagem };
   };
}
