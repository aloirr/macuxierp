import { violacao, type Violacao } from './violacao';

export type TipoMovimento = 'entrada' | 'saida' | 'ajuste';

export type ResultadoMovimento = { ok: true; delta: number; saldo: number } | { ok: false; violacao: Violacao };

/**
 * RN-CAD-07: saldo por filial, nunca negativo sem a permissão do gerente (`cadastros.estoque.negativo`).
 * Quantidades × 10^4 (D11). Entrada e saída levam quantidade positiva; o ajuste leva sinal (e não é zero).
 */
export function aplicarMovimento(p: { saldo: number; tipo: TipoMovimento; quantidade: number; podeNegativo: boolean }): ResultadoMovimento {
  const erro = (m: string): ResultadoMovimento => ({ ok: false, violacao: violacao('RN-CAD-07', 'quantidade', m) });
  if (!Number.isSafeInteger(p.quantidade)) return erro('Quantidade deve ser inteira (× 10^4)');
  if (p.tipo === 'ajuste' ? p.quantidade === 0 : p.quantidade <= 0) {
    return erro(p.tipo === 'ajuste' ? 'Ajuste não pode ser zero' : 'Quantidade deve ser positiva');
  }
  const delta = p.tipo === 'saida' ? -p.quantidade : p.quantidade;
  const saldo = p.saldo + delta;
  if (saldo < 0 && !p.podeNegativo) return erro('Saldo ficaria negativo: só o gerente pode autorizar');
  return { ok: true, delta, saldo };
}
