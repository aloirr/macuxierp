/**
 * T-0022: a camada de transporte que as notas N01..N20 vão usar, sobre o contrato da T-0045 (desenho
 * docs/desenho/T-0045.md §2.2 e §3; ADR 0008). Só exports públicos: `@macuxierp/nfe-sefaz` (porta, seletor, trava),
 * `@macuxierp/nfe-sefaz/teste` (A1 fictício gerado na hora, documentos e assinatura de teste) e
 * `@macuxierp/sefaz-simulador` (a fábrica que o worker monta na subida).
 *
 * O contador de chamadas fica AQUI, em volta da fábrica do simulador: ela é a única entrada do seletor no simulador
 * (desenho §3.2), então "0 chamadas" no contador = o simulador nunca foi alcançado.
 */
import {
  criarSeletorTransporte,
  type FabricaTransporteSimulador,
  type FilialEmissoraSefaz,
  type SefazTransporte,
  type SeletorTransporte,
  type TransporteHomologacao,
} from '../../../packages/nfe-sefaz/src/index';
import { criarFabricaSimulador, criarRegistroSimulador } from '../../../packages/sefaz-simulador/src/index';
import { FILIAIS, FILIAL_LOTE_A1, FILIAL_LOTE_A2, FILIAL_LOTE_A3, FILIAL_LOTE_B1 } from './matriz';

type OperacaoSefaz = Exclude<keyof SefazTransporte, 'destino'>;

/** UUIDs fixos das filiais do lote no arnês de transporte (no banco efêmero das notas, o UUID vem do cadastro). */
export const UUID_FILIAL: Readonly<Record<string, string>> = Object.freeze({
  [FILIAL_LOTE_A1]: '0b5e7c1a-2f3d-4a6b-8c9d-0e1f2a3b4c01',
  [FILIAL_LOTE_A2]: '0b5e7c1a-2f3d-4a6b-8c9d-0e1f2a3b4c02',
  [FILIAL_LOTE_A3]: '0b5e7c1a-2f3d-4a6b-8c9d-0e1f2a3b4c03',
  [FILIAL_LOTE_B1]: '0b5e7c1a-2f3d-4a6b-8c9d-0e1f2a3b4c04',
});

/** A filial da matriz no formato do contrato (`FilialEmissoraSefaz`): ambiente e UF vêm de `FILIAIS`. */
export function filialEmissora(filial: string): FilialEmissoraSefaz {
  const f = FILIAIS[filial];
  const id = UUID_FILIAL[filial];
  if (!f || !id) throw new Error(`filial fora da matriz: ${filial}`);
  return { filial_id: id, ambiente: f.ambiente, uf: f.uf, modo: 'normal' };
}

/** Chamadas recebidas pelo simulador, por filial (`filial_id`): fábrica e cada operação da porta. */
interface ContadorSimulador {
  readonly fabricadas: Map<string, number>;
  readonly operacoes: Map<string, OperacaoSefaz[]>;
  /** Total de chamadas que chegaram ao simulador para a filial (fábrica + operações). */
  total(filialId: string): number;
}

/** Envolve a fábrica do simulador e conta tudo o que chega nela, por filial. Não muda nenhuma resposta. */
export function contarSimulador(fabrica: FabricaTransporteSimulador): { fabrica: FabricaTransporteSimulador; contador: ContadorSimulador } {
  const fabricadas = new Map<string, number>();
  const operacoes = new Map<string, OperacaoSefaz[]>();
  const contador: ContadorSimulador = {
    fabricadas,
    operacoes,
    total: (id) => (fabricadas.get(id) ?? 0) + (operacoes.get(id)?.length ?? 0),
  };
  const contada: FabricaTransporteSimulador = (destino) => {
    const id = destino.filial_id;
    fabricadas.set(id, (fabricadas.get(id) ?? 0) + 1);
    const t = fabrica(destino);
    const registrar = <R>(op: OperacaoSefaz, f: () => Promise<R>) => {
      operacoes.set(id, [...(operacoes.get(id) ?? []), op]);
      return f();
    };
    return {
      destino: t.destino,
      autorizar: (p) => registrar('autorizar', () => t.autorizar(p)),
      consultarRecibo: (p) => registrar('consultarRecibo', () => t.consultarRecibo(p)),
      consultarProtocolo: (p) => registrar('consultarProtocolo', () => t.consultarProtocolo(p)),
      statusServico: () => registrar('statusServico', () => t.statusServico()),
      cancelar: (p) => registrar('cancelar', () => t.cancelar(p)),
      cartaCorrecao: (p) => registrar('cartaCorrecao', () => t.cartaCorrecao(p)),
      inutilizar: (p) => registrar('inutilizar', () => t.inutilizar(p)),
    };
  };
  return { fabrica: contada, contador };
}

/**
 * O seletor como o worker monta na F4 (desenho §3.2): `transporte` da homologação, a fábrica do simulador com UM
 * registro e relógio injetável. Sem a fábrica do transporte real (`sefaz`), como na F4.
 */
export function montarSeletorDoLote(o: { transporte?: TransporteHomologacao; agora?: () => Date; tMed?: number } = {}): {
  seletor: SeletorTransporte;
  contador: ContadorSimulador;
} {
  const { fabrica, contador } = contarSimulador(
    criarFabricaSimulador({
      registro: criarRegistroSimulador(),
      ...(o.agora ? { agora: o.agora } : {}),
      ...(o.tMed === undefined ? {} : { tMed: o.tMed }),
    }),
  );
  return { seletor: criarSeletorTransporte({ transporte: o.transporte ?? 'simulador', simulador: fabrica }), contador };
}
