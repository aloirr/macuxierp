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

  it('RF-INF-04: a linha do sinal nasce com o primeiro evento (sinal já, reconciliação no próximo 06h00 UTC), com a busca de pedidos ligada (A4) e o retorno desligado, e não é refeita', async () => {
    const t = await criarTenant(efemero.admin, 'cons-sinal', ['integracao-fdv']);
    const f = U();
    await tratar(t, evento(t, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-S' }), '2026-11-22T09:00:00.000Z'));
    const linha = () => adm('SELECT proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]);
    const [s1] = await linha();
    expect(s1!.proximo_sinal_em.getTime()).toBe(AGORA.getTime());
    expect(s1!.proxima_reconciliacao_em.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(s1!.proxima_busca_pedidos_em.getTime()).toBe(AGORA.getTime()); // A4: nasce ligada; o worker desliga pela MACUXIERP_FDV_RECEBIMENTO
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

  const conflitos = (t: string, entidade: string) =>
    adm('SELECT erp_id, chave, codigo, resolvido_em FROM integracao_fdv.conflito_chave WHERE tenant_id = $1 AND entidade = $2 ORDER BY detectado_em, created_at', [t, entidade]);
  const filialEv = (t: string, f: string, ext: string, em: string, extra: Record<string, unknown> = {}) =>
    evento(t, 'cadastros.filial.alterada@1', f, { ...cadFilial(f, { external_id: ext, padrao: false, cnpj: CNPJ_FILIAL_2 }), ...extra }, em);

  it('RN-CORE-05 e RN-CAD-08: troca controlada (external_id_anterior = chave do espelho) deixa a linha antiga viva, inativa e pendente, e a nova ativa', async () => {
    const t = await criarTenant(efemero.admin, 'cons-troca', ['integracao-fdv']);
    const f = U();
    await tratar(t, filialEv(t, f, 'FIL-OLD', '2026-11-22T09:00:00.000Z'));
    await adm('UPDATE integracao_fdv.registro_publicado SET hash_confirmado = hash, confirmado_em = $2, pendente = false WHERE tenant_id = $1', [t, AGORA]);
    await tratar(t, filialEv(t, f, 'FIL-NEW', '2026-11-22T09:01:00.000Z', { external_id_anterior: 'FIL-OLD' }));
    const velha = await reg(t, 'filial', 'FIL-OLD');
    expect(velha).toMatchObject({ ativo: false, pendente: true, erp_id: f });
    expect(await reg(t, 'filial', 'FIL-NEW')).toMatchObject({ ativo: true, pendente: true, erp_id: f });
    expect((await adm('SELECT deleted_at FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = $2', [t, 'FIL-OLD']))[0]!.deleted_at).toBeNull();
    expect(await conflitos(t, 'filial')).toHaveLength(0);
  });

  it('RN-CORE-05: adoção (external_id_anterior null) vale quando a chave do espelho era o UUID; troca recompõe os dependentes (M10)', async () => {
    const t = await criarTenant(efemero.admin, 'cons-adocao', ['integracao-fdv']);
    const f = U();
    const v = U();
    await tratar(t, filialEv(t, f, null as never, '2026-11-22T09:00:00.000Z'));
    await tratar(t, evento(t, 'cadastros.vendedor.alterado@1', v, cadVendedor(v, f, { external_id: 'VEN-A' }), '2026-11-22T09:00:30.000Z'));
    expect((await reg(t, 'vendedor', 'VEN-A'))!.payload.filial_external_id).toBe(f);
    await tratar(t, filialEv(t, f, 'FIL-ADOTADA', '2026-11-22T09:01:00.000Z', { external_id_anterior: null }));
    expect((await reg(t, 'filial', f))).toMatchObject({ ativo: false, pendente: true });
    expect((await reg(t, 'filial', 'FIL-ADOTADA'))!.ativo).toBe(true);
    const ven = await reg(t, 'vendedor', 'VEN-A');
    expect(ven!.payload.filial_external_id).toBe('FIL-ADOTADA');
    expect(ven!.pendente).toBe(true);
  });

  it('RN-CORE-05 e RN-INF-04: chave mudou sem marcador (evento antigo) = chave_alterada: nada é gravado nem sobrescrito e o conflito fica aberto, sem valor de campo', async () => {
    const t = await criarTenant(efemero.admin, 'cons-alterada', ['integracao-fdv']);
    const f = U();
    await tratar(t, filialEv(t, f, 'FIL-X', '2026-11-22T09:00:00.000Z'));
    await tratar(t, filialEv(t, f, 'FIL-Y', '2026-11-22T09:01:00.000Z', { razao_social: 'Mudou' }));
    expect(await reg(t, 'filial', 'FIL-Y')).toBeUndefined();
    expect((await reg(t, 'filial', 'FIL-X'))).toMatchObject({ ativo: true });
    expect((await reg(t, 'filial', 'FIL-X'))!.payload.nome).not.toBe('Mudou');
    const c = await conflitos(t, 'filial');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ erp_id: f, chave: 'FIL-Y', codigo: 'chave_alterada', resolvido_em: null });
    // repetir o mesmo evento não abre outro conflito
    await tratar(t, filialEv(t, f, 'FIL-Y', '2026-11-22T09:02:00.000Z'));
    expect(await conflitos(t, 'filial')).toHaveLength(1);
    // o próximo evento coerente (chave de volta ao espelho) encerra o conflito
    await tratar(t, filialEv(t, f, 'FIL-X', '2026-11-22T09:03:00.000Z'));
    const depois = await conflitos(t, 'filial');
    expect(depois).toHaveLength(1);
    expect(depois[0]!.resolvido_em).not.toBeNull();
  });

  it('RN-CORE-05: chave nova já usada por outro erp_id é chave_duplicada, mesmo com marcador coerente', async () => {
    const t = await criarTenant(efemero.admin, 'cons-duplicada', ['integracao-fdv']);
    const f1 = U();
    const f2 = U();
    await tratar(t, filialEv(t, f1, 'FIL-1', '2026-11-22T09:00:00.000Z'));
    await tratar(t, filialEv(t, f2, 'FIL-2', '2026-11-22T09:00:10.000Z', { cnpj: CNPJ_FILIAL_3 }));
    await tratar(t, filialEv(t, f2, 'FIL-1', '2026-11-22T09:01:00.000Z', { cnpj: CNPJ_FILIAL_3, external_id_anterior: 'FIL-2' }));
    expect((await reg(t, 'filial', 'FIL-1'))!.erp_id).toBe(f1);
    expect((await reg(t, 'filial', 'FIL-2'))).toMatchObject({ ativo: true, erp_id: f2 });
    expect(await conflitos(t, 'filial')).toMatchObject([{ erp_id: f2, chave: 'FIL-1', codigo: 'chave_duplicada', resolvido_em: null }]);
  });

  it('RN-CORE-05: produto com a chave de outro erp_id (consulta prévia de conferirChave) grava chave_duplicada', async () => {
    const t = await criarTenant(efemero.admin, 'cons-guarda', ['integracao-fdv']);
    const p = U();
    const u1 = U();
    await tratar(t, evento(t, 'cadastros.produto.alterado@1', p, cadProduto(p, [{ id: u1, unidade: 'CX', fator: 10_000, ean: null }], { external_id: 'PRD-G' }), '2026-11-22T09:00:00.000Z'));
    const p2 = U();
    await tratar(t, evento(t, 'cadastros.produto.alterado@1', p2, cadProduto(p2, [], { external_id: 'PRD-G' }), '2026-11-22T09:01:00.000Z'));
    expect((await reg(t, 'produto', 'PRD-G'))!.erp_id).toBe(p);
    expect(await conflitos(t, 'produto')).toMatchObject([{ erp_id: p2, chave: 'PRD-G', codigo: 'chave_duplicada' }]);
  });

  it('RN-CORE-05: a guarda de gravarRegistro, via aplicarRegistros, grava chave_duplicada para um filho (unidade) cuja chave já é de outro erp_id', async () => {
    const t = await criarTenant(efemero.admin, 'cons-guarda-filho', ['integracao-fdv']);
    const p = U();
    const u1 = U();
    const dono = U();
    const ev = (em: string, ean: string | null) => evento(t, 'cadastros.produto.alterado@1', p, cadProduto(p, [{ id: u1, unidade: 'CX', fator: 10_000, ean }], { external_id: 'PRD-F' }), em);
    await tratar(t, ev('2026-11-22T09:00:00.000Z', null));
    // a chave da unidade passa a pertencer a outro cadastro
    await adm("UPDATE integracao_fdv.registro_publicado SET erp_id = $2 WHERE tenant_id = $1 AND entidade = 'produto_unidade' AND registro_external_id = $3", [t, dono, u1]);
    await tratar(t, ev('2026-11-22T09:01:00.000Z', '7891000100103'));
    expect((await reg(t, 'produto_unidade', u1))!.erp_id).toBe(dono);
    expect(await conflitos(t, 'produto_unidade')).toMatchObject([{ erp_id: u1, chave: u1, codigo: 'chave_duplicada', resolvido_em: null }]);
    // o principal não é afetado
    expect(await conflitos(t, 'produto')).toHaveLength(0);
  });

  it('RN-CORE-05: cadastro inativo também confere a chave: mudança sem marcador é chave_alterada e com marcador é troca', async () => {
    const t = await criarTenant(efemero.admin, 'cons-inativo', ['integracao-fdv']);
    const f = U();
    await tratar(t, filialEv(t, f, 'FIL-I1', '2026-11-22T09:00:00.000Z'));
    await tratar(t, filialEv(t, f, 'FIL-I1', '2026-11-22T09:01:00.000Z', { inativo: true }));
    expect((await reg(t, 'filial', 'FIL-I1'))!.ativo).toBe(false);
    await tratar(t, filialEv(t, f, 'FIL-I2', '2026-11-22T09:02:00.000Z', { inativo: true }));
    expect(await reg(t, 'filial', 'FIL-I2')).toBeUndefined();
    expect(await conflitos(t, 'filial')).toMatchObject([{ erp_id: f, chave: 'FIL-I2', codigo: 'chave_alterada', resolvido_em: null }]);
    await tratar(t, filialEv(t, f, 'FIL-I2', '2026-11-22T09:03:00.000Z', { inativo: true, external_id_anterior: 'FIL-I1' }));
    expect(await reg(t, 'filial', 'FIL-I2')).toMatchObject({ ativo: false, erp_id: f });
    expect((await conflitos(t, 'filial')).every((c) => c.resolvido_em !== null)).toBe(true);
  });

  it('M3 e RN-CORE-05: evento atrasado com a chave mudada é descartado sem abrir conflito falso', async () => {
    const t = await criarTenant(efemero.admin, 'cons-atrasado', ['integracao-fdv']);
    const f = U();
    await tratar(t, filialEv(t, f, 'FIL-L1', '2026-11-22T09:10:00.000Z'));
    await tratar(t, filialEv(t, f, 'FIL-L2', '2026-11-22T09:00:00.000Z'));
    expect(await conflitos(t, 'filial')).toHaveLength(0);
    expect(await reg(t, 'filial', 'FIL-L2')).toBeUndefined();
    expect(await reg(t, 'filial', 'FIL-L1')).toMatchObject({ ativo: true, erp_id: f });
  });

  it('RD-0318: a chave do Hub da tabela vai em referencia.dados.chave (external_id ?? id) e referencia.external_id fica nulo', async () => {
    const t = await criarTenant(efemero.admin, 'cons-rd0318', ['integracao-fdv']);
    const tab = U();
    const tab2 = U();
    await tratar(t, evento(t, 'cadastros.tabela_preco.alterada@1', tab, cadTabela(tab, { external_id: 'TAB-KIT' }), '2026-11-22T09:00:00.000Z'));
    await tratar(t, evento(t, 'cadastros.tabela_preco.alterada@1', tab2, cadTabela(tab2, { padrao: false }), '2026-11-22T09:00:01.000Z'));
    const refs = await adm("SELECT erp_id, dados, external_id FROM integracao_fdv.referencia WHERE tenant_id = $1 AND tipo = 'tabela_preco'", [t]);
    expect(refs.find((r) => r.erp_id === tab)).toMatchObject({ dados: { chave: 'TAB-KIT' }, external_id: null });
    expect(refs.find((r) => r.erp_id === tab2)).toMatchObject({ dados: { chave: tab2 }, external_id: null });
  });

  it('RD-0318: o preço sai com a chave da tabela, nunca o UUID cru; trocar a chave da tabela recompõe os preços e os marca pendentes', async () => {
    const t = await criarTenant(efemero.admin, 'cons-rd0318b', ['integracao-fdv']);
    const tab = U();
    const f = U();
    const p = U();
    const preco = U();
    await tratar(t, evento(t, 'cadastros.preco.alterado@1', preco, cadPreco(tab, f, p), '2026-11-22T09:00:00.000Z'));
    expect((await reg(t, 'preco', preco))!.payload.tabela_external_id).toBeUndefined();
    await tratar(t, evento(t, 'cadastros.tabela_preco.alterada@1', tab, cadTabela(tab, { external_id: 'TAB-1' }), '2026-11-22T09:01:00.000Z'));
    let r = await reg(t, 'preco', preco);
    expect(r!.payload.tabela_external_id).toBe('TAB-1');
    expect(JSON.stringify(r!.payload)).not.toContain(tab);
    await adm('UPDATE integracao_fdv.registro_publicado SET hash_confirmado = hash, confirmado_em = $2, pendente = false WHERE tenant_id = $1', [t, AGORA]);
    await tratar(t, evento(t, 'cadastros.tabela_preco.alterada@1', tab, cadTabela(tab, { external_id: 'TAB-2', external_id_anterior: 'TAB-1' }), '2026-11-22T09:02:00.000Z'));
    r = await reg(t, 'preco', preco);
    expect(r!.payload.tabela_external_id).toBe('TAB-2');
    expect(r!.pendente).toBe(true);
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
