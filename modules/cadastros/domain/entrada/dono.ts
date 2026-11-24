/**
 * ADR 0014 §14 (RN-CAD a numerar): o dono de cada cadastro da F2, escolhido pelo superadmin no /config da empresa.
 * - dono `cliente` (o banco do cliente): a entrada aceita; o BKO e a carga de CSV são recusados (`dono_cliente`, 409 CONFLITO);
 * - dono `erp`: a entrada recusa o lote da entidade (`entidade_dono_erp`, 422); o BKO e a carga de CSV seguem.
 * `cliente_endereco` segue o dono do `cliente` e `produto_unidade` o do `produto` (o /config não deixa separá-los). Funções puras.
 */
import type { EntidadeCarga } from '../../contracts';
import { ENTIDADE_DA_CARGA, ENTIDADES_ENTRADA, type EntidadeEntrada } from './adaptar';

export type Dono = 'cliente' | 'erp';
export type OrigemEscrita = 'entrada' | 'bko' | 'csv';
export type MapaDono = Readonly<Partial<Record<EntidadeEntrada, Dono>>>;
export type ResultadoDono = { ok: true } | { ok: false; codigo: 'dono_cliente' | 'entidade_dono_erp' };

export function donoPermiteEscrita(dono: Dono, origem: OrigemEscrita): ResultadoDono {
  if (dono === 'cliente') return origem === 'entrada' ? { ok: true } : { ok: false, codigo: 'dono_cliente' };
  return origem === 'entrada' ? { ok: false, codigo: 'entidade_dono_erp' } : { ok: true };
}

const SEGUE: Readonly<Partial<Record<EntidadeEntrada, EntidadeEntrada>>> = { cliente_endereco: 'cliente', produto_unidade: 'produto' };

/** Dono efetivo da entidade do Hub no mapa da empresa (padrão `erp`); o endereço e a unidade seguem o cliente e o produto. */
export function donoEfetivo(entidade: EntidadeEntrada, mapa: MapaDono): Dono {
  return mapa[SEGUE[entidade] ?? entidade] ?? 'erp';
}

/** Dono da entidade da carga de CSV: `cliente` se qualquer entidade do Hub que ela recebe tem esse dono (a condição junta forma e prazo). */
export function donoDaCarga(entidade: EntidadeCarga, mapa: MapaDono): Dono {
  return ENTIDADES_ENTRADA.some((e) => ENTIDADE_DA_CARGA[e] === entidade && donoEfetivo(e, mapa) === 'cliente') ? 'cliente' : 'erp';
}
