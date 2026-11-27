/**
 * T-0057 (T1): a API de entrada `/entrada/v1` de ponta a ponta — HTTP na API de produção (a chave nasce pelo portal
 * `/config`) → lote em `cadastros.entrada_lote` → trabalho `TRABALHO_ENTRADA_LOTE` no worker → cadastros
 * (`gravarLinhas`) → eventos `cadastros.*@1` → espelho e agenda do `integracao-fdv` → dublê do Hub. ADR 0014 §1 a §4;
 * decisão 34 B (R-20261126-210816-alexandre): só delta, a carga completa responde 422 `CARGA_COMPLETA_NAO_SUPORTADA`.
 * Tudo com o código de produção do main (E1 #747, C1/C2 #748, E2 #749, C3/C4 #763, E3 #764); o arnês é
 * `apoio/entrada-v1.ts`. A falta do pepper, a troca e a revogação da chave e a empresa suspensa ficam no
 * `apps/api/src/entrada.db.test.ts`.
 * Roteiro manual equivalente: docs/testes/T-0057-thathyany-simulada.md. Dados fictícios. Sem Postgres pula; com
 * MACUXI_PG_EXIGIR=1 falha.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CABECALHO_CONECTOR_ID_ENTRADA, ChaveEntrada, CODIGO_CARGA_COMPLETA_NAO_SUPORTADA } from '../../packages/platform-sdk/src/index';
import { PG_DISPONIVEL } from '../../packages/platform-sdk/src/pg-testes';
import { CorpoLote, CursorEntidade, LoteAceito, LoteResultado, PAYLOADS_HUB, RespostaSinal, VERSAO_CONTRATO_HUB, type RegistroLote } from '../../packages/platform-sdk/src/hub-v1';
import {
  cnpjDaEmpresa,
  ENTIDADES_F2,
  envelopeCompleto,
  envelopeDelta,
  gerarChaveEntrada,
  linhasComSensivel,
  massaEntrada,
  montarEntradaV1,
  novaChaveIdempotencia,
  urlEntrada,
  type MassaEntrada,
  type MontagemEntradaV1,
} from './apoio/entrada-v1';
import { RelogioDeTeste } from './apoio/relogio';

const INICIO = new Date('2026-11-27T12:00:00.000Z');
/** O 401 neutro da autenticação de máquina (o mesmo para todo motivo, ADR 0014 §4). */
const NEUTRO = { codigo: 'NAO_AUTENTICADO', mensagem: 'Credencial de conector inválida' };

describe('T-0057 — a massa fictícia da /entrada/v1 passa no contrato hub-v1 do SDK (sem banco)', () => {
  it('os 10 cadastros da F2 têm registro, e cada um passa no payload do Hub e no envelope delta', () => {
    const { registros } = massaEntrada(INICIO);
    expect(Object.keys(registros).sort()).toEqual([...ENTIDADES_F2].sort());
    for (const e of ENTIDADES_F2) {
      for (const r of registros[e]) expect(PAYLOADS_HUB[e].safeParse(r).success, e).toBe(true);
      expect(CorpoLote.safeParse(envelopeDelta(e, registros[e], INICIO)).success, e).toBe(true);
    }
  });

  it('a carga completa usada no caso do 422 é válida pelo contrato (a recusa tem de vir da regra 34 B, não do Zod)', () => {
    const { registros } = massaEntrada(INICIO);
    expect(envelopeCompleto('filial', registros.filial, INICIO)).toMatchObject({ modo: 'completo', sessao: { parte: 1, ultimo: true } });
  });

  it('a chave gerada pelo arnês está no formato `ChaveEntrada` do SDK (32 bytes em base64url)', () => {
    expect(ChaveEntrada.safeParse(gerarChaveEntrada()).success).toBe(true);
  });
});

describe.skipIf(!PG_DISPONIVEL)('T-0057 T1 — /entrada/v1 → cadastros → dublê do Hub (PostgreSQL efêmero)', () => {
  const relogio = new RelogioDeTeste(INICIO);
  let m: MontagemEntradaV1;
  let massa: MassaEntrada;
  const lote = () => envelopeDelta('produto', massaEntrada(INICIO).registros.produto, INICIO);

  beforeAll(async () => {
    m = await montarEntradaV1(relogio);
    massa = massaEntrada(INICIO);
  }, 180_000);
  afterAll(async () => {
    await m?.fechar();
  });

  describe('autenticação de máquina (ADR 0014 §3 e §4; regra 6)', () => {
    it('chave certa: 202 LoteAceito, o lote e o trabalho ficam só no tenant da credencial', async () => {
      const [antesA, antesB] = [await m.trabalhosDaEntrada(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.B)];
      const r = await m.enviarLote(m.credenciais.A, lote());
      expect(r.statusCode, r.body).toBe(202);
      const aceito = LoteAceito.parse(r.json());
      expect(aceito).toMatchObject({ status: 'recebido', entidade: 'produto', modo: 'delta', recebidos: 1 });
      expect(aceito.repetido).toBeUndefined();
      expect((await m.loteNoBanco(aceito.lote_id))?.tenant_id).toBe(m.api.t.A);
      expect(await m.trabalhosDaEntrada(m.api.t.A)).toBe(antesA + 1);
      expect(await m.trabalhosDaEntrada(m.api.t.B)).toBe(antesB);
      const c = await m.chamarEntrada(m.credenciais.A, 'GET', urlEntrada('cursor', { entidade: 'produto' }));
      expect(c.statusCode, c.body).toBe(200);
      expect(CursorEntidade.safeParse(c.json()).success).toBe(true);
    });

    it('JWT do BKO (administrador real do tenant A) é recusado com o mesmo 401 neutro, com ou sem o X-Macuxi-Conector-Id, e nada entra na fila', async () => {
      const antes = await m.trabalhosDaEntrada(m.api.t.A);
      const jwt = m.api.auth('A');
      for (const cabecalhos of [jwt, { ...jwt, [CABECALHO_CONECTOR_ID_ENTRADA]: m.credenciais.A.conectorId }]) {
        const r = await m.chamarEntrada(null, 'POST', urlEntrada('lotes'), { corpo: lote(), cabecalhos: { ...cabecalhos, 'idempotency-key': novaChaveIdempotencia() } });
        expect(r.statusCode).toBe(401);
        expect(r.json()).toEqual(NEUTRO);
      }
      expect(await m.trabalhosDaEntrada(m.api.t.A)).toBe(antes);
    });

    it('sem Authorization, sem X-Macuxi-Conector-Id, chave errada ou conector inexistente: o mesmo 401 neutro (não diz qual falhou)', async () => {
      const { A } = m.credenciais;
      const casos: { c: { conectorId: string; chave: string } | null; cabecalhos: Record<string, string> }[] = [
        { c: null, cabecalhos: {} },
        { c: null, cabecalhos: { authorization: `Bearer ${A.chave}` } },
        { c: null, cabecalhos: { [CABECALHO_CONECTOR_ID_ENTRADA]: A.conectorId } },
        { c: { conectorId: A.conectorId, chave: gerarChaveEntrada() }, cabecalhos: {} },
        { c: { conectorId: 'tha-nao-existe', chave: A.chave }, cabecalhos: {} },
      ];
      for (const [i, k] of casos.entries()) {
        const r = await m.chamarEntrada(k.c, 'POST', urlEntrada('lotes'), { corpo: lote(), idempotencia: novaChaveIdempotencia(), cabecalhos: k.cabecalhos });
        expect(r.statusCode, `caso ${i}`).toBe(401);
        expect(r.json(), `caso ${i}`).toEqual(NEUTRO);
      }
    });

    it('chave do tenant B com o X-Macuxi-Conector-Id do tenant A: 401, sem lote nem trabalho em nenhum dos dois', async () => {
      const antes = [await m.lotesNoBanco(m.api.t.A), await m.lotesNoBanco(m.api.t.B), await m.trabalhosDaEntrada(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.B)];
      const r = await m.enviarLote({ conectorId: m.credenciais.A.conectorId, chave: m.credenciais.B.chave }, lote());
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual(NEUTRO);
      expect([await m.lotesNoBanco(m.api.t.A), await m.lotesNoBanco(m.api.t.B), await m.trabalhosDaEntrada(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.B)]).toEqual(antes);
    });

    it('chave do tenant A não lê o lote do tenant B: GET /entrada/v1/lotes/:id responde 404 (nem 403), e o B lê o próprio', async () => {
      const r = await m.enviarLote(m.credenciais.B, lote());
      expect(r.statusCode, r.body).toBe(202);
      const { lote_id } = LoteAceito.parse(r.json());
      const doA = await m.chamarEntrada(m.credenciais.A, 'GET', urlEntrada('lote', { id: lote_id }));
      expect(doA.statusCode).toBe(404);
      expect((await m.chamarEntrada(m.credenciais.B, 'GET', urlEntrada('lote', { id: lote_id }))).statusCode).toBe(200);
    });

    it('tenant sem o cadastros licenciado: 403 MODULO_INATIVO (RN-CORE-02), sem lote nem trabalho', async () => {
      const r = await m.enviarLote(m.credenciais.S, lote());
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
      expect([await m.lotesNoBanco(m.api.t.S), await m.trabalhosDaEntrada(m.api.t.S)]).toEqual([0, 0]);
    });

    it('a chave dá acesso só a /entrada/v1: com ela, a rota do BKO GET /v1/cadastros/filiais responde 401 (com o JWT, 200)', async () => {
      expect((await m.app.inject({ method: 'GET', url: '/v1/cadastros/filiais', headers: m.api.auth('A') })).statusCode).toBe(200);
      const r = await m.chamarEntrada(m.credenciais.A, 'GET', '/v1/cadastros/filiais');
      expect(r.statusCode).toBe(401);
      expect(linhasComSensivel([r.body], [m.credenciais.A.chave])).toEqual([]);
    });

    it('limite de falhas por IP e conector: depois de 20 falhas, 429 com Retry-After, mesmo com a chave certa; o outro conector segue', async () => {
      const alvo = await m.definirChave(m.api.t.B, 'tha-forca-bruta');
      for (let i = 0; i < 20; i++) {
        expect((await m.chamarEntrada({ conectorId: alvo.conectorId, chave: gerarChaveEntrada() }, 'GET', urlEntrada('cursor', { entidade: 'filial' }))).statusCode).toBe(401);
      }
      const r = await m.chamarEntrada(alvo, 'GET', urlEntrada('cursor', { entidade: 'filial' }));
      expect(r.statusCode).toBe(429);
      expect(r.headers['retry-after']).toBeDefined();
      expect((await m.chamarEntrada(m.credenciais.A, 'GET', urlEntrada('cursor', { entidade: 'filial' }))).statusCode).toBe(200);
    });
  });

  describe('idempotência (ADR 0014 §3; RN-INT-01)', () => {
    it('POST /lotes sem Idempotency-Key: 400, sem lote criado', async () => {
      const antes = await m.lotesNoBanco(m.api.t.A);
      const r = await m.chamarEntrada(m.credenciais.A, 'POST', urlEntrada('lotes'), { corpo: lote() });
      expect(r.statusCode, r.body).toBe(400);
      expect(await m.lotesNoBanco(m.api.t.A)).toBe(antes);
    });

    it('mesma Idempotency-Key e mesmo corpo: 202 com o mesmo lote_id e repetido=true; um lote e um trabalho só', async () => {
      const chave = novaChaveIdempotencia();
      const corpo = lote();
      const [lotes, trabalhos] = [await m.lotesNoBanco(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.A)];
      const r1 = LoteAceito.parse((await m.enviarLote(m.credenciais.A, corpo, chave)).json());
      const r2 = await m.enviarLote(m.credenciais.A, corpo, chave);
      expect(r2.statusCode).toBe(202);
      expect(LoteAceito.parse(r2.json())).toMatchObject({ lote_id: r1.lote_id, repetido: true });
      expect([await m.lotesNoBanco(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.A)]).toEqual([lotes + 1, trabalhos + 1]);
    });

    it('mesma Idempotency-Key com outro corpo: 409, sem ecoar o corpo, e o lote original não muda', async () => {
      const chave = novaChaveIdempotencia();
      const r1 = LoteAceito.parse((await m.enviarLote(m.credenciais.A, lote(), chave)).json());
      const antes = await m.loteNoBanco(r1.lote_id);
      const outro = envelopeDelta('cliente', massa.registros.cliente, INICIO);
      const r2 = await m.enviarLote(m.credenciais.A, outro, chave);
      expect(r2.statusCode).toBe(409);
      expect(linhasComSensivel([r2.body], massa.sensiveis)).toEqual([]);
      expect(await m.loteNoBanco(r1.lote_id)).toEqual(antes);
    });

    it('a mesma Idempotency-Key em outro tenant não colide: dois lotes, um em cada tenant', async () => {
      const chave = novaChaveIdempotencia();
      const a = LoteAceito.parse((await m.enviarLote(m.credenciais.A, lote(), chave)).json());
      const b = await m.enviarLote(m.credenciais.B, lote(), chave);
      expect(b.statusCode, b.body).toBe(202);
      const bb = LoteAceito.parse(b.json());
      expect(bb.lote_id).not.toBe(a.lote_id);
      expect(bb.repetido).toBeUndefined();
      expect([(await m.loteNoBanco(a.lote_id))?.tenant_id, (await m.loteNoBanco(bb.lote_id))?.tenant_id]).toEqual([m.api.t.A, m.api.t.B]);
    });
  });

  describe('recusa do envelope inteiro (decisão 34 B; ADR 0014 §2)', () => {
    it('modo completo com sessão válida: 422 CARGA_COMPLETA_NAO_SUPORTADA, sem lote, sem trabalho na fila e sem inativar nada', async () => {
      const antes = [await m.lotesNoBanco(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.A)];
      const r = await m.enviarLote(m.credenciais.A, envelopeCompleto('filial', massa.registros.filial, INICIO));
      expect(r.statusCode, r.body).toBe(422);
      expect(r.json()).toMatchObject({ codigo: CODIGO_CARGA_COMPLETA_NAO_SUPORTADA });
      expect([await m.lotesNoBanco(m.api.t.A), await m.trabalhosDaEntrada(m.api.t.A)]).toEqual(antes);
    });

    it('entidade fora da F2 (titulo) e versão do contrato errada: recusa sem lote criado', async () => {
      const antes = await m.lotesNoBanco(m.api.t.A);
      for (const corpo of [{ ...lote(), entidade: 'titulo' }, { ...lote(), versao_contrato: 'v9' }]) {
        const r = await m.enviarLote(m.credenciais.A, corpo);
        expect([400, 422], r.body).toContain(r.statusCode);
      }
      expect(await m.lotesNoBanco(m.api.t.A)).toBe(antes);
    });

    it('POST /entrada/v1/sinal grava o sinal e devolve RespostaSinal do conector da credencial, sem política de versão', async () => {
      const corpo = { versao_contrato: VERSAO_CONTRATO_HUB, conector_id: m.credenciais.A.conectorId, versao_conector: '1.0.0', em: INICIO.toISOString(), fila: [], entidades: [] };
      const r = await m.chamarEntrada(m.credenciais.A, 'POST', urlEntrada('sinal'), { corpo });
      expect(r.statusCode, r.body).toBe(200);
      const s = RespostaSinal.parse(r.json());
      expect(s.conector_id).toBe(m.credenciais.A.conectorId);
      expect(s.politica_versao ?? null).toBeNull();
      const outro = await m.chamarEntrada(m.credenciais.A, 'POST', urlEntrada('sinal'), { corpo: { ...corpo, conector_id: m.credenciais.B.conectorId } });
      expect(outro.statusCode).toBe(400);
    });
  });

  describe('os 10 cadastros da F2 (ADR 0014 §2): lote delta → worker → resultado → cursor → cadastro → Hub', () => {
    /**
     * Filial e produto já cadastrados pelo BKO (a entrada atualiza sem crt e sem ncm: D1/D2). A forma de pagamento é gravada em
     * `cadastros.entrada_forma` (0074, #793) e conta como nova. Os outros 7 também são novos.
     */
    // O endereço é uma linha do cliente (adaptarClienteEndereco): o de entrega novo conta como cliente atualizado.
    const ESPERADO: Partial<Record<(typeof ENTIDADES_F2)[number], 'atualizadas' | 'inalteradas'>> = {
      filial: 'atualizadas', produto: 'atualizadas', cliente_endereco: 'atualizadas',
    };
    beforeAll(async () => {
      await m.semearPeloBko(massa);
    });

    for (const e of ENTIDADES_F2) {
      const conta = ESPERADO[e] ?? 'novas';
      it(`${e}: 202 → worker → GET /lotes/:id concluido (${conta}=1) → cursor no registro → corpo do lote zerado`, async () => {
        const r = await m.enviarLote(m.credenciais.A, envelopeDelta(e, massa.registros[e], INICIO));
        expect(r.statusCode, r.body).toBe(202);
        const { lote_id } = LoteAceito.parse(r.json());
        await m.processarFila();
        const g = await m.chamarEntrada(m.credenciais.A, 'GET', urlEntrada('lote', { id: lote_id }));
        expect(g.statusCode, g.body).toBe(200);
        const res = LoteResultado.parse(g.json());
        expect([res.status, res.contagens[conta], res.contagens.com_erro], JSON.stringify(res.erros)).toEqual(['concluido', 1, 0]);
        const reg = massa.registros[e][0]!;
        const c = CursorEntidade.parse((await m.chamarEntrada(m.credenciais.A, 'GET', urlEntrada('cursor', { entidade: e }))).json());
        expect(c.cursor).toMatchObject({ external_id: reg.external_id });
        expect((await m.loteNoBanco(lote_id))?.corpo_nulo).toBe(true);
      });
    }

    const lerLote = async (id: string) => LoteResultado.parse((await m.chamarEntrada(m.credenciais.A, 'GET', urlEntrada('lote', { id }))).json());

    /** Um lote com duas linhas novas, a 1ª sem o campo e a 2ª com ele; devolve o resultado. */
    const loteSemEComCampo = async (e: 'filial' | 'produto', sem: RegistroLote, com: RegistroLote) => {
      const r = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta(e, [sem, com], INICIO))).json());
      await m.processarFila();
      return lerLote(r.lote_id);
    };

    // D1/D2 (decisão 40 B; ADR 0014, emenda de 27/11; #770 e #771): `crt` da filial e `ncm` do produto opcionais na entrada.
    it('D1: filial nova sem crt é recusada só na linha (campo_obrigatorio crt); a nova com crt grava no mesmo lote', async () => {
      const base = massa.registros.filial[0]!;
      const sem = { ...base, external_id: `${base.external_id}-D1S`, codigo: '0003', cnpj: cnpjDaEmpresa('0003') };
      const com = { ...base, external_id: `${base.external_id}-D1C`, codigo: '0004', cnpj: cnpjDaEmpresa('0004'), crt: '1' };
      const res = await loteSemEComCampo('filial', sem, com);
      expect([res.status, res.contagens.novas, res.contagens.com_erro], JSON.stringify(res.erros)).toEqual(['concluido_com_erros', 1, 1]);
      expect(res.erros).toEqual([expect.objectContaining({ indice: 0, external_id: sem.external_id, campo: 'crt', codigo: 'campo_obrigatorio' })]);
    });

    it('D2 (pedido das 01h04): produto novo sem ncm é recusado só na linha (campo_obrigatorio ncm); o novo com ncm grava no mesmo lote', async () => {
      const base = massa.registros.produto[0]!;
      const sem = { ...base, external_id: `${base.external_id}-D2S`, sku: `${base.sku}-D2S` };
      const com = { ...base, external_id: `${base.external_id}-D2C`, sku: `${base.sku}-D2C`, ncm: '10063021' };
      const res = await loteSemEComCampo('produto', sem, com);
      expect([res.status, res.contagens.novas, res.contagens.com_erro], JSON.stringify(res.erros)).toEqual(['concluido_com_erros', 1, 1]);
      expect(res.erros).toEqual([expect.objectContaining({ indice: 0, external_id: sem.external_id, campo: 'ncm', codigo: 'campo_obrigatorio' })]);
    });

    it('D1/D2: a filial e o produto já cadastrados pelo BKO, atualizados pela entrada sem crt e sem ncm, mantêm o valor gravado', async () => {
      const [f, p] = [massa.registros.filial[0]!, massa.registros.produto[0]!];
      const { rows } = await m.api.b.admin.query(
        `SELECT (SELECT crt FROM cadastros.filial WHERE tenant_id = $1 AND external_id = $2) AS crt,
                (SELECT ncm FROM cadastros.produto WHERE tenant_id = $1 AND external_id = $3) AS ncm`,
        [m.api.t.A, f.external_id, p.external_id],
      );
      expect(rows[0]).toEqual({ crt: '1', ncm: '22021000' });
    });

    // D3 (v0.3.18): a forma nova, sem condição no ERP, fica em cadastros.entrada_forma (0074, #793) e o prazo seguinte a usa.
    it('D3: o 1º prazo de uma forma nova, sem condição no ERP, só pela entrada grava', async () => {
      const formaNova = { ...massa.registros.forma_pagamento[0]!, external_id: 'THA-FOR-NOVA-D3', codigo: 'BOLETO', nome: 'Boleto novo D3' };
      const f = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('forma_pagamento', [formaNova], INICIO))).json());
      await m.processarFila();
      const rf = await lerLote(f.lote_id);
      expect([rf.status, rf.contagens.novas], JSON.stringify(rf.erros)).toEqual(['concluido', 1]);
      const base = massa.registros.prazo_pagamento[0]!;
      const prazo = { ...base, external_id: `${base.external_id}-D3`, forma_external_id: formaNova.external_id, codigo: 'N-D3' };
      const r = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('prazo_pagamento', [prazo], INICIO))).json());
      await m.processarFila();
      const rp = await lerLote(r.lote_id);
      expect([rp.status, rp.contagens.novas], JSON.stringify(rp.erros)).toEqual(['concluido', 1]);
    });

    it('D3 parcial (#768): com a forma já ligada a uma condição, o lote da forma e depois o 1º prazo novo dela gravam', async () => {
      const forma = massa.registros.forma_pagamento[0]!;
      const f = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('forma_pagamento', [{ ...forma, alterado_em: INICIO.toISOString() }], INICIO))).json());
      const prazo = { ...massa.registros.prazo_pagamento[0]!, external_id: `${massa.registros.prazo_pagamento[0]!.external_id}-D3P`, codigo: 'D3P-28', parcelas_dias: '28', descricao: 'Boleto 28' };
      const p = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('prazo_pagamento', [prazo], INICIO))).json());
      await m.processarFila();
      const [rf, rp] = [await lerLote(f.lote_id), await lerLote(p.lote_id)];
      expect([rf.status, rf.contagens.com_erro], JSON.stringify(rf.erros)).toEqual(['concluido', 0]);
      expect([rp.status, rp.contagens.novas, rp.contagens.com_erro], JSON.stringify(rp.erros)).toEqual(['concluido', 1, 0]);
    });

    it('D3 (RN-CAD-09): forma com código desconhecido grava o tPag nulo em entrada_forma e não muda o tPag das condições irmãs', async () => {
      const forma = massa.registros.forma_pagamento[0]!;
      const irmas = () =>
        m.api.b.admin.query('SELECT external_id, forma_tpag FROM cadastros.condicao_pagamento WHERE tenant_id = $1 AND forma_external_id = $2 ORDER BY external_id', [m.api.t.A, forma.external_id]);
      const antes = (await irmas()).rows;
      expect(antes.length, 'a massa tem condição irmã da forma').toBeGreaterThan(0);
      const desconhecida = { ...forma, codigo: 'XYZ-DESCONHECIDA', alterado_em: new Date(INICIO.getTime() + 3_600_000).toISOString() };
      const r = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('forma_pagamento', [desconhecida], INICIO))).json());
      await m.processarFila();
      const res = await lerLote(r.lote_id);
      expect([res.status, res.contagens.com_erro], JSON.stringify(res.erros)).toEqual(['concluido', 0]);
      const { rows } = await m.api.b.admin.query('SELECT tpag FROM cadastros.entrada_forma WHERE tenant_id = $1 AND external_id = $2 AND deleted_at IS NULL', [m.api.t.A, forma.external_id]);
      expect(rows).toEqual([{ tpag: null }]);
      expect((await irmas()).rows).toEqual(antes);
    });

    it('os 10 gravados saem ao dublê do Hub pelo espelho e pela agenda do integracao-fdv (o cadastro da entrada é o do BKO)', async () => {
      await m.assentarNoHub();
      for (const e of ENTIDADES_F2) expect(m.duble.contar('fdv-a', e), e).toBeGreaterThanOrEqual(1);
    });

    it('cursor por conector: o do B não mostra o avanço do A', async () => {
      const c = CursorEntidade.parse((await m.chamarEntrada(m.credenciais.B, 'GET', urlEntrada('cursor', { entidade: 'filial' }))).json());
      expect(c.cursor).toBeNull();
    });

    it('reenviar o mesmo registro (outra Idempotency-Key) conta como inalterada', async () => {
      const r = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('vendedor', massa.registros.vendedor, INICIO))).json());
      await m.processarFila();
      expect((await lerLote(r.lote_id)).contagens).toMatchObject({ inalteradas: 1, novas: 0, atualizadas: 0 });
    });

    // D4 (recado ao gerente, 27/11/2026 00h12), corrigido no #768.
    it('D4: registro com alterado_em mais antigo que o gravado conta como obsoleta, não grava e não recua o cursor', async () => {
      const reg = massa.registros.vendedor[0]!;
      const antigo = { ...reg, nome: 'Vendedora com nome antigo', alterado_em: new Date(INICIO.getTime() - 86_400_000).toISOString() };
      const r = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('vendedor', [antigo], INICIO))).json());
      await m.processarFila();
      const res = await lerLote(r.lote_id);
      expect(res.contagens).toMatchObject({ obsoletas: 1, novas: 0, atualizadas: 0 });
      expect(res.cursor).toMatchObject({ alterado_em: reg.alterado_em });
    });

    it('linha com referência ausente volta em erros[] com indice, external_id, campo e codigo, sem o valor; as válidas gravam; limite_erros corta', async () => {
      const ok = { ...massa.registros.vendedor[0]!, external_id: `${massa.registros.vendedor[0]!.external_id}-2`, nome: 'Vendedora Ficticia Dois' };
      const ruins = [1, 2, 3].map((n) => ({ ...ok, external_id: `${ok.external_id}-R${n}`, filial_external_id: `THA-FIL-INEXISTENTE-${n}` }));
      const r = LoteAceito.parse((await m.enviarLote(m.credenciais.A, envelopeDelta('vendedor', [ok, ...ruins], INICIO))).json());
      await m.processarFila();
      const res = LoteResultado.parse((await m.chamarEntrada(m.credenciais.A, 'GET', `${urlEntrada('lote', { id: r.lote_id })}?limite_erros=1`)).json());
      expect(res.status).toBe('concluido_com_erros');
      expect([res.contagens.novas, res.contagens.com_erro]).toEqual([1, 3]);
      expect(res.erros).toHaveLength(1);
      expect(res.erros_omitidos).toBe(2);
      expect(res.erros[0]).toMatchObject({ external_id: ruins[0]!.external_id });
      expect(Object.keys(res.erros[0]!)).toEqual(expect.arrayContaining(['indice', 'external_id', 'campo', 'codigo']));
      expect(JSON.stringify(res.erros)).not.toContain('THA-FIL-INEXISTENTE');
    });
  });

  describe('LGPD e segredos (ADR 0014 §3 e §4; regras 8 e 9)', () => {
    it('nenhuma linha de log da API e do worker traz a chave nem dado do registro (razão social, CPF, logradouro)', () => {
      const chaves = Object.values(m.credenciais).map((c) => c.chave);
      expect(m.logsApi.length).toBeGreaterThan(0);
      expect(linhasComSensivel(m.logsApi, [...chaves, ...massa.sensiveis])).toEqual([]);
      expect(linhasComSensivel(m.reg.logs, [...chaves, ...massa.sensiveis])).toEqual([]);
    });

    it('a resposta de erro não traz a chave; o banco guarda só o HMAC e o prefixo, nunca a chave clara', async () => {
      const chaves = Object.values(m.credenciais).map((c) => c.chave);
      const r = await m.enviarLote({ conectorId: m.credenciais.A.conectorId, chave: m.credenciais.B.chave }, lote());
      expect(linhasComSensivel([r.body, JSON.stringify(r.headers)], chaves)).toEqual([]);
      const banco = await m.credenciaisNoBanco();
      expect(banco.length).toBeGreaterThanOrEqual(3);
      expect(linhasComSensivel(banco, chaves)).toEqual([]);
    });
  });
});
