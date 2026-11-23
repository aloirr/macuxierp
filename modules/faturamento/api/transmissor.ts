/**
 * Trabalho do worker `faturamento.transmitir_nota` (RF-FAT-01, RN-FAT-03, RN-FAT-07), FASE DO WORKER; só o worker lê o A1 decifrado (ADR 0005 item 4).
 *   tx1 (trava a nota; lê o A1; com a nota em `rascunho` ou `rejeitada`: remonta pelo emissor do conteúdo gravado com o MESMO número, cNF e dhEmi,
 *   confere a chave, assina, INSERT da `nfe_assinada` (versão = max+1) e leva a `em_autorizacao`, tudo na mesma tx; com a nota já em `em_autorizacao`
 *   reutiliza a última `nfe_assinada`, sem reassinar) → chamada à SEFAZ FORA de transação → tx2 (aplica o retorno com `processarRetorno`, guarda o nfeProc
 *   ANTES do status e publica o evento). Depois do 103, o `nRec` é gravado numa tx curta ANTES de consultar o recibo.
 *   A1 vencido/revogado ou remontagem que não bate: a nota fica em rascunho/rejeitada com o motivo em `transporte.envio_pendente`, sem queimar número;
 *   o reenvio sai com o mesmo número (RN-FAT-07); nota nunca enviada sai por inutilização.
 *   Duplicidade (204/539): `consultarProtocolo` fora da transação e tx3. Retry, duplicidade e guarda pendente nunca remontam o XML:
 *   mudar emissor, verProc ou A1 entre o envio e o retry não muda o digest que a SEFAZ viu (RN-FAT-03).
 * O worker entrega as portas prontas: o `SeletorTransporte` (`criarSeletorTransporte` do nfe-sefaz, com a trava do simulador, ou o
 * simulador direto no arnês de teste), o A1 aberto (`lerA1DecifradoDaFilial` do core + `abrirA1` do emissor) e a porta `EmissorNFe`. Nada daqui importa o simulador
 * nem o transporte real. O A1 vive só em memória e o `pfx` é zerado no `finally`. Sem dado pessoal em log.
 */
import { createHash } from 'node:crypto';
import { ErroCertificadoA1, ErroMontagemNFe, type EmissorNFe } from '@macuxierp/nfe-emissor';
import { Uf, type SefazTransporteEpec, type SeletorEpec, type SeletorTransporte } from '@macuxierp/nfe-sefaz';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import { digestValueDoXml, emTransmissao, ErroViolacao, FUSO_MANAUS_MINUTOS, modoDoTransporte, pedidoAceitaNota, prazoEpec, situacaoPrazoEpec, transicaoVoltaContingencia } from '../domain';
import { criarProcessadorRetorno, mudarNota, xmlDaNota, type ResultadoRetorno } from './emissao';
import { criarProcessadorEpec, type ResultadoEpec } from './epec';
import type { A1DaFilial, AmbienteFiscalDaFilial, GuardaEpec, SituacaoPedidoDoPedido, NotaRegistro, RepositorioNotas, RepositorioTitulos, RetornoSefaz, TransmissaoRegistrada } from './portas';
import type { LogFaturamento } from './titulos';
import { comA1, descarregar as descarregarLog, medir as medirChamada } from './sefaz-comum';
import { retornoDaAutorizacao, retornoDaConsulta, retornoDoRecibo } from './retorno-sefaz';

export interface DepsTransmissor {
  banco: Banco;
  notas: RepositorioNotas;
  /** Títulos a receber: gerados na MESMA tx da autorização (RF-FAT-07). Ligar sempre (`repositoriosSql().titulos`). */
  titulos: RepositorioTitulos;
  /** Log sem dado pessoal, OBRIGATÓRIO: a geração de título pendente (a varredura gera depois) não pode sumir. */
  log: LogFaturamento;
  ambiente: AmbienteFiscalDaFilial;
  /**
   * RN-PED-02: situação do pedido (`criarConsultaParaFaturar().situacao` do pedido, com FOR SHARE), consultada ANTES de ler o A1 e assinar rascunho ou rejeitada.
   * OBRIGATÓRIA: a guarda fiscal (pedido cancelado não vira nota assinada) é exigida pelo tipo.
   */
  situacao: SituacaoPedidoDoPedido;
  /**
   * Liga o `lerA1DecifradoDaFilial(tx, chave, filial)` do core à chave do secret do servidor e abre o certificado (`abrirA1`): o `certificado` assina e
   * a `credencial` (pfx + senha) vai ao mTLS do transporte. `null` = filial sem A1 ativo; `ErroCertificadoA1` (fora da validade, senha) = A1 inválido.
   */
  lerA1(tx: Transacao, filial_id: string): Promise<A1DaFilial | null>;
  /** Porta `EmissorNFe` (`criarEmissorNFe`): o worker remonta (`montar`), assina (`assinar`) e transmite. */
  emissor: EmissorNFe;
  /** Fábrica INJETADA: `criarSeletorTransporte(...)` no worker de produção; o simulador direto no arnês da T-0022. */
  sefaz: SeletorTransporte;
  /**
   * EPEC (tpEmis 4, RN-FAT-08): o seletor do Ambiente Nacional (`criarSeletorEpec`, que recusa filial simulada, RN-FAT-10) e a guarda do evento autorizado.
   * Ausente = o worker não transmite nota EPEC (fica em rascunho com o motivo `destino_indisponivel`, sem queimar número).
   */
  epec?: { seletor: SeletorEpec; guarda: GuardaEpec };
  agora?: () => Date;
}

export type ResultadoTransmissao =
  | ResultadoRetorno
  | ResultadoEpec
  | { resultado: 'ignorada'; motivo: 'nota_inexistente' | 'status_nao_transmissivel' | 'em_transmissao' }
  /** A filial não tem A1 ativo: nada foi enviado; a nota continua como estava (com o motivo, se ainda não assinada). */
  | { resultado: 'sem_certificado' }
  /** Não assinada: A1 inválido/vencido (`a1_invalido`) ou remontagem que não bate com a nota (`remontagem_divergente`). Nota em rascunho/rejeitada, com o motivo; número intacto. */
  | { resultado: 'nao_assinada'; motivo: 'a1_invalido' | 'remontagem_divergente' | 'destino_indisponivel' | 'pedido_cancelado' | 'situacao_indisponivel' }
  /** RN-FAT-04: o ambiente da filial mudou depois da nota; o envio é recusado (a nota é de outro ambiente). */
  | { resultado: 'ambiente_mudou' }
  | { resultado: 'falha'; codigo: string };

type Preparo =
  | { tipo: 'fim'; resultado: ResultadoTransmissao; a1?: undefined }
  | { tipo: 'enviar'; nota: NotaRegistro; uf: Uf; a1: A1DaFilial; xmlAssinado: string; digestValue: string | null; transporte?: ReturnType<SeletorTransporte>; epec?: SefazTransporteEpec };

/** Só estes status são assinados pelo worker (0020: a `nfe_assinada` não entra em `em_autorizacao`). Contingência é do lote 4. */
const precisaAssinar = (status: NotaRegistro['status']): boolean => status === 'rascunho' || status === 'rejeitada';

export function criarTransmissor(deps: DepsTransmissor) {
  const agora = deps.agora ?? ((): Date => new Date());
  const processar = criarProcessadorRetorno(deps.notas, deps.titulos, deps.log);
  const processarEpec = deps.epec ? criarProcessadorEpec(deps.notas, deps.epec.guarda) : null;
  /** RN-FAT-08: nota tpEmis 4 ainda sem o evento EPEC registrado: o envio é o do EVENTO 110140 ao Ambiente Nacional, não o da NF-e. */
  const ehEnvioEpec = (n: NotaRegistro): boolean => n.tp_emis === 4 && !n.epec_protocolo;
  const destinoEpec = (n: NotaRegistro, uf: Uf, a1: A1DaFilial): SefazTransporteEpec | null => {
    if (!deps.epec) return null;
    try {
      return deps.epec.seletor({ filial_id: n.filial_id, ambiente: n.ambiente, uf }, a1.credencial);
    } catch {
      return null;
    }
  };

  /** Motivo curto e sem dado pessoal: só rótulos de regra e de campo. */
  const motivoDe = (e: unknown): string | null => {
    if (e instanceof ErroViolacao) return `remontagem: ${e.violacoes.map((v) => `${v.rn}@${v.campo}`).join(', ')}`.slice(0, 255);
    if (e instanceof ErroMontagemNFe) return 'remontagem: o emissor recusou o conteúdo gravado';
    if (e instanceof Error && /^RN-FAT-07/.test(e.message)) return e.message.slice(0, 255);
    return null;
  };

  async function preparar(tenant_id: string, nota_id: string): Promise<Preparo> {
    // `comA1` (sefaz-comum) zera o pfx em tudo que não entrega o A1 ao chamador (retorno cedo, exceção, falha do commit).
    {
      return comA1(deps.banco, deps.lerA1, tenant_id, async (tx, abrirA1): Promise<Preparo> => {
        // Outra transmissão da mesma nota em curso: sai sem fazer nada (a trava vale até o fim desta tx).
        if (!(await deps.notas.travarTransmissao(tx, nota_id))) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'em_transmissao' } };
        let nota = await deps.notas.obter(tx, nota_id);
        if (!nota) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'nota_inexistente' } };
        const assinar = precisaAssinar(nota.status);
        // RN-FAT-09: a volta da EPEC (emitida_contingencia -> em_autorizacao) transmite a MESMA nfe_assinada ao autorizador normal; SVC nunca volta (violação).
        const volta = nota.status === 'emitida_contingencia';
        if (volta && transicaoVoltaContingencia({ status: nota.status, tpEmis: nota.tp_emis, epecAutorizado: !!nota.epec_protocolo }).length > 0) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
        if (!assinar && !volta && !emTransmissao(nota.status)) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
        // RN-FAT-07 e RN-FAT-03: quem assina trava a linha (FOR UPDATE) e relê: o reenvio da API (que também trava) não troca a revisão no meio.
        if (assinar) {
          nota = await deps.notas.obter(tx, nota_id, { travar: true });
          if (!nota || !precisaAssinar(nota.status)) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
        }
        // RN-FAT-04: a nota é do ambiente em que nasceu; se a filial mudou, nada sai (o banco recusa o reenvio também).
        if ((await deps.ambiente.ambiente(tx, nota.filial_id)) !== nota.ambiente) return { tipo: 'fim', resultado: { resultado: 'ambiente_mudou' } };
        // RN-PED-02 / RN-FAT-07: pedido não faturável (ou situação indisponível) não é assinado; número intacto (README P-2).
        if (assinar) {
          const s = await deps.situacao.situacao(tx, nota.pedido_id);
          if (!s) {
            await deps.notas.registrarMotivoEnvio(tx, nota.id, 'RN-PED-02: situação do pedido indisponível');
            return { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'situacao_indisponivel' } };
          }
          if (!pedidoAceitaNota(s.status)) {
            await deps.notas.registrarMotivoEnvio(tx, nota.id, 'RN-PED-02: pedido cancelado');
            return { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'pedido_cancelado' } };
          }
        }
        let a1: A1DaFilial | null;
        try {
          a1 = await abrirA1(nota.filial_id);
        } catch (e) {
          if (!(e instanceof ErroCertificadoA1)) throw e;
          // A1 vencido ou revogado entre as fases: a nota fica como está, com o motivo, sem queimar número (RN-CORE-06, RN-FAT-07).
          if (!assinar) return { tipo: 'fim', resultado: { resultado: 'sem_certificado' } };
          await deps.notas.registrarMotivoEnvio(tx, nota.id, `A1 inválido: ${e.message}`);
          return { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'a1_invalido' } };
        }
        if (!a1) {
          if (assinar) await deps.notas.registrarMotivoEnvio(tx, nota.id, 'sem certificado A1 ativo para a filial');
          return { tipo: 'fim', resultado: { resultado: 'sem_certificado' } };
        }
        const conteudo = await deps.notas.lerConteudo(tx, nota_id);
        if (!conteudo) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'nota_inexistente' } };
        const uf = Uf.parse(conteudo.emitente.endereco.uf);
        if (volta) return voltaDaEpec(tx, nota, uf, a1);
        if (!assinar) {
          const xml = await xmlAssinadoDaNota(tx, nota);
          if (!ehEnvioEpec(nota)) return { tipo: 'enviar', nota, uf, a1, ...xml };
          const epec = destinoEpec(nota, uf, a1);
          return epec ? { tipo: 'enviar', nota, uf, a1, ...xml, epec } : { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'destino_indisponivel' } };
        }

        const ultimo = await deps.notas.ultimoXmlAssinado(tx, nota.id);
        // Rejeitada já assinada para o conteúdo atual (revisão) e sem reenvio novo: trabalho velho, nada a fazer.
        if (ultimo && ultimo.versao >= nota.revisao) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
        // RN-FAT-04/RN-FAT-07: o destino é resolvido ANTES de assinar. Se o seletor recusar (produção sem transporte real, endereço não conferido), a nota fica em
        // rascunho com o motivo, sem nfe_assinada e sem em_autorizacao; o número fica na nota e aparece em numeradasNaoEnviadas.
        let transporte: ReturnType<SeletorTransporte> | undefined;
        let epec: SefazTransporteEpec | undefined;
        try {
          if (ehEnvioEpec(nota)) {
            epec = destinoEpec(nota, uf, a1) ?? undefined;
            if (!epec) throw new Error('destino_epec_indisponivel');
          } else {
            transporte = deps.sefaz({ filial_id: nota.filial_id, ambiente: nota.ambiente, uf, modo: modoDoTransporte(nota.tp_emis) }, a1.credencial);
          }
        } catch {
          await deps.notas.registrarMotivoEnvio(tx, nota.id, 'destino_indisponivel');
          return { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'destino_indisponivel' } };
        }
        let xml: string;
        try {
          xml = xmlDaNota(deps.emissor, nota, conteudo); // MESMO número, cNF e dhEmi gravados; a chave refeita tem de bater com a da nota (RN-FAT-07)
        } catch (e) {
          const motivo = motivoDe(e);
          if (!motivo) throw e;
          await deps.notas.registrarMotivoEnvio(tx, nota.id, motivo);
          return { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'remontagem_divergente' } };
        }
        const assinado = deps.emissor.assinar(xml, a1.certificado);
        // RN-FAT-02/03: nfe_assinada (só INSERT, versão = max+1) ANTES de em_autorizacao e de qualquer transmissão, na mesma tx.
        await deps.notas.gravarXmlAssinado(tx, nota.id, assinado.xml, createHash('sha256').update(assinado.xml, 'utf8').digest('hex'));
        // A revisão lida vai no UPDATE: se a API gravou outra no meio, o UPDATE não pega, a tx desfaz e a próxima volta usa a revisão nova.
        const enviada = await mudarNota(deps.notas, tx, nota, 'em_autorizacao', { revisao: nota.revisao });
        return { tipo: 'enviar', nota: enviada, uf, a1, xmlAssinado: assinado.xml, digestValue: digestValueDoXml(assinado.xml), ...(transporte ? { transporte } : {}), ...(epec ? { epec } : {}) };
      });
    }
  }

  /**
   * RN-FAT-09 (ADR 0011): volta da EPEC. A nota `emitida_contingencia` com `epec_protocolo` vai a `em_autorizacao` e a MESMA `nfe_assinada` (sem remontar nem reassinar; mesma chave)
   * é transmitida no modo `normal`. O destino é resolvido ANTES de mudar o status: se o seletor recusar, a nota segue em `emitida_contingencia` (nada se perde). Prazo vencido (168 h do
   * evento) não impede o envio, só deixa o sinal no log (sem dado pessoal); quem decide é a SEFAZ. Rejeição segue a RN-FAT-07 (nota rejeitada mantém o número).
   */
  async function voltaDaEpec(tx: Transacao, nota: NotaRegistro, uf: Uf, a1: A1DaFilial): Promise<Preparo> {
    let transporte: ReturnType<SeletorTransporte>;
    try {
      transporte = deps.sefaz({ filial_id: nota.filial_id, ambiente: nota.ambiente, uf, modo: modoDoTransporte(nota.tp_emis) }, a1.credencial);
    } catch {
      return { tipo: 'fim', resultado: { resultado: 'nao_assinada', motivo: 'destino_indisponivel' } };
    }
    const xml = await xmlAssinadoDaNota(tx, nota);
    if (nota.epec_autorizada_em && situacaoPrazoEpec(agora(), prazoEpec({ epecAutorizadoEm: new Date(nota.epec_autorizada_em) })) === 'vencido') {
      deps.log({ evento: 'faturamento.epec.prazo_vencido', tenant_id: nota.tenant_id, nota_id: nota.id, motivo: 'RN-FAT-09: transmissão posterior depois de 168 h do evento EPEC' });
    }
    const enviada = await mudarNota(deps.notas, tx, nota, 'em_autorizacao', { revisao: nota.revisao });
    return { tipo: 'enviar', nota: enviada, uf, a1, ...xml, transporte };
  }

  /**
   * RN-FAT-03: nota já em `em_autorizacao` (retry, recibo, guarda pendente): lê a última `nfe_assinada` guardada na primeira transmissão e a reutiliza, sem reassinar; retry,
   * duplicidade e guarda pendente usam o MESMO assinado e o `DigestValue` dele (o `digVal` do protocolo tem de ser igual).
   */
  async function xmlAssinadoDaNota(tx: Transacao, nota: NotaRegistro): Promise<{ xmlAssinado: string; digestValue: string | null }> {
    const ultimo = await deps.notas.ultimoXmlAssinado(tx, nota.id);
    if (!ultimo) throw new Error('RN-FAT-03: a nota em_autorizacao não tem XML assinado guardado');
    return { xmlAssinado: ultimo.xml, digestValue: digestValueDoXml(ultimo.xml) };
  }

  /** Aplica o retorno numa transação própria (tx2 e tx3). `autorizada_guarda_pendente` também passa por aqui (reprocessa a guarda). */
  async function aplicar(
    tenant_id: string,
    nota_id: string,
    retorno: RetornoSefaz,
    opcoes: { xmlAssinado: string; digestValue: string | null; jaConsultou?: boolean },
    descarregar: (tx: Transacao) => Promise<void>,
  ): Promise<ResultadoRetorno | { resultado: 'ignorada'; motivo: 'nota_inexistente' }> {
    return deps.banco.comTenant(tenant_id, async (tx) => {
      const nota = await deps.notas.obter(tx, nota_id, { travar: true });
      if (!nota) return { resultado: 'ignorada', motivo: 'nota_inexistente' } as const;
      await descarregar(tx);
      const r = await processar(tx, nota, retorno, opcoes);
      if (r.resultado === 'aguardando' && retorno.nRec) await deps.notas.registrarRecibo(tx, nota_id, retorno.nRec);
      return r;
    });
  }

  async function transmitirNota(tenant_id: string, nota_id: string): Promise<ResultadoTransmissao> {
    const p = await preparar(tenant_id, nota_id);
    if (p.tipo === 'fim') return p.resultado;
    const { nota, a1, xmlAssinado, digestValue } = p;
    try {
      if (p.epec) return await transmitirEpec(tenant_id, nota, a1, xmlAssinado, p.epec);
      const transporte = p.transporte ?? deps.sefaz({ filial_id: nota.filial_id, ambiente: nota.ambiente, uf: p.uf, modo: modoDoTransporte(nota.tp_emis) }, a1.credencial);
      const log: TransmissaoRegistrada[] = [];
      const medir = <T extends { cStat: string; xMotivo: string }>(servico: TransmissaoRegistrada['servico'], chamar: () => Promise<T>): Promise<T> => medirChamada(agora, transporte, chamar, { nota_id, servico }, log);
      const descarregar = (t: Transacao): Promise<void> => descarregarLog(log, (reg) => deps.notas.registrarTransmissao(t, reg));

      let retorno: RetornoSefaz;
      if (nota.status === 'autorizada_guarda_pendente') {
        // Já autorizada na SEFAZ, só falta guardar: o protocolo vem da consulta; o XML assinado guardado é o mesmo (mesmo digest).
        retorno = retornoDaConsulta(await medir('consulta', () => transporte.consultarProtocolo({ chNFe: nota.chave_acesso })));
      } else if (nota.recibo) {
        retorno = retornoDoRecibo(await medir('ret_autorizacao', () => transporte.consultarRecibo({ nRec: nota.recibo as string })), nota.chave_acesso);
      } else {
        const envio = await medir('autorizacao', () => deps.emissor.transmitir(xmlAssinado, String(agora().getTime()).slice(-15), transporte));
        retorno = retornoDaAutorizacao(envio, nota.chave_acesso);
        if (envio.recibo && retorno.cStat === '103') {
          // O recibo é gravado ANTES de consultá-lo: se a consulta falhar, o retry consulta este recibo em vez de reenviar o lote.
          const nRec = envio.recibo.nRec;
          await deps.banco.comTenant(tenant_id, async (t) => {
            await descarregar(t);
            await deps.notas.registrarRecibo(t, nota_id, nRec);
          });
          retorno = { ...retornoDoRecibo(await medir('ret_autorizacao', () => transporte.consultarRecibo({ nRec })), nota.chave_acesso), nRec };
        }
      }

      const r = await aplicar(tenant_id, nota_id, retorno, { xmlAssinado, digestValue }, descarregar);
      if (r.resultado !== 'consultar_protocolo') return r;

      // Duplicidade: a nota pode já estar autorizada na SEFAZ. Consulta FORA de transação e reinterpreta (nunca vira rejeição).
      const consulta = await medir('consulta', () => transporte.consultarProtocolo({ chNFe: nota.chave_acesso }));
      return await aplicar(tenant_id, nota_id, retornoDaConsulta(consulta), { xmlAssinado, digestValue, jaConsultou: true }, descarregar);
    } finally {
      a1.credencial.pfx.fill(0);
    }
  }

  /**
   * EPEC (RN-FAT-08): a nota tpEmis 4 já assinada e em `em_autorizacao` envia o evento 110140 (o emissor monta, assina e transmite) FORA de transação; o retorno é aplicado
   * numa tx própria (`criarProcessadorEpec`: guarda do evento antes do status). Retry com a nota ainda em `em_autorizacao` reenvia o evento com `dhEvento` novo; um 573 fica
   * sem mudança (a consulta do evento é da etapa 4). Não registra `nota_transmissao` (o serviço 'epec' não existe na 0013).
   */
  async function transmitirEpec(tenant_id: string, nota: NotaRegistro, a1: A1DaFilial, xmlAssinado: string, transporte: SefazTransporteEpec): Promise<ResultadoTransmissao> {
    if (!processarEpec) throw new Error('RN-FAT-08: EPEC sem a guarda ligada');
    const resposta = await deps.emissor.epec({ nfe: xmlAssinado, dhEvento: agora(), fusoMinutos: FUSO_MANAUS_MINUTOS }, a1.certificado, transporte);
    const r = await deps.banco.comTenant(tenant_id, async (tx) => {
      const atual = await deps.notas.obter(tx, nota.id, { travar: true });
      if (!atual) return { resultado: 'ignorada', motivo: 'nota_inexistente' } as const;
      return processarEpec(tx, atual, resposta, resposta.assinado.xml);
    });
    // 573 ou lote sem retEvento: a nota segue em em_autorizacao. O pacote não tem consulta de evento (ver docs, etapa 4); o motivo vai ao log para o engenheiro/administrador conferir.
    if (r.resultado === 'aguardando') deps.log({ evento: 'faturamento.epec.evento_sem_retorno', tenant_id, nota_id: nota.id, motivo: `cStat ${r.codigo}: aguardando a consulta do evento (pendente do engenheiro)` });
    return r;
  }

  /**
   * Varredura: notas `em_autorizacao` e `autorizada_guarda_pendente` paradas há mais de `paradasHaMinutos` (padrão 2) e as em `rascunho` sem
   * `nfe_assinada` paradas há o mesmo tempo (há `esperaEnvioPendenteMin`, padrão 30, quando há `envio_pendente`), uma de cada vez;
   * falha de uma não trava as outras. Segura: o worker confere a revisão ao assinar (RN-FAT-07).
   */
  async function transmitirPendentes(tenant_id: string, limite = 20, paradasHaMinutos = 2, esperaEnvioPendenteMin = 30): Promise<{ nota_id: string; resultado: ResultadoTransmissao }[]> {
    const pendentes = await deps.banco.comTenant(tenant_id, (tx) => deps.notas.pendentesDeTransmissao(tx, limite, paradasHaMinutos, esperaEnvioPendenteMin));
    const saida: { nota_id: string; resultado: ResultadoTransmissao }[] = [];
    for (const n of pendentes) {
      try {
        saida.push({ nota_id: n.id, resultado: await transmitirNota(tenant_id, n.id) });
      } catch (e) {
        saida.push({ nota_id: n.id, resultado: { resultado: 'falha', codigo: e instanceof Error ? e.name : 'ERRO' } });
      }
    }
    return saida;
  }

  return { transmitirNota, transmitirPendentes };
}
