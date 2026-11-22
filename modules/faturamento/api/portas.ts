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
import type { Ambiente, FiltroNotas, FiltroRejeicoes, NotaDetalhe, NotaResumo, RejeicaoNota, StatusNota, TipoEmissao } from '../contracts';
import type { ConteudoNota, Crt, EnderecoNota, IndIeDest, PedidoFaturavel } from '../domain';

/** Implementada pelo `criarConsultaParaFaturar` de `@macuxierp/pedido/api` (liga o apps/api e o apps/worker). Lê com `FOR SHARE`. */
export interface SituacaoPedidoDoPedido {
  situacao(tx: Transacao, pedido_id: string): Promise<SituacaoPedidoParaFaturar | null>;
}

/** Porta inversa, implementada AQUI e consumida pelo cancelamento do pedido (P-2): nota `em_autorizacao` bloqueia o cancelamento. */
export interface NotaEmAberto {
  temNotaEmAutorizacao(tx: Transacao, pedido_id: string): Promise<boolean>;
}

/** Pedido aprovado como a fila `faturamento.pedido_a_faturar` o guarda (payload de `pedido.pedido.aprovado@1`, sem ler o schema `pedido`). */
export interface PedidosAprovados {
  obter(tx: Transacao, pedido_id: string): Promise<PedidoFaturavel | null>;
  /** Consumidor de `pedido.pedido.aprovado@1`: idempotente por (tenant, pedido): evento repetido não regrava. */
  gravar(tx: Transacao, pedido: PedidoFaturavel): Promise<'novo' | 'repetido'>;
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
  recibo: string | null;
  idempotencia: string;
  /** Quantas vezes o conteúdo foi gravado (1 na emissão, +1 a cada reenvio da rejeitada): a `versao` da `nfe_assinada` que o cobre. */
  revisao: number;
  /** Itens como o pedido os solicitou (nulo = nota total do saldo): o reenvio da rejeitada refaz a nota com os mesmos itens. */
  itens_solicitados: { sequencia: number; quantidade?: number }[] | null;
  itens: { sequencia: number; quantidade: number; valor_centavos: number }[];
}
export type NovaNota = Omit<NotaRegistro, 'id' | 'status' | 'protocolo' | 'recibo' | 'itens' | 'vai_ao_fdv' | 'revisao'>;

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
