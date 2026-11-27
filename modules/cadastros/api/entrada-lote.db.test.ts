/**
 * T-0057 C3 e C4 (ADR 0014 §3), PostgreSQL real e RLS: o POST do lote pelo papel `macuxierp_app`, o processamento pelo `macuxierp_worker`
 * (executor `cadastros.entrada_lote`, que grava por `gravarLinhas`), o GET do resultado, o cursor e o sinal. Sem Postgres o teste pula
 * (`bash db/scripts/pg-local.sh`).
 *
 * Gravar o cadastro é do worker, mas as migrações até a 0071 só deram ao `macuxierp_worker` o INSERT/UPDATE de estoque, cliente (INSERT)
 * e consulta externa. Enquanto o `banco-dados` não entrega a migração dos GRANTs (recado desta tarefa), o `beforeAll` concede ao worker,
 * NO BANCO EFÊMERO, só o que o vendedor precisa: o resto do fluxo (lote, fila, resultado, cursor) roda com os GRANTs reais da 0071.
 */
import { randomBytes } from 'node:crypto';
import { TRABALHO_ENTRADA_LOTE, type ContextoEntrada, type PedidoTrabalho, type RotaEntrada, type Trabalho, type Transacao } from '@macuxierp/platform-sdk';
import { AuditoriaPg, OutboxPg, FilaDeTrabalhosPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { CursorEntidade, LoteAceito, LoteResultado } from '@macuxierp/platform-sdk/hub-v1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarExecutorEntradaLote } from './entrada-lote';
import { criarExecutorExpurgoEntrada, TRABALHO_ENTRADA_EXPURGO } from './entrada-expurgo';
import { entradaSql } from './entrada-sql';
import { rotasEntrada } from './entrada-rotas';
import { repositoriosSql } from './sql';

const AGORA = new Date('2026-11-26T16:00:00.000Z');

describe.skipIf(!PG_DISPONIVEL)('entrada de lotes (T-0057 C3 e C4, PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
  let B: string;
  let credA: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const executor = criarExecutorEntradaLote({ repositorios: repositoriosSql, entrada: entradaSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), fila: new FilaDeTrabalhosPg(), agora: () => AGORA });
  const registro = (n: number, extra: Record<string, unknown> = {}) => ({ external_id: `V${n}`, alterado_em: `2026-11-2${n}T10:00:00.000Z`, ativo: true, nome: `Vendedor ${n}`, ...extra });
  const corpo = (registros: unknown[], extra: Record<string, unknown> = {}) => ({
    versao_contrato: 'v1', entidade: 'vendedor', modo: 'delta', enviado_em: '2026-11-26T15:59:00.000Z', cursor: null, registros, linhas_invalidas: [], linhas_invalidas_omitidas: 0, ...extra,
  });
  const rota = (metodo: 'GET' | 'POST', caminho: string) => rotasEntrada.find((r) => r.metodo === metodo && r.caminho === caminho) as RotaEntrada;
  /** A rota como o plugin da apps/api a chama: tx do tenant no papel `macuxierp_app`. */
  const chamar = (tenant: string, conector: string, metodo: 'GET' | 'POST', caminho: string, o: { corpo?: unknown; consulta?: unknown; params?: Record<string, string>; chave?: string } = {}) =>
    app.comTenant(tenant, async (tx: Transacao) => {
      const r = rota(metodo, caminho);
      const pedidos: PedidoTrabalho[] = [];
      const ctx: ContextoEntrada = {
        conector: { tenant_id: tenant, credencial_id: credA, conector_id: conector }, tx, request_id: 'req', agora: AGORA,
        enfileirar: async (p) => { pedidos.push({ ...p, tenant_id: tenant }); return { id: 'x' }; },
      };
      const resposta = await r.executar(ctx, {
        corpo: r.corpo ? r.corpo.parse(o.corpo) : undefined, consulta: r.consulta ? r.consulta.parse(o.consulta ?? {}) : undefined, params: o.params ?? {},
        cabecalhos: o.chave ? { 'idempotency-key': o.chave } : {}, arquivos: {}, todosArquivos: {},
      });
      return { resposta, pedidos };
    });
  const trabalho = (tenant: string, loteId: string): Trabalho => ({ id: randomBytes(4).toString('hex'), tipo: TRABALHO_ENTRADA_LOTE, tenant_id: tenant, payload: { lote_id: loteId }, tentativas: 0 });
  const processar = (tenant: string, loteId: string) => worker.comTenant(tenant, (tx) => executor.executar(trabalho(tenant, loteId), tx));
  const receber = async (tenant: string, conector: string, c: unknown, chave: string) =>
    LoteAceito.parse((await chamar(tenant, conector, 'POST', '/lotes', { corpo: c, chave })).resposta.corpo).lote_id;
  const resultado = async (tenant: string, conector: string, id: string) =>
    LoteResultado.parse((await chamar(tenant, conector, 'GET', '/lotes/:id', { params: { id } })).resposta.corpo);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'entrada-lote-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'entrada-lote-b', ['cadastros']);
    credA = (await admin(
      `INSERT INTO cadastros.entrada_credencial (tenant_id, conector_id, chave_hmac, chave_prefixo) VALUES ($1, 'conector-1', decode($2, 'hex'), 'abcd1234') RETURNING id`,
      [A, 'ab'.repeat(32)],
    ))[0]!.id as string;
    await admin(
      `INSERT INTO cadastros.filial (tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao)
       VALUES ($1, '12345678000195', 'Filial', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', true)`,
      [A],
    );
    // Ver o comentário do arquivo: o GRANT do vendedor ao worker é do banco-dados (recado), aqui só no banco efêmero.
    await admin('GRANT SELECT, INSERT, UPDATE ON cadastros.vendedor TO macuxierp_worker');
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('ADR 0014 §3: POST 202, o worker grava, o GET traz status e cursor, o corpo some e o GET cursores acompanha', async () => {
    const id = await receber(A, 'conector-1', corpo([registro(1), registro(2)]), 'chave-pg-0001');
    expect((await resultado(A, 'conector-1', id)).status).toBe('recebido');
    expect((await admin('SELECT corpo IS NOT NULL AS tem FROM cadastros.entrada_lote WHERE id = $1', [id]))[0]).toEqual({ tem: true });
    expect(await processar(A, id)).toEqual({ processados: 1 });
    const r = await resultado(A, 'conector-1', id);
    expect(r).toMatchObject({ status: 'concluido', erros: [], contagens: { recebidas: 2, novas: 2, atualizadas: 0, inalteradas: 0 }, cursor: { alterado_em: '2026-11-22T10:00:00.000Z', external_id: 'V2' } });
    expect(r.concluido_em).not.toBeNull();
    expect((await admin('SELECT corpo FROM cadastros.entrada_lote WHERE id = $1', [id]))[0]).toEqual({ corpo: null });
    expect((await admin('SELECT external_id FROM cadastros.vendedor WHERE tenant_id = $1 ORDER BY external_id', [A])).map((l) => l.external_id)).toEqual(['V1', 'V2']);
    const c = CursorEntidade.parse((await chamar(A, 'conector-1', 'GET', '/cursores/:entidade', { params: { entidade: 'vendedor' } })).resposta.corpo);
    expect(c).toMatchObject({ entidade: 'vendedor', cursor: { alterado_em: '2026-11-22T10:00:00.000Z', external_id: 'V2' } });
    expect(c.atualizado_em).not.toBeNull();
    expect((await admin("SELECT count(*)::int AS n FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'cadastros.vendedor.alterado@1'", [A]))[0]!.n).toBe(2);
  }, 60_000);

  it('idempotência no banco: a mesma chave e corpo devolve o lote; outro corpo dá 409; um lote só', async () => {
    const c = corpo([registro(3)]);
    const id = await receber(A, 'conector-1', c, 'chave-pg-0002');
    const de = await chamar(A, 'conector-1', 'POST', '/lotes', { corpo: c, chave: 'chave-pg-0002' });
    expect(LoteAceito.parse(de.resposta.corpo)).toMatchObject({ lote_id: id, repetido: true });
    expect(de.pedidos).toHaveLength(0);
    await expect(chamar(A, 'conector-1', 'POST', '/lotes', { corpo: corpo([registro(4)]), chave: 'chave-pg-0002' })).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO' });
    expect((await admin("SELECT count(*)::int AS n FROM cadastros.entrada_lote WHERE idempotency_key = 'chave-pg-0002'"))[0]!.n).toBe(1);
  }, 60_000);

  it('RN-INT-01 e LGPD: erro por linha só com índice, external_id, campo e código; o dado não fica no lote nem no resultado', async () => {
    const id = await receber(A, 'conector-1', corpo([registro(5, { nome: 'Maria Segredo' }), { external_id: 'V6', alterado_em: '2026-11-26T11:00:00.000Z', ativo: true }]), 'chave-pg-0003');
    await processar(A, id);
    const r = await resultado(A, 'conector-1', id);
    expect(r).toMatchObject({ status: 'concluido_com_erros', contagens: { com_erro: 1 }, erros: [{ indice: 1, external_id: 'V6', campo: 'nome', codigo: 'campo_obrigatorio', reprocessavel: false }] });
    expect(JSON.stringify((await admin('SELECT * FROM cadastros.entrada_lote WHERE id = $1', [id]))[0])).not.toContain('Segredo');
  }, 60_000);

  it('ADR 0014 (emenda de 27/11): sem crt/ncm, o cadastro existente ou adotado pelo cnpj mantém o gravado e o novo é recusado só na linha', async () => {
    // FX1 já tem external_id; a filial adotada pelo cnpj (sem external_id gravado) é a seguinte.
    await admin("UPDATE cadastros.filial SET external_id = 'FX1', regime_pis_cofins = 'nao_cumulativo' WHERE tenant_id = $1", [A]);
    await admin(
      `INSERT INTO cadastros.filial (tenant_id, cnpj, razao_social, crt, regime_pis_cofins, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao)
       VALUES ($1, '99000001000101', 'Filial Adotada', '2', NULL, 'Rua B', '2', 'Centro', '1302603', 'AM', '69000000', false)`,
      [A],
    );
    const f = (external_id: string, extra: Record<string, unknown> = {}) => ({
      external_id, alterado_em: '2026-11-26T09:00:00.000Z', ativo: true, codigo: '01', nome: 'Filial Renomeada', cidade: 'Manaus', uf: 'AM', cnpj: '12.345.678/0001-95',
      logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '69000000', ...extra,
    });
    const id = await receber(A, 'conector-1', corpo([
      f('FX1'), f('FX2', { cnpj: '99.000.002/0001-48' }), f('FX3', { cnpj: '99.000.001/0001-01', nome: 'Adotada' }),
    ], { entidade: 'filial' }), 'chave-pg-0009');
    await processar(A, id);
    const r = await resultado(A, 'conector-1', id);
    expect(r.erros).toMatchObject([{ indice: 1, external_id: 'FX2', campo: 'crt', codigo: 'campo_obrigatorio', reprocessavel: false }]);
    expect((await admin('SELECT crt, razao_social FROM cadastros.filial WHERE tenant_id = $1 AND external_id = $2', [A, 'FX1']))[0]).toMatchObject({ crt: '3', razao_social: 'Filial Renomeada' });
    expect((await admin('SELECT crt, external_id FROM cadastros.filial WHERE tenant_id = $1 AND cnpj = $2', [A, '99000001000101']))[0]).toMatchObject({ crt: '2', external_id: 'FX3' });
    expect((await admin('SELECT count(*)::int AS n FROM cadastros.filial WHERE tenant_id = $1 AND external_id = $2', [A, 'FX2']))[0]!.n).toBe(0);
  }, 60_000);

  it('ADR 0014 (emenda de 27/11): produto novo sem ncm é recusado em ncm (campo_obrigatorio) e o resto do lote segue', async () => {
    const id = await receber(A, 'conector-1', corpo([{ external_id: 'PX1', alterado_em: '2026-11-26T09:00:00.000Z', ativo: true, sku: 'SKUX1', nome: 'Parafuso', unidade: 'UN' }], { entidade: 'produto' }), 'chave-pg-0010');
    await processar(A, id);
    expect((await resultado(A, 'conector-1', id)).erros).toMatchObject([{ indice: 0, external_id: 'PX1', campo: 'ncm', codigo: 'campo_obrigatorio' }]);
    expect((await admin('SELECT count(*)::int AS n FROM cadastros.produto WHERE tenant_id = $1 AND external_id = $2', [A, 'PX1']))[0]!.n).toBe(0);
  }, 60_000);

  it('um lote por vez por entidade e conector: o trabalho do 2º lote processa o 1º antes, e o cursor não anda para trás', async () => {
    const a = await receber(A, 'conector-1', corpo([registro(8)]), 'chave-pg-0004');
    const b = await receber(A, 'conector-1', corpo([registro(7)]), 'chave-pg-0005');
    expect(await processar(A, b)).toEqual({ processados: 2 });
    expect((await resultado(A, 'conector-1', a)).status).toBe('concluido');
    expect((await resultado(A, 'conector-1', b)).status).toBe('concluido');
    const c = CursorEntidade.parse((await chamar(A, 'conector-1', 'GET', '/cursores/:entidade', { params: { entidade: 'vendedor' } })).resposta.corpo);
    expect(c.cursor).toEqual({ alterado_em: '2026-11-28T10:00:00.000Z', external_id: 'V8' });
    expect(await processar(A, a)).toEqual({ processados: 0 });
  }, 60_000);

  it('RLS: outra empresa não vê o lote nem o cursor, e o lote de um conector não é lido por outro', async () => {
    const id = await receber(A, 'conector-1', corpo([registro(9)]), 'chave-pg-0006');
    await expect(chamar(B, 'conector-1', 'GET', '/lotes/:id', { params: { id } })).rejects.toMatchObject({ status: 404 });
    await expect(chamar(A, 'conector-2', 'GET', '/lotes/:id', { params: { id } })).rejects.toMatchObject({ status: 404 });
    const c = CursorEntidade.parse((await chamar(B, 'conector-1', 'GET', '/cursores/:entidade', { params: { entidade: 'vendedor' } })).resposta.corpo);
    expect(c.cursor).toBeNull();
    await processar(A, id);
  }, 60_000);

  it('POST sinal grava o último sinal por tenant e conector (upsert)', async () => {
    const sinal = (versao: string) => ({ versao_contrato: 'v1', conector_id: 'conector-1', versao_conector: versao, em: '2026-11-26T15:58:00.000Z', fila: [], entidades: [] });
    await chamar(A, 'conector-1', 'POST', '/sinal', { corpo: sinal('1.5.0') });
    await chamar(A, 'conector-1', 'POST', '/sinal', { corpo: { ...sinal('1.5.1'), parado_por_versao: true } });
    expect(await admin('SELECT versao_conector, parado_por_versao FROM cadastros.entrada_sinal WHERE tenant_id = $1', [A])).toEqual([{ versao_conector: '1.5.1', parado_por_versao: true }]);
  }, 60_000);

  it('aoDesistir (papel worker) marca o lote parado como falhou, zera o corpo e não mexe no cursor', async () => {
    const id = await receber(A, 'conector-1', corpo([registro(1)]), 'chave-pg-0007');
    await worker.comTenant(A, (tx) => executor.aoDesistir!(trabalho(A, id), tx));
    expect(await resultado(A, 'conector-1', id)).toMatchObject({ status: 'falhou', cursor: null });
    expect((await admin('SELECT erro_codigo, corpo FROM cadastros.entrada_lote WHERE id = $1', [id]))[0]).toEqual({ erro_codigo: 'falha_processamento', corpo: null });
  }, 60_000);

  it('ADR 0014 (emenda de 27/11): produto existente sem ncm mantém o gravado (nenhum erro na linha)', async () => {
    await admin(
      `INSERT INTO cadastros.produto (tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao, external_id)
       VALUES ($1, 'SKUX2', 'Parafuso antigo', '22021000', 'UN', 'UN', 'PADRAO', 'PX2')`,
      [A],
    );
    const id = await receber(A, 'conector-1', corpo([{ external_id: 'PX2', alterado_em: '2026-11-26T09:00:00.000Z', ativo: true, sku: 'SKUX2', nome: 'Parafuso novo', unidade: 'UN' }], { entidade: 'produto' }), 'chave-pg-0011');
    await processar(A, id);
    expect((await resultado(A, 'conector-1', id)).erros).toEqual([]);
    expect((await admin('SELECT ncm, descricao FROM cadastros.produto WHERE tenant_id = $1 AND external_id = $2', [A, 'PX2']))[0]).toEqual({ ncm: '22021000', descricao: 'Parafuso novo' });
  }, 60_000);

  it('ADR 0014 §3 (LGPD): o expurgo de 24 h falha e zera o corpo do lote velho, não toca o novo nem o já concluído, e rodar de novo não muda nada', async () => {
    const velho = await receber(A, 'conector-1', corpo([registro(1)]), 'chave-pg-0020');
    const processando = await receber(A, 'conector-1', corpo([registro(2)]), 'chave-pg-0021');
    const novo = await receber(A, 'conector-1', corpo([registro(3)]), 'chave-pg-0022');
    await admin("UPDATE cadastros.entrada_lote SET created_at = now() - interval '25 hours' WHERE id = ANY($1::uuid[])", [[velho, processando]]);
    await admin("UPDATE cadastros.entrada_lote SET estado = 'processando', processado_em = now() WHERE id = $1", [processando]);
    const exp = criarExecutorExpurgoEntrada({ entrada: entradaSql, agora: () => new Date() });
    expect(exp.tipo).toBe(TRABALHO_ENTRADA_EXPURGO);
    const rodar = () => worker.comTenant(A, (tx) => exp.executar({ id: 'exp', tipo: TRABALHO_ENTRADA_EXPURGO, tenant_id: A, payload: {}, tentativas: 0 }, tx));
    const estados = async () => admin('SELECT id, estado, erro_codigo, cursor_external_id IS NULL AS sem_cursor, corpo IS NULL AS sem_corpo, concluido_em IS NOT NULL AS fechado FROM cadastros.entrada_lote WHERE id = ANY($1::uuid[]) ORDER BY id', [[velho, processando, novo]]);
    expect((await rodar())!.expurgados).toBeGreaterThanOrEqual(2);
    const depois = await estados();
    expect(depois.find((l) => l.id === velho)).toMatchObject({ estado: 'falhou', erro_codigo: 'corpo_expirado', sem_corpo: true, sem_cursor: true, fechado: true });
    expect(depois.find((l) => l.id === processando)).toMatchObject({ estado: 'falhou', erro_codigo: 'corpo_expirado', sem_corpo: true });
    expect(depois.find((l) => l.id === novo)).toMatchObject({ estado: 'recebido', erro_codigo: null, sem_corpo: false });
    expect(await rodar()).toEqual({ expurgados: 0 });
    expect(await estados()).toEqual(depois);
    expect(await resultado(A, 'conector-1', velho)).toMatchObject({ status: 'falhou' });
    await processar(A, novo);
  }, 60_000);

  it('RN-CAD-09 (0074, PostgreSQL real e RLS): forma nova sem condição vai para entrada_forma e o prazo seguinte a usa; tPag nulo recusa o prazo; o reenvio revive a apagada', async () => {
    const T = A; // a credencial do conector é única no banco: o teste usa o tenant A (os external_id FP*/PZ* não colidem com os outros testes)
    const T2 = B;
    const forma = (n: number, extra: Record<string, unknown> = {}) => ({ external_id: `FP${n}`, alterado_em: `2026-11-26T1${n}:00:00.000Z`, ativo: true, codigo: 'BOLETO', nome: 'Boleto', ...extra });
    const lote = async (entidade: string, registros: unknown[], chave: string) => {
      const id = LoteAceito.parse((await chamar(T, 'conector-1', 'POST', '/lotes', { corpo: corpo(registros, { entidade }), chave })).resposta.corpo).lote_id;
      await processar(T, id);
      return resultado(T, 'conector-1', id);
    };
    expect(await lote('forma_pagamento', [forma(1), forma(2, { codigo: 'XYZ-DESCONHECIDA' })], 'chave-forma-001')).toMatchObject({ status: 'concluido', contagens: { novas: 2, atualizadas: 0, inalteradas: 0 } });
    expect(await admin('SELECT external_id, tpag IS NULL AS sem_tpag FROM cadastros.entrada_forma WHERE tenant_id = $1 ORDER BY external_id', [T])).toEqual([
      { external_id: 'FP1', sem_tpag: false }, { external_id: 'FP2', sem_tpag: true },
    ]);
    expect(await admin('SELECT 1 FROM cadastros.entrada_forma WHERE tenant_id = $1', [T2])).toEqual([]);
    const prazo = (n: number, f: string) => ({ external_id: `PZ${n}`, alterado_em: '2026-11-26T20:00:00.000Z', ativo: true, forma_external_id: f, codigo: `P${n}`, parcelas_dias: '30/60' });
    expect(await lote('prazo_pagamento', [prazo(1, 'FP1')], 'chave-forma-002')).toMatchObject({ status: 'concluido', contagens: { novas: 1, com_erro: 0 } });
    expect((await admin('SELECT external_id, forma_external_id, forma_codigo FROM cadastros.condicao_pagamento WHERE tenant_id = $1', [T]))).toEqual([{ external_id: 'PZ1', forma_external_id: 'FP1', forma_codigo: 'BOLETO' }]);
    // reenvio igual: inalterada; apagada e reenviada: revive
    expect(await lote('forma_pagamento', [forma(1, { alterado_em: '2026-11-26T19:00:00.000Z' })], 'chave-forma-003')).toMatchObject({ contagens: { novas: 0, atualizadas: 0 } });
    await admin("UPDATE cadastros.entrada_forma SET deleted_at = now() WHERE tenant_id = $1 AND external_id = 'FP2'", [T]);
    expect(await lote('forma_pagamento', [forma(2, { alterado_em: '2026-11-26T21:00:00.000Z', codigo: 'XYZ-DESCONHECIDA' })], 'chave-forma-004')).toMatchObject({ contagens: { atualizadas: 1 } });
    expect((await admin("SELECT deleted_at IS NULL AS viva FROM cadastros.entrada_forma WHERE tenant_id = $1 AND external_id = 'FP2'", [T]))[0]).toEqual({ viva: true });
    // RN-CAD-09 (v0.3.26): forma de mesmo código com outro external_id é alias: o prazo grava com o external_id existente (FP1), sem 2ª forma
    expect(await lote('forma_pagamento', [forma(3, { external_id: 'THA-FOR-1', codigo: 'boleto', alterado_em: '2026-11-26T22:00:00.000Z' })], 'chave-forma-005')).toMatchObject({ status: 'concluido' });
    expect(await lote('prazo_pagamento', [{ ...prazo(2, 'THA-FOR-1'), alterado_em: '2026-11-26T23:00:00.000Z', parcelas_dias: '28/56' }], 'chave-forma-006')).toMatchObject({ status: 'concluido', contagens: { novas: 1, com_erro: 0 } });
    expect((await admin("SELECT forma_external_id, prazos_dias FROM cadastros.condicao_pagamento WHERE tenant_id = $1 AND external_id = 'PZ2'", [T]))[0]).toMatchObject({ forma_external_id: 'FP1', prazos_dias: [28, 56] });
  }, 90_000);
});
