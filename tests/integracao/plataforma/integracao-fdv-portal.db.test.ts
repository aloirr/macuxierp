/**
 * T-0056 (testes): integração FDV no portal `/config` (ADR 0013 §2, §3, §4 e §6) na API real (`appPgDeTeste`, plugins de
 * plataforma de produção com a chave do conector) sobre o PostgreSQL efêmero migrado até a 0042.
 * - E1: as 6 rotas do plugin: sem sessão 401; empresa inexistente 404; empresa sem o módulo `integracao-fdv` 422 RN-CORE-02;
 *   entrada inválida 400. (Cookie do tenant, CSRF e TROCAR_SENHA ficam na matriz do isolamento.db.test.ts, que enumera o plugin.)
 * - E2: o superadmin grava a credencial pelo portal (nasce sem cadastro ligado e sem carga inicial, 0042) → liga o produto pela
 *   configuração (1 `integracao-fdv.carga_inicial.solicitada@1` só com as recém-ligadas; `preco` traz `tabela_preco`)
 *   → o administrador do tenant lê `GET /v1/integracao-fdv/status`
 *   (configurado, só o prefixo) e o tenant B não vê nada de A (RLS) → `POST carga-completa` abre a sessão e antecipa o cursor
 *   → um ciclo da agenda do worker (papel `macuxierp_worker`) leva a carga ao dublê HTTP do Hub com a chave gravada pelo portal.
 * A chave do conector nunca aparece em resposta, log pino nem auditoria. Dados fictícios (exemplo.invalid).
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA as C,
  criarClienteHub,
  decifrarCampo,
  ENTIDADES_ENVIO_FDV,
  PREFIXO_PLATAFORMA,
  type ClienteHub,
  type ContextoAgenda,
  type ItemAgenda,
} from '../../../packages/platform-sdk/src/index';
import { OutboxPg, type BancoPg } from '../../../packages/platform-sdk/src/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, destinoDeLogs, inserirAdministradorDeTeste, SENHA_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { criarAgendaConector } from '../../../modules/integracao-fdv/api/agenda-conector';
import { espelho, payloadProduto } from '../../../modules/integracao-fdv/api/apoio-conector-teste';
import { criarDubleHub, gerarChaveConector, type DubleHub } from '../../ponta-a-ponta-fdv/apoio/duble-hub';
import { relogioReal } from '../../ponta-a-ponta-fdv/apoio/relogio';
import { atalhosPortal, inserirSuperadmin, type AppPortal, type MetodoPortal, type RespostaPortal } from '../../apoio/portal-pg';

const EMAIL_SA = 'sa-t0056-ifdv@exemplo.invalid';
/** Um e-mail por empresa: desde a 0079 (ADR 0021) o e-mail de usuário é único no sistema todo. */
const EMAIL_ADM_A = 'adm-t0056-ifdv-a@exemplo.invalid';
const EMAIL_ADM_B = 'adm-t0056-ifdv-b@exemplo.invalid';
/** Chave mestra e chave do conector geradas a cada execução: nenhum segredo fixo no teste. */
const MESTRA = randomBytes(32);
const CHAVE = gerarChaveConector();
const CONECTOR = 'erp-t0056-portal';
const ENTIDADE = 'produto';
const BASE_FICTICIA = 'https://duble-hub-t0056.invalid';

interface Rota {
  nome: keyof typeof C;
  metodo: MetodoPortal;
}
/** As 6 rotas do plugin (ADR 0013 §2), com o método da tabela. */
const ROTAS: readonly Rota[] = [
  { nome: 'ler', metodo: 'GET' },
  { nome: 'credencial', metodo: 'PUT' },
  { nome: 'testar', metodo: 'POST' },
  { nome: 'configuracao', metodo: 'PUT' },
  { nome: 'cargaCompleta', metodo: 'POST' },
  { nome: 'retomar', metodo: 'POST' },
];
const CORPOS: Partial<Record<keyof typeof C, object>> = {
  credencial: { conector_id: CONECTOR, chave: CHAVE, ambiente: 'teste' },
  configuracao: { entidades_habilitadas: [ENTIDADE], limite_registros_lote: 100 },
};
const urlDe = (nome: keyof typeof C, id: string, entidade = ENTIDADE) =>
  `${PREFIXO_PLATAFORMA}${C[nome].replace(':id', id).replace(':entidade', entidade)}`;

describe.skipIf(!PG_DISPONIVEL)('integração FDV no portal /config: borda das rotas e ponta a ponta com o BKO e o worker (T-0056, ADR 0013)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let worker: BancoPg;
  let hub: DubleHub;
  let p: ReturnType<typeof atalhosPortal>;
  let token = '';
  let A = '';
  let B = '';
  let SEM_LICENCA = '';
  const logs: string[] = [];
  const corpos: string[] = [];

  /** Chamada do superadmin; guarda o corpo para a varredura da chave. */
  const sa = async (metodo: MetodoPortal, url: string, o: { corpo?: object; chave?: string } = {}): Promise<RespostaPortal> => {
    const r = await p.pedir(metodo, url, { token, ...o });
    corpos.push(r.body);
    return r;
  };
  const pedirRota = (r: Rota, id: string, o: { token?: string } = {}) =>
    p.pedir(r.metodo, urlDe(r.nome, id), { ...o, chave: randomUUID(), ...(CORPOS[r.nome] ? { corpo: CORPOS[r.nome] } : {}) });
  const auditoria = async (t: string) =>
    (await b.admin.query("SELECT acao, to_jsonb(a)::text AS linha FROM plataforma.auditoria a WHERE tenant_id = $1 AND acao LIKE 'integracao-fdv.%' ORDER BY created_at", [t])).rows as {
      acao: string;
      linha: string;
    }[];
  /** `payload.entidades` de cada `integracao-fdv.carga_inicial.solicitada@1` do tenant, na ordem de gravação. */
  const cargasIniciais = async (t: string) =>
    (
      await b.admin.query("SELECT payload FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'integracao-fdv.carga_inicial.solicitada@1' ORDER BY created_at, id", [t])
    ).rows.map((r) => (r.payload as { payload: { entidades: string[] } }).payload.entidades);
  const loginTenant = async (slug: string, email: string) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: slug, email, senha: SENHA_DE_TESTE } });
    expect(r.statusCode).toBe(200);
    return r.json<{ token_acesso: string }>().token_acesso;
  };
  const status = async (jwt: string) => {
    const r = await app.inject({ method: 'GET', url: '/v1/integracao-fdv/status', headers: { authorization: `Bearer ${jwt}` } });
    corpos.push(r.body);
    return r;
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(b, EMAIL_SA);
    A = await criarTenant(b.admin, 't0056-ifdv-a', ['core', 'integracao-fdv']);
    B = await criarTenant(b.admin, 't0056-ifdv-b', ['core', 'integracao-fdv']);
    SEM_LICENCA = await criarTenant(b.admin, 't0056-ifdv-sem-lic', ['core']);
    await inserirAdministradorDeTeste(b.admin, A, { id: randomUUID(), email: EMAIL_ADM_A, nome: 'Pessoa Fictícia A', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, B, { id: randomUUID(), email: EMAIL_ADM_B, nome: 'Pessoa Fictícia B', filialIds: [] });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', chaveIntegracao: MESTRA, logger: { level: 'debug', stream: destinoDeLogs(logs) } }));
    worker = b.banco('macuxierp_worker');
    hub = await criarDubleHub({ relogio: relogioReal, consultasAtePronto: 0 });
    hub.registrarConector({ tenant: 'fdv-t0056-a', conectorId: CONECTOR, chave: CHAVE });
    p = atalhosPortal(app);
    token = await p.sessao(EMAIL_SA);
  }, 180_000);
  afterAll(async () => {
    await hub?.fechar();
    await app?.close();
    await b?.remover();
  });

  describe('E1: borda das 6 rotas do plugin', () => {
    it('sem sessão do portal: 401 em todas', async () => {
      const fora: string[] = [];
      for (const r of ROTAS) {
        const res = await pedirRota(r, A);
        if (res.statusCode !== 401) fora.push(`${r.metodo} ${r.nome} → ${res.statusCode}`);
      }
      expect(fora).toEqual([]);
    });

    it('superadmin em empresa inexistente: 404 em todas e nada auditado', async () => {
      const id = randomUUID();
      const fora: string[] = [];
      for (const r of ROTAS) {
        const res = await pedirRota(r, id, { token });
        if (res.statusCode !== 404) fora.push(`${r.metodo} ${r.nome} → ${res.statusCode} ${res.body}`);
      }
      expect(fora).toEqual([]);
      expect(await auditoria(id)).toEqual([]);
    });

    it('empresa sem o módulo integracao-fdv: GET 200 com modulo_licenciado false; as 5 escritas 422 RN-CORE-02 e nada gravado', async () => {
      const ler = await sa('GET', urlDe('ler', SEM_LICENCA));
      expect(ler.statusCode).toBe(200);
      expect(ler.json()).toMatchObject({ modulo_licenciado: false });
      const fora: string[] = [];
      for (const r of ROTAS.filter((x) => x.metodo !== 'GET')) {
        const res = await pedirRota(r, SEM_LICENCA, { token });
        if (res.statusCode !== 422 || res.json<{ codigo: string }>().codigo !== 'RN-CORE-02') fora.push(`${r.metodo} ${r.nome} → ${res.statusCode} ${res.body}`);
      }
      expect(fora).toEqual([]);
      expect(await auditoria(SEM_LICENCA)).toEqual([]);
      expect((await b.admin.query('SELECT 1 FROM integracao_fdv.credencial WHERE tenant_id = $1', [SEM_LICENCA])).rowCount).toBe(0);
    });

    it('entrada inválida: 400 VALIDACAO (id fora de UUID, cadastro fora da F2, corpo e Idempotency-Key obrigatória)', async () => {
      const casos: [string, Promise<RespostaPortal>][] = [
        ['GET id não-UUID', sa('GET', urlDe('ler', 'nao-e-uuid'))],
        ['carga-completa entidade fora da F2', sa('POST', urlDe('cargaCompleta', A, 'pedido'), { chave: randomUUID() })],
        ['retomar entidade fora da F2', sa('POST', urlDe('retomar', A, 'nada'), { chave: randomUUID() })],
        ['credencial chave curta', sa('PUT', urlDe('credencial', A), { corpo: { conector_id: CONECTOR, chave: 'curta', ambiente: 'teste' } })],
        ['credencial ambiente desconhecido', sa('PUT', urlDe('credencial', A), { corpo: { conector_id: CONECTOR, chave: CHAVE, ambiente: 'xpto' } })],
        ['configuracao limite 0', sa('PUT', urlDe('configuracao', A), { corpo: { entidades_habilitadas: [ENTIDADE], limite_registros_lote: 0 } })],
        ['configuracao cadastro repetido', sa('PUT', urlDe('configuracao', A), { corpo: { entidades_habilitadas: [ENTIDADE, ENTIDADE], limite_registros_lote: 10 } })],
        ['configuracao cadastro desconhecido', sa('PUT', urlDe('configuracao', A), { corpo: { entidades_habilitadas: ['pedido'], limite_registros_lote: 10 } })],
        ['carga-completa sem Idempotency-Key', sa('POST', urlDe('cargaCompleta', A))],
      ];
      const fora: string[] = [];
      for (const [nome, pr] of casos) {
        const r = await pr;
        if (r.statusCode !== 400) fora.push(`${nome} → ${r.statusCode} ${r.body}`);
      }
      expect(fora).toEqual([]);
      // nenhum 400 gravou nada nem tocou o Hub
      expect((await b.admin.query('SELECT 1 FROM integracao_fdv.credencial WHERE tenant_id = $1', [A])).rowCount).toBe(0);
      expect(await auditoria(A)).toEqual([]);
      expect(hub.requisicoes).toEqual([]);
    });
  });

  describe('E2: portal grava → BKO lê → carga completa chega ao Hub pelo worker', () => {
    it('antes da credencial, o BKO do tenant mostra tudo desligado', async () => {
      const r = await status(await loginTenant('t0056-ifdv-a', EMAIL_ADM_A));
      expect(r.statusCode).toBe(200);
      const s = r.json<{ conector_id: string | null; cadastros: { ligada: boolean }[] }>();
      expect(s.conector_id).toBeNull();
      expect(s.cadastros.map((c) => c.ligada)).toEqual(ENTIDADES_ENVIO_FDV.map(() => false));
    });

    it('PUT /credencial (201): a primeira credencial nasce sem cadastro ligado e não pede carga inicial (ligar um por um, 0042)', async () => {
      const cred = await sa('PUT', urlDe('credencial', A), { corpo: CORPOS.credencial! });
      expect(cred.statusCode).toBe(201);
      const c = cred.json<{ entidades_habilitadas: string[]; cadastros: { ligada: boolean }[] }>();
      expect(c.entidades_habilitadas).toEqual([]);
      expect(c.cadastros.some((x) => x.ligada)).toBe(false);
      expect(await cargasIniciais(A)).toEqual([]);
    });

    it('PUT /configuracao ligando o produto (200): 1 carga_inicial.solicitada@1 só com o produto; cifra com a empresa alvo, auditoria sem a chave', async () => {
      const conf = await sa('PUT', urlDe('configuracao', A), { corpo: CORPOS.configuracao!, chave: randomUUID() });
      expect(conf.statusCode).toBe(200);
      expect(conf.json()).toMatchObject({ entidades_habilitadas: [ENTIDADE], limite_registros_lote: 100 });
      expect(await cargasIniciais(A)).toEqual([[ENTIDADE]]);
      const { rows } = await b.admin.query('SELECT chave_cifrada, chave_prefixo FROM integracao_fdv.credencial WHERE tenant_id = $1 AND deleted_at IS NULL', [A]);
      expect(rows).toHaveLength(1);
      expect(decifrarCampo({ chave: MESTRA, tenantId: A, cifrado: rows[0].chave_cifrada }).toString('utf8')).toBe(CHAVE);
      expect(CHAVE.startsWith(rows[0].chave_prefixo)).toBe(true);
      expect((await auditoria(A)).map((x) => x.acao)).toEqual(['integracao-fdv.credencial.criar', 'integracao-fdv.configuracao.alterar']);
      expect(hub.requisicoes).toEqual([]); // a API não chama o Hub
    });

    it('BKO de A: status configurado com o prefixo, só o produto ligado; o tenant B (RLS) continua sem nada', async () => {
      const r = await status(await loginTenant('t0056-ifdv-a', EMAIL_ADM_A));
      expect(r.statusCode).toBe(200);
      const s = r.json<{ conector_id: string; ambiente: string; chave_prefixo: string; cadastros: { entidade: string; ligada: boolean }[] }>();
      expect(s).toMatchObject({ conector_id: CONECTOR, ambiente: 'teste' });
      expect(s.chave_prefixo.length).toBeLessThanOrEqual(8);
      expect(CHAVE.startsWith(s.chave_prefixo)).toBe(true);
      expect(s.cadastros.filter((c) => c.ligada).map((c) => c.entidade)).toEqual([ENTIDADE]);
      expect(Object.keys(s)).not.toContain('credencial_id');
      expect(Object.keys(s)).not.toContain('entidades_habilitadas');

      const rb = await status(await loginTenant('t0056-ifdv-b', EMAIL_ADM_B));
      expect(rb.statusCode).toBe(200);
      expect(rb.json()).toMatchObject({ conector_id: null, ambiente: null, chave_prefixo: null });
      expect(rb.body).not.toContain(CONECTOR);
    });

    it('POST carga-completa (202): abre a sessão, antecipa o cursor e audita; a mesma Idempotency-Key não abre outra decisão', async () => {
      const chave = randomUUID();
      const r = await sa('POST', urlDe('cargaCompleta', A), { chave });
      expect([r.statusCode, r.json()]).toEqual([202, { aceito: true }]);
      const cur = (await b.admin.query("SELECT sessao_aberta_id, proximo_em <= now() AS vencido FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2", [A, ENTIDADE])).rows;
      expect(cur).toHaveLength(1);
      expect(cur[0]).toMatchObject({ vencido: true });
      expect(cur[0].sessao_aberta_id).toEqual(expect.any(String));
      const repetido = await sa('POST', urlDe('cargaCompleta', A), { chave });
      expect(repetido.statusCode).toBe(202);
      expect((await auditoria(A)).filter((x) => x.acao === 'integracao-fdv.entidade.carga_completa')).toHaveLength(1);
      expect(hub.requisicoes).toEqual([]);
    });

    it('um ciclo da agenda do worker leva a carga do produto ao dublê do Hub com a chave gravada pelo portal', async () => {
      // um produto no espelho (o que o consumidor do cadastros grava); a carga completa vazia é a lacuna L-1 da T-0056
      await espelho(b.admin, A, ENTIDADE, payloadProduto('prod-t0056-1'));
      const { itens, executar } = await cicloWorker(worker, hub, A);
      expect(itens.some((i) => i.tarefa === 'envio' && i.chave === ENTIDADE)).toBe(true);
      await executar();
      const doTenant = hub.requisicoes.filter((x) => x.tenant === 'fdv-t0056-a');
      expect(doTenant.length).toBeGreaterThan(0);
      expect(doTenant.every((x) => x.status !== 401)).toBe(true); // a chave decifrada pelo worker é a que o portal gravou
      expect(doTenant.some((x) => x.metodo === 'POST' && x.caminho === '/integracao/v1/lotes' && x.status === 202)).toBe(true);
      const lotes = (await b.admin.query('SELECT entidade::text AS entidade, modo, estado FROM integracao_fdv.lote_envio WHERE tenant_id = $1', [A])).rows;
      expect(lotes).toEqual([expect.objectContaining({ entidade: ENTIDADE, modo: 'completo' })]);
      expect(lotes[0].estado).not.toBe('recusado');
      expect(hub.registro('fdv-t0056-a', ENTIDADE, 'prod-t0056-1')).not.toBeNull();
    });

    it('a chave do conector não aparece em resposta, log pino nem auditoria', async () => {
      expect(corpos.length).toBeGreaterThan(5);
      expect(corpos.join('\n')).not.toContain(CHAVE);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain(CHAVE);
      const aud = (await auditoria(A)).map((x) => x.linha).join('\n');
      expect(aud.length).toBeGreaterThan(0);
      expect(aud).not.toContain(CHAVE);
      expect(aud).not.toContain(CHAVE.slice(0, 8)); // nem o prefixo (ADR 0013 §4)
      expect(hub.log.join('\n')).not.toContain(CHAVE);
    });

    it('ligar o preço pede a carga do preço com a tabela de preço (dependência); religar igual não pede de novo', async () => {
      const PRECO = await criarTenant(b.admin, 't0056-ifdv-preco', ['core', 'integracao-fdv']);
      const cred = await p.pedir('PUT', urlDe('credencial', PRECO), { token, chave: randomUUID(), corpo: { conector_id: 'erp-t0056-preco', chave: gerarChaveConector(), ambiente: 'teste' } });
      expect(cred.statusCode).toBe(201);
      expect(await cargasIniciais(PRECO)).toEqual([]);
      const corpo = { entidades_habilitadas: ['preco'], limite_registros_lote: 100 };
      expect((await p.pedir('PUT', urlDe('configuracao', PRECO), { token, chave: randomUUID(), corpo })).statusCode).toBe(200);
      const cargas = await cargasIniciais(PRECO);
      expect(cargas).toHaveLength(1);
      expect([...cargas[0]!].sort()).toEqual(['preco', 'tabela_preco']);
      expect((await p.pedir('PUT', urlDe('configuracao', PRECO), { token, chave: randomUUID(), corpo })).statusCode).toBe(200);
      expect(await cargasIniciais(PRECO)).toHaveLength(1);
    });

    it('espelho vazio: carga completa pelo portal e um ciclo do worker não mandam lote vazio ao Hub, não recusam nem pausam o cadastro', async () => {
      // Se o contrato do doc 06 do FDV mandar o lote vazio para inativar tudo, troque a asserção por: dublê recebe registros: [] e responde 202
      const VAZIO = await criarTenant(b.admin, 't0056-ifdv-vazio', ['core', 'integracao-fdv']);
      const conectorVazio = 'erp-t0056-vazio';
      const chaveVazio = gerarChaveConector();
      hub.registrarConector({ tenant: 'fdv-t0056-vazio', conectorId: conectorVazio, chave: chaveVazio });
      const cred = await p.pedir('PUT', urlDe('credencial', VAZIO), { token, chave: randomUUID(), corpo: { conector_id: conectorVazio, chave: chaveVazio, ambiente: 'teste' } });
      expect(cred.statusCode).toBe(201);
      expect((await p.pedir('PUT', urlDe('configuracao', VAZIO), { token, chave: randomUUID(), corpo: CORPOS.configuracao! })).statusCode).toBe(200);
      const carga = await p.pedir('POST', urlDe('cargaCompleta', VAZIO), { token, chave: randomUUID() });
      expect([carga.statusCode, carga.json()]).toEqual([202, { aceito: true }]);

      const { itens, executar } = await cicloWorker(worker, hub, VAZIO);
      expect(itens.some((i) => i.tarefa === 'envio' && i.chave === ENTIDADE)).toBe(true);
      const antes = hub.requisicoes.length;
      await executar();

      // janela do ciclo, não filtro por tenant: o dublê grava tenant null nas respostas de erro (ex.: 422 lote_vazio)
      const doCiclo = hub.requisicoes.slice(antes);
      expect(doCiclo.filter((x) => x.metodo === 'POST' && x.caminho === '/integracao/v1/lotes')).toEqual([]);
      const lotes = (await b.admin.query("SELECT estado FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND estado = 'recusado'", [VAZIO])).rows;
      expect(lotes).toEqual([]);
      const cur = (await b.admin.query('SELECT pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2', [VAZIO, ENTIDADE])).rows;
      expect(cur).toEqual([{ pausada_motivo: null }]);
      const envelope = await p.pedir('GET', urlDe('ler', VAZIO), { token });
      expect(envelope.statusCode).toBe(200);
      // o envelope do portal não expõe pausada_motivo: resume pausa, lote recusado/falho e erros em `falha` (falhaEnvioFdv)
      const produto = envelope.json<{ cadastros: { entidade: string; falha: unknown }[] }>().cadastros.find((c) => c.entidade === ENTIDADE);
      expect(produto).toMatchObject({ entidade: ENTIDADE, falha: null });
    });
  });
});

/** Um ciclo da agenda do worker no tenant: reserva os itens e devolve como executá-los contra o dublê do Hub. */
async function cicloWorker(banco: BancoPg, hub: DubleHub, tenantId: string): Promise<{ itens: ItemAgenda[]; executar: () => Promise<void> }> {
  const agenda = criarAgendaConector({ outbox: new OutboxPg() });
  const base = hub.url.replace(/\/integracao\/v1$/, '');
  const cliente: ClienteHub = criarClienteHub({
    urls: { teste: BASE_FICTICIA, producao: BASE_FICTICIA },
    versaoErp: '0.3.4',
    fetch: (u: string | URL | Request, init?: RequestInit) => fetch(String(u).replace(BASE_FICTICIA, base), init),
  });
  const agora = new Date();
  const posse = new Date(agora.getTime() + 120_000);
  const itens = (await banco.semTenant((tx) => agenda.reservar(tx, 100, agora, posse))).filter((i) => i.tenant_id === tenantId);
  const executar = async (): Promise<void> => {
    for (const item of itens) await agenda.executar(item, contexto(banco, item, cliente, agora, posse));
  };
  return { itens, executar };
}

/** Contexto da agenda como o laço do worker monta: transações curtas no tenant do item e a chave decifrada só em memória. */
function contexto(banco: BancoPg, item: ItemAgenda, hub: ClienteHub, agora: Date, posseAte: Date): ContextoAgenda {
  return {
    agora,
    posseAte,
    hub,
    decifrarCredencial: (cifrada, tenantId) => decifrarCampo({ chave: MESTRA, tenantId, cifrado: cifrada }).toString('utf8'),
    emTransacao: (fn) => banco.comTenant(item.tenant_id, fn),
  };
}
