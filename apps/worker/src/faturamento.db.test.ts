/**
 * T-0045 lote A, ponta a ponta no PostgreSQL migrado: API real (`appPgDeTeste` do apps/api, módulos de produção, papel `macuxierp_app`) →
 * fila (`plataforma.trabalho`) → worker montado como no `main.ts` (`montarConsumidores`, `montarExecutores` com o faturamento, papel
 * `macuxierp_worker`) → simulador da SEFAZ-AM in-process (só homologação, R-20261122-022626).
 * O A1 de teste é gerado em tempo de execução (`@macuxierp/nfe-sefaz/teste`) e sobe pela rota do core (`POST /v1/core/certificados`,
 * cifrado com a chave de teste); só o worker o decifra (ADR 0005 item 4). Nenhum `.pfx` em disco, nenhuma escrita no Hub do FDV.
 * Casos: emissão autorizada (nfeProc guardado antes do status), a nota no pedido (#194) e no estoque (#192), cancelamento 135, nota MEI (CRT 4) e a filial em produção
 * fiscal: a API recusa com 422 RN-FAT-04 antes de reservar o número (lote 5, #205) e o simulador nunca é chamado para ela.
 * Estado do simulador no Postgres (T-0045 §9, lote B #220): o worker montado SEM `sefaz` (o padrão do `main.ts`) emite, "reinicia" (montagem nova,
 * mesmo banco) e cancela: 135, com o nProt da autorização guardado no simulador, e o nProt seguinte não repete.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { validarXsd, XNOME_HOMOLOGACAO, type DestinoSimulador } from '@macuxierp/nfe-sefaz';
import { gerarA1DeTeste } from '@macuxierp/nfe-sefaz/teste';
import { criarFabricaSimulador, PREFIXO_NUMERO_SIMULADOR } from '@macuxierp/sefaz-simulador';
import { ArmazenamentoMemoria, criarEvento, relogioDoSistema } from '@macuxierp/platform-sdk';
import { CatalogoArquivosPg, LicencasPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { formulario } from 'api/src/apoio-multipart';
import { appPgDeTeste, inserirAdministradorDeTeste, SENHA_DE_TESTE } from 'api/src/apoio-teste';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fonteTenantsSql } from '@macuxierp/core/api';
import { criarSefazDoWorker, montarFaturamentoWorker } from './faturamento';
import { montarConsumidores, montarExecutores } from './modulos';
import { FilaOutboxPg, RegistroConsumoPg, ReservaTrabalhosPg } from './pg';
import { ciclo, type DependenciasWorker } from './worker';

/** CNPJs fictícios da mesma raiz (o core exige a raiz da empresa no A1, RN-CORE-06). */
const CNPJ = { matriz: '11222333000181', mei: '11222333000262', producao: '11222333000343' } as const;
type Filial = keyof typeof CNPJ;
/** Formato exigido pelo CHECK `ambiente_producao_aprovada` (0003): só o operador grava produção (ADR 0006). */
const RECADO_APROVACAO = 'R-20261121-120000-alexandre';
const CRT: Record<Filial, string> = { matriz: '1', mei: '4', producao: '1' };
const IE: Record<Filial, string> = { matriz: '041234561', mei: '041234570', producao: '041234588' };

describe.skipIf(!PG_DISPONIVEL)('T-0045 lote A: API → fila → worker → simulador da SEFAZ-AM (PostgreSQL, papéis app e worker)', () => {
  let b: BancoEfemero;
  let app: Awaited<ReturnType<typeof appPgDeTeste>>['app'];
  let worker: BancoPg;
  let tenant: string;
  let auth: string;
  let deps: DependenciasWorker;
  const chaveA1 = randomBytes(32);
  const filiais: Record<Filial, string> = { matriz: randomUUID(), mei: randomUUID(), producao: randomUUID() };
  const ids = { cliente: randomUUID(), produto: randomUUID(), condicao: randomUUID(), tabela: randomUUID() };
  /** Cada destino que a fábrica do simulador atendeu (o seletor do worker só a chama para filial em homologação). */
  const destinos: DestinoSimulador[] = [];
  const linhasLog: string[] = [];
  const a1s = { matriz: gerarA1DeTeste({ cnpj: CNPJ.matriz }), mei: gerarA1DeTeste({ cnpj: CNPJ.mei }), producao: gerarA1DeTeste({ cnpj: CNPJ.producao }) };

  const admin = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await b.admin.query<T>(sql, p)).rows;

  async function inserirMassa(): Promise<void> {
    await admin('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [tenant, 'EMPRESA FICTICIA DE TESTE LTDA', CNPJ.matriz]);
    for (const f of Object.keys(filiais) as Filial[]) {
      await admin(
        `INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, ie, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao, emissora, nfe_serie, nfe_numero_inicial)
         VALUES ($1, $2, $3, $4, $5, $6, 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', $7, true, 1, 1)`,
        [filiais[f], tenant, CNPJ[f], `Filial ${f} (teste)`, IE[f], CRT[f], f === 'matriz'],
      );
    }
    await admin(`INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias) VALUES ($1, $2, 'AV', 'À vista', '01', '{0}')`, [ids.condicao, tenant]);
    await admin(`INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio, padrao) VALUES ($1, $2, 'Padrão', '2026-01-01', true)`, [ids.tabela, tenant]);
    await admin(
      `INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id, tabela_preco_id, filial_id, limite_credito_centavos)
       VALUES ($1, $2, 'PF', '52998224725', '9', 'Cliente Ficticio', $3, $4, $5, 10000000)`,
      [ids.cliente, tenant, ids.condicao, ids.tabela, filiais.matriz],
    );
    await admin(
      `INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
       VALUES ($1, $2, 'principal', 'Rua B', '2', 'Centro', '1302603', 'AM', '69000001')`,
      [tenant, ids.cliente],
    );
    await admin(
      `INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao, custo_centavos)
       VALUES ($1, $2, 'P1', 'Refrigerante 2 L', '22021000', 'UN', 'UN', 'padrao', 499)`,
      [ids.produto, tenant],
    );
    for (const f of Object.values(filiais)) {
      await admin(`INSERT INTO cadastros.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos) VALUES ($1, $2, $3, $4, 1990)`, [tenant, ids.tabela, f, ids.produto]);
      await admin(`INSERT INTO cadastros.estoque_saldo (tenant_id, filial_id, produto_id, quantidade) VALUES ($1, $2, $3, 1000000000)`, [tenant, f, ids.produto]);
    }
    // Simples Nacional e MEI: CSOSN 102 sem crédito, PIS/COFINS 49 (DAS); vale para os CRT 1 e 4 (RN-FIS-01, RN-FIS-02).
    await admin(
      `INSERT INTO fiscal.regra_tributaria (tenant_id, codigo, cst_pis, cst_cofins, fonte_tipo, fonte_referencia, versao, vigencia_inicio)
       VALUES ($1, '102', '49', '49', 'lei', 'LC 123/2006', '2026.1', '2026-01-01')`,
      [tenant],
    );
    await admin("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', $3)", [tenant, filiais.producao, RECADO_APROVACAO]);
  }

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    tenant = await criarTenant(b.admin, `fat-e2e-${randomUUID().slice(0, 8)}`, ['cadastros', 'pedido', 'faturamento', 'fiscal']);
    await inserirMassa();
    await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email: 'adm@fat-e2e.teste', nome: 'Administração', filialIds: Object.values(filiais) });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', chaveA1 }));
    const slug = (await admin<{ slug: string }>('SELECT slug FROM plataforma.tenant WHERE id = $1', [tenant]))[0]!.slug;
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: slug, email: 'adm@fat-e2e.teste', senha: SENHA_DE_TESTE } });
    expect(login.statusCode, login.body).toBe(200);
    auth = `Bearer ${login.json<{ token_acesso: string }>().token_acesso}`;

    const log = pino({ level: 'info' }, new Writable({ write: (c, _e, cb) => (linhasLog.push(String(c)), cb()) }));
    const fabrica = criarFabricaSimulador();
    const faturamento = montarFaturamentoWorker({
      banco: worker, chaveA1, log, tenants: fonteTenantsSql, licencas: new LicencasPg(),
      sefaz: criarSefazDoWorker({ simulador: (d) => (destinos.push(d), fabrica(d)) }),
    });
    deps = {
      banco: worker,
      outbox: new FilaOutboxPg(),
      trabalhos: new ReservaTrabalhosPg(),
      consumo: new RegistroConsumoPg(),
      consumidores: montarConsumidores({ log, relogio: relogioDoSistema }),
      executores: montarExecutores({ banco: worker, log, armazenamento: new ArmazenamentoMemoria(), catalogo: new CatalogoArquivosPg(), agora: () => relogioDoSistema.agora(), faturamento }),
      relogio: relogioDoSistema,
      log,
    };
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  /** Ciclos do worker até não haver mais o que fazer (outbox e trabalhos). */
  async function rodarWorker(): Promise<void> {
    for (let i = 0; i < 10 && (await ciclo(deps)); i++);
  }
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: payload as object, headers: { authorization: auth, ...headers } });

  async function enviarA1(f: Filial): Promise<void> {
    const form = formulario({ filial_id: filiais[f], senha: a1s[f].senha }, { arquivo: a1s[f].pfx });
    const r = await app.inject({ method: 'POST', url: '/v1/core/certificados', payload: form.payload, headers: { ...form.headers, authorization: auth } });
    expect(r.statusCode, r.body).toBe(201);
  }

  /** Pedido aprovado na filial (pela rota do pedido), já na fila a faturar pelo consumidor do worker. */
  async function aprovarPedido(f: Filial): Promise<string> {
    const ped = await post(
      '/v1/pedido/pedidos',
      { filial_id: filiais[f], cliente_id: ids.cliente, condicao_pagamento_id: ids.condicao, itens: [{ produto_id: ids.produto, quantidade: 20_000, preco_unitario_centavos: 1990, desconto_centavos: 0 }] },
      { 'idempotency-key': randomUUID() },
    );
    expect(ped.statusCode, ped.body).toBe(201);
    const pedido = ped.json<{ id: string; status: string }>();
    expect(pedido.status).toBe('aprovado');
    await rodarWorker(); // pedido.pedido.aprovado@1 → faturamento.pedido_a_faturar (consumidor ligado no worker)
    return pedido.id;
  }

  /** Pedido aprovado e a nota emitida pela rota do faturamento (rascunho + trabalho na fila). */
  async function emitirNota(f: Filial): Promise<{ id: string; status: string; pedido_id: string }> {
    const pedido_id = await aprovarPedido(f);
    const nota = await post('/v1/faturamento/notas', { pedido_id, idempotencia: `e2e-${randomUUID()}` });
    expect(nota.statusCode, nota.body).toBe(201);
    return { ...nota.json<{ id: string; status: string }>(), pedido_id };
  }

  const notaNoBanco = async (id: string) =>
    (await admin<{ status: string; protocolo: string | null; updated_at: Date }>('SELECT status, protocolo, updated_at FROM faturamento.nota WHERE id = $1', [id]))[0]!;
  const xmlsDaNota = async (id: string) =>
    admin<{ tipo: string; xml: string; protocolo: string | null; created_at: Date }>('SELECT tipo, xml, protocolo, created_at FROM faturamento.nota_xml WHERE nota_id = $1 ORDER BY created_at, tipo', [id]);
  const trabalhos = async (tipo: string) => admin<{ estado: string; erro: string | null; resultado: Record<string, unknown> | null }>('SELECT estado, erro, resultado FROM plataforma.trabalho WHERE tenant_id = $1 AND tipo = $2 ORDER BY created_at', [tenant, tipo]);

  let autorizada: string;
  let pedidoAutorizado: string;

  it('RN-FAT-03: emissão autorizada pelo worker no simulador, com o nfeProc guardado antes do status e do evento', async () => {
    await enviarA1('matriz');
    const nota = await emitirNota('matriz');
    expect(nota.status).toBe('rascunho'); // a API não assina (ADR 0005 item 4)
    expect(await xmlsDaNota(nota.id)).toEqual([]);
    await rodarWorker();

    expect((await trabalhos('faturamento.transmitir_nota')).at(-1)).toMatchObject({ estado: 'concluido', resultado: { resultado: 'autorizada' } });
    const n = await notaNoBanco(nota.id);
    expect(n.status).toBe('autorizada');
    expect(n.protocolo?.startsWith(PREFIXO_NUMERO_SIMULADOR)).toBe(true);
    const xmls = await xmlsDaNota(nota.id);
    expect(xmls.map((x) => x.tipo)).toEqual(['nfe_assinada', 'nfe_autorizada']);
    const [assinada, proc] = xmls as [(typeof xmls)[0], (typeof xmls)[0]];
    // O nfeProc guardado: a NF-e assinada pelo worker + o protNFe do simulador, válido no XSD, homologação e "sem valor fiscal".
    expect(proc.protocolo).toBe(n.protocolo);
    expect(proc.xml).toContain(assinada.xml.replace(/^<\?xml[^>]*>/, ''));
    expect(proc.xml).toMatch(/<cStat>100<\/cStat>/);
    expect(proc.xml).toContain('<tpAmb>2</tpAmb>');
    expect(proc.xml).toContain(`<xNome>${XNOME_HOMOLOGACAO}</xNome>`);
    expect(await validarXsd(proc.xml, 'procNFe')).toEqual({ valido: true, erros: [] });
    // Guarda antes do status: o gatilho da guarda leva a nota a `autorizada` (a nota não muda antes do XML), e o evento vem depois.
    expect(proc.created_at.getTime()).toBeLessThanOrEqual(n.updated_at.getTime());
    const [evento] = await admin<{ ocorrido_em: Date }>("SELECT ocorrido_em FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'faturamento.nota.autorizada@1' AND agregado_id = $2", [tenant, nota.id]);
    expect(evento!.ocorrido_em.getTime()).toBeGreaterThanOrEqual(proc.created_at.getTime());
    expect(destinos.every((d) => d.ambiente === 'homologacao' && d.tpAmb === 2)).toBe(true);
    autorizada = nota.id;
    pedidoAutorizado = nota.pedido_id;
  }, 30_000); // assina, valida o XSD e autoriza no simulador: na suíte cheia, com a CPU dividida, passa dos 5 s

  const statusDoPedido = async (id: string) => (await admin<{ status: string }>('SELECT status FROM pedido.pedido WHERE id = $1', [id]))[0]!.status;
  const saldoMatriz = async () =>
    Number((await admin<{ quantidade: string }>('SELECT quantidade FROM cadastros.estoque_saldo WHERE tenant_id = $1 AND filial_id = $2 AND produto_id = $3', [tenant, filiais.matriz, ids.produto]))[0]!.quantidade);
  const faturadosDoPedido = async (id: string) =>
    Number((await admin<{ n: string }>("SELECT count(*) AS n FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'pedido.pedido.faturado@1' AND agregado_id = $2", [tenant, id]))[0]!.n);

  it('#194 e #192: a nota autorizada (homologação) marca o pedido faturado, publica um faturado@1 e não move o estoque', async () => {
    expect(await statusDoPedido(pedidoAutorizado)).toBe('faturado');
    expect(await faturadosDoPedido(pedidoAutorizado)).toBe(1);
    expect(await saldoMatriz()).toBe(1_000_000_000); // homologação sem a bandeira: o estoque não move (R-20261122-022626)
  });

  /**
   * O GRANT do `macuxierp_worker` em `cadastros.estoque_saldo` e `estoque_movimento` saiu na 0029 (#217): o consumidor do estoque grava.
   * PENDÊNCIA (modulo-faturamento): o evento real ainda não leva `produto_id`/`filial_id` por item nem `conta_como_real`
   * (`modules/faturamento/api/eventos.ts`); o republicado os acrescenta, como o contrato `ItemNotaEvento` já prevê.
   */
  it('#192: a mesma nota republicada com conta_como_real baixa o estoque no worker; o pedido não soma de novo', async () => {
    const [orig] = await admin<{ payload: { itens: Record<string, unknown>[] } & Record<string, unknown> }>(
      "SELECT payload->'payload' AS payload FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'faturamento.nota.autorizada@1' AND agregado_id = $2",
      [tenant, autorizada],
    );
    const itens = orig!.payload.itens.map((i) => ({ ...i, produto_id: ids.produto, filial_id: filiais.matriz }));
    const republicado = criarEvento(
      { nome: 'faturamento.nota.autorizada@1', tenant_id: tenant, agregado_id: autorizada, ator: 'sistema', request_id: 'e2e-conta-como-real', payload: { ...orig!.payload, itens, conta_como_real: true } },
      relogioDoSistema.agora(),
    );
    await worker.comTenant(tenant, (tx) => new OutboxPg().gravar(tx, republicado));
    await rodarWorker();
    expect(await faturadosDoPedido(pedidoAutorizado)).toBe(1);
    const [ev] = await admin<{ erro: string | null }>('SELECT erro FROM plataforma.evento WHERE id = $1', [republicado.id]);
    expect(ev!.erro ?? '').not.toMatch(/permission denied/);
    expect(await saldoMatriz()).toBe(1_000_000_000 - 20_000);
  });

  it('RN-FAT-02: cancelamento pela API, processado no worker: cStat 135, procEvento guardado e a nota cancelada', async () => {
    const r = await post(`/v1/faturamento/notas/${autorizada}/cancelar`, { justificativa: 'Cancelamento de teste ponta a ponta no simulador' }, { 'idempotency-key': randomUUID() });
    expect(r.statusCode, r.body).toBe(202);
    await rodarWorker();
    expect((await trabalhos('faturamento.processar_evento')).at(-1)).toMatchObject({ estado: 'concluido', resultado: { resultado: 'registrado' } });
    const [ev] = await admin<{ status: string; protocolo: string }>("SELECT status, protocolo FROM faturamento.nota_evento WHERE nota_id = $1 AND tipo = 'cancelamento'", [autorizada]);
    expect(ev?.status).toBe('registrado');
    expect(ev!.protocolo.startsWith(PREFIXO_NUMERO_SIMULADOR)).toBe(true);
    expect((await notaNoBanco(autorizada)).status).toBe('cancelada');
    // O procEventoNFe guardado (nota_xml) traz o retorno do simulador: 135, evento registrado e vinculado.
    const proc = (await xmlsDaNota(autorizada)).find((x) => x.tipo === 'evento_cancelamento');
    expect(proc?.protocolo).toBe(ev!.protocolo);
    expect(proc?.xml).toMatch(/<retEvento[\s\S]*<cStat>135<\/cStat>/);
    expect(proc?.xml).toContain('<tpEvento>110111</tpEvento>');
  });

  // #222 ligado no worker: o transmissor de produção consulta a situação do pedido (`criarConsultaParaFaturar`) antes de ler o A1 e assinar.
  // O cancelamento pela rota é recusado com nota em rascunho (P-2); aqui o pedido muda pelo admin entre a emissão e o worker, como numa corrida.
  it('RN-PED-02 e RN-FAT-07: pedido cancelado depois da emissão — o worker não assina nem transmite; a nota fica em rascunho com o número', async () => {
    const nota = await emitirNota('matriz');
    const antes = destinos.length;
    await admin("UPDATE pedido.pedido SET status = 'cancelado' WHERE id = $1", [nota.pedido_id]);
    await rodarWorker();
    expect((await trabalhos('faturamento.transmitir_nota')).at(-1)).toMatchObject({ estado: 'concluido', resultado: { resultado: 'nao_assinada', motivo: 'pedido_cancelado' } });
    expect((await notaNoBanco(nota.id)).status).toBe('rascunho');
    expect(await xmlsDaNota(nota.id)).toEqual([]);
    expect(destinos.length).toBe(antes);
  });

  it('nota MEI (CRT 4): autorizada no simulador, com o CRT 4 no XML guardado', async () => {
    await enviarA1('mei');
    const nota = await emitirNota('mei');
    await rodarWorker();
    expect((await notaNoBanco(nota.id)).status).toBe('autorizada');
    const proc = (await xmlsDaNota(nota.id)).find((x) => x.tipo === 'nfe_autorizada')!;
    expect(proc.xml).toContain('<CRT>4</CRT>');
    expect(proc.xml).toMatch(/<CSOSN>102<\/CSOSN>/);
  });

  // Desde o lote 5 (#205) a API recusa a emissão em produção antes do worker (`EMISSAO_PRODUCAO_HABILITADA = false` até a T-0046): a nota nem
  // nasce, então o seletor do worker (barreira (a), `SimuladorEmProducaoErro`) fica como segunda trava, testada no `faturamento.test.ts`.
  it('regra 7 e RN-FAT-04: filial em produção fiscal — a API recusa com 422 antes de reservar o número; nada vai à fila nem ao simulador', async () => {
    await enviarA1('producao');
    const antes = destinos.length;
    const trabalhosAntes = (await trabalhos('faturamento.transmitir_nota')).length;
    const pedido_id = await aprovarPedido('producao');
    const r = await post('/v1/faturamento/notas', { pedido_id, idempotencia: `e2e-${randomUUID()}` });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json<{ codigo: string }>().codigo).toBe('RN-FAT-04');
    expect(await admin('SELECT 1 FROM faturamento.nota WHERE pedido_id = $1', [pedido_id])).toEqual([]);
    expect(await admin('SELECT 1 FROM faturamento.serie_numeracao WHERE filial_id = $1', [filiais.producao])).toEqual([]);
    await rodarWorker();
    expect((await trabalhos('faturamento.transmitir_nota')).length).toBe(trabalhosAntes);
    expect(destinos.length).toBe(antes);
    expect(destinos.some((d) => d.filial_id === filiais.producao)).toBe(false);
  });

  /** Um "processo" novo do worker, montado como no `main.ts`: sem `sefaz`, o simulador guarda a memória no Postgres (`estadoSimuladorPorTenant`). */
  function workerComEstadoPg(): DependenciasWorker {
    const faturamento = montarFaturamentoWorker({ banco: worker, chaveA1, log: deps.log, tenants: fonteTenantsSql, licencas: new LicencasPg() });
    return { ...deps, executores: montarExecutores({ banco: worker, log: deps.log, armazenamento: new ArmazenamentoMemoria(), catalogo: new CatalogoArquivosPg(), agora: () => relogioDoSistema.agora(), faturamento }) };
  }
  const rodarCom = async (dw: DependenciasWorker) => {
    for (let i = 0; i < 10 && (await ciclo(dw)); i++);
  };
  /** Últimos 9 dígitos do nProt do simulador: o sequencial (`seq_nprot`). */
  const seq = (nProt: string) => Number(nProt.slice(-9));
  const notaNoSimulador = async (nota_id: string) =>
    (await admin<{ tenant_id: string; n_prot: string; situacao: string }>(
      'SELECT s.tenant_id, s.n_prot, s.situacao FROM sefaz_simulador.nota s JOIN faturamento.nota n ON n.chave_acesso = s.ch_nfe AND n.tenant_id = s.tenant_id WHERE n.id = $1',
      [nota_id],
    ))[0];

  it('T-0045 §9: reinício do worker com o estado no Postgres — cancelamento 135 com o nProt da autorização; o nProt seguinte não repete', async () => {
    // Processo 1: emite e autoriza; o simulador grava a nota (com o nProt) em sefaz_simulador.nota, no tenant (RLS).
    const antes = workerComEstadoPg();
    const nota = await emitirNota('matriz');
    await rodarCom(antes);
    const autorizada1 = await notaNoBanco(nota.id);
    expect(autorizada1.status).toBe('autorizada');
    const pA = autorizada1.protocolo!;
    expect(await notaNoSimulador(nota.id)).toEqual({ tenant_id: tenant, n_prot: pA, situacao: 'autorizada' });

    // Processo 2 (worker novo, mesmo banco): a memória de antes continua; o cancelamento acha a nota e o nProt dela.
    const depois = workerComEstadoPg();
    const r = await post(`/v1/faturamento/notas/${nota.id}/cancelar`, { justificativa: 'Cancelamento depois do reinicio do worker no simulador' }, { 'idempotency-key': randomUUID() });
    expect(r.statusCode, r.body).toBe(202);
    await rodarCom(depois);
    expect((await trabalhos('faturamento.processar_evento')).at(-1)).toMatchObject({ estado: 'concluido', resultado: { resultado: 'registrado' } });
    expect((await notaNoBanco(nota.id)).status).toBe('cancelada');
    const proc = (await xmlsDaNota(nota.id)).find((x) => x.tipo === 'evento_cancelamento')!;
    expect(proc.xml).toMatch(/<retEvento[\s\S]*<cStat>135<\/cStat>/);
    expect(proc.xml).toContain(`<nProt>${pA}</nProt>`); // o pedido de cancelamento leva o nProt da autorização, e o simulador o aceitou
    expect(await notaNoSimulador(nota.id)).toEqual({ tenant_id: tenant, n_prot: pA, situacao: 'cancelada' });
    const [ev] = await admin<{ n_prot: string }>("SELECT n_prot FROM sefaz_simulador.evento WHERE tenant_id = $1 AND tp_evento = '110111'", [tenant]);
    expect(ev!.n_prot).toBe(proc.protocolo);
    expect(seq(ev!.n_prot)).toBeGreaterThan(seq(pA));

    // O nProt seguinte, no processo 2, continua a sequência (em memória, voltaria ao início e repetiria o pA).
    const outra = await emitirNota('matriz');
    await rodarCom(depois);
    const pB = (await notaNoBanco(outra.id)).protocolo!;
    expect((await notaNoBanco(outra.id)).status).toBe('autorizada');
    expect([pA, ev!.n_prot]).not.toContain(pB);
    expect(seq(pB)).toBeGreaterThan(seq(ev!.n_prot));
  }, 60_000);

  it('regras 8 e 9: o log do worker não traz o A1, a senha, o XML nem o documento do cliente', () => {
    const texto = linhasLog.join('');
    for (const a1 of Object.values(a1s)) {
      expect(texto).not.toContain(a1.senha);
      expect(texto).not.toContain(a1.pfx.subarray(0, 24).toString('base64'));
    }
    expect(texto).not.toContain('<NFe');
    expect(texto).not.toContain('52998224725');
  });
});
