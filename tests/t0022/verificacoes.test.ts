// T-0022 (F4): testes reais das verificações puras do arnês e da coerência da matriz das 20 notas.
// Não dependem do faturamento (T-0019, T-0021): rodam hoje, sem banco nem simulador.
import { describe, expect, it } from 'vitest';
import {
  BASE_PENDENTE,
  COBERTURA_OBRIGATORIA,
  DEPENDENCIAS,
  FILIAIS,
  FILIAL_LOTE_A1,
  FILIAL_LOTE_A2,
  FILIAL_LOTE_B1,
  INUTILIZACOES,
  MATRIZ,
  TENANT_LOTE_A,
  TENANT_LOTE_B,
  dependeDe,
} from './apoio/matriz';
import { conferirNumeracaoPorSerie, conferirSequencia, NUMERO_MAXIMO_NFE, rotuloSerie } from './apoio/numeracao';

describe('RN-FAT-01: conferirSequencia (uma série)', () => {
  it('sequência contínua a partir de 1 não tem buraco', () => {
    expect(conferirSequencia([1, 2, 3, 4])).toEqual({
      ok: true,
      buracos: [],
      duplicados: [],
      inutilizadosUsados: [],
      invalidos: [],
      faixasInvalidas: [],
    });
  });

  it('a ordem de chegada não importa (concorrência)', () => {
    expect(conferirSequencia([3, 1, 4, 2]).ok).toBe(true);
  });

  it('série vazia está ok', () => {
    expect(conferirSequencia([]).ok).toBe(true);
  });

  it('acusa o buraco no meio e o começo que não é 1', () => {
    expect(conferirSequencia([1, 2, 4]).buracos).toEqual([3]);
    expect(conferirSequencia([3, 4]).buracos).toEqual([1, 2]);
  });

  it('faixa inutilizada é o único buraco permitido', () => {
    const r = conferirSequencia([1, 2, 5, 6], [{ inicio: 3, fim: 4 }]);
    expect(r.ok).toBe(true);
  });

  it('inutilização de um número só (início = fim)', () => {
    expect(conferirSequencia([1, 3], [{ inicio: 2, fim: 2 }]).ok).toBe(true);
  });

  it('inutilização que não cobre o buraco inteiro deixa o resto acusado', () => {
    expect(conferirSequencia([1, 5], [{ inicio: 2, fim: 3 }]).buracos).toEqual([4]);
  });

  it('inutilização no fim da série conta como ocupada; buraco antes dela é acusado', () => {
    expect(conferirSequencia([1, 2], [{ inicio: 3, fim: 5 }]).ok).toBe(true);
    expect(conferirSequencia([1], [{ inicio: 3, fim: 5 }]).buracos).toEqual([2]);
  });

  it('número repetido é acusado (reserva fora da transação ou reenvio com número novo)', () => {
    const r = conferirSequencia([1, 2, 2, 3, 3, 3]);
    expect(r.ok).toBe(false);
    expect(r.duplicados).toEqual([2, 3]);
    expect(r.buracos).toEqual([]);
  });

  it('número usado e também inutilizado é acusado', () => {
    const r = conferirSequencia([1, 2, 3], [{ inicio: 2, fim: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.inutilizadosUsados).toEqual([2]);
  });

  it('números fora do intervalo da NF-e são acusados', () => {
    const r = conferirSequencia([0, 1, 2.5, -3, NUMERO_MAXIMO_NFE + 1]);
    expect(r.ok).toBe(false);
    expect(r.invalidos).toEqual([-3, 0, 2.5, NUMERO_MAXIMO_NFE + 1]);
    expect(r.buracos).toEqual([]);
  });

  it('faixa invertida ou fora do intervalo é acusada e não tapa buraco', () => {
    const r = conferirSequencia(
      [1, 4],
      [
        { inicio: 3, fim: 2 },
        { inicio: 0, fim: 0 },
      ],
    );
    expect(r.ok).toBe(false);
    expect(r.faixasInvalidas).toEqual([
      { inicio: 3, fim: 2 },
      { inicio: 0, fim: 0 },
    ]);
    expect(r.buracos).toEqual([2, 3]);
  });

  it('aceita início diferente de 1 (série migrada de outro emissor)', () => {
    expect(conferirSequencia([101, 102], [], 101).ok).toBe(true);
    expect(conferirSequencia([102], [], 101).buracos).toEqual([101]);
  });

  it('número reservado no fim da série sem nota é buraco (ultimoReservado entra no topo)', () => {
    expect(conferirSequencia([1, 2], [], 1, 4).buracos).toEqual([3, 4]);
    expect(conferirSequencia([1, 2], [], 1, 2).ok).toBe(true);
    expect(conferirSequencia([], [], 1, 0).ok).toBe(true);
    expect(conferirSequencia([1, 2], [{ inicio: 3, fim: 4 }], 1, 4).ok).toBe(true);
  });

  it('ultimoReservado fora do intervalo é acusado e não mexe no topo', () => {
    const r = conferirSequencia([1], [], 1, -1);
    expect(r.invalidos).toEqual([-1]);
    expect(r.buracos).toEqual([]);
  });
});

describe('RN-FAT-01: conferirNumeracaoPorSerie (por tenant, filial e série)', () => {
  it('séries, filiais e tenants diferentes são sequências independentes', () => {
    const r = conferirNumeracaoPorSerie([
      { tenant: 't1', filial: 'f1', serie: 1, numero: 1 },
      { tenant: 't1', filial: 'f1', serie: 1, numero: 2 },
      { tenant: 't1', filial: 'f1', serie: 2, numero: 1 },
      { tenant: 't1', filial: 'f2', serie: 1, numero: 1 },
      { tenant: 't2', filial: 'f1', serie: 1, numero: 1 },
    ]);
    expect([...r.keys()]).toEqual(['t1/f1/serie-1', 't1/f1/serie-2', 't1/f2/serie-1', 't2/f1/serie-1']);
    expect([...r.values()].every((x) => x.ok)).toBe(true);
  });

  it('o mesmo número em séries diferentes não é duplicado; na mesma série é', () => {
    const r = conferirNumeracaoPorSerie([
      { tenant: 't1', filial: 'f1', serie: 1, numero: 1 },
      { tenant: 't1', filial: 'f1', serie: 1, numero: 1 },
      { tenant: 't1', filial: 'f2', serie: 1, numero: 1 },
    ]);
    expect(r.get('t1/f1/serie-1')?.duplicados).toEqual([1]);
    expect(r.get('t1/f2/serie-1')?.ok).toBe(true);
  });

  it('a inutilização vale só para a série em que foi feita', () => {
    const r = conferirNumeracaoPorSerie(
      [
        { tenant: 't1', filial: 'f1', serie: 1, numero: 1 },
        { tenant: 't1', filial: 'f1', serie: 1, numero: 3 },
        { tenant: 't1', filial: 'f1', serie: 2, numero: 1 },
        { tenant: 't1', filial: 'f1', serie: 2, numero: 3 },
      ],
      [{ tenant: 't1', filial: 'f1', serie: 1, inicio: 2, fim: 2 }],
    );
    expect(r.get('t1/f1/serie-1')?.ok).toBe(true);
    expect(r.get('t1/f1/serie-2')?.buracos).toEqual([2]);
  });

  it('série só com inutilização aparece no resultado', () => {
    const r = conferirNumeracaoPorSerie([], [{ tenant: 't1', filial: 'f1', serie: 9, inicio: 1, fim: 2 }]);
    expect(r.get('t1/f1/serie-9')?.ok).toBe(true);
  });

  it('o último reservado vale só para a própria série e acusa reserva sem nota', () => {
    const r = conferirNumeracaoPorSerie(
      [
        { tenant: 't1', filial: 'f1', serie: 1, numero: 1 },
        { tenant: 't1', filial: 'f1', serie: 2, numero: 1 },
      ],
      [],
      [
        { tenant: 't1', filial: 'f1', serie: 1, numero: 2 },
        { tenant: 't1', filial: 'f1', serie: 2, numero: 1 },
        { tenant: 't1', filial: 'f2', serie: 1, numero: 1 },
      ],
    );
    expect(r.get('t1/f1/serie-1')?.buracos).toEqual([2]);
    expect(r.get('t1/f1/serie-2')?.ok).toBe(true);
    expect(r.get('t1/f2/serie-1')?.buracos).toEqual([1]);
  });
});

describe('T-0022: coerência da matriz das 20 notas', () => {
  it('tem exatamente N01 a N20, em ordem e sem repetição', () => {
    expect(MATRIZ.map((n) => n.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('a numeração planejada não tem buraco fora da inutilização nem número repetido', () => {
    const r = conferirNumeracaoPorSerie(MATRIZ, INUTILIZACOES);
    for (const [serie, res] of r) expect(res, serie).toMatchObject({ ok: true });
    expect([...r.keys()]).toEqual([
      rotuloSerie({ tenant: TENANT_LOTE_A, filial: FILIAL_LOTE_A1, serie: 1 }),
      rotuloSerie({ tenant: TENANT_LOTE_A, filial: FILIAL_LOTE_A1, serie: 2 }),
      rotuloSerie({ tenant: TENANT_LOTE_A, filial: FILIAL_LOTE_A2, serie: 1 }),
      rotuloSerie({ tenant: TENANT_LOTE_B, filial: FILIAL_LOTE_B1, serie: 1 }),
    ]);
  });

  it('toda nota sai de filial homologada do próprio tenant', () => {
    for (const n of MATRIZ) {
      expect(FILIAIS[n.filial], n.id).toMatchObject({ tenant: n.tenant, ambiente: 'homologacao' });
    }
  });

  it('cobre todos os itens obrigatórios do plano', () => {
    const cobertos = new Set(MATRIZ.flatMap((n) => n.cobertura));
    expect(COBERTURA_OBRIGATORIA.filter((c) => !cobertos.has(c))).toEqual([]);
  });

  it('toda nota autorizada consome número: cobre autorização e numeração, com regra, entrada e esperado', () => {
    for (const n of MATRIZ) {
      expect(n.cobertura, n.id).toEqual(expect.arrayContaining(['autorizacao', 'numeracao']));
      expect(n.regras.length, n.id).toBeGreaterThan(0);
      for (const r of n.regras)
        expect(r, n.id).toMatch(/^(RN-(CORE|FAT|FIS|PED)-\d{2}|RF-FAT-\d{2}|CLAUDE-\d)$/);
      expect(n.entrada.length, n.id).toBeGreaterThan(10);
      expect(n.esperado.length, n.id).toBeGreaterThan(10);
    }
  });

  it('a faixa de INUTILIZACOES fica entre a N08 e a N09, na mesma série', () => {
    const [faixa] = INUTILIZACOES;
    const n08 = MATRIZ.find((n) => n.id === 'N08');
    const n09 = MATRIZ.find((n) => n.id === 'N09');
    expect(rotuloSerie(n08!)).toBe(rotuloSerie(faixa!));
    expect(rotuloSerie(n09!)).toBe(rotuloSerie(faixa!));
    expect([n08?.numero, n09?.numero]).toEqual([faixa!.inicio - 1, faixa!.fim + 1]);
  });

  it('dependências: alemDaBase não repete nem traz item de BASE_PENDENTE; toda dependência descrita é usada', () => {
    for (const n of MATRIZ) {
      expect(new Set(n.alemDaBase).size, n.id).toBe(n.alemDaBase.length);
      expect(n.alemDaBase.filter((d) => BASE_PENDENTE.includes(d)), n.id).toEqual([]);
    }
    const usadas = new Set(MATRIZ.flatMap(dependeDe));
    expect(Object.keys(DEPENDENCIAS).filter((d) => !usadas.has(d as keyof typeof DEPENDENCIAS))).toEqual([]);
  });
});
