/**
 * T-0057 (E1): a massa fictícia do cenário B tem os 10 cadastros da F2, na ordem do contrato, cada registro válido no
 * payload do Hub v1 e com as referências fechadas dentro da própria massa. Zod do main (`contracts/hub.ts`), igual ao
 * `hub-v1.ts` do SDK (ADR 0014 §2). TODO(T-0057): trocar pelo `@macuxierp/platform-sdk/hub-v1`.
 */
import { describe, expect, it } from 'vitest';
import { ENTIDADES_HUB_F2, PAYLOADS_HUB, RegistroLote } from '../../modules/integracao-fdv/contracts/hub';
import { cnpjValido, cpfValido } from '../../packages/platform-sdk/src/documentos';
import { ENTIDADES_F2 } from './apoio/conector-simulado';
import { cargaSemParte, montarMassaCenarioB } from './apoio/massa-cenario-b';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

describe('massa do cenário B (10 cadastros no layout do kit)', () => {
  const massa = montarMassaCenarioB();

  it('tem exatamente as 10 entidades da F2, na ordem do contrato', () => {
    expect([...ENTIDADES_F2]).toEqual([...ENTIDADES_HUB_F2]);
    expect(Object.keys(massa.registros)).toEqual([...ENTIDADES_HUB_F2]);
    for (const e of ENTIDADES_F2) expect(massa.registros[e].length, e).toBeGreaterThan(0);
  });

  it('cada registro passa no payload da entidade e no RegistroLote do contrato', () => {
    for (const e of ENTIDADES_F2) {
      massa.registros[e].forEach((r, i) => {
        const p = PAYLOADS_HUB[e].safeParse(r);
        expect(p.success, `${e}[${i}] ${JSON.stringify(p.error?.issues.map((x) => x.path))}`).toBe(true);
        expect(RegistroLote.safeParse(r).success, `${e}[${i}]`).toBe(true);
      });
    }
  });

  it('external_id no estilo do kit (código do cliente, não UUID), único por entidade', () => {
    for (const e of ENTIDADES_F2) {
      const ids = massa.registros[e].map((r) => r.external_id);
      expect(new Set(ids).size, e).toBe(ids.length);
      for (const x of ids) {
        expect(x).toMatch(/^CB-[A-Z]+-\d{4}$/);
        expect(x).not.toMatch(UUID);
      }
    }
  });

  it('as referências fecham dentro da massa (ordem de carga RN-INF-02)', () => {
    const ids = (e: (typeof ENTIDADES_F2)[number]) => new Set(massa.registros[e].map((r) => r.external_id));
    const [fil, ven, fp, prd, cli] = [
      ids('filial'),
      ids('vendedor'),
      ids('forma_pagamento'),
      ids('produto'),
      ids('cliente'),
    ];
    const ref = (e: (typeof ENTIDADES_F2)[number], campo: string, alvo: Set<string>) => {
      for (const r of massa.registros[e])
        if (r[campo] !== undefined) expect(alvo.has(String(r[campo])), `${e}.${campo}`).toBe(true);
    };
    ref('vendedor', 'filial_external_id', fil);
    ref('prazo_pagamento', 'forma_external_id', fp);
    ref('produto_unidade', 'produto_external_id', prd);
    ref('preco', 'produto_external_id', prd);
    ref('preco', 'filial_external_id', fil);
    ref('estoque', 'produto_external_id', prd);
    ref('estoque', 'filial_external_id', fil);
    ref('cliente', 'filial_external_id', fil);
    ref('cliente', 'vendedor_external_id', ven);
    ref('cliente_endereco', 'cliente_external_id', cli);
    const formas = new Set(massa.registros.forma_pagamento.map((r) => r.codigo));
    for (const c of massa.registros.cliente)
      for (const f of c.formas_pagamento as string[]) expect(formas.has(f)).toBe(true);
  });

  it('regras do hub-v1: centavos inteiros, UTC com Z, quantidade numérica, documentos com DV e sem máscara', () => {
    for (const e of ENTIDADES_F2)
      for (const r of massa.registros[e]) {
        expect(r.alterado_em).toMatch(/Z$/);
        for (const [k, v] of Object.entries(r))
          if (k.endsWith('_cents')) expect(Number.isInteger(v), `${e}.${k}`).toBe(true);
      }
    for (const u of massa.registros.produto_unidade) expect(typeof u.fator).toBe('number');
    for (const s of massa.registros.estoque) expect(typeof s.saldo).toBe('number');
    for (const f of massa.registros.filial) expect(cnpjValido(String(f.cnpj))).toBe(true);
    const docs = massa.registros.cliente.map((c) => String(c.documento));
    expect(docs.every((d) => /^\d+$/.test(d))).toBe(true);
    expect(cpfValido(docs[0]!)).toBe(true);
    for (const d of docs.slice(1)) expect(cnpjValido(d)).toBe(true);
    expect(new Set(docs).size).toBe(docs.length);
  });

  it('é determinística: a mesma base dá os mesmos bytes (o reenvio se confere por igualdade)', () => {
    expect(JSON.stringify(montarMassaCenarioB())).toBe(JSON.stringify(massa));
    const outra = montarMassaCenarioB({ base: new Date('2026-11-25T00:00:00.000Z') });
    expect(outra.registros.filial[0]!.alterado_em).not.toBe(massa.registros.filial[0]!.alterado_em);
  });

  it('a contagem confere e os sensíveis cobrem documento, razão social e endereço dos clientes', () => {
    for (const e of ENTIDADES_F2) expect(massa.contagem[e]).toBe(massa.registros[e].length);
    for (const c of massa.registros.cliente) {
      expect(massa.sensiveis).toContain(c.documento);
      expect(massa.sensiveis).toContain(c.razao_social);
    }
    expect(massa.sensiveis.length).toBeGreaterThanOrEqual(3 * massa.registros.cliente.length);
  });

  it('o tamanho cresce por opção (a trava de 30% pede 10 produtos) e as unidades seguem o produto', () => {
    const grande = montarMassaCenarioB({ produtos: 10, clientes: 5 });
    expect(grande.contagem).toMatchObject({
      produto: 10,
      produto_unidade: 20,
      preco: 10,
      estoque: 10,
      cliente: 5,
      cliente_endereco: 5,
    });
    for (const e of ENTIDADES_F2)
      for (const r of grande.registros[e]) expect(PAYLOADS_HUB[e].safeParse(r).success, e).toBe(true);
  });
});

describe('cargaSemParte (trava de 30%, ADR 0014 §3)', () => {
  const produtos = montarMassaCenarioB({ produtos: 10 }).registros.produto;

  it('4 de 10 faltando = 40% (acima da trava); 3 de 10 = 30% (no limite)', () => {
    expect(cargaSemParte(produtos, 4)).toMatchObject({ candidatos: 4, percentual: 40 });
    expect(cargaSemParte(produtos, 4).registros).toHaveLength(6);
    expect(cargaSemParte(produtos, 3).percentual).toBe(30);
    expect(cargaSemParte(produtos, 0)).toMatchObject({ candidatos: 0, percentual: 0 });
  });

  it('recusa faixa inválida e não altera a lista de origem', () => {
    expect(() => cargaSemParte(produtos, 11)).toThrow(/fora da faixa/);
    expect(() => cargaSemParte(produtos, -1)).toThrow(/fora da faixa/);
    cargaSemParte(produtos, 5);
    expect(produtos).toHaveLength(10);
  });
});
