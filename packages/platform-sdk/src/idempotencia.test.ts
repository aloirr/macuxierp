import { describe, expect, it } from 'vitest';
import { transacaoComPrazo, type Transacao } from './banco';
import { ErroApi } from './erros';
import { chaveDoPedido, executarIdempotente, hashDoPedido, VALIDADE_IDEMPOTENCIA_MS } from './idempotencia';
import { ArquivoRecebido } from './rotas';
import { IdempotenciaMemoria } from './testes';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const AGORA = new Date('2026-11-21T15:00:00Z');
const tx = {} as Transacao;
const arq = (nome: string, conteudo: string) =>
  new ArquivoRecebido('arquivos', nome, 'text/csv', Buffer.from(conteudo));

describe('Idempotency-Key: cabeçalho (RN-CORE-05)', () => {
  it('opcional sem chave é null; obrigatória sem chave é 400; chave fora do padrão é 400', () => {
    expect(chaveDoPedido({}, 'opcional')).toBeNull();
    expect(chaveDoPedido({ 'idempotency-key': ' 0123456789abcdef ' }, 'obrigatoria')).toBe(
      '0123456789abcdef',
    );
    expect(() => chaveDoPedido({}, 'obrigatoria')).toThrow(
      expect.objectContaining({ status: 400, codigo: 'VALIDACAO' }),
    );
    for (const ruim of ['curta', 'com espaço no meio', 'x'.repeat(129), 'ç'.repeat(10)]) {
      expect(() => chaveDoPedido({ 'idempotency-key': ruim }, 'opcional')).toThrow(ErroApi);
    }
  });
});

describe('hash do pedido (T-0026 §4)', () => {
  const base = {
    corpo: { modo: 'validar', b: 1 },
    consulta: undefined,
    params: {},
    todosArquivos: { arquivos: [arq('cliente.csv', 'a;b')] },
  };

  it('mesmo pedido, mesma ordem ou não, dá o mesmo hash hex de 64; muda com corpo, nome ou conteúdo do arquivo', () => {
    const h = hashDoPedido(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoPedido({ ...base, corpo: { b: 1, modo: 'validar' } })).toBe(h);
    expect(hashDoPedido({ ...base, corpo: { modo: 'gravar', b: 1 } })).not.toBe(h);
    expect(hashDoPedido({ ...base, todosArquivos: { arquivos: [arq('produto.csv', 'a;b')] } })).not.toBe(h);
    expect(hashDoPedido({ ...base, todosArquivos: { arquivos: [arq('cliente.csv', 'a;c')] } })).not.toBe(h);
  });
});

describe('executarIdempotente', () => {
  const chave = {
    tenant_id: TENANT,
    chave: 'chave-0001',
    rota: 'POST /v1/cadastros/cargas',
    hash_corpo: 'a'.repeat(64),
    agora: AGORA,
  };

  it('1º executa e guarda; o reenvio devolve a resposta guardada sem executar', async () => {
    const repo = new IdempotenciaMemoria();
    let execucoes = 0;
    const executar = async () => ({ status: 201, corpo: { n: ++execucoes } });
    expect(await executarIdempotente(repo, tx, chave, executar)).toEqual({
      resposta: { status: 201, corpo: { n: 1 } },
      repetida: false,
    });
    expect(await executarIdempotente(repo, tx, chave, executar)).toEqual({
      resposta: { status: 201, corpo: { n: 1 } },
      repetida: true,
    });
    expect(execucoes).toBe(1);
  });

  it('mesma chave com outro pedido é 409; pedido em andamento é 409', async () => {
    const repo = new IdempotenciaMemoria();
    await executarIdempotente(repo, tx, chave, async () => ({ corpo: null }));
    await expect(
      executarIdempotente(repo, tx, { ...chave, hash_corpo: 'b'.repeat(64) }, async () => ({})),
    ).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO' });
    const outra = { ...chave, chave: 'chave-0002' };
    await repo.reservar(tx, { ...outra, expira_em: new Date(AGORA.getTime() + 1000) });
    await expect(executarIdempotente(repo, tx, outra, async () => ({}))).rejects.toMatchObject({
      status: 409,
    });
  });

  it('a chave vale 24 h por tenant e rota: vencida, outro tenant ou outra rota executam de novo', async () => {
    const repo = new IdempotenciaMemoria();
    let n = 0;
    const executar = async () => ({ corpo: { n: ++n } });
    await executarIdempotente(repo, tx, chave, executar);
    await executarIdempotente(
      repo,
      tx,
      { ...chave, tenant_id: '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c' },
      executar,
    );
    await executarIdempotente(repo, tx, { ...chave, rota: 'PUT /v1/cadastros/x' }, executar);
    expect(
      (
        await executarIdempotente(
          repo,
          tx,
          { ...chave, agora: new Date(AGORA.getTime() + VALIDADE_IDEMPOTENCIA_MS - 1) },
          executar,
        )
      ).repetida,
    ).toBe(true);
    expect(
      (
        await executarIdempotente(
          repo,
          tx,
          { ...chave, agora: new Date(AGORA.getTime() + VALIDADE_IDEMPOTENCIA_MS) },
          executar,
        )
      ).repetida,
    ).toBe(false);
    expect(n).toBe(4);
  });

  it('a rota que falha não conclui (na transação real a reserva é desfeita junto)', async () => {
    const repo = new IdempotenciaMemoria();
    await expect(
      executarIdempotente(repo, tx, chave, async () => Promise.reject(new Error('falhou'))),
    ).rejects.toThrow('falhou');
    expect([...repo.registros.values()][0]).toMatchObject({ status: null });
  });
});

describe('transacaoComPrazo (tempoMaximoMs da rota)', () => {
  it('dentro do prazo consulta; depois dele a consulta nova é 503 TEMPO_ESGOTADO', async () => {
    let ms = 0;
    const consultas: string[] = [];
    const base: Transacao = { consultar: async <L>(sql: string) => (consultas.push(sql), [] as L[]) };
    const t = transacaoComPrazo(base, { restanteMs: 120_000, limiteRotaMs: 120_000 }, () => ms);
    await t.consultar('SELECT 1');
    ms = 120_000;
    await t.consultar('SELECT 2');
    ms = 120_001;
    await expect(t.consultar('SELECT 3')).rejects.toMatchObject({
      status: 503,
      codigo: 'TEMPO_ESGOTADO',
      message: expect.stringContaining('120 s'),
    });
    expect(consultas).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('a mensagem cita o limite da rota, não o que sobrava (sobra de 400 ms não vira "0 s")', async () => {
    let ms = 0;
    const base: Transacao = { consultar: async <L>() => [] as L[] };
    const t = transacaoComPrazo(base, { restanteMs: 400, limiteRotaMs: 120_000 }, () => ms);
    ms = 401;
    await expect(t.consultar('SELECT 1')).rejects.toMatchObject({
      codigo: 'TEMPO_ESGOTADO',
      message: expect.stringContaining('passou de 120 s'),
    });
  });
});
