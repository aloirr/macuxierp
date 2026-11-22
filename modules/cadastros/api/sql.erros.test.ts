import { ErroApi } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { repositoriosSql } from './sql';

const comErro = (e: object) => repositoriosSql({ consultar: async () => { throw Object.assign(new Error('violou check com valor 4111111111111111'), e); } });
const criar = (e: object) => comErro(e).condicoesPagamento.inserir({ codigo: 'X', descricao: 'X', forma_tpag: '03', prazos_dias: [30] } as never).catch((x: unknown) => x);

describe('tradução de erros do Postgres no adaptador SQL', () => {
  it.each(['condicao_parcelas_cartao_forma_ck', 'condicao_parcelas_cartao_ck'])('RN-CAD-09: 23514 do CHECK %s vira 422 RN-CAD-09 sem ecoar valores', async (constraint) => {
    const e = (await criar({ code: '23514', schema: 'cadastros', table: 'condicao_pagamento', constraint })) as ErroApi;
    expect(e).toBeInstanceOf(ErroApi);
    expect({ status: e.status, codigo: e.codigo }).toEqual({ status: 422, codigo: 'RN-CAD-09' });
    expect(JSON.stringify([e.message, e.campos])).not.toContain('4111');
  });
  it('RN-CAD-09: 23514 de outra constraint da mesma tabela NÃO vira RN-CAD-09', async () => {
    const e = (await criar({ code: '23514', schema: 'cadastros', table: 'condicao_pagamento', constraint: 'condicao_outra_ck' })) as Error;
    expect(e).not.toBeInstanceOf(ErroApi);
    expect(e.message).toContain('violou');
  });
  it('erro desconhecido passa intacto', async () => {
    expect(((await criar({ code: 'XX000' })) as Error).message).toContain('violou');
  });
});
