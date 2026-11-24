import { describe, expect, it } from 'vitest';
import { PERFIS, type Perfil } from '@macuxierp/platform-sdk';
import { criarClienteCore } from './cliente';
import { formatarCnpj, quadroEmpresaFiscal } from './empresa-fiscal';
import { PAGINAS_CORE, TEXTO_AMBIENTE_HOMOLOGACAO, paginasVisiveis } from './paginas';

const EMPRESA = { id: '3f2c2d8e-5a64-4f0d-9c53-0a6d7d2b1e11', razao_social: 'Comercial Rio Negro LTDA', nome_fantasia: 'Rio Negro', cnpj: '11222333000181', ie: '041234567', fuso: 'America/Manaus', updated_at: '2026-11-24T10:00:00.000Z' };
const F1 = '22222222-2222-4222-8222-222222222222';
const F2 = '33333333-3333-4333-8333-333333333333';

describe('T-0088: quadro de empresa e ambiente fiscal na tela ambiente (só exibição)', () => {
  it('RN-CORE-08: a tela ambiente só tem a volta para homologação; não há página nem botão novo de troca', () => {
    expect(PAGINAS_CORE.some((x) => x.id === 'empresa-fiscal')).toBe(false);
    const p = PAGINAS_CORE.find((x) => x.id === 'ambiente');
    expect(p?.botoes.map((b) => b.id)).toEqual(['voltar-homologacao']);
  });

  it('RN-CORE-08: o cliente do BKO só sabe voltar para homologação; nenhuma chamada manda produção', async () => {
    const corpos: unknown[] = [];
    const c = criarClienteCore({
      baseUrl: 'http://x',
      token: () => 't',
      fetch: async (_u, init) => {
        corpos.push(init.body);
        return { status: 200, json: async () => ({ filial_id: F1, ambiente: 'homologacao', recado_aprovacao: null }) };
      },
    });
    await c.voltarParaHomologacao(F1);
    expect(corpos).toEqual([JSON.stringify({ ambiente: 'homologacao' })]);
    expect(Object.keys(c).filter((k) => /produ/i.test(k))).toEqual([]);
  });

  it('RN-CORE-02: administrador, fiscal e faturista veem a tela ambiente; os demais perfis, não (a API também barra)', () => {
    const quem = (PERFIS as readonly Perfil[]).filter((p) => paginasVisiveis(p).some((x) => x.id === 'ambiente'));
    expect([...quem].sort()).toEqual(['administrador', 'faturista', 'fiscal']);
  });

  it('RN-CORE-08: o quadro usa o ambiente da API, ordena por filial e só traz o texto de produção havendo homologação', () => {
    const q = quadroEmpresaFiscal(
      EMPRESA as never,
      [
        { filial_id: F2, ambiente: 'producao', recado_aprovacao: 'R-1' },
        { filial_id: F1, ambiente: 'homologacao', recado_aprovacao: null },
      ],
      { [F1]: 'Matriz Manaus', [F2]: 'Filial Parintins' },
    );
    expect(q.filiais.map((f) => [f.filial, f.rotulo, f.ambiente])).toEqual([
      ['Filial Parintins', 'Produção', 'producao'],
      ['Matriz Manaus', 'Homologação', 'homologacao'],
    ]);
    expect(q.empresa).toMatchObject({ cnpj: '11.222.333/0001-81', razao_social: 'Comercial Rio Negro LTDA', fuso: 'America/Manaus' });
    expect(q.texto_homologacao).toBe(TEXTO_AMBIENTE_HOMOLOGACAO);
    const so = quadroEmpresaFiscal(EMPRESA as never, [{ filial_id: F2, ambiente: 'producao', recado_aprovacao: 'R-1' }]);
    expect(so.texto_homologacao).toBeNull();
  });

  it('sem o nome da filial a tela mostra o id curto; CNPJ fora do padrão volta como veio', () => {
    expect(quadroEmpresaFiscal(EMPRESA as never, [{ filial_id: F1, ambiente: 'homologacao', recado_aprovacao: null }]).filiais[0]?.filial).toBe('22222222');
    expect(formatarCnpj('abc')).toBe('abc');
  });
});
