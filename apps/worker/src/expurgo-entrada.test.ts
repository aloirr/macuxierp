/**
 * T-0057 (LGPD, ADR 0014 §3): a rotina de hora em hora que enfileira o `cadastros.entrada_expurgo` em cada tenant ativo com o
 * `cadastros` licenciado, com `external_id` por hora (não duplica na mesma hora), e o executor registrado no worker. Dados fictícios.
 */
import { TRABALHO_ENTRADA_EXPURGO } from '@macuxierp/cadastros/api';
import type { Licenca } from '@macuxierp/platform-sdk';
import { BancoMemoria, FilaDeTrabalhosMemoria } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { montarPeriodicas } from './modulos';
import { criarRotinaExpurgoEntrada, INTERVALO_EXPURGO_ENTRADA_MS, ROTINA_EXPURGO_ENTRADA } from './expurgo-entrada';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d';
const T3 = '2f8d8c6a-5e3b-4dab-9f4c-7b9aaebc3d4e';
const LIC: Record<string, Licenca[]> = {
  [T1]: [{ modulo: 'cadastros', ativo: true, valido_ate: null }],
  [T2]: [],
  [T3]: [{ modulo: 'cadastros', ativo: true, valido_ate: null }],
};

function montar(falhaEm?: string) {
  const fila = new FilaDeTrabalhosMemoria();
  const { log, registros } = pinoEmMemoria();
  const rotina = criarRotinaExpurgoEntrada({
    banco: new BancoMemoria(),
    log,
    fila,
    tenantsAtivos: async () => [T1, T2, T3],
    licencas: {
      ler: async (_tx, t) => {
        if (t === falhaEm) throw new Error('falha simulada');
        return LIC[t] ?? [];
      },
    },
  });
  return { rotina, fila, registros };
}

describe('rotina cadastros.entrada_expurgo (T-0057, LGPD)', () => {
  it('de hora em hora; um trabalho por tenant com o cadastros, external_id da hora', async () => {
    const { rotina, fila } = montar();
    expect([rotina.id, rotina.intervaloMs]).toEqual([ROTINA_EXPURGO_ENTRADA, INTERVALO_EXPURGO_ENTRADA_MS]);
    expect(INTERVALO_EXPURGO_ENTRADA_MS).toBe(3_600_000);
    const r = await rotina.executar(new Date('2026-11-27T06:17:00Z'));
    expect(r).toEqual({ tenants: 3, enfileirados: 2, falhas: 0 });
    expect(fila.pedidos.map((p) => [p.tipo, p.tenant_id, p.external_id])).toEqual([
      [TRABALHO_ENTRADA_EXPURGO, T1, 'expurgo:2026-11-27T06'],
      [TRABALHO_ENTRADA_EXPURGO, T3, 'expurgo:2026-11-27T06'],
    ]);
  });

  it('falha num tenant não para os outros e o log leva só o tenant e o nome do erro', async () => {
    const { rotina, fila, registros } = montar(T1);
    expect(await rotina.executar(new Date('2026-11-27T07:00:00Z'))).toEqual({ tenants: 3, enfileirados: 1, falhas: 1 });
    expect(fila.pedidos.map((p) => p.tenant_id)).toEqual([T3]);
    expect(registros().find((l) => l.tenant_id === T1)).toMatchObject({ rotina: ROTINA_EXPURGO_ENTRADA, erro: 'Error' });
  });

  it('o worker liga a rotina pelo montarPeriodicas (com o banco), e sem banco ela não entra', () => {
    const { log } = pinoEmMemoria();
    expect(montarPeriodicas({ banco: new BancoMemoria(), log }).map((r) => r.id)).toEqual([ROTINA_EXPURGO_ENTRADA]);
    expect(montarPeriodicas({})).toEqual([]);
  });
});
