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
import { Uf, type SeletorTransporte } from '@macuxierp/nfe-sefaz';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import { digestValueDoXml, emTransmissao, ErroViolacao } from '../domain';
import { criarProcessadorRetorno, mudarNota, xmlDaNota, type ResultadoRetorno } from './emissao';
import type { A1DaFilial, AmbienteFiscalDaFilial, NotaRegistro, RepositorioNotas, RepositorioTitulos, RetornoSefaz, TransmissaoRegistrada } from './portas';
import type { LogFaturamento } from './titulos';
import { comA1, descarregar as descarregarLog, medir as medirChamada } from './sefaz-comum';
import { retornoDaAutorizacao, retornoDaConsulta, retornoDoRecibo } from './retorno-sefaz';

export interface DepsTransmissor {
  banco: Banco;
  notas: RepositorioNotas;
  /** Títulos a receber: gerados na MESMA tx da autorização (RF-FAT-07). Ligar sempre (`repositoriosSql().titulos`). */
  titulos: RepositorioTitulos;
  /** Log sem dado pessoal: geração de título pendente (a varredura gera depois). */
  log?: LogFaturamento;
  ambiente: AmbienteFiscalDaFilial;
  /**
   * Liga o `lerA1DecifradoDaFilial(tx, chave, filial)` do core à chave do secret do servidor e abre o certificado (`abrirA1`): o `certificado` assina e
   * a `credencial` (pfx + senha) vai ao mTLS do transporte. `null` = filial sem A1 ativo; `ErroCertificadoA1` (fora da validade, senha) = A1 inválido.
   */
  lerA1(tx: Transacao, filial_id: string): Promise<A1DaFilial | null>;
  /** Porta `EmissorNFe` (`criarEmissorNFe`): o worker remonta (`montar`), assina (`assinar`) e transmite. */
  emissor: EmissorNFe;
  /** Fábrica INJETADA: `criarSeletorTransporte(...)` no worker de produção; o simulador direto no arnês da T-0022. */
  sefaz: SeletorTransporte;
  agora?: () => Date;
}

export type ResultadoTransmissao =
  | ResultadoRetorno
  | { resultado: 'ignorada'; motivo: 'nota_inexistente' | 'status_nao_transmissivel' | 'em_transmissao' }
  /** A filial não tem A1 ativo: nada foi enviado; a nota continua como estava (com o motivo, se ainda não assinada). */
  | { resultado: 'sem_certificado' }
  /** Não assinada: A1 inválido/vencido (`a1_invalido`) ou remontagem que não bate com a nota (`remontagem_divergente`). Nota em rascunho/rejeitada, com o motivo; número intacto. */
  | { resultado: 'nao_assinada'; motivo: 'a1_invalido' | 'remontagem_divergente' }
  /** RN-FAT-04: o ambiente da filial mudou depois da nota; o envio é recusado (a nota é de outro ambiente). */
  | { resultado: 'ambiente_mudou' }
  | { resultado: 'falha'; codigo: string };

type Preparo =
  | { tipo: 'fim'; resultado: ResultadoTransmissao; a1?: undefined }
  | { tipo: 'enviar'; nota: NotaRegistro; uf: Uf; a1: A1DaFilial; xmlAssinado: string; digestValue: string | null };

/** Só estes status são assinados pelo worker (0020: a `nfe_assinada` não entra em `em_autorizacao`). Contingência é do lote 4. */
const precisaAssinar = (status: NotaRegistro['status']): boolean => status === 'rascunho' || status === 'rejeitada';

export function criarTransmissor(deps: DepsTransmissor) {
  const agora = deps.agora ?? ((): Date => new Date());
  const processar = criarProcessadorRetorno(deps.notas, deps.titulos, deps.log);

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
        if (!assinar && !emTransmissao(nota.status)) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
        // RN-FAT-07 e RN-FAT-03: quem assina trava a linha (FOR UPDATE) e relê: o reenvio da API (que também trava) não troca a revisão no meio.
        if (assinar) {
          nota = await deps.notas.obter(tx, nota_id, { travar: true });
          if (!nota || !precisaAssinar(nota.status)) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
        }
        // RN-FAT-04: a nota é do ambiente em que nasceu; se a filial mudou, nada sai (o banco recusa o reenvio também).
        if ((await deps.ambiente.ambiente(tx, nota.filial_id)) !== nota.ambiente) return { tipo: 'fim', resultado: { resultado: 'ambiente_mudou' } };
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
        if (!assinar) return { tipo: 'enviar', nota, uf, a1, ...(await xmlAssinadoDaNota(tx, nota)) };

        const ultimo = await deps.notas.ultimoXmlAssinado(tx, nota.id);
        // Rejeitada já assinada para o conteúdo atual (revisão) e sem reenvio novo: trabalho velho, nada a fazer.
        if (ultimo && ultimo.versao >= nota.revisao) return { tipo: 'fim', resultado: { resultado: 'ignorada', motivo: 'status_nao_transmissivel' } };
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
        return { tipo: 'enviar', nota: enviada, uf, a1, xmlAssinado: assinado.xml, digestValue: digestValueDoXml(assinado.xml) };
      });
    }
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
      const transporte = deps.sefaz({ filial_id: nota.filial_id, ambiente: nota.ambiente, uf: p.uf, modo: 'normal' }, a1.credencial);
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
