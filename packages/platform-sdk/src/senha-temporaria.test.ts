import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { regrasDescumpridas } from './senha';
import {
  ALFABETO_SENHA_TEMPORARIA,
  CLASSES_SENHA_TEMPORARIA,
  gerarSenhaTemporaria,
  regrasDescumpridasTemporaria,
  senhaTemporariaNoFormato,
  TAMANHO_SENHA_TEMPORARIA,
} from './senha-temporaria';

describe('senha temporária (44 B): fonte única do alfabeto e do gerador', () => {
  it('só letras e números, sem os que se confundem (0/O/o, 1/I/i/l, 2/Z, 5/S, 8/B), e cerca de 100 bits', () => {
    expect(ALFABETO_SENHA_TEMPORARIA).toMatch(/^[A-Za-z0-9]+$/);
    for (const c of '0Oo1Iil2Z5S8B') expect(ALFABETO_SENHA_TEMPORARIA, c).not.toContain(c);
    expect(new Set(ALFABETO_SENHA_TEMPORARIA).size).toBe(ALFABETO_SENHA_TEMPORARIA.length);
    expect(ALFABETO_SENHA_TEMPORARIA).toHaveLength(48);
    expect(TAMANHO_SENHA_TEMPORARIA * Math.log2(ALFABETO_SENHA_TEMPORARIA.length)).toBeGreaterThan(100);
  });

  it('500 senhas: 18 caracteres do alfabeto, uma de cada classe, todas diferentes e com a classe em posições variadas', () => {
    const sortear = (n: number) => randomInt(n);
    const senhas = Array.from({ length: 500 }, () => gerarSenhaTemporaria(sortear));
    for (const s of senhas) {
      expect(senhaTemporariaNoFormato(s), s).toBe(true);
      expect(regrasDescumpridasTemporaria(s)).toEqual([]);
    }
    expect(new Set(senhas).size).toBe(500);
    const posicaoDoDigito = new Set(senhas.map((s) => [...s].findIndex((c) => CLASSES_SENHA_TEMPORARIA[2].includes(c))));
    expect(posicaoDoDigito.size).toBeGreaterThan(3);
  });

  it('isenta só da regra "especial": a regra do usuário continua pedindo o especial', () => {
    const s = gerarSenhaTemporaria((n) => randomInt(n));
    expect(regrasDescumpridas(s)).toEqual(['especial']);
    expect(regrasDescumpridasTemporaria(s)).toEqual([]);
    expect(regrasDescumpridasTemporaria('abcdefgh')).toEqual(['numero']);
    expect(regrasDescumpridasTemporaria('1234')).toEqual(expect.arrayContaining(['caracteres', 'letra']));
  });

  it('fora do formato: tamanho, caractere confundível ou classe faltando', () => {
    expect(senhaTemporariaNoFormato('Aa3'.repeat(6))).toBe(true);
    expect(senhaTemporariaNoFormato('Aa3'.repeat(5))).toBe(false);
    expect(senhaTemporariaNoFormato('Aa0'.repeat(6))).toBe(false);
    expect(senhaTemporariaNoFormato('aa3'.repeat(6))).toBe(false);
  });
});
