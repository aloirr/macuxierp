/**
 * Erros tipados do contrato da SEFAZ. Rejeição da SEFAZ NÃO é erro: volta no `cStat` da resposta. Erro é o que impede
 * a conversa (destino proibido, configuração errada, rede). Mensagens sem dado pessoal, sem XML e sem segredo.
 */

export type CodigoErroSefaz =
  /** Regra 7: filial em produção nunca fala com o simulador. */
  | 'SEFAZ_SIMULADOR_EM_PRODUCAO'
  /** Filial emissora com dados fora do contrato (ambiente, UF ou modo desconhecidos). */
  | 'SEFAZ_FILIAL_INVALIDA'
  /** UF sem autorizador mapeado em `AUTORIZADOR_DA_UF`. */
  | 'SEFAZ_UF_SEM_AUTORIZADOR'
  /** Contingência que não é a SVC da UF (`SVC_DA_UF`). */
  | 'SEFAZ_CONTINGENCIA_INVALIDA'
  /** Produção pedida com endereço ainda "a conferir" (T-0046). */
  | 'SEFAZ_ENDERECO_NAO_CONFERIDO'
  /** O seletor escolheu um destino para o qual não recebeu fábrica de transporte. */
  | 'SEFAZ_TRANSPORTE_NAO_CONFIGURADO'
  /** Pedido fora do contrato (Zod) antes de sair para a SEFAZ. */
  | 'SEFAZ_PEDIDO_INVALIDO'
  /** Rede, TLS, tempo esgotado ou SOAP ilegível: a SEFAZ não deu `cStat`. */
  | 'SEFAZ_FALHA_TRANSPORTE'
  /** Simulador: a sequência do `nProt`/`nRec` chegou ao fim (permanente, sem retry; T-0045 lote B). */
  | 'SEFAZ_SIMULADOR_ESGOTADO';

export class ErroSefaz extends Error {
  override readonly name: string = 'ErroSefaz';
  constructor(
    readonly codigo: CodigoErroSefaz,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Regra 7 (CLAUDE.md) e RN-CORE-08: a trava do simulador. Nunca é capturado para "tentar de outro jeito". */
export class SimuladorEmProducaoErro extends ErroSefaz {
  override readonly name = 'SimuladorEmProducaoErro';
  constructor(filialId: string | null) {
    super(
      'SEFAZ_SIMULADOR_EM_PRODUCAO',
      `Filial emissora ${filialId ?? '(sem id)'} está em produção fiscal: o simulador da SEFAZ só atende homologação (regra 7)`,
    );
  }
}

/**
 * Falha de conversa com a SEFAZ. `retentavel` diz se o worker pode tentar de novo. Na autorização, antes de reenviar,
 * o worker consulta o protocolo pela chave (desenho §3.4), porque a SEFAZ pode ter autorizado sem a resposta chegar.
 */
export class FalhaTransporteSefaz extends ErroSefaz {
  override readonly name = 'FalhaTransporteSefaz';
  constructor(
    readonly servico: string,
    readonly retentavel: boolean,
    motivo: string,
  ) {
    super('SEFAZ_FALHA_TRANSPORTE', `${servico}: ${motivo}`);
  }
}
