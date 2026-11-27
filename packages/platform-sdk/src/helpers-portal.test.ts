import { describe, expect, it } from 'vitest';
import { ErroApi } from './erros';
import { ESCALA_QTD4, qtd4Inteira } from './formatar';
import { ACOES_PLATAFORMA, uuidDaRota } from './plataforma-rotas';
import { FRASE_ZERAR_DADOS, FraseZerarDados, MENSAGEM_FRASE_ZERAR } from './portal-cargas';

const UUID = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';

describe('uuidDaRota (RD-1820)', () => {
  it('devolve o UUID do parâmetro (padrão `id`, ou o nome pedido)', () => {
    expect(uuidDaRota({ id: UUID })).toBe(UUID);
    expect(uuidDaRota({ filial_id: UUID.toUpperCase() }, 'filial_id')).toBe(UUID.toUpperCase());
  });
  it('fora do formato ou ausente: 400 VALIDACAO só no campo do parâmetro', () => {
    for (const [params, nome] of [[{ id: 'x' }, 'id'], [{}, 'id'], [{ id: UUID }, 'outro']] as const) {
      try {
        uuidDaRota(params, nome);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ErroApi);
        expect(e).toMatchObject({ status: 400, codigo: 'VALIDACAO', campos: { [nome]: 'UUID inválido' } });
      }
    }
  });
});

describe('FraseZerarDados (RD-1824)', () => {
  it('aceita a frase sem diferenciar maiúsculas e ponto final; recusa outra com a mensagem do Zerar', () => {
    expect(FraseZerarDados.safeParse(` ${FRASE_ZERAR_DADOS.toUpperCase()}. `).success).toBe(true);
    const r = FraseZerarDados.safeParse('zerar');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(MENSAGEM_FRASE_ZERAR);
  });
  it('acima de 200 caracteres: "Frase longa demais"', () => {
    expect(FraseZerarDados.safeParse('a'.repeat(201)).error?.issues[0]?.message).toBe('Frase longa demais');
  });
});

describe('ESCALA_QTD4 e qtd4Inteira (RD-1831)', () => {
  it('Qtd4 inteira = múltipla de 10.000; fração, valor não inteiro e infinito = false', () => {
    for (const q of [0, 10_000, -20_000, 9_999 * ESCALA_QTD4]) expect(qtd4Inteira(q)).toBe(true);
    for (const q of [1, 12_500, -5_000, 10_000.5, Number.POSITIVE_INFINITY, Number.NaN]) expect(qtd4Inteira(q)).toBe(false);
  });
});

describe('ações da ficha da empresa (T-0101, ADR 0012)', () => {
  it('atualizar_receita e revelar_contato estão em ACOES_PLATAFORMA', () => {
    expect(ACOES_PLATAFORMA).toEqual(expect.arrayContaining(['plataforma.empresa.atualizar_receita', 'plataforma.empresa.revelar_contato']));
  });

  it('salvar_ficha e trocar_cnpj (RN-CORE-16, gravadas pela 0077) estão em ACOES_PLATAFORMA', () => {
    expect(ACOES_PLATAFORMA).toEqual(expect.arrayContaining(['plataforma.empresa.salvar_ficha', 'plataforma.empresa.trocar_cnpj']));
  });
});
