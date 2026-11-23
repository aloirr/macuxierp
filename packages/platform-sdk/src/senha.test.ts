import { describe, expect, it } from 'vitest';
import {
  EXEMPLO_ESPECIAIS,
  MENSAGEM_SENHA_ATUAL_INCORRETA,
  MENSAGEM_SENHA_FORA_DA_REGRA,
  MENSAGEM_SENHA_IGUAL,
  MENSAGEM_SENHA_OK,
  REGRAS_SENHA,
  ROTULOS_OLHO_SENHA,
  SENHA_MAXIMA,
  SENHA_MINIMA,
  SenhaNova,
  TITULO_REGRAS_SENHA,
  erroSenhaForaDaRegra,
  regrasDescumpridas,
} from './senha';

describe('regra única de senha do ERP (RN-CORE-32 do FDV; T-0052, Alexandre 23/11 10h01 de Manaus)', () => {
  it('exporta os textos da tela iguais aos do FDV', () => {
    expect(TITULO_REGRAS_SENHA).toBe('A senha precisa ter');
    expect(MENSAGEM_SENHA_OK).toBe('A senha atende às regras.');
    expect(EXEMPLO_ESPECIAIS).toBe('! @ # $');
    expect(ROTULOS_OLHO_SENHA).toEqual({ mostrar: 'Mostrar senha', ocultar: 'Ocultar senha' });
    expect(Object.isFrozen(ROTULOS_OLHO_SENHA)).toBe(true);
  });

  it('exporta limites, mensagens e as regras na ordem, congeladas', () => {
    expect(SENHA_MINIMA).toBe(8);
    expect(SENHA_MAXIMA).toBe(200);
    expect(MENSAGEM_SENHA_FORA_DA_REGRA).toBe('A senha não atende às regras');
    expect(MENSAGEM_SENHA_IGUAL).toBe('A senha nova precisa ser diferente da atual');
    expect(MENSAGEM_SENHA_ATUAL_INCORRETA).toBe('Senha atual incorreta. Confira e digite de novo.');
    expect(REGRAS_SENHA).toEqual([
      { id: 'caracteres', texto: '8 caracteres ou mais' },
      { id: 'letra', texto: 'Uma letra' },
      { id: 'numero', texto: 'Um número' },
      { id: 'especial', texto: 'Um caractere especial' },
    ]);
    expect(Object.isFrozen(REGRAS_SENHA)).toBe(true);
    expect(REGRAS_SENHA.every((r) => Object.isFrozen(r))).toBe(true);
  });

  it('aceita "abcdef1!" e acento como letra ("çãõ1234!")', () => {
    expect(regrasDescumpridas('abcdef1!')).toEqual([]);
    expect(regrasDescumpridas('çãõ1234!')).toEqual([]);
    expect(SenhaNova.parse('abcdef1!')).toBe('abcdef1!');
  });

  it('aponta a regra que falta', () => {
    expect(regrasDescumpridas('abcdefg1')).toEqual(['especial']);
    expect(regrasDescumpridas('abcdefg!')).toEqual(['numero']);
    expect(regrasDescumpridas('1234567!')).toEqual(['letra']);
    expect(regrasDescumpridas('ab1!')).toEqual(['caracteres']);
  });

  it('espaço em branco não conta como caractere especial', () => {
    expect(regrasDescumpridas('abcd 123')).toEqual(['especial']);
    expect(regrasDescumpridas('abc\t1234')).toEqual(['especial']);
  });

  it('devolve os ids na ordem de REGRAS_SENHA', () => {
    expect(regrasDescumpridas('')).toEqual(['caracteres', 'letra', 'numero', 'especial']);
    expect(regrasDescumpridas('!!')).toEqual(['caracteres', 'letra', 'numero']);
  });

  it('SenhaNova: um issue por regra, mensagem = texto e params.regra = id', () => {
    const r = SenhaNova.safeParse('abc');
    expect(r.success).toBe(false);
    const issues = r.error?.issues ?? [];
    expect(issues.map((i) => i.message)).toEqual(['8 caracteres ou mais', 'Um número', 'Um caractere especial']);
    expect(issues.map((i) => (i as { params?: { regra?: string } }).params?.regra)).toEqual(['caracteres', 'numero', 'especial']);
  });

  it('SenhaNova recusa mais de 200 caracteres', () => {
    expect(SenhaNova.safeParse('a1!' + 'x'.repeat(198)).success).toBe(false);
    expect(SenhaNova.safeParse('a1!' + 'x'.repeat(197)).success).toBe(true);
  });

  it('erroSenhaForaDaRegra monta mensagem, campo, texto e detalhes; null quando cumpre', () => {
    expect(erroSenhaForaDaRegra('abcdef1!')).toBeNull();
    expect(erroSenhaForaDaRegra('abc')).toEqual({
      mensagem: 'A senha não atende às regras',
      campo: 'senha_nova',
      texto: '8 caracteres ou mais; Um número; Um caractere especial',
      detalhes: ['caracteres', 'numero', 'especial'],
    });
  });
});
