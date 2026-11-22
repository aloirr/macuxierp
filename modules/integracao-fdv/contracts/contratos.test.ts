import { describe, expect, it } from 'vitest';
import { CorpoLote, CredencialEntrada, ENTIDADES_CARGA_INICIAL, EVENTOS, EVENTO_CARGA_INICIAL, EVENTO_LOTE_FALHOU, LinhaInvalida } from './index';

const corpo = { versao_contrato: 'v1', entidade: 'produto', enviado_em: '2026-11-21T20:00:00.000Z', cursor: null, registros: [], linhas_invalidas: [], linhas_invalidas_omitidas: 0 };

describe('contratos do módulo', () => {
  it('RF-INF-02: completo exige sessão; delta não tem sessão', () => {
    const sessao = { id: '11111111-1111-4111-8111-111111111111', parte: 1, ultimo: true };
    expect(CorpoLote.safeParse({ ...corpo, modo: 'completo' }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'completo', sessao }).success).toBe(true);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'delta', sessao }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'delta' }).success).toBe(true);
  });

  it('RN-INF-04: campo do erro segue o formato do banco', () => {
    const l = (campo: string | null) => LinhaInvalida.safeParse({ external_id: 'a', codigo: 'campo_invalido', campo }).success;
    expect(l('endereco.cidade')).toBe(true);
    expect(l('itens[0]')).toBe(true);
    expect(l(null)).toBe(true);
    expect(l('com espaço')).toBe(false);
    expect(l('x'.repeat(81))).toBe(false);
  });

  it('RF-INF-05: chave da credencial sem espaço e com no mínimo 32 caracteres', () => {
    const c = (chave: string) => CredencialEntrada.safeParse({ conector_id: 'erp-1', chave, ambiente: 'teste' }).success;
    expect(c('a'.repeat(32))).toBe(true);
    expect(c('a'.repeat(31))).toBe(false);
    expect(c(`${'a'.repeat(32)} b`)).toBe(false);
  });

  it('C-4: carga inicial pede lista explícita; lote.falhou traz o estado', () => {
    expect(EVENTOS[EVENTO_CARGA_INICIAL].safeParse({ entidades: [] }).success).toBe(false);
    expect(EVENTOS[EVENTO_CARGA_INICIAL].safeParse({ entidades: ['preco', 'tabela_preco'] }).success).toBe(true);
    expect(ENTIDADES_CARGA_INICIAL).toHaveLength(12);
    const f = { lote_envio_id: '11111111-1111-4111-8111-111111111111', entidade: 'produto', modo: 'delta', geracao: 1, codigo: 'rede', tentativas: 3, falhou_em: '2026-11-21T20:00:00.000Z' };
    expect(EVENTOS[EVENTO_LOTE_FALHOU].safeParse({ ...f, estado: 'recusado' }).success).toBe(true);
    expect(EVENTOS[EVENTO_LOTE_FALHOU].safeParse({ ...f, estado: 'concluido' }).success).toBe(false);
  });
});
