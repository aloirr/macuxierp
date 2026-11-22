import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './apoio-teste';
import { filialValida, produtoValido } from './fixtures-teste';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';
import { criarResolvedorChaveErp } from './resolvedor-chave';

const tx = { consultar: async () => [] };

describe('ResolvedorChaveErp no dublê em memória (ADR 0010, item 2)', () => {
  it('ADR 0010: external_id acha, UUID canônico sem external_id acha, o com external_id não acha pelo id, o desconhecido fica fora', async () => {
    const { repos, deps } = dependenciasEmMemoria();
    const kit = await repos.produtos.inserir({ ...produtoValido(), external_id: 'P0001' } as never);
    const erp = await repos.produtos.inserir(produtoValido({ codigo: 'P2' }) as never);
    const inativo = await repos.produtos.inserir({ ...produtoValido({ codigo: 'P3' }), external_id: 'P0003' } as never);
    await repos.produtos.inativar(inativo.id);
    const r = criarResolvedorChaveErp(deps.repositorios);
    const m = await r.resolver(tx, 'produto', [kit.external_id as string, kit.id, erp.id, erp.id.toUpperCase(), 'P0003', randomUUID(), 'X']);
    expect(Object.fromEntries(m)).toEqual({ P0001: kit.id, [erp.id]: erp.id, P0003: inativo.id });
  });
  it('ADR 0010: entidade desconhecida (inclusive tabela_preco e estoque) devolve mapa vazio', async () => {
    const { repos, deps } = dependenciasEmMemoria();
    const p = await repos.produtos.inserir({ ...produtoValido(), external_id: 'P0001' } as never);
    for (const e of ['pedido', 'tabela_preco', 'estoque', 'condicao_pagamento', '', 'toString', '__proto__']) {
      expect((await criarResolvedorChaveErp(deps.repositorios).resolver(tx, e, ['P0001', p.id])).size, e).toBe(0);
    }
  });
  it('RD-0317: UUID fora do formato canônico (maiúsculo, sem hífen) não acha pelo id', async () => {
    const { repos, deps } = dependenciasEmMemoria();
    const p = await repos.produtos.inserir(produtoValido() as never);
    expect((await criarResolvedorChaveErp(deps.repositorios).resolver(tx, 'produto', [p.id.toUpperCase(), p.id.replaceAll('-', '')])).size).toBe(0);
  });
});

describe('guarda do external_id na API em memória (RD-0317, RN-CORE-05)', () => {
  it('RN-CORE-05: POST e PATCH recusam external_id que é o id de outro registro; o inativo conta', async () => {
    const { deps, repos } = dependenciasEmMemoria();
    const a = criarAmbiente(criarPluginCadastros(deps), undefined, tx);
    const f = await repos.filiais.inserir(filialValida() as never);
    const g = await repos.filiais.inserir(filialValida({ cnpj: '11444777000161', padrao: false, emissora: false }) as never);
    await repos.filiais.inativar(g.id);
    for (const alvo of [f.id, g.id]) {
      const r = await a.chamar('POST', '/filiais', { corpo: filialValida({ cnpj: '11222333000262', padrao: false, emissora: false, external_id: alvo }) });
      expect([r.status, r.corpo.codigo]).toEqual([422, 'RN-CORE-05']);
    }
    const p = await a.chamar('PATCH', `/filiais/${f.id}`, { corpo: { external_id: g.id } });
    expect([p.status, p.corpo.codigo]).toEqual([422, 'RN-CORE-05']);
    const proprio = await a.chamar('PATCH', `/filiais/${f.id}`, { corpo: { external_id: f.id } });
    expect([proprio.status, proprio.corpo.codigo]).toEqual([422, 'RN-CORE-05']);
    expect((await a.chamar('PATCH', `/filiais/${f.id}`, { corpo: { external_id: 'F-KIT' } })).status).toBe(200);
  });
});
