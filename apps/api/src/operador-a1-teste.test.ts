/**
 * Entrada do `operador.sh a1-teste` (T-0080, ADR 0008): argumentos, nome no titular e linhas da saída (só ids, estados
 * e datas). O caminho no PostgreSQL real fica no operador-a1-teste.db.test.ts; o operador.sh com o docker falso, no
 * packages/config/deploy-operador.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErroUsoA1Teste, lerArgsA1Teste, linhasA1Teste, nomeNoTitular, PADRAO_OPERADOR, type ResultadoA1Teste } from './a1-teste';
import { padraoDoFonte } from './apoio-operador-teste';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FONTE_COMUM = readFileSync(resolve(RAIZ, 'scripts', 'plataforma', 'comum.mjs'), 'utf8');
const FONTE_OPERADOR = readFileSync(resolve(RAIZ, 'scripts', 'deploy', 'producao', 'operador.sh'), 'utf8');
const FILIAL = '0b9d6f2e-6c1a-4f43-9b7e-1f2a3b4c5d6e';
const base = ['--empresa', 'AM2808', '--operador', 'op.teste'];

describe('a1-teste: argumentos', () => {
  it('PADRAO_OPERADOR igual ao do comum.mjs e ao do operador.sh', () => {
    expect(PADRAO_OPERADOR.source).toBe(padraoDoFonte(FONTE_COMUM, 'PADRAO_OPERADOR'));
    expect(FONTE_OPERADOR).toContain(`PADRAO_OPERADOR='${PADRAO_OPERADOR.source}'`);
  });

  it('simulação por padrão; código em minúscula (RN-CORE-11); filial opcional', () => {
    expect(lerArgsA1Teste(base)).toEqual({ empresa: 'am2808', filial: null, operador: 'op.teste', confirmar: false, substituir: false });
    expect(lerArgsA1Teste([...base, '--filial', FILIAL.toUpperCase(), '--substituir', '--confirmar'])).toEqual({
      empresa: 'am2808',
      filial: FILIAL,
      operador: 'op.teste',
      confirmar: true,
      substituir: true,
    });
  });

  it.each([
    ['sem empresa', ['--operador', 'op.teste']],
    ['código fora do formato', ['--empresa', 'AM28', '--operador', 'op.teste']],
    ['UF inexistente', ['--empresa', 'XX2808', '--operador', 'op.teste']],
    ['filial não UUID', [...base, '--filial', '12']],
    ['sem operador', ['--empresa', 'AM2808']],
    ['operador inválido', ['--empresa', 'AM2808', '--operador', 'Op Teste']],
    ['opção sem valor', [...base, '--filial']],
    ['opção desconhecida', [...base, '--senha', 'x']],
  ])('%s: erro de uso sem ecoar o valor', (_n, argv) => {
    expect(() => lerArgsA1Teste(argv)).toThrow(ErroUsoA1Teste);
    try {
      lerArgsA1Teste(argv);
    } catch (e) {
      expect((e as Error).message).not.toContain('Op Teste');
      expect((e as Error).message).not.toMatch(/--senha x|XX2808/);
    }
  });
});

describe('a1-teste: nome no titular (como o ICP-Brasil grava)', () => {
  it('sem acento, maiúscula, até 48 caracteres (o CN leva ":CNPJ")', () => {
    expect(nomeNoTitular('Comércio São João Ltda.')).toBe('COMERCIO SAO JOAO LTDA.');
    expect(nomeNoTitular(`Á${'b'.repeat(70)}`)).toHaveLength(48);
    expect(nomeNoTitular('***')).toBe('EMPRESA DE TESTE');
  });
});

describe('a1-teste: linhas da saída', () => {
  const r: ResultadoA1Teste = {
    estado: 'gerado',
    acao: 'gerar',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    filial_id: FILIAL,
    ambiente: 'homologacao',
    anterior: null,
    certificado_id: '22222222-2222-4222-8222-222222222222',
    valido_ate: new Date('2027-11-23T00:00:00Z'),
  };
  it('a última linha é o estado; só ids, estados e datas', () => {
    const l = linhasA1Teste(r);
    expect(l.at(-1)).toBe('estado: gerado');
    expect(l.join('\n')).toContain('gerado 22222222-2222-4222-8222-222222222222 (origem teste, válido até 2027-11-23');
    expect(linhasA1Teste({ ...r, estado: 'simulacao', certificado_id: null, valido_ate: null }).at(-1)).toBe('estado: simulacao');
    expect(linhasA1Teste({ ...r, estado: 'sem-mudanca', acao: 'manter' }).join('\n')).toContain('nada a fazer');
  });
});
