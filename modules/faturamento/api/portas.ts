/**
 * Portas do faturamento. Nada daqui importa a api nem o domain de outro módulo: as implementações vêm de fora (pedido, cadastros,
 * fiscal, core, o `@macuxierp/nfe-emissor` (porta `EmissorNFe`, o ÚNICO montador do XML), o `@macuxierp/nfe-sefaz` e o repositório SQL deste módulo, sobre a migração 0013).
 * A SEFAZ é a porta real `SefazTransporte` do `@macuxierp/nfe-sefaz`, entregue pronta pelo worker (seletor com a trava do simulador).
 */
import type { CalculoSaida, ErroFiscal } from '@macuxierp/fiscal/contracts';
import type { CertificadoA1EmMemoria } from '@macuxierp/nfe-emissor';
import type { CredencialA1EmMemoria } from '@macuxierp/nfe-sefaz';
import type { A1ValidoDaFilial } from '@macuxierp/core/contracts';
import type { SituacaoPedidoParaFaturar } from '@macuxierp/pedido/contracts';
import type { Pagina, Transacao } from '@macuxierp/platform-sdk';
import type { Ambiente, BaixaTituloResumo, FiltroTitulos, TituloDetalhe, TituloResumo, EventoNotaResumo, FiltroNotas, InutilizacaoResumo, FiltroRejeicoes, NotaDetalhe, NotaResumo, RejeicaoNota, StatusNota, TipoEmissao } from '../contracts';
import type { StatusFilaFaturar, ParcelaGerada, ConteudoNota, Crt, EnderecoNota, IndIeDest, NotaNaFaixa, PedidoFaturavel } from '../domain';

/** Implementada pelo `criarConsultaParaFaturar` de `@macuxierp/pedido/api` (liga o apps/api e o apps/worker). Lê com `FOR SHARE`. */
export interface SituacaoPedidoDoPedido {
  situacao(tx: Transacao, pedido_id: string): Promise<SituacaoPedidoParaFaturar | null>;
}

/**
 * Porta inversa, implementada AQUI e consumida pelo cancelamento do pedido (P-2): é "nota em aberto" (RN-PED-02) a do pedido em rascunho
 * numerada, `em_autorizacao` ou `emitida_contingencia`. Rejeitada (opção A do Alexandre, 22/11 03h23 (R-20261122-032334-alexandre): não bloqueia o cancelamento; número vai para inutilização), autorizada e guarda pendente ficam FORA desta porta:
 * a autorizada é lida por `notasAutorizadas`, e o pedido faturado_parcial ainda cancela o saldo.
 */
export interface NotaEmAberto {
  temNotaEmAutorizacao(tx: Transacao, pedido_id: string): Promise<boolean>;
  /** Ids das notas `autorizada` ou `autorizada_guarda_pendente` do pedido (não apagadas): o pedido recusa o cancelamento enquanto houver autorizada ainda não aplicada. */
  notasAutorizadas(tx: Transacao, pedido_id: string): Promise<string[]>;
}

/** Pedido aprovado como a fila `faturamento.pedido_a_faturar` o guarda (payload de `pedido.pedido.aprovado@1`, sem ler o schema `pedido`). */
export interface PedidosAprovados {
  obter(tx: Transacao, pedido_id: string): Promise<PedidoFaturavel | null>;
  /** Consumidor de `pedido.pedido.aprovado@1`: idempotente por (tenant, pedido): evento repetido não regrava. */
  gravar(tx: Transacao, pedido: PedidoFaturavel, status?: StatusFilaFaturar): Promise<'novo' | 'repetido'>;
  /** Reentrega de pedido cancelado: marca `cancelado` se já estiver na fila; se não estiver, não grava nada. */
  marcarCancelado(tx: Transacao, pedido_id: string): Promise<void>;
}

/** Entrada do adaptador do cálculo fiscal (o fiscal.calculo@1 exige mais: regras, CFOP; quem implementa a porta os busca). */
export interface EntradaCalculoFiscal {
  ambiente: Ambiente;
  filial_id: string;
  pedido: PedidoFaturavel;
  /** Data civil de emissão (AAAA-MM-DD, fuso do tenant): decide a vigência das regras (RN-FIS-04). */
  data_emissao: string;
  itens: {
    sequencia: number;
    produto_id: string;
    ncm: string;
    /** `ProdutoRetrato.origem`: o cálculo a devolve em `icms.orig`. */
    origem: string;
    quantidade: number;
    preco_unitario_centavos: number;
    valor_centavos: number;
    desconto_centavos: number;
    frete_centavos: number;
    outras_centavos: number;
  }[];
}
export type ResultadoCalculoFiscal =
  | { ok: true; saida: CalculoSaida; /** CFOP por sequência: o contrato do cálculo o recebe e não o devolve. */ cfops: Record<number, string> }
  | { ok: false; erros: ErroFiscal[] };
/** Implementada sobre `fiscal.calculo@1` (motor puro do fiscal + regras buscadas pela API). Os `item_id` do cálculo são `String(sequencia)`. */
export interface CalculoFiscal {
  calcular(tx: Transacao, entrada: EntradaCalculoFiscal): Promise<ResultadoCalculoFiscal>;
}

export interface FilialEmissora {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  ie: string;
  crt: Crt;
  endereco: EnderecoNota;
  emissora: boolean;
  nfe_serie: number | null;
}
export interface ClienteDestinatario {
  id: string;
  documento: string;
  nome: string;
  ind_ie_dest: IndIeDest;
  ie: string | null;
  endereco: EnderecoNota;
  email: string | null;
}
/** Condição de pagamento do pedido: o `tPag` e os prazos (indPag e parcelas do boleto). */
export interface CondicaoDoPedido {
  forma_tpag: string;
  prazos_dias: number[];
}
/** Implementada sobre os contratos de `cadastros` (sem ler tabela de outro schema; o adaptador fica no `cadastros/api`). */
export interface ConsultaCadastrosFaturamento {
  filial(tx: Transacao, filial_id: string): Promise<FilialEmissora | null>;
  cliente(tx: Transacao, cliente_id: string): Promise<ClienteDestinatario | null>;
  condicao(tx: Transacao, condicao_id: string): Promise<CondicaoDoPedido | null>;
  /** Número inicial da série da filial (RF-CAD-08); o `faturamento.reservar_numero` o recebe do app. */
  numeroInicial(tx: Transacao, filial_id: string, serie: number): Promise<number | null>;
}

/** Ambiente fiscal da filial (`core.ambiente_fiscal`; sem linha = homologação, ADR 0006). Só leitura. */
export interface AmbienteFiscalDaFilial {
  ambiente(tx: Transacao, filial_id: string): Promise<Ambiente>;
}

/**
 * A1 da filial, aberto só em memória (RN, regra 9): `certificado` é o do `abrirA1` do `@macuxierp/nfe-emissor` (assina) e `credencial` é o
 * pfx + senha que o seletor de transporte do `@macuxierp/nfe-sefaz` usa no mTLS. O `abrirA1`, o seletor e a leitura decifrada do core
 * ficam no worker/api; o faturamento só os recebe prontos. `liberar` zera o material.
 */
export interface A1DaFilial {
  certificado: CertificadoA1EmMemoria;
  credencial: CredencialA1EmMemoria;
}

/**
 * "A filial tem A1 ATIVO e dentro da validade?" (RN-CORE-06), para a API, SEM decifrar nada: o `macuxierp_app` só lê os metadados do certificado
 * (`valido_de`, `valido_ate`, `ativo`; 0003). O adaptador no apps/api liga a `criarPortaA1` (`@macuxierp/core/api`, veredito `a1ValidoDaFilial`) à
 * transação da requisição. O A1 decifrado só existe no worker (`lerA1`, `DepsTransmissor`).
 */
export type ResultadoA1Ativo = A1ValidoDaFilial;
export interface ConsultaA1Ativo {
  temA1Ativo(tx: Transacao, filial_id: string): Promise<ResultadoA1Ativo>;
}

/** Normalização do retorno da SEFAZ (autorização, recibo ou consulta) para o que o domínio interpreta. */
export interface RetornoSefaz {
  cStat: string;
  xMotivo: string;
  nProt: string | null;
  digVal: string | null;
  /** Texto da SEFAZ, com deslocamento (`2026-11-21T10:31:02-04:00`). */
  dhRecbto: string | null;
  /** `<protNFe>` bruto: junto da NF-e assinada forma o `nfeProc` guardado (RN-FAT-03). */
  xmlProtocolo: string | null;
  /** Recibo do lote (cStat 103). */
  nRec: string | null;
}

/** Nota gravada (o que o repositório devolve). Sem XML: o autorizado e o assinado vivem em `nota_xml` (`nfe_autorizada` e `nfe_assinada`). */
export interface NotaRegistro {
  id: string;
  tenant_id: string;
  pedido_id: string;
  /** Do payload do pedido a faturar (nulo para pedido nascido no ERP). */
  pedido_uuid: string | null;
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
  ambiente: Ambiente;
  /** RN-FAT-04: só produção vira faturamento no FDV (derivado do ambiente). */
  vai_ao_fdv: boolean;
  serie: number;
  numero: number;
  cnf: string;
  chave_acesso: string;
  tp_emis: TipoEmissao;
  status: StatusNota;
  emitida_em: string;
  total_centavos: number;
  protocolo: string | null;
  /** UTC ISO do `dhRecbto` da autorização (nulo antes dela): base do prazo de 24 h do cancelamento (RN-FAT-02). */
  autorizada_em: string | null;
  recibo: string | null;
  idempotencia: string;
  /** Quantas vezes o conteúdo foi gravado (1 na emissão, +1 a cada reenvio da rejeitada): a `versao` da `nfe_assinada` que o cobre. */
  revisao: number;
  /** Itens como o pedido os solicitou (nulo = nota total do saldo): o reenvio da rejeitada refaz a nota com os mesmos itens. */
  itens_solicitados: { sequencia: number; quantidade?: number }[] | null;
  itens: { sequencia: number; produto_id?: string; quantidade: number; valor_centavos: number }[];
}
export type NovaNota = Omit<NotaRegistro, 'id' | 'status' | 'protocolo' | 'autorizada_em' | 'recibo' | 'itens' | 'vai_ao_fdv' | 'revisao'>;

export interface DadosMudancaStatus {
  protocolo?: string;
  cStat?: string;
  xMotivo?: string;
  recibo?: string;
  /** UTC ISO do `dhRecbto` do protocolo (a nota autorizada exige protocolo e data, `nota_protocolada`). */
  autorizadaEm?: string;
  /** Revisão do conteúdo que o chamador leu: o UPDATE só vale se a nota ainda estiver nela (RN-FAT-07; o reenvio da API sobe a revisão). */
  revisao?: number;
}

export interface TransmissaoRegistrada {
  nota_id: string;
  servico: 'autorizacao' | 'ret_autorizacao' | 'consulta';
  destino: 'simulador' | 'sefaz_am' | 'svc';
  cStat: string | null;
  xMotivo: string | null;
  enviada_em: string;
  respondida_em: string;
  duracao_ms: number;
}

/**
 * Repositório SQL das notas (`api/sql.ts`, migração 0013). As escritas rodam na MESMA transação `tx` recebida: número, nota,
 * itens, status e evento confirmam ou desfazem juntos. RLS por tenant (a `tx` vem de `comTenant`).
 */
export interface RepositorioNotas {
  /** `pg_advisory_xact_lock` pela chave: duas emissões simultâneas com a mesma chave não reservam dois números (RN-CORE-05). */
  travarIdempotencia(tx: Transacao, tenant_id: string, idempotencia: string): Promise<void>;
  buscarPorIdempotencia(tx: Transacao, tenant_id: string, idempotencia: string): Promise<NotaRegistro | null>;
  /** `FOR UPDATE` na linha do pedido em `faturamento.pedido_a_faturar`: duas emissões do mesmo pedido não passam juntas pelo saldo (RN-FAT-01). */
  travarPedido(tx: Transacao, pedido_id: string): Promise<void>;
  /**
   * Soma, por sequência do item, as quantidades (qtd4) das notas do pedido em qualquer status menos cancelada, inutilizada e denegada
   * (saldo pelo próprio faturamento, sem esperar o evento). `exceto_nota_id`: o reenvio não conta a si mesmo.
   */
  quantidadesJaFaturadas(tx: Transacao, pedido_id: string, exceto_nota_id?: string): Promise<Map<number, number>>;
  /** `travar`: `FOR UPDATE` (o retorno da SEFAZ e o reenvio não correm juntos sobre a mesma nota). */
  obter(tx: Transacao, nota_id: string, opcoes?: { travar?: boolean }): Promise<NotaRegistro | null>;
  /** Retratos, itens com o cálculo fiscal, pagamento e transporte: base para refazer o XML (`notaParaEmissaoDe`). */
  lerConteudo(tx: Transacao, nota_id: string): Promise<ConteudoNota | null>;
  /** Próximo número da série da filial, sem buraco (RN-FAT-01): `numeroInicial` só vale na 1ª reserva da série. */
  reservarNumero(tx: Transacao, tenant_id: string, filial_id: string, ambiente: Ambiente, serie: number, numeroInicial: number): Promise<number>;
  /** Grava a nota em `rascunho` com o conteúdo e os itens. O banco confere o número reservado e o ambiente da filial. */
  gravarNota(tx: Transacao, nota: NovaNota, conteudo: ConteudoNota): Promise<NotaRegistro>;
  /**
   * Worker: a nota `rascunho`/`rejeitada` não pôde ser assinada (A1 vencido ou revogado entre as fases, remontagem que não bate): grava o
   * motivo em `transporte.envio_pendente` (`{ motivo, registrado_em }`), SEM mudar status nem número. `atualizarConteudo` (o reenvio) o limpa.
   */
  registrarMotivoEnvio(tx: Transacao, nota_id: string, motivo: string): Promise<void>;
  /**
   * Reenvio (RN-FAT-07): regrava retratos, itens e totais da nota `rejeitada` (ou `rascunho`) e zera o recibo. Número, série,
   * cNF e chave NUNCA mudam; em outro status lança. O banco recusa também (gatilho).
   */
  atualizarConteudo(tx: Transacao, nota_id: string, conteudo: ConteudoNota): Promise<void>;
  /**
   * Valida a transição no banco também; lança se `de` não for o status atual. A resposta da SEFAZ (cStat, xMotivo, recibo,
   * protocolo, data) vai no MESMO UPDATE da passagem de status. Não serve para `autorizada` (ver `guardarXmlAutorizado`).
   */
  mudarStatus(tx: Transacao, nota_id: string, de: StatusNota, para: StatusNota, dados?: DadosMudancaStatus): Promise<void>;
  /** Registra o recibo do lote aceito (nota continua `em_autorizacao`): a próxima volta só consulta o recibo. */
  registrarRecibo(tx: Transacao, nota_id: string, recibo: string): Promise<void>;
  /**
   * Guarda o `nfeProc` autorizado em `nota_xml` (imutável, só INSERT). O gatilho do banco leva a nota de
   * `autorizada_guarda_pendente` a `autorizada`: quem chama NÃO muda o status depois (RN-FAT-03). Falha = lança, e a tx
   * continua usável (savepoint).
   */
  guardarXmlAutorizado(tx: Transacao, nota_id: string, xml: { conteudo: string; protocolo: string }): Promise<void>;
  /**
   * `pg_try_advisory_xact_lock` pela nota (RN-FAT-03): `false` = outra transmissão da mesma nota está em curso e quem chama sai sem
   * fazer nada. A trava vale até o fim da `tx`.
   */
  travarTransmissao(tx: Transacao, nota_id: string): Promise<boolean>;
  /**
   * Guarda o XML ASSINADO (`nota_xml`, tipo `nfe_assinada`): SÓ INSERT, com `versao` = max+1 da nota (devolvida); protocolo nulo; não muda
   * o status. A migração 0020 só aceita com a nota em `rascunho`, `rejeitada` ou `emitida_contingencia` (nunca em `em_autorizacao`) e
   * com a `chave_acesso` da nota já igual à do XML. Concorrência: `UNIQUE (tenant_id, nota_id, versao)` lança 23505, que o reenvio trata
   * como repetição idempotente (RN-FAT-03).
   */
  gravarXmlAssinado(tx: Transacao, nota_id: string, xml: string, sha256: string): Promise<number>;
  /** Última versão do XML assinado (a de maior `versao`), ou nulo se a nota nunca foi assinada. */
  ultimoXmlAssinado(tx: Transacao, nota_id: string): Promise<{ versao: number; xml: string } | null>;
  registrarTransmissao(tx: Transacao, t: TransmissaoRegistrada): Promise<void>;
  /** Outbox: grava `nome` (ex.: `faturamento.nota.autorizada@1`) com o `payload` já validado pelo contrato; agregado = `nota.id`. */
  publicarEvento(tx: Transacao, evento: { nome: string; agregado_id: string; payload: Record<string, unknown> }): Promise<void>;

  // Leituras das rotas e do worker
  listar(tx: Transacao, filtro: FiltroNotas): Promise<Pagina<NotaResumo>>;
  detalhar(tx: Transacao, nota_id: string): Promise<NotaDetalhe | null>;
  /** XML autorizado guardado (nulo se a nota ainda não o tem). */
  lerXmlAutorizado(tx: Transacao, nota_id: string): Promise<{ xml: string; protocolo: string; chave_acesso: string } | null>;
  listarRejeicoes(tx: Transacao, filtro: FiltroRejeicoes): Promise<Pagina<RejeicaoNota>>;
  /**
   * Notas `em_autorizacao` e `autorizada_guarda_pendente` mais antigas primeiro (varredura do worker), só as com `updated_at` mais
   * antigo que `paradasHaMinutos`: a nota que outra transmissão acabou de tocar fica de fora. Entram também as em `rascunho` sem
   * `nfe_assinada` (trabalho perdido), paradas há `paradasHaMinutos`, ou há `esperaEnvioPendenteMin` se houver `envio_pendente` (A1 ruim: não insistir).
   * É seguro: o worker confere a revisão ao levar a nota a `em_autorizacao`.
   */
  pendentesDeTransmissao(tx: Transacao, limite: number, paradasHaMinutos: number, esperaEnvioPendenteMin: number): Promise<{ id: string; status: StatusNota }[]>;
  /**
   * Alerta do prazo de inutilização (RN-FAT-01): notas numeradas ainda em `rascunho` ou `rejeitada` com `emitida_em` anterior a `antesDe`.
   * Número que não vai ser enviado só se fecha por inutilização, dentro do prazo (dia 10 do mês seguinte).
   */
  numeradasNaoEnviadas(tx: Transacao, antesDe: Date): Promise<NotaNumeradaNaoEnviada[]>;
}

export interface NotaNumeradaNaoEnviada {
  id: string;
  filial_id: string;
  ambiente: Ambiente;
  serie: number;
  numero: number;
  status: 'rascunho' | 'rejeitada';
  emitida_em: string;
}

/** Evento da nota como o banco o guarda (`nota_evento`, 0013). `dh_evento` é o `updated_at` do pedido pendente: estável até o fim do ciclo. */
export interface EventoRegistro extends EventoNotaResumo {
  /** UTC ISO: o `dhEvento` do pedido guardado antes de transmitir (RN-FAT-03); a retentativa o reenvia IGUAL. */
  dh_evento: string;
}
/** Inutilização como o banco a guarda (`inutilizacao`, 0013). */
export interface InutilizacaoRegistro extends InutilizacaoResumo {
  criado_em: string;
}

/** Log da chamada à SEFAZ de um evento ou inutilização (`transmissao`): sem XML e sem dado pessoal. */
export type TransmissaoDeEvento = Omit<TransmissaoRegistrada, 'nota_id' | 'servico'> & {
  servico: 'evento' | 'inutilizacao';
  evento_id?: string;
  nota_id?: string;
  inutilizacao_id?: string;
};

/** Lease de transmissão (RN-FAT-01): `respondida_em` nulo e `enviada_em` recente = chamada à SEFAZ em curso para o pedido. */
export interface LeaseDeTransmissao {
  servico: 'evento' | 'inutilizacao';
  evento_id?: string;
  nota_id?: string;
  inutilizacao_id?: string;
  destino: TransmissaoRegistrada['destino'];
  /** Minutos que o lease vale; vencido, outra volta (fila ou varredura) pode retomar o pedido. */
  leaseMin: number;
}

export interface NovoEvento {
  nota_id: string;
  tipo: 'cancelamento' | 'cce';
  n_seq_evento: number;
  texto: string;
}
export interface NovaInutilizacao {
  filial_id: string;
  ambiente: Ambiente;
  serie: number;
  ano: number;
  numero_inicial: number;
  numero_final: number;
  justificativa: string;
}

/**
 * Repositório SQL dos eventos e da inutilização (`api/sql.ts`, 0013 e 0020). Ordem da T-0018 §8: o PEDIDO nasce `pendente` (`criarEvento`,
 * `criarInutilizacao`) antes de qualquer chamada à SEFAZ; o retorno é guardado em `nota_xml` (`guardarXmlEvento`, `guardarXmlInutilizacao`) ANTES de o
 * status mudar: o gatilho do banco leva o evento a `registrado` (e a nota a `cancelada`) e a inutilização a `registrado` (e as notas da faixa a
 * `inutilizada`). Nada daqui edita a nota autorizada.
 */
export interface RepositorioEventos {
  listarEventos(tx: Transacao, nota_id: string): Promise<EventoRegistro[]>;
  /** `travar`: `FOR UPDATE` (o processamento e uma nova tentativa não correm juntos). */
  obterEvento(tx: Transacao, evento_id: string, opcoes?: { travar?: boolean }): Promise<EventoRegistro | null>;
  /** INSERT `pendente`. O banco recusa fora da nota autorizada, CC-e fora da sequência e cancelamento repetido. */
  criarEvento(tx: Transacao, e: NovoEvento): Promise<EventoRegistro>;
  /** `rejeitado` → `pendente` com a MESMA sequência (texto novo, `dh_evento` novo). */
  reabrirEvento(tx: Transacao, evento_id: string, texto: string): Promise<EventoRegistro>;
  rejeitarEvento(tx: Transacao, evento_id: string, r: { cStat: string; xMotivo: string }): Promise<void>;
  /** Guarda o `procEventoNFe` (`nota_xml`, tipos `evento_cancelamento` e `evento_cce`); o gatilho registra o evento e cancela a nota. Lança se falhar. */
  guardarXmlEvento(tx: Transacao, evento: EventoRegistro, xml: { conteudo: string; protocolo: string; dhRegistro: string }): Promise<void>;

  listarInutilizacoes(tx: Transacao, filtro: { filial_id?: string }): Promise<InutilizacaoRegistro[]>;
  obterInutilizacao(tx: Transacao, id: string, opcoes?: { travar?: boolean }): Promise<InutilizacaoRegistro | null>;
  /** INSERT `pendente`: o banco confere a faixa (até proximo+99, sem sobreposição, só rascunho ou rejeitada) e avança a numeração. */
  criarInutilizacao(tx: Transacao, i: NovaInutilizacao): Promise<InutilizacaoRegistro>;
  rejeitarInutilizacao(tx: Transacao, id: string, r: { cStat: string; xMotivo: string }): Promise<void>;
  guardarXmlInutilizacao(tx: Transacao, i: InutilizacaoRegistro, xml: { conteudo: string; protocolo: string; dhRegistro: string }): Promise<void>;
  /** Próximo número da série da filial (`serie_numeracao.proximo`); nulo = série sem numeração. */
  proximoNumero(tx: Transacao, filial_id: string, ambiente: Ambiente, serie: number): Promise<number | null>;
  /** `travar`: `FOR UPDATE` nas notas da faixa (a inutilização muda o status delas). */
  notasNaFaixa(tx: Transacao, filial_id: string, ambiente: Ambiente, serie: number, inicial: number, final: number, opcoes?: { travar?: boolean }): Promise<NotaNaFaixa[]>;
  registrarTransmissao(tx: Transacao, t: TransmissaoDeEvento): Promise<void>;
  /** Tentativas de transmissão do evento (qualquer linha em `transmissao`) e se há lease ativo (sem resposta e dentro de `leaseMin`). */
  situacaoTransmissaoEvento(tx: Transacao, evento_id: string, leaseMin: number): Promise<{ tentativas: number; leaseAtivo: boolean }>;
  /**
   * Trava de transmissão (RN-FAT-01), numa tx curta ANTES de chamar a porta: trava a linha do pedido (`FOR UPDATE`) e, se ele está `pendente` e SEM lease
   * ativo, grava a tentativa em `transmissao` com `respondida_em` nulo (o lease) e devolve o id dela. `null` = outro trabalho já transmite (ou o pedido
   * não está mais pendente): quem chama sai sem chamar a SEFAZ. A advisory lock da tx1 não cobre a chamada, que roda fora de transação.
   */
  iniciarTransmissao(tx: Transacao, l: LeaseDeTransmissao): Promise<{ id: string } | null>;
  /** Fecha o lease com o retorno da chamada (cStat, xMotivo, respondida_em, duração): uma linha por tentativa. */
  concluirTransmissao(tx: Transacao, lease_id: string, r: Pick<TransmissaoDeEvento, 'cStat' | 'xMotivo' | 'respondida_em' | 'duracao_ms'>): Promise<void>;
  // (cStat nulo = a chamada falhou antes de haver resposta; o lease fecha e a próxima volta retoma.)
  /**
   * 563 (faixa já inutilizada na SEFAZ): a inutilização FICA `pendente` (a faixa segue reservada, as notas não mudam) e grava `c_stat`/`x_motivo` com o
   * motivo `ja_inutilizada_na_sefaz`; a varredura não a retoma (divergência para o suporte). Só vale com a inutilização pendente.
   */
  registrarDivergenciaInutilizacao(tx: Transacao, id: string, r: { cStat: string; xMotivo: string }): Promise<void>;
  /** Eventos e inutilizações pendentes mais antigos primeiro (varredura do worker), parados há mais de `paradasHaMinutos` e SEM lease ativo; exclui a divergência 563. */
  pendentes(tx: Transacao, limite: number, paradasHaMinutos: number, leaseMin: number): Promise<{ tipo: 'evento' | 'inutilizacao'; id: string }[]>;
}

/**
 * Portas opcionais do DANFE (RF-FAT-03). `logoEmitente`: PNG do logo da filial emissora (o do CLIENTE; nulo = quadro sem logo, dados centralizados).
 * `assinaturaMarca`: PNG do rodapé "Emitido pelo" (ativo do design-de-marca); sem a porta, `ativos-marca.ts` lê `docs/marca/ativos` por caminho.
 */
export interface PortaDanfe {
  logoEmitente?(tx: Transacao, filial_id: string): Promise<Uint8Array | null>;
  assinaturaMarca?(): Promise<Uint8Array | null>;
}

/**
 * Bandeira por filial "faturamento real com NF-e simulada" (desligada por padrão; sem linha = false). Adaptador SQL sobre `faturamento.configuracao_filial`
 * (filial_id, faturamento_real_nfe_simulada, alterado_por), tabela que o banco-dados ainda cria. Ausente nos deps do worker = bandeira desligada.
 */
export interface ConfiguracaoFaturamento {
  faturamentoRealComNfeSimulada(tx: Transacao, filial_id: string): Promise<boolean>;
  definir(tx: Transacao, filial_id: string, ligada: boolean, usuario_id: string): Promise<void>;
  /** Leitura que NUNCA lança (tabela ainda inexistente, por exemplo): vale false e chama `avisar(motivo)`. O adaptador SQL usa SAVEPOINT para não abortar a transação. */
  lerBandeiraSegura(tx: Transacao, filial_id: string, avisar: (motivo: string) => void): Promise<boolean>;
}

/**
 * Repositório SQL dos títulos a receber (`api/sql-titulos.ts`, 0013: `titulo` e `titulo_baixa`). Roda na `tx` do chamador. O banco confere tudo: título só de
 * nota autorizada, saldo = valor − baixas não estornadas (o gatilho de `titulo_baixa` atualiza o saldo e o status na mesma tx da baixa e do estorno).
 */
export interface RepositorioTitulos {
  /** Idempotente por (nota, parcela): devolve só as parcelas NOVAS (reprocesso não duplica nem republica). */
  inserirParcelas(tx: Transacao, nota: Pick<NotaRegistro, 'id' | 'filial_id' | 'cliente_id'> & { conta_como_real: boolean }, parcelas: readonly ParcelaGerada[]): Promise<TituloResumo[]>;
  listarDaNota(tx: Transacao, nota_id: string, opcoes?: { travar?: boolean }): Promise<TituloResumo[]>;
  obter(tx: Transacao, id: string, opcoes?: { travar?: boolean }): Promise<TituloResumo | null>;
  baixasDoTitulo(tx: Transacao, titulo_id: string): Promise<BaixaTituloResumo[]>;
  /** INSERT em `titulo_baixa`; o gatilho do banco abate o saldo. */
  registrarBaixa(tx: Transacao, titulo_id: string, b: { valor_centavos: number; forma: string; usuario_id: string | null; baixado_em: Date }): Promise<BaixaTituloResumo>;
  /** UPDATE de `estornada_em` (uma vez); o gatilho devolve o saldo. */
  estornarBaixa(tx: Transacao, baixa_id: string, estornada_em: Date): Promise<void>;
  /** Cancela só títulos `aberto` (o banco recusa o resto). */
  cancelar(tx: Transacao, ids: readonly string[]): Promise<void>;
  listar(tx: Transacao, filtro: FiltroTitulos): Promise<Pagina<TituloResumo>>;
  detalhar(tx: Transacao, id: string): Promise<TituloDetalhe | null>;
  /**
   * Soma dos saldos `aberto` do cliente de nota não cancelada, de produção OU `conta_como_real` (RN-PED-04; decisão do Alexandre de 22/11: a nota simulada vale como real).
   * Lê a coluna `faturamento.titulo.conta_como_real` (0026), gravada na geração com o valor da nota.
   */
  saldoAbertoCliente(tx: Transacao, cliente_id: string): Promise<number>;
  /**
   * Roda `fn` num SAVEPOINT: se lançar, desfaz só o que `fn` gravou e DEVOLVE o erro (a transação segue viva). RN-FAT-03: a geração dos títulos nunca
   * derruba a guarda do nfeProc feita antes na mesma tx.
   */
  emSavepoint<T>(tx: Transacao, fn: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; erro: unknown }>;
  /** Ids das notas autorizadas de boleto, autorizadas há ao menos `ha_minutos`, sem nenhuma parcela (varredura de reconciliação). `excluir`: notas que a varredura desistiu de gerar (teto de tentativas). */
  notasBoletoSemTitulo(tx: Transacao, opcoes: { ha_minutos: number; limite: number; excluir?: readonly string[] }): Promise<string[]>;
}
