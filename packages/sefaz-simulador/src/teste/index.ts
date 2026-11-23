/**
 * `@macuxierp/sefaz-simulador/teste`: apoio SÓ DE TESTE do simulador (fora da API de produção do pacote). Nunca é
 * importado por código de produção (apps, módulos, worker): só por `*.test.ts` e pelo `tests/`.
 *
 * `rejeitarProximo` força o `cStat` do próximo envio de uma operação (N05 da T-0022). O controle mora no estado do
 * destino, dentro do `RegistroSimulador` (sem global): vale para todas as instâncias do mesmo registro e destino.
 * `destinoDe` dá o destino do simulador de um modo (inclusive o de SVC, montado à mão) aos testes deste e de outros pacotes.
 */
import { TP_EMIS, escolherDestinoSefaz, type DestinoSimulador, type ModoEmissao } from '@macuxierp/nfe-sefaz';
import { MOTIVO, type CStatSimulador } from '../contexto';
import { OPERACOES_REJEITAVEIS, criarRegistroSimulador, type OperacaoRejeitavel, type RegistroSimulador } from '../estado';
import { criarSimuladorSefaz, type OpcoesSimulador, type SimuladorSefaz } from '../index';

export type { OperacaoRejeitavel } from '../estado';

/**
 * `cStat` de sucesso ou de processamento (Manual de Orientação): autorizado, homologado, lote recebido/processado,
 * serviço em operação, evento registrado e afins. Não são rejeição: `rejeitarProximo` os recusa.
 */
export const CSTAT_DE_SUCESSO: ReadonlySet<string> = new Set(['100', '101', '102', '103', '104', '105', '107', '124', '128', '135', '136', '150', '151', '155']);

export interface ApoioTesteSimulador {
  /**
   * O próximo envio de `operacao` (padrão `autorizar`) responde com `cStat`, sem gravar nada no simulador; o seguinte
   * volta ao normal. Na autorização, cada NF-e do lote volta rejeitada (lote 104/103); nos eventos, o `retEvento`
   * (lote 128); no recibo e na inutilização, o próprio retorno. A falha de transporte "antes de processar" não o consome.
   *
   * @throws RangeError se o `cStat` for de sucesso (`CSTAT_DE_SUCESSO`), não estiver na tabela `MOTIVO` ou a operação
   * não for conhecida.
   */
  rejeitarProximo(o: { cStat: string; operacao?: OperacaoRejeitavel }): void;
}

export interface SimuladorSefazDeTeste extends SimuladorSefaz {
  readonly teste: ApoioTesteSimulador;
}

/** O apoio de teste de um destino num registro (use o mesmo registro passado à `criarFabricaSimulador`). */
export function apoioDeTesteSimulador(registro: RegistroSimulador, destino: DestinoSimulador): ApoioTesteSimulador {
  return Object.freeze({
    rejeitarProximo({ cStat, operacao = 'autorizar' }: { cStat: string; operacao?: OperacaoRejeitavel }) {
      if (CSTAT_DE_SUCESSO.has(cStat)) throw new RangeError(`rejeitarProximo: cStat ${cStat} é de sucesso, não de rejeição`);
      if (!Object.hasOwn(MOTIVO, cStat)) throw new RangeError(`rejeitarProximo: cStat ${cStat} fora da tabela MOTIVO do simulador`);
      if (!(OPERACOES_REJEITAVEIS as readonly string[]).includes(operacao)) throw new RangeError(`rejeitarProximo: operacao ${String(operacao)} desconhecida`);
      registro.estadoDe(destino).controles.rejeicoes.set(operacao, cStat as CStatSimulador);
    },
  });
}

/** `criarSimuladorSefaz` com o apoio de teste em `simulador.teste` (registro novo se `opcoes.registro` faltar). */
export function criarSimuladorDeTeste(destino: DestinoSimulador, opcoes: OpcoesSimulador = {}): SimuladorSefazDeTeste {
  const registro = opcoes.registro ?? criarRegistroSimulador();
  const s = criarSimuladorSefaz(destino, { ...opcoes, registro });
  return Object.freeze({ ...s, teste: apoioDeTesteSimulador(registro, s.destino) });
}

/** Filial fixa dos testes do simulador (padrão do `destinoDe`). */
export const FILIAL_DE_TESTE = '7f1c2a50-3b8e-4c1d-9a2f-0e6b5d4c3a21';

/**
 * Destino do simulador para o teste (homologação, AM). O de SVC é montado À MÃO a partir do normal, SÓ AQUI: o seletor
 * recusa contingência com o simulador (RN-FAT-10, `SEFAZ_CONTINGENCIA_SIMULADA`), e o worker nunca chega a este destino.
 */
export function destinoDe(modo: ModoEmissao = 'normal', filial: string = FILIAL_DE_TESTE): DestinoSimulador {
  const normal = escolherDestinoSefaz(
    { filial_id: filial, ambiente: 'homologacao', uf: 'AM' },
    { transporte: 'simulador' },
  ) as DestinoSimulador;
  return modo === 'normal' ? normal : Object.freeze({ ...normal, modo, tpEmis: TP_EMIS[modo] });
}
