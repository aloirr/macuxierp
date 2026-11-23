import { describe, expect, it } from 'vitest';
import { ENTIDADES_CARGA } from '../../contracts';
import { motivoDependencia } from './dependencias';
import { LAYOUT } from './layout';
import { modeloCsv } from './modelo';
import { conferirReferencias, idsVazios } from './referencias';

describe('modelo CSV por entidade (RF-CAD-11)', () => {
  it.each(ENTIDADES_CARGA)('RF-CAD-11: modelo de %s tem BOM, ";", uma linha e obrigatórias primeiro, sem ignoradas', (e) => {
    const csv = modeloCsv(e);
    expect(csv.startsWith('﻿')).toBe(true);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toBe('');
    const cab = (linhas[0] as string).split(';');
    expect(cab.slice(0, LAYOUT[e].obrigatorias.length)).toEqual(LAYOUT[e].obrigatorias);
    expect(new Set(cab)).toEqual(new Set([...LAYOUT[e].obrigatorias, ...LAYOUT[e].usadas]));
    for (const i of LAYOUT[e].ignoradas.filter((c) => !LAYOUT[e].obrigatorias.includes(c))) expect(cab).not.toContain(i);
  });
});

describe('dependência entre arquivos (RF-CAD-11)', () => {
  it('RF-CAD-11: mensagem A0 com cadastro, coluna e plural, sem valor de célula', () => {
    expect(motivoDependencia('Preço', 'produto_external_id', 'produto')).toBe('Preço produto_external_id não encontrado: carregue o cadastro de produtos ou corrija a coluna produto_external_id.');
  });
  it('RF-CAD-11: com ou sem o arquivo no lote, a referência ausente é CARGA_DEPENDENCIA (erro da linha)', () => {
    const l = { linha: 2, external_id: 'U1', avisos: [], dados: { unidade: 'CX', fator: 120_000 }, refs: { produto: 'SUMIU' } };
    const r = conferirReferencias('produto_unidade', [l], idsVazios());
    expect(r.erros).toEqual([{ linha: 2, campo: 'produto_external_id', codigo: 'CARGA_DEPENDENCIA', motivo: 'Unidade do produto produto_external_id não encontrado: carregue o cadastro de produtos ou corrija a coluna produto_external_id.', entidade_faltante: 'produto' }]);
  });
});
