import { describe, expect, it } from 'vitest';
import { ENTIDADES_CARGA } from '../../contracts';
import { ARQUIVO_DO_ALVO, DEPENDENCIAS, motivoDependencia } from './dependencias';
import { LAYOUT } from './layout';
import { modeloCsv } from './modelo';
import { REFS_CARGA, conferirReferencias, idsVazios } from './referencias';

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
  it.each(ENTIDADES_CARGA)('RF-CAD-11: DEPENDENCIAS de %s bate com o que REFS_CARGA usa', (e) => {
    const usadas = new Set(Object.values(REFS_CARGA[e]).map((a) => ARQUIVO_DO_ALVO[a]));
    expect(new Set(DEPENDENCIAS[e])).toEqual(usadas);
  });
  it('RF-CAD-11: mensagem fixa no plural, sem valor de célula', () => {
    expect(motivoDependencia('produto')).toBe('Faltam produtos: carregue produto.csv antes.');
  });
  it('RF-CAD-11: sem o arquivo no lote é CARGA_DEPENDENCIA; com ele, CARGA_REFERENCIA', () => {
    const l = { linha: 2, external_id: 'U1', avisos: [], dados: { unidade: 'CX', fator: 120_000 }, refs: { produto: 'SUMIU' } };
    const sem = conferirReferencias('produto_unidade', [l], idsVazios(), new Set(['produto_unidade']));
    expect(sem.erros).toEqual([{ linha: 2, campo: 'produto_external_id', codigo: 'CARGA_DEPENDENCIA', motivo: 'Faltam produtos: carregue produto.csv antes.', entidade_faltante: 'produto' }]);
    const com = conferirReferencias('produto_unidade', [l], idsVazios(), new Set(['produto_unidade', 'produto']));
    expect(com.erros[0]?.codigo).toBe('CARGA_REFERENCIA');
  });
});
