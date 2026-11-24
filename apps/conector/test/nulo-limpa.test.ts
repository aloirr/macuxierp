/**
 * T-0099 do FDV: opt-in por campo `"nulo": "limpa"` no conector.json. Com ele, o NULL da view iria como `null` e LIMPARIA o campo;
 * sem ele (padrão, `"omite"`), o NULL some do registro e o destino mantém o que tinha.
 *
 * Macuxi ERP (ADR 0014 §2): nenhum campo do contrato da /entrada/v1 aceita `null` (os opcionais são só "ausente"). Então o esquema
 * recusa `"limpa"` em todo campo e os exemplos não o usam; `"omite"` segue valendo. O mapeamento do `null` fica no código (provado
 * abaixo com a configuração montada por fora do esquema) e volta a valer quando o SDK aceitar nulo em algum campo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErroConfig, interpretarConfig } from '../src/config/carregar';
import { campoAceitaNulo } from '../src/config/entidades';
import type { EntidadeConfig } from '../src/config/esquema';
import { mapearEValidar, mapearLinha } from '../src/mapeamento';
import { processarFila } from '../src/remetente';
import { sincronizarEntidade } from '../src/sincronizador';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

const CONSULTA = '/*cliente*/ SELECT * FROM v WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND external_id > :cursor_external_id) ORDER BY alterado_em, external_id LIMIT :limite';
const CAMPOS = {
  external_id: 'external_id',
  alterado_em: 'alterado_em',
  razao_social: 'razao_social',
  ativo: { valor: true },
  filial_external_id: { valor: 'F1' },
  limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal', nulo: 'omite' },
  prazo_medio_max_dias: { coluna: 'prazo', transformar: 'inteiro' }, // sem opt-in: omite
  formas_pagamento: { coluna: 'formas', transformar: 'json' },
  'endereco.cidade': { coluna: 'cidade' },
  vendedor_external_id: { coluna: 'vendedor', nulo: 'omite' },
};

const configCom = (campos: Record<string, unknown>) =>
  interpretarConfig(
    JSON.stringify({
      hub: { url: 'https://h.example.com', conectorId: 'cnx-1' },
      erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u' },
      entidades: { cliente: { consulta: CONSULTA, campos } },
    }),
    'json',
  );
const erroDe = (campos: Record<string, unknown>) => {
  try {
    configCom(campos);
  } catch (e) {
    if (e instanceof ErroConfig) return e.message;
    throw e;
  }
  return '';
};

const T = new Date('2026-03-01T10:00:00.000Z');

describe('conector.json: "nulo" na definição do campo', () => {
  it('aceita "omite" (o padrão) em campo opcional, inclusive com caminho', () => {
    const cfg = configCom(CAMPOS).entidades.cliente as EntidadeConfig;
    expect(cfg.campos.limite_credito_cents).toMatchObject({ nulo: 'omite' });
    expect(cfg.campos.vendedor_external_id).toMatchObject({ nulo: 'omite' });
  });

  it('ADR 0014 §2: recusa "limpa" em todo campo do cliente da /entrada/v1 (nenhum aceita nulo), com o caminho e a orientação', () => {
    for (const [campo, coluna] of [['limite_credito_cents', 'limite'], ['formas_pagamento', 'formas'], ['endereco.cidade', 'cidade'], ['vendedor_external_id', 'vendedor'], ['prazo_medio_max_dias', 'prazo']] as const) {
      expect(erroDe({ ...CAMPOS, [campo]: { coluna, nulo: 'limpa' } }), campo).toMatch(new RegExp(`campos\\.${campo.replace('.', '\\.')}\\.nulo.*"nulo": "limpa" só vale para campo que o contrato aceita nulo`));
    }
  });

  it('recusa "limpa" em campo obrigatório (razao_social, external_id, alterado_em), com o caminho e a orientação', () => {
    expect(erroDe({ ...CAMPOS, razao_social: { coluna: 'razao_social', nulo: 'limpa' } })).toMatch(/entidades\.cliente\.campos\.razao_social\.nulo.*"razao_social" de "cliente" é obrigatório/);
    expect(erroDe({ ...CAMPOS, external_id: { coluna: 'external_id', nulo: 'limpa' } })).toMatch(/campos\.external_id\.nulo/);
    expect(erroDe({ ...CAMPOS, alterado_em: { coluna: 'alterado_em', nulo: 'limpa' } })).toMatch(/campos\.alterado_em\.nulo/);
  });

  it('recusa valor desconhecido e "nulo" fora da forma { coluna }', () => {
    expect(erroDe({ ...CAMPOS, limite_credito_cents: { coluna: 'limite', nulo: 'apaga' } })).toMatch(/limite_credito_cents/);
    expect(erroDe({ ...CAMPOS, limite_credito_cents: { valor: 1, nulo: 'omite' } })).toMatch(/limite_credito_cents/);
  });

  it('campoAceitaNulo segue o schema do contrato (na /entrada/v1, nenhum campo aceita nulo)', () => {
    for (const campo of ['limite_credito_cents', 'endereco.cidade', 'formas_pagamento', 'razao_social', 'external_id', 'nao_existe', 'razao_social.x']) {
      expect(campoAceitaNulo('cliente', campo), campo).toBe(false);
    }
  });

  it('os exemplos (SQL Server, Oracle e thathyany) validam com o schema e não usam "nulo": "limpa"', () => {
    for (const nome of ['conector.exemplo.json', 'conector.oracle.exemplo.json', 'conector.thathyany.exemplo.json']) {
      const cfg = interpretarConfig(readFileSync(join(__dirname, '..', 'exemplos', nome), 'utf8'), 'json');
      for (const e of Object.values(cfg.entidades)) {
        for (const spec of Object.values((e as EntidadeConfig).campos)) expect(typeof spec === 'object' && 'nulo' in spec ? spec.nulo : 'omite', nome).toBe('omite');
      }
    }
  });
});

describe('mapeamento com "nulo"', () => {
  /** Configuração montada por fora do esquema (o esquema do ERP recusaria o "limpa"): prova o mapeamento que fica no código. */
  const comLimpa = (): EntidadeConfig => {
    const c = configCom(CAMPOS).entidades.cliente as EntidadeConfig;
    return { ...c, campos: { ...c.campos, limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal', nulo: 'limpa' }, 'endereco.cidade': { coluna: 'cidade', nulo: 'limpa' } } };
  };

  it('NULL com "limpa" vira null no registro, mas o contrato do ERP recusa a linha; sem opt-in ou com "omite", o campo some e a linha passa', () => {
    const linha = { external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: null, prazo: null, formas: null, cidade: null, vendedor: null };
    const m = mapearLinha(comLimpa(), linha, 0);
    expect(m.registro).toMatchObject({ limite_credito_cents: null, endereco: { cidade: null } });
    expect(m.registro).not.toHaveProperty('prazo_medio_max_dias');
    expect(m.registro).not.toHaveProperty('vendedor_external_id');
    expect(mapearEValidar('cliente', comLimpa(), [linha]).invalidas).toBe(1);
    const semLimpa = mapearEValidar('cliente', configCom({ ...CAMPOS, limite_credito_cents: { valor: 0 } }).entidades.cliente as EntidadeConfig, [linha]);
    expect(semLimpa.invalidas).toBe(0);
    expect(semLimpa.registros[0]).not.toHaveProperty('formas_pagamento');
    expect(semLimpa.registros[0]).not.toHaveProperty('endereco');
  });

  it('valor presente com "limpa" segue a transformação normal; coluna que não veio na linha continua omitida', () => {
    const m = mapearLinha(comLimpa(), { external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: '12.34', formas: '["PIX"]' }, 0);
    expect(m.registro).toMatchObject({ limite_credito_cents: 1234, formas_pagamento: ['PIX'] });
    expect(m.registro).not.toHaveProperty('endereco');
  });

  it('sem nenhum opt-in o registro é idêntico ao da v1 (nulos omitidos)', () => {
    const semOptIn = configCom({ external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social', limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal' } }).entidades.cliente as EntidadeConfig;
    const m = mapearLinha(semOptIn, { external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: null }, 0);
    expect(m.registro).toEqual({ external_id: 'C1', alterado_em: T.toISOString(), razao_social: 'Mercado' });
  });
});

describe('ponta a ponta: o NULL omitido chega ao ERP sem a chave', () => {
  let amb: Ambiente | undefined;
  afterEach(async () => amb?.encerrar());

  it('o registro do lote não leva formas_pagamento nem prazo_medio_max_dias (NULL omitido) e leva a cidade', async () => {
    amb = await criarAmbiente({ entidades: { cliente: { consulta: CONSULTA, campos: CAMPOS } } });
    amb.erp.definir('cliente', [{ external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: '10.00', prazo: null, formas: null, cidade: 'Boa Vista', vendedor: null }]);
    await sincronizarEntidade(amb.ctx, 'cliente');
    for (let i = 0; i < 3; i++) {
      await processarFila(amb.ctx);
      amb.relogio.avancar(6_000);
    }
    const reg = amb.hub.envelopes[0]?.registros[0] as Record<string, unknown>;
    expect(reg).toMatchObject({ external_id: 'C1', limite_credito_cents: 1000, endereco: { cidade: 'Boa Vista' } });
    expect(reg).not.toHaveProperty('formas_pagamento');
    expect(reg).not.toHaveProperty('prazo_medio_max_dias');
    expect(reg).not.toHaveProperty('vendedor_external_id');
  });
});
