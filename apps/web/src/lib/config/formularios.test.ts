import { CriarEmpresaEntrada } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { traduzirCriarEmpresa } from './formularios';

const parse = (codigo: string, nome: string) => CriarEmpresaEntrada.safeParse({ codigo: codigo.trim() || undefined, nome, fuso: undefined });

describe('traduzirCriarEmpresa', () => {
  it('nome em branco e código vazio mostram os dois erros juntos', () => {
    const p = parse('', '');
    const c = traduzirCriarEmpresa(p.success ? null : p.error, '');
    expect(c.codigo).toBe('Informe o código do FDV.');
    expect(c.nome).toBe('Informe o nome da empresa (2 a 120 caracteres).');
  });
  it('código fora do padrão usa a mensagem da regra', () => {
    const p = parse('xx', 'Acme');
    expect(traduzirCriarEmpresa(p.success ? null : p.error, 'xx').codigo).toBe('Código fora do padrão. Veja a regra acima.');
  });
});
