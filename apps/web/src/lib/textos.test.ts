import { describe, expect, it } from 'vitest';
import * as textos from './textos';

describe('RD-T1 (v0.3.22): um texto só para cada retorno', () => {
  it('nenhum texto exportado se repete, nem quase (sem o "agora"/"em instantes")', () => {
    const base = (t: string) => t.toLowerCase().replace(/\bagora\b|\bem instantes\b/g, '').replace(/[^a-zà-ú]+/g, ' ').trim();
    const valores = Object.values(textos).filter((v): v is string => typeof v === 'string');
    expect(new Set(valores.map(base)).size).toBe(valores.length);
  });
  it('a falha sem texto da API é o FALHA; o antigo ERRO_CONCLUIR saiu', () => {
    expect(textos.FALHA).toBe('Não foi possível concluir agora. Tente de novo em instantes.');
    expect('ERRO_CONCLUIR' in textos).toBe(false);
  });
});
