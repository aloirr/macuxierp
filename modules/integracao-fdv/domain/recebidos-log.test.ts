import { describe, expect, it } from 'vitest';
import { decidirRecebidosDoLog, motivoDaRecusaCliente } from './recebidos-log';
import type { LinhaClienteRecebido } from './pre-cadastro-cliente';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const linha = (n: number, o: Partial<LinhaClienteRecebido> = {}): LinhaClienteRecebido => ({
  id: U(n), cliente_uuid: U(100 + n), codigo_fdv: null, razao_social: 'Mercado Sol', documento_mascarado: '11.222.333/****-**',
  vendedor_external_id: 'V-1', recebido_em: new Date('2026-11-26T12:00:00.000Z'), revisao: 1, situacao: 'aceito', motivo: null, erros: [],
  cliente_id: U(200 + n), payload_expurgado_em: null, retorno: 'enviado', ...o,
});

describe('recebidos do Log (RN-INF-09; LGPD)', () => {
  it('RN-INF-09: só o cadastro de cliente leva recebidos; os outros saem vazios e com total 0', () => {
    expect(decidirRecebidosDoLog({ entidade: 'produto', linhas: [linha(1)], limite: 10 })).toEqual({ recebidos: [], total: 0 });
    expect(decidirRecebidosDoLog({ entidade: 'cliente_endereco', linhas: [linha(1)], limite: 10 })).toEqual({ recebidos: [], total: 0 });
    const r = decidirRecebidosDoLog({ entidade: 'cliente', linhas: [linha(1)], limite: 10 });
    expect(r.recebidos).toHaveLength(1);
    expect(r.total).toBe(1);
  });
  it('corta no limite e mantém o total real informado (nunca menor que o devolvido)', () => {
    const linhas = [linha(1), linha(2), linha(3)];
    expect(decidirRecebidosDoLog({ entidade: 'cliente', linhas, limite: 2 })).toMatchObject({ total: 3 });
    expect(decidirRecebidosDoLog({ entidade: 'cliente', linhas, limite: 2 }).recebidos).toHaveLength(2);
    expect(decidirRecebidosDoLog({ entidade: 'cliente', linhas, limite: 2, totalNoBanco: 40 }).total).toBe(40);
    expect(decidirRecebidosDoLog({ entidade: 'cliente', linhas, limite: 2, totalNoBanco: 1 }).total).toBe(3);
    expect(decidirRecebidosDoLog({ entidade: 'cliente', linhas, limite: 0 }).recebidos).toEqual([]);
  });
  it('LGPD: o documento só sai mascarado; valor cru ou inteiro vira nulo', () => {
    const r = decidirRecebidosDoLog({ entidade: 'cliente', limite: 10, linhas: [linha(1, { documento_mascarado: '11222333000181' }), linha(2, { documento_mascarado: '123.456.789-09' }), linha(3)] });
    expect(r.recebidos.map((c) => c.documento_mascarado)).toEqual([null, null, '11.222.333/****-**']);
    expect(JSON.stringify(r)).not.toContain('11222333000181');
  });
  it('RN-INF-09: a recusa por vendedor sai com o código e o motivo; erros só com campo, código e mensagem', () => {
    const r = decidirRecebidosDoLog({
      entidade: 'cliente', limite: 10,
      linhas: [linha(1, { situacao: 'recusado', cliente_id: null, motivo: 'recusado', erros: [{ campo: 'vendedor_external_id', codigo: 'vendedor_fdv_inativo', mensagem: 'm', valor: 'segredo' }] })],
    });
    expect(r.recebidos[0]!.erros).toEqual([{ campo: 'vendedor_external_id', codigo: 'vendedor_fdv_inativo', mensagem: 'm' }]);
  });
  it('RN-INF-09: motivo legível dos códigos de recusa, com os de vendedor; código desconhecido nunca ecoa texto', () => {
    expect(motivoDaRecusaCliente('vendedor_fdv_nao_encontrado')).toMatch(/Vendedor não encontrado/);
    expect(motivoDaRecusaCliente('vendedor_fdv_inativo')).toMatch(/Vendedor inativo/);
    expect(motivoDaRecusaCliente('documento_ja_cadastrado')).toMatch(/Já existe/);
    expect(motivoDaRecusaCliente('texto livre 123.456.789-09')).not.toContain('123');
    expect(motivoDaRecusaCliente(null)).toBe(motivoDaRecusaCliente('qualquer_coisa'));
  });
});
