/**
 * Serviço de aplicação da emissão (RF-FAT-01, RF-FAT-08): orquestra as portas, sem SQL nem HTTP. Toda escrita acontece na
 * transação `tx` recebida (número, nota, itens, status e evento confirmam juntos). A API NÃO fala com a SEFAZ.
 * `emitirNota` (ordem da T-0018, na MESMA transação da reserva do número): nota em `rascunho` com chave, cNF e dhEmi → assina com o A1
 * (porta `lerA1`; o `pfx` é zerado ao fim) → INSERT da `nfe_assinada` → só então `em_autorizacao` (a migração 0020 recusa a `nfe_assinada` em
 * `em_autorizacao`). O reenvio da rejeitada remonta e reassina com a nota ainda em `rejeitada`, grava a versão nova e só então vai a
 * `em_autorizacao`. O worker NÃO assina: lê a última `nfe_assinada` e transmite FORA da transação, e aplica o retorno com `processarRetorno`
 * (ver `transmissor.ts`). Contingência (lote 4): o assinado só entra depois do UPDATE para `emitida_contingencia`.
 */
import { ErroMontagemNFe, type EmissorNFe, type NotaParaEmissaoEntrada } from '@macuxierp/nfe-emissor';
import { montarNfeProc } from '@macuxierp/nfe-sefaz';
import { violacao, type Transacao, type Violacao } from '@macuxierp/platform-sdk';
import { createHash } from 'node:crypto';
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
  instanteManaus,
  interpretarRetorno,
  modFreteDoPedido,
  montarNota,
  montarPagamento,
  notaParaEmissaoDe,
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
  A1DaFilial,
  AmbienteFiscalDaFilial,
  CalculoFiscal,
  ConsultaCadastrosFaturamento,
  DadosMudancaStatus,
  FilialEmissora,
  NotaRegistro,
  PedidosAprovados,
  RepositorioNotas,
  RetornoSefaz,
  SituacaoPedidoDoPedido,
} from './portas';

export const EVENTO_NOTA_AUTORIZADA = 'faturamento.nota.autorizada@1' as const;
export const EVENTO_NOTA_REJEITADA = 'faturamento.nota.rejeitada@1' as const;

/** Texto fiscal padrão até a configuração por filial existir (ver "Pendências" no README). */
const NAT_OP_PADRAO = 'VENDA DE MERCADORIA';

export interface DepsEmissao {
  /** Porta `EmissorNFe` (`criarEmissorNFe` do `@macuxierp/nfe-emissor`): o serviço nunca gera XML nem chave por conta própria. */
  emissor: EmissorNFe;
  pedidos: PedidosAprovados;
  situacao: SituacaoPedidoDoPedido;
  cadastros: ConsultaCadastrosFaturamento;
  calculo: CalculoFiscal;
  ambiente: AmbienteFiscalDaFilial;
  notas: RepositorioNotas;
  /**
   * A1 da filial aberto em memória (`lerA1DecifradoDaFilial` do core + `abrirA1` do emissor, ligados no worker/api). `null` = filial sem A1
   * ativo: violação ANTES da reserva do número. A emissão o usa só para assinar e zera o `pfx` ao fim.
   */
  lerA1(tx: Transacao, filial_id: string): Promise<A1DaFilial | null>;
  agora?: () => Date;
  /** Sorteio do cNF (inteiro em [0, 100000000), injetável em teste); sem ele, o emissor sorteia. */
  sorteio?: () => number;
  tpEmis?: TipoEmissao;
}

interface Preparado {
  ok: true;
  pedido: PedidoFaturavel;
  nota: NotaMontada;
  filial: FilialEmissora;
  destinatario: DestinatarioNota;
  /** Da condição de pagamento do pedido (nulos = sem condição: tPag 99). */
  forma_tpag: string | null;
  prazos_dias: number[] | null;
}

export type ResultadoEmissao = { ok: true; nota: NotaRegistro; repetida: boolean } | { ok: false; violacoes: Violacao[] };

/** Como o retorno ficou aplicado; o worker decide o que fazer em seguida (consultar protocolo, reagendar, nada). */
export type ResultadoRetorno =
  | { resultado: 'autorizada'; nota: NotaRegistro }
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
 * XML (sem assinatura) montado pelo emissor do conteúdo gravado (RN-FAT-02). É o que a API assina (com o A1 lido pela porta `lerA1`) na emissão e no reenvio da
 * rejeitada; o worker reutiliza o assinado guardado. Série, número, dhEmi e cNF não mudam: a chave e o cNF que o emissor devolve
 * têm de ser os da nota.
 */
export function xmlDaNota(emissor: EmissorNFe, nota: NotaRegistro, conteudo: ConteudoNota): string {
  const e = notaParaEmissaoDe(identidadeDe(nota), conteudo);
  if (!e.ok) throw new ErroViolacao(e.violacoes);
  const r = emissor.montar(e.nota);
  if (r.chave !== nota.chave_acesso) throw new Error('RN-FAT-07: a chave refeita difere da chave da nota');
  if (r.cNF !== nota.cnf) throw new Error('RN-FAT-07: o cNF refeito difere do cNF da nota');
  return r.xml;
}

async function mudarNota(notas: RepositorioNotas, tx: Transacao, nota: NotaRegistro, para: StatusNota, dados?: DadosMudancaStatus, extra: Partial<NotaRegistro> = {}): Promise<NotaRegistro> {
  const v = validarTransicao(nota.status, para);
  if (v.length > 0) throw new ErroViolacao(v);
  await notas.mudarStatus(tx, nota.id, nota.status, para, dados);
  return comStatus(nota, para, extra);
}

export function criarServicoEmissao(deps: DepsEmissao) {
  const agora = deps.agora ?? ((): Date => new Date());
  const tpEmis: TipoEmissao = deps.tpEmis ?? 1;
  const mudar = (tx: Transacao, nota: NotaRegistro, para: StatusNota, dados?: DadosMudancaStatus, extra: Partial<NotaRegistro> = {}): Promise<NotaRegistro> =>
    mudarNota(deps.notas, tx, nota, para, dados, extra);

  /** Tudo que independe do número: situação com FOR SHARE, ambiente, cálculo fiscal, nota montada, destinatário e pagamento. */
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
    const montada = montarNota({ pedido, situacao, itens, ambiente, calculo, v_nf_fiscal: calc.saida.totais.v_nf });
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
    return { ok: true, pedido, nota: montada.nota, filial, destinatario: dest.destinatario, forma_tpag: forma, prazos_dias: prazos };
  }

  function montarConteudo(p: Preparado, numero: number, emitida_em: Date, itensSolicitados: EmitirNotaEntrada['itens']): ConteudoNota {
    const pag = montarPagamento({ forma_tpag: p.forma_tpag, prazos_dias: p.prazos_dias, total_centavos: p.nota.totais.vNF, emissao: emitida_em, numero });
    return {
      natOp: NAT_OP_PADRAO,
      emitente: { cnpj: p.filial.cnpj, nome: p.filial.razao_social, fantasia: p.filial.nome_fantasia, ie: p.filial.ie, crt: p.filial.crt, endereco: p.filial.endereco },
      destinatario: p.destinatario,
      modFrete: modFreteDoPedido(p.pedido.pedido.frete),
      infCpl: p.pedido.pedido.observacao,
      itensSolicitados: itensSolicitados ?? null,
      pagamentos: pag.pagamentos,
      cobranca: pag.cobranca,
      itens: p.nota.itens,
    };
  }

  const identidade = (p: Preparado, fixo: Pick<IdentidadeNota, 'numero' | 'cnf' | 'emitida_em'>): IdentidadeNota =>
    identidadeNota({ ...p.nota, tpEmis, serie: p.filial.nfe_serie as number }, fixo);

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

  /** A1 da filial ou violação (antes da reserva do número: nenhum número queimado por filial sem certificado). */
  async function abrirA1(tx: Transacao, filial_id: string): Promise<{ ok: true; a1: A1DaFilial } | { ok: false; violacoes: Violacao[] }> {
    const a1 = await deps.lerA1(tx, filial_id);
    if (!a1) return { ok: false, violacoes: [violacao('RN-CORE-06', 'filial_id', 'Filial sem certificado A1 ativo: cadastre o A1 antes de emitir.')] };
    return { ok: true, a1 };
  }

  /** Assina o XML montado e guarda a `nfe_assinada` (só INSERT, versão = max+1), com a nota ainda em rascunho ou rejeitada. */
  async function assinarEGuardar(tx: Transacao, nota_id: string, xml: string, a1: A1DaFilial): Promise<void> {
    const assinado = deps.emissor.assinar(xml, a1.certificado);
    await deps.notas.gravarXmlAssinado(tx, nota_id, assinado.xml, createHash('sha256').update(assinado.xml, 'utf8').digest('hex'));
  }

  /**
   * RF-FAT-01. Idempotente pela chave: repetir devolve a mesma nota sem reservar outro número (RN-CORE-05). Nasce em `rascunho` e
   * vai a `em_autorizacao` na mesma transação que reserva o número (RN-FAT-01). Violação devolve `ok: false` ANTES da reserva:
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
    const aberto = await abrirA1(tx, p.filial.id);
    if (!aberto.ok) return aberto;
    try {
      return await emitirComA1(tx, tenant_id, entrada, p, emitida_em, aberto.a1);
    } finally {
      aberto.a1.credencial.pfx.fill(0);
    }
  }

  async function emitirComA1(tx: Transacao, tenant_id: string, entrada: EmitirNotaEntrada, p: Preparado, emitida_em: Date, a1: A1DaFilial): Promise<ResultadoEmissao> {
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
        tp_emis: tpEmis,
        emitida_em: id.emitida_em.toISOString(),
        total_centavos: p.nota.totais.vNF,
        idempotencia: entrada.idempotencia,
        itens_solicitados: entrada.itens ?? null,
      },
      conteudo,
    );
    await assinarEGuardar(tx, rascunho.id, montada.xml, a1); // com a nota em rascunho (0020), antes de qualquer outra coisa
    const nota = await mudar(tx, rascunho, 'em_autorizacao');
    return { ok: true, nota, repetida: false };
  }

  /**
   * RN-FAT-07: reenvio da `rejeitada` com o MESMO série, número, cNF e chave (nada de reservar outro). O conteúdo é refeito
   * (o faturista pode ter corrigido cadastro, e a `revisao` sobe) e volta a `em_autorizacao`; a API monta (`emissor.montar`), assina (`emissor.assinar`) e guarda uma nova versão do XML assinado.
   */
  async function reenviarNota(tx: Transacao, nota: NotaRegistro): Promise<ResultadoEmissao> {
    const v = validarTransicao(nota.status, 'em_autorizacao');
    if (v.length > 0) return { ok: false, violacoes: v };
    if (!podeEditar(nota.status)) {
      return { ok: false, violacoes: [violacao('RN-FAT-07', 'status', `Só a nota rejeitada ou em rascunho é reenviada (status "${nota.status}").`)] };
    }
    const emitida_em = new Date(nota.emitida_em);
    const p = await preparar(tx, nota.pedido_id, nota.itens_solicitados ?? undefined, emitida_em);
    if (!p.ok) return p;
    const id = identidade(p, { numero: nota.numero, cnf: nota.cnf, emitida_em });
    const conteudo = montarConteudo(p, nota.numero, emitida_em, nota.itens_solicitados ?? undefined);
    const conferida = conferir(id, conteudo);
    if (!conferida.ok) return conferida;
    if (conferida.montada.chave !== nota.chave_acesso) {
      return { ok: false, violacoes: [violacao('RN-FAT-07', 'chave', 'O reenvio mudaria a chave de acesso (série, número ou data): reemita ou inutilize.')] };
    }
    // Total e itens refeitos entram na nota ANTES de transmitir: o evento autorizado leva o mesmo total do vNF do XML (RN-FAT-07).
    const aberto = await abrirA1(tx, p.filial.id);
    if (!aberto.ok) return aberto;
    try {
      await deps.notas.atualizarConteudo(tx, nota.id, conteudo);
      // Remonta e reassina com a nota AINDA rejeitada (0020), grava a versão nova e só então vai a em_autorizacao.
      // Sem catch do 23505: após o erro a tx fica abortada (sem savepoint). A rota trava a nota com FOR UPDATE, então o reenvio é serial.
      await assinarEGuardar(tx, nota.id, conferida.montada.xml, aberto.a1);
    } finally {
      aberto.a1.credencial.pfx.fill(0);
    }
    const itens = conteudo.itens.map(resumoDoItem);
    const atualizada = await mudar(tx, nota, 'em_autorizacao', undefined, { total_centavos: p.nota.totais.vNF, itens, recibo: null });
    return { ok: true, nota: atualizada, repetida: false };
  }

  return { emitirNota, reenviarNota, processarRetorno: criarProcessadorRetorno(deps.notas) };
}

/**
 * Aplica o retorno da SEFAZ (autorização, recibo ou consulta) à nota: único caminho que leva a nota a autorizada, denegada ou rejeitada.
 * Só precisa do repositório: o worker o usa direto, sem as portas da emissão.
 */
export function criarProcessadorRetorno(notas: RepositorioNotas) {
  const mudar = (tx: Transacao, nota: NotaRegistro, para: StatusNota, dados?: DadosMudancaStatus, extra: Partial<NotaRegistro> = {}): Promise<NotaRegistro> =>
    mudarNota(notas, tx, nota, para, dados, extra);
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
      try {
        await notas.guardarXmlAutorizado(tx, atual.id, { conteudo: montarNfeProc(opcoes.xmlAssinado, retorno.xmlProtocolo), protocolo });
      } catch {
        return { resultado: 'guarda_pendente', nota: atual, motivo: 'falha_na_guarda' }; // sem evento (RN-FAT-03)
      }
      // Guardar o XML levou a nota a `autorizada` por gatilho do banco: nenhum `mudarStatus` depois.
      const autorizada = comStatus(atual, 'autorizada');
      const payload = NotaAutorizadaPayload.parse({ ...base(autorizada, protocolo), pedido_uuid: autorizada.pedido_uuid });
      await notas.publicarEvento(tx, { nome: EVENTO_NOTA_AUTORIZADA, agregado_id: autorizada.id, payload });
      return { resultado: 'autorizada', nota: autorizada };
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
