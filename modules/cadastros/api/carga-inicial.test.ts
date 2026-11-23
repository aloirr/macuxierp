import type { EnvelopeEvento, FilaDeTrabalhos, Outbox, PedidoTrabalho, Trabalho, Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EVENTO_CARGA_INICIAL, TRABALHO_CARGA_INICIAL, EVENTOS } from '../contracts';
import { TAMANHO_PAGINA_CARGA, criarConsumidorCargaInicial, criarExecutorCargaInicial, entidadesPedidas } from './carga-inicial';
import { CNPJ_A, ENDERECO_AM, clienteValido, filialValida } from './fixtures-teste';
import { repositoriosEmMemoria } from './memoria';
import { TENANT } from './apoio-teste';

const tx: Transacao = { consultar: async () => [] };
const ORIGEM = '33333333-3333-4333-8333-333333333333';

function ambiente() {
  const repos = repositoriosEmMemoria();
  const fila = new Map<string, PedidoTrabalho & { id: string }>();
  const filaPorta: FilaDeTrabalhos = {
    async enfileirar(_tx, p) {
      const chave = `${p.tenant_id}|${p.external_id}`;
      const ja = fila.get(chave);
      if (ja) return { id: ja.id };
      const id = `t${fila.size + 1}`;
      fila.set(chave, { ...p, id });
      return { id };
    },
  };
  const gravados: EnvelopeEvento[] = [];
  const outbox: Outbox = { gravar: async (_tx, e) => gravados.push(e) };
  const consumidor = criarConsumidorCargaInicial({ fila: filaPorta });
  const executor = criarExecutorCargaInicial({ repositorios: () => repos, fila: filaPorta, outbox, agora: () => new Date('2026-11-21T15:00:00Z') });
  const solicitar = (payload: Record<string, unknown>, tenant = TENANT) =>
    consumidor.tratar({ id: ORIGEM, nome: EVENTO_CARGA_INICIAL, tenant_id: tenant, agregado_id: tenant, versao: 1, ocorrido_em: '2026-11-21T15:00:00.000Z', ator: 'sistema', request_id: 'r', payload }, tx);
  /** Roda a fila até esvaziar (como o worker). */
  async function drenar() {
    const feitos = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const proximo = [...fila.values()].find((t) => !feitos.has(t.id));
      if (!proximo) return feitos.size;
      feitos.add(proximo.id);
      await executor.executar({ ...proximo, tentativas: 0 } as Trabalho, tx);
    }
    throw new Error('fila não esvaziou');
  }
  return { repos, fila, gravados, consumidor, executor, solicitar, drenar };
}

describe('carga inicial: consumidor tolerante (C-4)', () => {
  it('declara o evento que consome e aceita campo extra no payload', async () => {
    const a = ambiente();
    expect(a.consumidor.eventos).toEqual(['integracao-fdv.carga_inicial.solicitada@1']);
    await a.solicitar({ entidades: ['cliente'], motivo: 'primeira_credencial', conector_id: 'x' });
    expect([...a.fila.values()].map((t) => t.payload)).toEqual([{ origem: ORIGEM, entidade: 'cliente', apos: null, tabela_id: null, pagina: 1, cursor_itens: null }]);
    expect([...a.fila.values()][0]?.tipo).toBe(TRABALHO_CARGA_INICIAL);
  });
  it('ignora entidade desconhecida, traduz nomes do Hub e não duplica entidade', async () => {
    const a = ambiente();
    await a.solicitar({ entidades: ['nota', 'titulo', 'cliente_endereco', 'cliente', 'prazo_pagamento', 'forma_pagamento', 'filial'] });
    expect([...a.fila.values()].map((t) => t.payload.entidade)).toEqual(['filial', 'condicao_pagamento', 'cliente']);
    expect(entidadesPedidas(['x', 'preco'])).toEqual(['preco']);
  });
  it('payload sem entidades válidas não falha nem enfileira', async () => {
    const a = ambiente();
    await a.solicitar({ outra: 1 });
    await a.solicitar({ entidades: 'cliente' });
    expect(a.fila.size).toBe(0);
  });
  it('reentrega do mesmo evento não duplica trabalho', async () => {
    const a = ambiente();
    await a.solicitar({ entidades: ['cliente'] });
    await a.solicitar({ entidades: ['cliente'] });
    expect(a.fila.size).toBe(1);
  });
});

describe('carga inicial: trabalho paginado (C-4)', () => {
  const semear = async (a: ReturnType<typeof ambiente>, n: number) => {
    const filial = await a.repos.filiais.inserir(filialValida() as never);
    for (let i = 0; i < n; i++) {
      const doc = String(10_000_000_000_000 + i);
      const c = await a.repos.clientes.inserir(clienteValido(filial.id, { documento: doc, enderecos: [{ ...ENDERECO_AM, tipo: 'principal' }] }) as never);
      if (i % 7 === 0) await a.repos.clientes.inativar(c.id);
    }
    return filial.id;
  };

  it('com mais de uma página, republica todos os clientes, inativos incluídos, com payload válido', async () => {
    const a = ambiente();
    a.repos.oficiais.municipios.set('1302603', 'Manaus');
    const n = TAMANHO_PAGINA_CARGA * 2 + 5;
    await semear(a, n);
    await a.solicitar({ entidades: ['cliente'] });
    const trabalhos = await a.drenar();
    expect(trabalhos).toBe(3);
    expect(a.gravados).toHaveLength(n);
    expect(new Set(a.gravados.map((e) => e.agregado_id)).size).toBe(n);
    expect(a.gravados.every((e) => e.nome === 'cadastros.cliente.alterado@1' && e.tenant_id === TENANT && e.ator === 'sistema' && e.versao === 1)).toBe(true);
    expect(a.gravados.filter((e) => e.payload.inativo === true).length).toBe(Math.ceil(n / 7));
    for (const e of a.gravados) {
      expect(() => EVENTOS['cadastros.cliente.alterado@1'].parse(e.payload)).not.toThrow();
      expect((e.payload.enderecos as { id: string; municipio_nome: string }[])[0]).toMatchObject({ municipio_nome: 'Manaus' });
    }
  });
  it('só republica o tenant da solicitação: o trabalho leva o tenant do evento', async () => {
    const a = ambiente();
    const outro = '99999999-9999-4999-8999-999999999999';
    await a.solicitar({ entidades: ['filial'] }, outro);
    expect([...a.fila.values()].every((t) => t.tenant_id === outro)).toBe(true);
    await semear(a, 1);
    await a.drenar();
    expect(a.gravados.every((e) => e.tenant_id === outro)).toBe(true); // o repositório já é o da transação do tenant (RLS)
  });
  it('reprocessar a mesma solicitação não cria trabalho novo; rodar de novo a última página repete só aquela página', async () => {
    const a = ambiente();
    await semear(a, TAMANHO_PAGINA_CARGA + 1);
    await a.solicitar({ entidades: ['cliente'] });
    await a.drenar();
    const trabalhos = a.fila.size;
    const eventos = a.gravados.length;
    await a.solicitar({ entidades: ['cliente'] });
    expect(a.fila.size).toBe(trabalhos);
    const ultimo = [...a.fila.values()].at(-1) as PedidoTrabalho & { id: string };
    await a.executor.executar({ ...ultimo, tentativas: 1 } as Trabalho, tx);
    expect(a.fila.size).toBe(trabalhos);
    expect(a.gravados.length).toBe(eventos + 1);
  });
  it('cobre filial, tabela de preço, preço, produto, vendedor, condição e estoque', async () => {
    const a = ambiente();
    const f = await a.repos.filiais.inserir(filialValida({ cnpj: CNPJ_A }) as never);
    const prod = await a.repos.produtos.inserir({ codigo: 'P1', descricao: 'X', ncm: '22021000', unidade_comercial: 'UN', unidade_tributavel: 'UN', grupo_tributacao: 'B' } as never);
    const tab = await a.repos.tabelasPreco.inserir({ nome: 'T', padrao: true, vigencia_inicio: '2026-01-01', vigencia_fim: null } as never);
    await a.repos.tabelasPreco.gravarLote(tab.id, [{ filial_id: f.id, produto_id: prod.id, preco_centavos: 100, desconto_maximo_bp: 0 }]);
    await a.repos.vendedores.inserir({ codigo: 'V1', nome: 'Ana', filial_id: f.id, usuario_id: null, external_id: null } as never);
    await a.repos.condicoesPagamento.inserir({ codigo: 'C1', descricao: 'à vista', forma_tpag: '01', prazos_dias: [0] } as never);
    await a.repos.estoque.gravarMovimento({ filial_id: f.id, produto_id: prod.id } as never, 50_0000);
    await a.solicitar({ entidades: ['filial', 'tabela_preco', 'preco', 'produto', 'vendedor', 'condicao_pagamento', 'estoque'] });
    await a.drenar();
    expect(a.gravados.map((e) => e.nome).sort()).toEqual([
      'cadastros.condicao_pagamento.alterada@1', 'cadastros.estoque.alterado@1', 'cadastros.filial.alterada@1', 'cadastros.preco.alterado@1',
      'cadastros.produto.alterado@1', 'cadastros.tabela_preco.alterada@1', 'cadastros.vendedor.alterado@1',
    ]);
  });
  it('ADR 0010 / RN-CORE-05 (C-10): a republicação leva o external_id de preço, unidade e endereço', async () => {
    const a = ambiente();
    const f = await a.repos.filiais.inserir(filialValida({ cnpj: CNPJ_A }) as never);
    const prod = await a.repos.produtos.inserir({ codigo: 'P1', descricao: 'X', ncm: '22021000', unidade_comercial: 'UN', unidade_tributavel: 'UN', grupo_tributacao: 'B' } as never);
    await a.repos.produtos.unidades.inserir(prod.id, { unidade: 'CX', fator: 120_000, ean: null, external_id: 'PU-1' } as never);
    const tab = await a.repos.tabelasPreco.inserir({ nome: 'T', padrao: true, vigencia_inicio: '2026-01-01', vigencia_fim: null } as never);
    await a.repos.carga.gravarItemPreco({ tabelaId: tab.id, filialId: f.id, produtoId: prod.id, preco_centavos: 100, desconto_maximo_bp: 0, desconto_herdado: true, externalId: 'PR-1', inativo: false });
    await a.repos.clientes.inserir(clienteValido(f.id, { enderecos: [{ ...ENDERECO_AM, tipo: 'principal', external_id: 'CE-1' }] }) as never);
    await a.solicitar({ entidades: ['preco', 'produto', 'cliente'] });
    await a.drenar();
    const payload = (n: string) => a.gravados.find((e) => e.nome === n)!.payload as Record<string, unknown>;
    expect(payload('cadastros.preco.alterado@1').external_id).toBe('PR-1');
    expect((payload('cadastros.produto.alterado@1').unidades as { external_id: string }[]).map((u) => u.external_id)).toEqual(['PU-1']);
    expect((payload('cadastros.cliente.alterado@1').enderecos as { external_id: string }[]).map((u) => u.external_id)).toEqual(['CE-1']);
  });
});
