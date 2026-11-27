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
});
