import type { StatusPedido } from '../contracts';

/** RN-PED-02 (T-0013 §2): de → para possíveis. */
export const TRANSICOES: Readonly<Record<StatusPedido, readonly StatusPedido[]>> = {
  recebido: ['aprovado', 'em_analise'],
  em_analise: ['aprovado', 'recusado'],
  aprovado: ['faturado_parcial', 'faturado', 'cancelado'],
  faturado_parcial: ['faturado', 'cancelado'],
  recusado: [],
  faturado: [],
  cancelado: [],
};

/** Status finais: nada sai deles. */
export const TERMINAIS: readonly StatusPedido[] = (Object.keys(TRANSICOES) as StatusPedido[]).filter((s) => TRANSICOES[s].length === 0);

export const possiveis = (status: StatusPedido): readonly StatusPedido[] => TRANSICOES[status];

export type ResultadoTransicao =
  | { ok: true }
  | { ok: false; rn: 'RN-PED-02'; de: StatusPedido; para: StatusPedido; possiveis: readonly StatusPedido[]; mensagem: string };

/** RN-PED-02: transição fora da tabela é recusada com a lista do que é possível (vira 422 `detalhes.possiveis`). */
export function validarTransicao(de: StatusPedido, para: StatusPedido): ResultadoTransicao {
  if (TRANSICOES[de].includes(para)) return { ok: true };
  const lista = TRANSICOES[de];
  return {
    ok: false,
    rn: 'RN-PED-02',
    de,
    para,
    possiveis: lista,
    mensagem: `Transição ${de} → ${para} não é permitida` + (lista.length ? `; possíveis: ${lista.join(', ')}` : '; o status é final'),
  };
}
