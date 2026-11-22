/**
 * Consumidor `integracao-fdv.publicar-cadastros` contra o PostgreSQL real (papel macuxierp_worker, RLS). Sem Postgres o teste
 * pula (`bash db/scripts/pg-local.sh`). T-0009 §1 (M1, M3, M9, M10) e §6.1; RN-INF-02, RN-INF-03.
 */
import type { EnvelopeEvento } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGORA, CNPJ_FILIAL_2, CNPJ_FILIAL_3, admSql, cadCliente, cadCondicao, cadFilial, cadPreco, cadProduto, cadTabela, cadVendedor, evento, licenciadas, U } from './apoio-conector-teste';
import { criarConsumidorPublicarCadastros } from './consumidor-cadastros';

describe.skipIf(!PG_DISPONIVEL)('consumidor publicar-cadastros no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let A: string;
  let B: string;
  let SEM: string;
  let adm: ReturnType<typeof admSql>;
  const consumidor = criarConsumidorPublicarCadastros({ licencas: licenciadas('integracao-fdv'), agora: () => AGORA });
  const semLicenca = criarConsumidorPublicarCadastros({ licencas: licenciadas(), agora: () => AGORA });
  const tratar = (t: string, e: EnvelopeEvento, c = consumidor): Promise<void> => banco.comTenant(t, (tx) => c.tratar(e, tx));
  const reg = async (t: string, entidade: string, chave: string) =>
    (await adm('SELECT payload, hash, pendente, ativo, alterado_em, erp_id, fonte_refs, hash_confirmado FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3', [t, entidade, chave]))[0];
  const cursor = async (t: string, e: string) => (await adm('SELECT proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2', [t, e]))[0];

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 4);
    A = await criarTenant(efemero.admin, 'cons-a', ['integracao-fdv']);
    B = await criarTenant(efemero.admin, 'cons-b', ['integracao-fdv']);
    SEM = await criarTenant(efemero.admin, 'cons-sem', []);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('M1: filial grava o espelho com a chave do external_id, a referência filial_padrao e acorda o envio', async () => {
    const f = U();
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-01' }), '2026-11-22T09:00:00.000Z'));
    const r = await reg(A, 'filial', 'FIL-01');
    expect(r!.payload).toMatchObject({ external_id: 'FIL-01', codigo: '0001', nome: 'Empresa LTDA', cidade: 'Manaus' });
    expect(r!.pendente).toBe(true);
    expect(r!.erp_id).toBe(f);
    expect(r!.fonte_refs).toEqual({});
    expect((await adm("SELECT erp_id FROM integracao_fdv.referencia WHERE tenant_id = $1 AND tipo = 'filial_padrao' AND deleted_at IS NULL", [A]))[0]!.erp_id).toBe(f);
    expect((await cursor(A, 'filial'))!.proximo_em.getTime()).toBe(AGORA.getTime());
  });

  it('RF-INF-04: a linha do sinal nasce com o primeiro evento (sinal já, reconciliação no próximo 06h00 UTC), sem tocar nas colunas da T-0016, e não é refeita', async () => {
    const t = await criarTenant(efemero.admin, 'cons-sinal', ['integracao-fdv']);
    const f = U();
    await tratar(t, evento(t, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-S' }), '2026-11-22T09:00:00.000Z'));
    const linha = () => adm('SELECT proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]);
    const [s1] = await linha();
    expect(s1!.proximo_sinal_em.getTime()).toBe(AGORA.getTime());
    expect(s1!.proxima_reconciliacao_em.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(s1!.proxima_busca_pedidos_em).toBeNull();
    expect(s1!.proximo_retorno_em).toBeNull();
    // a agenda já andou: um evento novo não a refaz
    await adm("UPDATE integracao_fdv.sinal SET proximo_sinal_em = '2026-11-22T10:01:00Z', proxima_busca_pedidos_em = '2026-11-22T10:00:30Z' WHERE tenant_id = $1", [t]);
    const f2 = U();
    await tratar(t, evento(t, 'cadastros.filial.alterada@1', f2, cadFilial(f2, { external_id: 'FIL-S2', padrao: false, cnpj: CNPJ_FILIAL_2 }), '2026-11-22T09:01:00.000Z'));
    const linhas = await linha();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.proximo_sinal_em.toISOString()).toBe('2026-11-22T10:01:00.000Z');
    expect(linhas[0]!.proxima_busca_pedidos_em.toISOString()).toBe('2026-11-22T10:00:30.000Z');
  });

  it('M9: sem licença do módulo nada é gravado (e o consumo segue sem erro)', async () => {
    const f = U();
    await tratar(SEM, evento(SEM, 'cadastros.filial.alterada@1', f, cadFilial(f), '2026-11-22T09:00:00.000Z'), semLicenca);
    expect(await adm('SELECT 1 FROM integracao_fdv.registro_publicado WHERE tenant_id = $1', [SEM])).toHaveLength(0);
    expect(await adm('SELECT 1 FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [SEM])).toHaveLength(0);
  });

  it('M10 e RN-INF-02: vendedor que chega antes da filial usa o UUID e é recomposto com a chave quando a filial chega', async () => {
    const f = U();
    const v = U();
    await tratar(A, evento(A, 'cadastros.vendedor.alterado@1', v, cadVendedor(v, f, { external_id: 'VEN-7' }), '2026-11-22T09:00:00.000Z'));
    expect((await reg(A, 'vendedor', 'VEN-7'))!.payload.filial_external_id).toBe(f);
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-02', padrao: false, cnpj: CNPJ_FILIAL_2 }), '2026-11-22T09:01:00.000Z'));
    const r = await reg(A, 'vendedor', 'VEN-7');
    expect(r!.payload.filial_external_id).toBe('FIL-02');
    expect(r!.pendente).toBe(true);
  });

  it('RN-INF-03: republicar o mesmo cadastro já confirmado não fica pendente (carga inicial C-4)', async () => {
    const f = U();
    const ev = () => evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-03', padrao: false, cnpj: CNPJ_FILIAL_3 }), '2026-11-22T09:05:00.000Z');
    await tratar(A, ev());
    const antes = await reg(A, 'filial', 'FIL-03');
    await adm('UPDATE integracao_fdv.registro_publicado SET hash_confirmado = hash, confirmado_em = $4, pendente = false WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3', [A, 'filial', 'FIL-03', AGORA]);
    await tratar(A, { ...ev(), ocorrido_em: '2026-11-22T09:30:00.000Z' });
    const depois = await reg(A, 'filial', 'FIL-03');
    expect(depois!.pendente).toBe(false);
    expect(depois!.alterado_em.getTime()).toBe(antes!.alterado_em.getTime());
    // mudança real volta a pendente
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-03', padrao: false, cnpj: CNPJ_FILIAL_3, razao_social: 'Outro Nome' }), '2026-11-22T09:40:00.000Z'));
    expect((await reg(A, 'filial', 'FIL-03'))!.pendente).toBe(true);
  });

  it('M3: evento mais velho que o já aplicado é descartado', async () => {
    const f = U();
    const novo = evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-04', padrao: false, cnpj: CNPJ_FILIAL_2, razao_social: 'Nome Novo' }), '2026-11-22T09:10:00.000Z');
    const velho = evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-04', padrao: false, cnpj: CNPJ_FILIAL_2, razao_social: 'Nome Velho' }), '2026-11-22T09:00:00.000Z');
    await tratar(A, novo);
    await tratar(A, velho);
    expect((await reg(A, 'filial', 'FIL-04'))!.payload.nome).toBe('Nome Novo');
  });

  it('M8 e C-2/M10: produto sem custo; preço sem tabela vai sem tabela_nome e a tabela recompõe; unidade retirada inativa', async () => {
    const f = U(); const p = U(); const t = U(); const u1 = U(); const u2 = U();
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { padrao: true, cnpj: CNPJ_FILIAL_3 }), '2026-11-22T09:20:00.000Z'));
    await tratar(A, evento(A, 'cadastros.produto.alterado@1', p, cadProduto(p, [{ id: u1, unidade: 'CX', fator: 10_000, ean: null }, { id: u2, unidade: 'UN', fator: 125, ean: null }]), '2026-11-22T09:00:00.000Z'));
    const prod = await reg(A, 'produto', p);
    expect(JSON.stringify(prod!.payload)).not.toMatch(/custo|7771777/);
    expect((await reg(A, 'produto_unidade', u2))!.payload.fator).toBe(0.0125);

    const preco = U();
    await tratar(A, evento(A, 'cadastros.preco.alterado@1', preco, cadPreco(t, f, p), '2026-11-22T09:02:00.000Z'));
    let r = await reg(A, 'preco', preco);
    expect(r!.payload.tabela_nome).toBeUndefined();
    await tratar(A, evento(A, 'cadastros.tabela_preco.alterada@1', t, cadTabela(t, { external_id: 'TAB-1' }), '2026-11-22T09:03:00.000Z'));
    r = await reg(A, 'preco', preco);
    expect(r!.payload).toMatchObject({ tabela_external_id: 'TAB-1', tabela_nome: 'Varejo', produto_external_id: p, preco_cents: 1990 });
    expect('filial_external_id' in r!.payload).toBe(false); // a filial padrão vale para todas (P-1)
    expect(r!.ativo).toBe(true);
    await tratar(A, evento(A, 'cadastros.tabela_preco.alterada@1', t, cadTabela(t, { external_id: 'TAB-1', inativo: true }), '2026-11-22T09:04:00.000Z'));
    expect((await reg(A, 'preco', preco))!.ativo).toBe(false);

    await tratar(A, evento(A, 'cadastros.produto.alterado@1', p, cadProduto(p, [{ id: u1, unidade: 'CX', fator: 10_000, ean: null }]), '2026-11-22T09:10:00.000Z'));
    expect((await reg(A, 'produto_unidade', u2))!.ativo).toBe(false);
    expect((await reg(A, 'produto_unidade', u1))!.ativo).toBe(true);
  });

  it('M10: estoque leva o nome da filial e chaves cruzadas; nome novo da filial recompõe', async () => {
    const f = U(); const p = U(); const ag = U();
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-E', padrao: false, cnpj: CNPJ_FILIAL_2, nome_fantasia: 'Loja Centro' }), '2026-11-22T09:00:00.000Z'));
    await tratar(A, evento(A, 'cadastros.produto.alterado@1', p, cadProduto(p, [], { external_id: 'PRD-E' }), '2026-11-22T09:00:00.000Z'));
    await tratar(A, evento(A, 'cadastros.estoque.alterado@1', ag, { filial_id: f, produto_id: p, quantidade: -15_000 }, '2026-11-22T09:01:00.000Z'));
    let r = await reg(A, 'estoque', ag);
    expect(r!.payload).toEqual({ external_id: ag, ativo: true, deposito_external_id: 'FIL-E', deposito_nome: 'Loja Centro', produto_external_id: 'PRD-E', saldo: -1.5, filial_external_id: 'FIL-E' });
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-E', padrao: false, cnpj: CNPJ_FILIAL_2, nome_fantasia: 'Loja Nova' }), '2026-11-22T09:02:00.000Z'));
    r = await reg(A, 'estoque', ag);
    expect(r!.payload.deposito_nome).toBe('Loja Nova');
  });

  it('T-0009 2.3 e 2.7: condição vira forma + prazo; cliente leva carteira, forma e prazo médio e o cliente_endereco a chave do cliente', async () => {
    const f = U(); const v = U(); const c = U(); const cli = U(); const end = U();
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-C', padrao: false, cnpj: CNPJ_FILIAL_3 }), '2026-11-22T09:00:00.000Z'));
    await tratar(A, evento(A, 'cadastros.vendedor.alterado@1', v, cadVendedor(v, f, { external_id: 'VEN-C' }), '2026-11-22T09:00:00.000Z'));
    await tratar(A, evento(A, 'cadastros.cliente.alterado@1', cli, cadCliente(cli, f, { external_id: 'CLI-C', vendedor_id: v, condicao_pagamento_id: c, enderecos: [{ id: end, tipo: 'principal', ...cadFilial(f).endereco }] }), '2026-11-22T09:01:00.000Z'));
    let cl = await reg(A, 'cliente', 'CLI-C');
    expect(cl!.payload).toMatchObject({ vendedor_external_id: 'VEN-C', filial_external_id: 'FIL-C' });
    expect(cl!.payload.formas_pagamento).toBeUndefined();
    expect(JSON.stringify(cl!.payload)).not.toMatch(/sigiloso|email/);
    expect((await reg(A, 'cliente_endereco', end))!.payload.cliente_external_id).toBe('CLI-C');
    // RD-0318: o erp_id vai na coluna; a forma de pagamento não tem registro próprio no ERP (nulo)
    expect((await reg(A, 'cliente', 'CLI-C'))!.erp_id).toBe(cli);
    expect((await reg(A, 'cliente_endereco', end))!.erp_id).toBe(end);

    await tratar(A, evento(A, 'cadastros.condicao_pagamento.alterada@1', c, cadCondicao(c, { external_id: 'PZ-C', forma_external_id: 'FP-BOL', forma_codigo: 'BOLETO', forma_nome: 'Boleto' }), '2026-11-22T09:02:00.000Z'));
    expect((await reg(A, 'forma_pagamento', 'FP-BOL'))!.payload).toMatchObject({ codigo: 'BOLETO', ativo: true });
    expect((await reg(A, 'forma_pagamento', 'FP-BOL'))!.erp_id).toBeNull();
    expect((await reg(A, 'prazo_pagamento', 'PZ-C'))!.erp_id).toBe(c);
    expect((await reg(A, 'prazo_pagamento', 'PZ-C'))!.payload).toMatchObject({ forma_external_id: 'FP-BOL', parcelas_dias: '28/56' });
    cl = await reg(A, 'cliente', 'CLI-C');
    expect(cl!.payload).toMatchObject({ formas_pagamento: ['BOLETO'], prazo_medio_max_dias: 42 });

    // condição inativada e sem outra com a mesma forma: a forma fica inativa
    await tratar(A, evento(A, 'cadastros.condicao_pagamento.alterada@1', c, cadCondicao(c, { external_id: 'PZ-C', forma_external_id: 'FP-BOL', forma_codigo: 'BOLETO', forma_nome: 'Boleto', inativo: true }), '2026-11-22T09:03:00.000Z'));
    expect((await reg(A, 'forma_pagamento', 'FP-BOL'))!.ativo).toBe(false);
  });

  it('RN-CAD-08: external_id novo do cadastro inativa o registro da chave antiga no Hub', async () => {
    const f = U();
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-OLD', padrao: false, cnpj: CNPJ_FILIAL_2 }), '2026-11-22T09:00:00.000Z'));
    await tratar(A, evento(A, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-NEW', padrao: false, cnpj: CNPJ_FILIAL_2 }), '2026-11-22T09:01:00.000Z'));
    expect((await reg(A, 'filial', 'FIL-OLD'))!.ativo).toBe(false);
    expect((await reg(A, 'filial', 'FIL-NEW'))!.ativo).toBe(true);
  });

  it('multi-tenant: o evento de um tenant não aparece no outro', async () => {
    const f = U();
    await tratar(B, evento(B, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-B' }), '2026-11-22T09:00:00.000Z'));
    expect(await reg(A, 'filial', 'FIL-B')).toBeUndefined();
    expect((await reg(B, 'filial', 'FIL-B'))!.payload.external_id).toBe('FIL-B');
    // via RLS do papel do worker: o tenant A não enxerga o espelho do B
    const vistos = await banco.comTenant(A, (tx) => tx.consultar<{ registro_external_id: string }>("SELECT registro_external_id FROM integracao_fdv.registro_publicado WHERE registro_external_id = 'FIL-B'"));
    expect(vistos).toHaveLength(0);
  });

  it('cursor_entidade: o consumidor só antecipa proximo_em (least), nunca adia', async () => {
    const f = U();
    await adm("INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em) VALUES ($1, 'vendedor', $2) ON CONFLICT (tenant_id, entidade) DO UPDATE SET proximo_em = EXCLUDED.proximo_em", [B, new Date(AGORA.getTime() - 60_000)]);
    await tratar(B, evento(B, 'cadastros.vendedor.alterado@1', U(), cadVendedor(U(), f), '2026-11-22T09:00:00.000Z'));
    expect((await cursor(B, 'vendedor'))!.proximo_em.getTime()).toBe(AGORA.getTime() - 60_000);
  });
});
