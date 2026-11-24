import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { mapearEValidar } from '../src/mapeamento';
import { parametrosCabecalho } from '../src/pedidos';
import { PedidoParaErp } from '../src/contrato';

const ler = (nome: string) => interpretarConfig(readFileSync(join(__dirname, '..', 'exemplos', nome), 'utf8'), 'json');
const cfg = ler('conector.exemplo.json').entidades.prazo_pagamento!;
const base = { external_id: 'P1', alterado_em: new Date('2026-03-01T10:00:00Z'), ativo: true, forma_external_id: 'F1', codigo: '30', descricao: '30 dias', parcelas_dias: '[30]', prazo_medio_dias: 30, ordem: 1 };
const rodar = (extra: Record<string, unknown>) => mapearEValidar('prazo_pagamento', cfg, [{ ...base, ...extra }]);

const UUID = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01';
const pedido = (extra: Record<string, unknown> = {}) =>
  PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'c1', vendedor_external_id: 'v1', condicao_pagamento_erp: '30D',
    criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 3000,
    itens: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 3, preco_unitario_cents: 1000, total_cents: 3000 }],
    ...extra,
  });
const pg = (extra: Record<string, unknown> = {}) => ({ forma_codigo: 'BOL', prazo_codigo: '30', parcelas_dias: [30], prazo_medio_dias: 30, ...extra });

/**
 * ADR 0014 §2: o prazo de pagamento da /entrada/v1 do Macuxi ERP não tem `percentual_ajuste` (nem `prazo_medio_dias`/`ordem`): no
 * FDV 1.5.0 o Conector lia o % da view (RN-INT-15); aqui o esquema recusa mapear o campo e os exemplos não o leem. O % continua
 * chegando no PEDIDO (bloco seguinte), só informativo.
 */
describe('RN-INT-15: % de ajuste do prazo fora do contrato da /entrada/v1 (ADR 0014 §2)', () => {
  it('RN-INT-15: mapear percentual_ajuste no prazo_pagamento é recusado com a lista dos campos do contrato', () => {
    const json = JSON.stringify({
      hub: { url: 'https://erp.exemplo.com.br', conectorId: 'cnx-1' },
      erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u' },
      entidades: { prazo_pagamento: { consulta: cfg.consulta, campos: { ...cfg.campos, percentual_ajuste: { coluna: 'percentual_ajuste', transformar: 'numero' } } } },
    });
    expect(() => interpretarConfig(json, 'json')).toThrow(/o contrato de "prazo_pagamento" não tem o campo "percentual_ajuste"/);
  });

  it('RN-INT-15: a coluna da view é ignorada (SELECT * continua igual) e o registro não leva a chave', () => {
    const r = rodar({ percentual_ajuste: -1.71 });
    expect(r.problemas).toEqual([]);
    expect(r.registros).toHaveLength(1);
    expect('percentual_ajuste' in (r.registros[0] ?? {})).toBe(false);
  });

  it('a lista de parcelas em JSON da view ([30], [28,56]) vira o texto do contrato do ERP ("30", "28/56")', () => {
    expect(rodar({}).registros[0]?.parcelas_dias).toBe('30');
    expect(rodar({ parcelas_dias: '[28,56]' }).registros[0]?.parcelas_dias).toBe('28/56');
    expect(rodar({ parcelas_dias: '[]' }).registros).toHaveLength(0);
  });

  it('RN-INT-15: os exemplos leem com SELECT * e não mapeiam percentual_ajuste', () => {
    for (const nome of ['conector.exemplo.json', 'conector.oracle.exemplo.json', 'conector.thathyany.exemplo.json']) {
      const e = ler(nome).entidades.prazo_pagamento;
      expect(e?.consulta, nome).toMatch(/SELECT (TOP \(:limite\) )?\* FROM /);
      expect(e?.campos.percentual_ajuste, nome).toBeUndefined();
    }
  });
});

describe('RN-INT-15: % de ajuste no pedido (Hub para ERP), só informativo', () => {
  it('RN-INT-15: pagamento.percentual_ajuste vira pagamento_percentual_ajuste', () => {
    expect(parametrosCabecalho(pedido({ pagamento: pg({ percentual_ajuste: -1.71 }) })).pagamento_percentual_ajuste).toBe(-1.71);
  });

  it('RN-INT-15: sem o campo ou sem pagamento, o parâmetro vai null', () => {
    expect(parametrosCabecalho(pedido({ pagamento: pg() })).pagamento_percentual_ajuste).toBeNull();
    expect(parametrosCabecalho(pedido()).pagamento_percentual_ajuste).toBeNull();
  });

  it('RN-INT-15: o Conector não recalcula preço nem total', () => {
    const p = pedido({ pagamento: pg({ percentual_ajuste: 5 }) });
    const c = parametrosCabecalho(p);
    expect(c.total_cents).toBe(p.total_cents);
    expect(c.desconto_total_cents).toBe(p.desconto_total_cents ?? null);
  });

  it('RN-INT-15: o EXEC do SQL Server e o INSERT do Oracle citam o parâmetro', () => {
    expect(ler('conector.exemplo.json').pedidos?.gravacao.cabecalho).toContain('@pagamento_percentual_ajuste = :pagamento_percentual_ajuste');
    const o = ler('conector.oracle.exemplo.json').pedidos?.gravacao.cabecalho ?? '';
    expect(o).toContain(', pagamento_percentual_ajuste)');
    expect(o).toContain(':pagamento_percentual_ajuste');
  });
});
