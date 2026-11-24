/** Adaptadores PostgreSQL da plataforma (pg.ts) no banco migrado, no papel `macuxierp_app` (RLS valendo). */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarEvento } from './eventos';
import { executarIdempotente, VALIDADE_IDEMPOTENCIA_MS } from './idempotencia';
import { AuditoriaPg, CatalogoArquivosPg, envelopeDaLinha, FilaDeTrabalhosPg, IdempotenciaPg, LicencasPg, OutboxPg, SELECT_EVENTO, type BancoPg, type LinhaEvento } from './pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from './pg-testes';

// hora-fixa-ok: data de guarda do arquivo, só conferida na volta (não se compara ao relógio)
const GUARDA = new Date(Date.UTC(2031, 0, 2));

describe.skipIf(!PG_DISPONIVEL)('adaptadores PostgreSQL da plataforma', () => {
  let b: BancoEfemero;
  let app: BancoPg;
  let t1: string;
  let t2: string;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    app = b.banco('macuxierp_app', 1);
    t1 = await criarTenant(b.admin, 'sdk-um', ['cadastros']);
    t2 = await criarTenant(b.admin, 'sdk-dois', ['pedido']);
  });
  afterAll(async () => {
    await b?.remover();
  });

  it('o tenant vale só dentro da transação (set_config local), nunca na conexão do pool', async () => {
    const tenant = 'SELECT current_setting($1, true) AS t';
    expect(await app.comTenant(t1, (tx) => tx.consultar<{ t: string }>(tenant, ['app.tenant_id']))).toEqual([{ t: t1 }]);
    const [depois] = await app.semTenant((tx) => tx.consultar<{ t: string | null }>(tenant, ['app.tenant_id']));
    expect(depois?.t ?? '').toBe('');
    await expect(app.comTenant('nao-e-uuid', async () => 1)).rejects.toThrow(RangeError);
  });

  it('erro desfaz a transação e devolve a conexão ao pool', async () => {
    const e = criarEvento({ nome: 'cadastros.cliente.alterado@1', tenant_id: t1, agregado_id: randomUUID(), versao: 1, ator: 'sistema', request_id: 'r-rollback', payload: {} }, new Date());
    await expect(
      app.comTenant(t1, async (tx) => {
        await new OutboxPg().gravar(tx, e);
        throw new Error('falha depois da escrita');
      }),
    ).rejects.toThrow('falha depois da escrita');
    const { rows } = await b.admin.query('SELECT 1 FROM plataforma.evento WHERE id = $1', [e.id]);
    expect(rows).toHaveLength(0);
    expect(await app.ping()).toBe(true);
  });

  it('outbox grava o envelope inteiro e ele volta igual', async () => {
    const ator = randomUUID();
    const e = criarEvento({ nome: 'cadastros.cliente.alterado@1', tenant_id: t1, agregado_id: randomUUID(), ator, request_id: 'r-1', payload: { inativo: false, nome: 'x' } }, new Date());
    const versao = await app.comTenant(t1, (tx) => new OutboxPg().gravar(tx, e));
    const { rows } = await b.admin.query<LinhaEvento>(`SELECT ${SELECT_EVENTO} FROM plataforma.evento WHERE id = $1`, [e.id]);
    expect(envelopeDaLinha(rows[0]!)).toEqual({ ...e, versao });
  });

  describe('versão do evento por agregado (T-0034)', () => {
    const evento = (tenant: string, agregado: string, nome = 'cadastros.cliente.alterado@1') =>
      criarEvento({ nome, tenant_id: tenant, agregado_id: agregado, versao: 99, ator: 'sistema', request_id: 'r-versao', payload: {} }, new Date());
    const versoes = async (tenant: string, agregado: string) =>
      (await b.admin.query<{ versao: string }>('SELECT versao FROM plataforma.evento WHERE tenant_id = $1 AND agregado_id = $2 ORDER BY versao', [tenant, agregado])).rows.map((r) => Number(r.versao));

    it('conta 1, 2... por (tenant, agregado), para qualquer nome, e ignora a versão recebida', async () => {
      const [a, bAg] = [randomUUID(), randomUUID()];
      const outbox = new OutboxPg();
      expect(await app.comTenant(t1, (tx) => outbox.gravar(tx, evento(t1, a)))).toBe(1);
      expect(await app.comTenant(t1, (tx) => outbox.gravar(tx, evento(t1, a, 'cadastros.carteira.alterada@1')))).toBe(2);
      expect(await app.comTenant(t1, (tx) => outbox.gravar(tx, evento(t1, bAg)))).toBe(1);
      expect(await app.comTenant(t2, (tx) => outbox.gravar(tx, evento(t2, a)))).toBe(1);
      expect(await versoes(t1, a)).toEqual([1, 2]);
      expect(await versoes(t1, bAg)).toEqual([1]);
      expect(await versoes(t2, a)).toEqual([1]);
    });

    it('rollback não consome versão', async () => {
      const a = randomUUID();
      const outbox = new OutboxPg();
      await expect(
        app.comTenant(t1, async (tx) => {
          expect(await outbox.gravar(tx, evento(t1, a))).toBe(1);
          throw new Error('desfaz');
        }),
      ).rejects.toThrow('desfaz');
      expect(await app.comTenant(t1, (tx) => outbox.gravar(tx, evento(t1, a)))).toBe(1);
      expect(await versoes(t1, a)).toEqual([1]);
    });

    it('duas conexões no mesmo agregado ao mesmo tempo gravam 1 e 2, sem violar o UNIQUE', async () => {
      const a = randomUUID();
      const outbox = new OutboxPg();
      const outra = b.banco('macuxierp_app', 1);
      let soltar!: () => void;
      const segura = new Promise<void>((r) => (soltar = r));
      let gravou!: () => void;
      const primeiraGravou = new Promise<void>((r) => (gravou = r));
      // A primeira grava e segura a transação aberta (com o lock); a segunda entra e espera o lock.
      const primeira = app.comTenant(t1, async (tx) => {
        const v = await outbox.gravar(tx, evento(t1, a));
        gravou();
        await segura;
        return v;
      });
      await primeiraGravou;
      const segunda = outra.comTenant(t1, (tx) => outbox.gravar(tx, evento(t1, a, 'cadastros.carteira.alterada@1')));
      // Só os locks do banco deste arquivo (o `b.admin` está nele): no CI, outros arquivos rodam em outros bancos do servidor.
      const esperandoLock = async () =>
        Number(
          (
            await b.admin.query<{ n: string }>(
              `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
                 AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
            )
          ).rows[0]!.n,
        );
      // A falha da asserção não pode deixar a primeira transação aberta (travaria o resto do arquivo).
      try {
        for (let i = 0; i < 200 && (await esperandoLock()) === 0; i++) await new Promise((r) => setTimeout(r, 10));
        expect(await esperandoLock()).toBe(1);
      } finally {
        soltar();
        await Promise.allSettled([primeira, segunda]);
      }
      expect([await primeira, await segunda].sort()).toEqual([1, 2]);
      expect(await versoes(t1, a)).toEqual([1, 2]);
    });
  });

  it('outbox de outro tenant é recusada pela RLS', async () => {
    const e = criarEvento({ nome: 'cadastros.cliente.alterado@1', tenant_id: t2, agregado_id: randomUUID(), versao: 1, ator: 'sistema', request_id: 'r-2', payload: {} }, new Date());
    await expect(app.comTenant(t1, (tx) => new OutboxPg().gravar(tx, e))).rejects.toThrow(/row-level security/);
  });

  it('fila de trabalho é idempotente por external_id; o mesmo external_id noutro tipo é conflito', async () => {
    const fila = new FilaDeTrabalhosPg();
    const pedido = { tipo: 'cadastros.consultar_ie', tenant_id: t1, payload: { uf: 'AM' }, external_id: 'ie-1' };
    const a = await app.comTenant(t1, (tx) => fila.enfileirar(tx, pedido));
    const b2 = await app.comTenant(t1, (tx) => fila.enfileirar(tx, pedido));
    expect(b2.id).toBe(a.id);
    await expect(app.comTenant(t1, (tx) => fila.enfileirar(tx, { ...pedido, tipo: 'core.exportar' }))).rejects.toMatchObject({ codigo: 'CONFLITO' });
    const sem = await app.comTenant(t1, (tx) => fila.enfileirar(tx, { tipo: 'core.exportar', tenant_id: t1, payload: {} }));
    expect(sem.id).not.toBe(a.id);
  });

  it('auditoria e catálogo de arquivos gravam no tenant', async () => {
    const entidade = randomUUID();
    const id = randomUUID();
    await app.comTenant(t1, async (tx) => {
      await new AuditoriaPg().inserir(tx, { tenant_id: t1, usuario_id: null, acao: 'teste', entidade: 'cliente', entidade_id: entidade, antes: null, depois: ['a'], request_id: 'r-3', ocorrido_em: new Date() });
      await new CatalogoArquivosPg().inserir(tx, { id, tenant_id: t1, chave_s3: `macuxierp/${t1}/nfe/x.xml`, tipo: 'application/xml', sha256: 'a'.repeat(64), tamanho: 10, imutavel: true, guarda_ate: GUARDA });
    });
    const { rows } = await b.admin.query('SELECT depois FROM plataforma.auditoria WHERE entidade_id = $1', [entidade]);
    expect(rows).toEqual([{ depois: ['a'] }]);
    const arq = await b.admin.query<{ guarda_ate: string }>("SELECT guarda_ate::text FROM plataforma.arquivo WHERE id = $1", [id]);
    expect(arq.rows).toEqual([{ guarda_ate: '2031-01-02' }]);
  });

  it('licenças: cada tenant lê só as dele', async () => {
    const licencas = new LicencasPg();
    expect((await app.comTenant(t1, (tx) => licencas.ler(tx, t1))).map((l) => l.modulo)).toEqual(['cadastros']);
    // pedir as do outro tenant dentro da transação do t1 não devolve nada (RLS)
    expect(await app.comTenant(t1, (tx) => licencas.ler(tx, t2))).toEqual([]);
  });

  it('licenças com o fuso do tenant numa consulta só (T-0042); sem licença o fuso vem; outro tenant, nada (RLS)', async () => {
    const licencas = new LicencasPg();
    const t3 = await criarTenant(b.admin, 'sdk-tres', []);
    await b.admin.query("UPDATE plataforma.tenant SET fuso = 'America/Sao_Paulo' WHERE id = $1", [t3]);
    const consultas: string[] = [];
    const lerContando = (t: string, alvo: string) =>
      app.comTenant(t, (tx) => licencas.lerComFuso({ consultar: <L,>(sql: string, p?: readonly unknown[]) => (consultas.push(sql), tx.consultar<L>(sql, p)) }, alvo));
    expect(await lerContando(t1, t1)).toEqual({ licencas: [{ modulo: 'cadastros', ativo: true, valido_ate: null }], fuso: 'America/Manaus' });
    expect(await lerContando(t3, t3)).toEqual({ licencas: [], fuso: 'America/Sao_Paulo' });
    expect(await lerContando(t1, t3)).toEqual({ licencas: [], fuso: null });
    expect(consultas).toHaveLength(3);
  });

  it('Idempotency-Key: guarda a resposta, repete sem executar, 409 com outro pedido, isola o tenant e desfaz com a rota', async () => {
    const repo = new IdempotenciaPg();
    const agora = new Date();
    const pedido = { tenant_id: t1, chave: `k-${randomUUID()}`, rota: 'POST /v1/cadastros/cargas', hash_corpo: 'a'.repeat(64), agora };
    let n = 0;
    const executar = async () => ({ status: 200, corpo: { n: ++n, texto: 'ok' } });
    expect((await app.comTenant(t1, (tx) => executarIdempotente(repo, tx, pedido, executar))).repetida).toBe(false);
    expect(await app.comTenant(t1, (tx) => executarIdempotente(repo, tx, pedido, executar))).toEqual({ resposta: { status: 200, corpo: { n: 1, texto: 'ok' } }, repetida: true });
    await expect(app.comTenant(t1, (tx) => executarIdempotente(repo, tx, { ...pedido, hash_corpo: 'b'.repeat(64) }, executar))).rejects.toMatchObject({ status: 409 });
    // a mesma chave no outro tenant é outra chave (RLS e UNIQUE por tenant)
    expect((await app.comTenant(t2, (tx) => executarIdempotente(repo, tx, { ...pedido, tenant_id: t2 }, executar))).repetida).toBe(false);
    // a rota que falha desfaz a reserva: o reenvio executa
    const falha = { ...pedido, chave: `k-${randomUUID()}` };
    await expect(app.comTenant(t1, (tx) => executarIdempotente(repo, tx, falha, async () => Promise.reject(new Error('rota falhou'))))).rejects.toThrow('rota falhou');
    expect((await app.comTenant(t1, (tx) => executarIdempotente(repo, tx, falha, executar))).repetida).toBe(false);
    // vencida (24 h depois) é substituída
    const depois = { ...pedido, agora: new Date(agora.getTime() + VALIDADE_IDEMPOTENCIA_MS + 1000), hash_corpo: 'c'.repeat(64) };
    expect(await app.comTenant(t1, (tx) => executarIdempotente(repo, tx, depois, executar))).toMatchObject({ repetida: false, resposta: { corpo: { n: 4 } } });
    const { rows } = await b.admin.query('SELECT tenant_id, status FROM plataforma.idempotencia WHERE chave = $1 ORDER BY tenant_id = $2', [pedido.chave, t1]);
    expect(rows).toHaveLength(2);
  });

  it('BancoPlataformaPg (ADR 0012): papel macuxierp_config e sessão só dentro da transação, nunca na conexão do pool', async () => {
    const plataforma = app.plataforma();
    const sessao = { superadmin_id: randomUUID(), sessao_id: randomUUID() };
    const quem = "SELECT current_user AS papel, current_setting('macuxierp.sessao_superadmin', true) AS sessao";
    expect(await plataforma.comPlataforma(sessao, (tx) => tx.consultar(quem))).toEqual([{ papel: 'macuxierp_config', sessao: sessao.sessao_id }]);
    // GUC customizado já usado na conexão volta como '' (não NULL) depois da transação
    const [antes] = await plataforma.antesDaSessao((tx) => tx.consultar<{ papel: string; sessao: string | null }>(quem));
    expect({ papel: antes?.papel, sessao: antes?.sessao ?? '' }).toEqual({ papel: 'macuxierp_config', sessao: '' });
    // pool de 1 conexão: depois do COMMIT (e do ROLLBACK) a mesma conexão volta ao papel da aplicação, sem a sessão
    const [depois] = await app.semTenant((tx) => tx.consultar<{ papel: string; sessao: string | null }>(quem));
    expect({ papel: depois?.papel, sessao: depois?.sessao ?? '' }).toEqual({ papel: 'macuxierp_app', sessao: '' });
    await expect(plataforma.comPlataforma(sessao, async () => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    const [aposErro] = await app.semTenant((tx) => tx.consultar<{ papel: string }>(quem));
    expect(aposErro?.papel).toBe('macuxierp_app');
    await expect(plataforma.comPlataforma({ ...sessao, sessao_id: 'nao-e-uuid' }, async () => 1)).rejects.toThrow(RangeError);
    // sem sessão, a função da lista fechada recusa com o SQLSTATE próprio (MXS01)
    await expect(plataforma.antesDaSessao((tx) => tx.consultar('SELECT * FROM plataforma.empresa_ler($1::uuid)', [t1]))).rejects.toMatchObject({ code: 'MXS01' });
  });

  it('conferirPapel aceita o papel da aplicação e recusa outro', async () => {
    await expect(app.conferirPapel('macuxierp_app')).resolves.toBeUndefined();
    await expect(app.conferirPapel('macuxierp_worker')).rejects.toThrow(/esperado macuxierp_worker/);
  });
});
