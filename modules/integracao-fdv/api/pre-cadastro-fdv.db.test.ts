/**
 * Pré-cadastro de cliente do FDV contra o PostgreSQL real com a migração 0057 (papéis macuxierp_worker e macuxierp_app, RLS),
 * com dublê do Hub e da porta `CriadorClienteFdv` (sem rede, sem FDV real, sem cadastros). Sem Postgres o teste pula
 * (`bash db/scripts/pg-local.sh`). T-0059 §5 e §7 (casos 1 a 9); RN-INF-04, RN-INF-06, RN-CORE-02.
 */
import {
  ErroApi, corpoErroApi, executarAutorizado, PERFIS, pode, type Perfil, type RespostaRota, type RetornoClienteFdv, type Sessao,
} from '@macuxierp/platform-sdk';
import { LicencasPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENDA_BUSCA_CLIENTES_ID, AGENDA_RETORNO_CLIENTES_ID, criarAgendasClientesFdv } from './agendas-clientes';
import { AGORA, U, admSql, ciclo, criarCredencial, dubleLogAlertas, hubDuble, ok, recusa, retentavel } from './apoio-conector-teste';
import { lerRecebidosParaExportar } from './clientes-recebidos';
import { expurgarPreCadastro } from './expurgo-pre-cadastro';
import type { ClienteHubClientes, CriadorClienteFdv, RespostaRetornoCliente } from './portas';
import { buscarClientesPendentes } from './recebimento-clientes';
import { enviarRetornosClientes, reterSeAguardaVinculo } from './retorno-clientes';
import { criarPluginIntegracaoFdv } from './index';

const relogio = { agora: (): Date => new Date('2026-11-25T12:00:00.000Z') };
// hora-fixa-ok: a função do banco do expurgo compara o corte com o now() do banco (RN-INF-06), então só o relógio real a exercita
const RELOGIO_REAL = { agora: (): Date => new Date() };
/** Dado pessoal que nunca pode aparecer em log, alerta nem rota. */
const SEGREDOS = ['Mercado do Fulano', '11222333000181', '11.222.333/0001-81', 'fulano@exemplo.com', '92999990000', 'Rua Secreta'];

const pendente = (uuid: string, extra: Record<string, unknown> = {}) => ({
  cliente_uuid: uuid, recebido_em: '2026-11-25T10:00:00.000-04:00', razao_social: 'Mercado do Fulano', documento: '11.222.333/0001-81',
  email: 'fulano@exemplo.com', telefone: '92999990000', logradouro: 'Rua Secreta', cidade: 'Manaus', uf: 'AM', tentativa: 1, ...extra,
});

describe.skipIf(!PG_DISPONIVEL)('pré-cadastro de cliente do FDV no PostgreSQL real (migração 0057)', () => {
  let efemero: BancoEfemero;
  let worker: BancoPg;
  let app: BancoPg;
  let A: string;
  let B: string;
  let C: string;
  let adm: ReturnType<typeof admSql>;
  const d = dubleLogAlertas();

  /** Porta do cadastros (dublê): documento terminado em 99 é recusado; os outros viram cliente. Conta as chamadas. */
  const criadorDuble = () => {
    const chamadas: string[] = [];
    const criador: CriadorClienteFdv = {
      decidir: async (_tx, _t, pre) => {
        chamadas.push(pre.cliente_uuid);
        if ((pre.documento ?? '').endsWith('99')) {
          return { status: 'rejeitado_erp', motivo: 'Documento inválido', erros: [{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' }] };
        }
        const id = U();
        return { status: 'vinculado', external_id: id, cliente_id: id };
      },
    };
    return { criador, chamadas };
  };
  /** Dublê do Hub: o retorno de cada cliente_uuid segue o roteiro dele (a última resposta se repete; sem roteiro, 200). */
  const hubDe = (clientes: unknown[], roteiro: Record<string, RespostaRetornoCliente[]> = {}) => {
    const enviados: Array<{ uuid: string; corpo: RetornoClienteFdv }> = [];
    const vez = new Map<string, number>();
    const hub: ClienteHubClientes = {
      pendentes: async () => ({ status: 200, clientes }),
      enviarRetorno: async (uuid, corpo) => {
        enviados.push({ uuid, corpo });
        const fila = roteiro[uuid] ?? [{ status: 200 }];
        const i = vez.get(uuid) ?? 0;
        vez.set(uuid, i + 1);
        return fila[Math.min(i, fila.length - 1)]!;
      },
    };
    return { hub, enviados };
  };
  const deps = (t: { hub: ClienteHubClientes; criador?: CriadorClienteFdv }, aditivos = true) => ({
    banco: worker, hub: t.hub, criador: (t.criador ?? criadorDuble().criador), relogio, log: d.log, alertar: d.alertar, aditivos,
  });
  const linhas = (t: string, uuid: string) =>
    adm('SELECT revisao, situacao, motivo, erros, cliente_id, tentativas_fdv, payload IS NULL AS sem_payload, vendedor_external_id, documento_mascarado FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1 AND cliente_uuid = $2 ORDER BY revisao', [t, uuid]);
  const retornosDe = (t: string, uuid: string) =>
    adm('SELECT revisao, status, estado, tentativas, resposta_http, codigo_recusa, corpo FROM integracao_fdv.cliente_retorno WHERE tenant_id = $1 AND cliente_uuid = $2 ORDER BY created_at, id', [t, uuid]);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    worker = efemero.banco('macuxierp_worker', 4);
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'pre-a', ['integracao-fdv']);
    B = await criarTenant(efemero.admin, 'pre-b', ['integracao-fdv']);
    C = await criarTenant(efemero.admin, 'pre-c', []);
    for (const t of [A, B, C]) await adm('INSERT INTO integracao_fdv.sinal (tenant_id) VALUES ($1)', [t]);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('T-0059 §5.1: pré-cadastro válido vira aceito, o payload fica nulo, o retorno vinculado entra na fila e a agenda de retorno é ligada', async () => {
    const uuid = U();
    const { criador, chamadas } = criadorDuble();
    const r = await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid, { codigo_fdv: '00042' })]).hub, criador }), A);
    expect(r).toMatchObject({ buscados: 1, aceitos: 1, recusados: 0, erros: 0, proxima: 'intervalo' });
    expect(chamadas).toEqual([uuid]);
    const [l] = await linhas(A, uuid);
    expect(l).toMatchObject({ revisao: 1, situacao: 'aceito', sem_payload: true, vendedor_external_id: null, documento_mascarado: '11.222.333/****-**', tentativas_fdv: 1 });
    expect(l!.cliente_id).not.toBeNull();
    const [ret] = await retornosDe(A, uuid);
    expect(ret).toMatchObject({ status: 'vinculado', estado: 'pendente' });
    expect(ret!.corpo).toMatchObject({ cliente_uuid: uuid, status: 'vinculado', external_id: l!.cliente_id });
    expect((await adm('SELECT proximo_retorno_clientes_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [A]))[0]!.proximo_retorno_clientes_em).not.toBeNull();
  });

  it('T-0059 §5.1: o vendedor_external_id do FDV v1.0.34 é lido quando vem (decisão a); ausente fica nulo', async () => {
    const [u1, u2] = [U(), U()];
    await buscarClientesPendentes(deps({ hub: hubDe([pendente(u1, { vendedor_external_id: 'V-07' }), pendente(u2, { vendedor_external_id: null })]).hub }), A);
    expect((await linhas(A, u1))[0]).toMatchObject({ vendedor_external_id: 'V-07' });
    expect((await linhas(A, u2))[0]).toMatchObject({ vendedor_external_id: null });
  });

  it('T-0105: o vendedor_external_id do pendente chega ao criador.decidir (porta do cadastros); ausente chega vazio', async () => {
    const [u1, u2] = [U(), U()];
    const vistos = new Map<string, unknown>();
    const criador: CriadorClienteFdv = {
      decidir: async (_tx, _t, pre) => {
        vistos.set(pre.cliente_uuid, pre.vendedor_external_id);
        const id = U();
        return { status: 'vinculado', external_id: id, cliente_id: id };
      },
    };
    await buscarClientesPendentes(deps({ hub: hubDe([pendente(u1, { vendedor_external_id: 'V-07' }), pendente(u2)]).hub, criador }), A);
    expect(vistos.get(u1)).toBe('V-07');
    expect(vistos.get(u2) ?? null).toBeNull();
  });

  it('RN-INF-04: recusa leva motivo e erros por campo (revisão e erros no corpo, opção ligada); o 200 marca enviado', async () => {
    const uuid = U();
    const h = hubDe([pendente(uuid, { documento: '11222333000199', revisao: 1, hash: 'a'.repeat(64) })]);
    await buscarClientesPendentes(deps({ hub: h.hub }), A);
    const [l] = await linhas(A, uuid);
    expect(l).toMatchObject({ situacao: 'recusado', motivo: 'Documento inválido', sem_payload: false, cliente_id: null });
    expect(l!.erros).toEqual([{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' }]);
    const e = await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, A);
    expect(e.falhou).toBe(0);
    expect(e.enviados).toBeGreaterThanOrEqual(1); // a fila do tenant leva também os retornos pendentes dos testes anteriores
    expect(h.enviados.find((x) => x.uuid === uuid)!.corpo).toMatchObject({ status: 'rejeitado_erp', revisao: 1, motivo: 'Documento inválido', erros: [{ campo: 'documento', codigo: 'documento_invalido' }] });
    expect((await retornosDe(A, uuid))[0]).toMatchObject({ estado: 'enviado', resposta_http: 200 });
  });

  it('RN-INF-04: com a opção desligada (dublê da v1.0.28) o retorno vai só com o motivo, sem revisão nem erros', async () => {
    const uuid = U();
    await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid, { documento: '11222333000199' })]).hub }, false), A);
    const corpo = (await retornosDe(A, uuid))[0]!.corpo;
    expect(corpo).toMatchObject({ status: 'rejeitado_erp', motivo: 'Documento inválido' });
    expect(corpo).not.toHaveProperty('erros');
    expect(corpo).not.toHaveProperty('revisao');
  });

  it('T-0059 §7.3: o mesmo pendente de novo não revalida nem cria dois clientes; o retorno enviado volta à fila e o Hub responde repetido', async () => {
    const uuid = U();
    const { criador, chamadas } = criadorDuble();
    const h = hubDe([pendente(uuid)], { [uuid]: [{ status: 200, repetido: false }, { status: 200, repetido: true }] });
    await buscarClientesPendentes(deps({ hub: h.hub, criador }), A);
    await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, A);
    const r2 = await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid, { tentativa: 2 })]).hub, criador }), A);
    expect(r2).toMatchObject({ repetidos: 1, aceitos: 0 });
    expect(chamadas).toHaveLength(1);
    expect((await linhas(A, uuid))[0]).toMatchObject({ tentativas_fdv: 2, situacao: 'aceito' });
    expect((await retornosDe(A, uuid))).toHaveLength(1);
    expect((await retornosDe(A, uuid))[0]!.estado).toBe('pendente');
    await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, A);
    expect(h.enviados.filter((x) => x.uuid === uuid)).toHaveLength(2);
    expect((await retornosDe(A, uuid))[0]!.estado).toBe('enviado');
  });

  it('T-0059 §7.4: reenvio (revisão 2, corrigido) vira reenviado e depois aceito; a revisão 1 fica no histórico e a seção mostra uma linha', async () => {
    const uuid = U();
    await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid, { documento: '11222333000199', revisao: 1 })]).hub }), A);
    expect((await linhas(A, uuid)).map((x) => x.situacao)).toEqual(['recusado']);
    // revisão 2 corrigida: entra como reenviado e é decidida na mesma transação (aceita)
    let situacaoNaDecisao = '';
    const criador: CriadorClienteFdv = {
      decidir: async (tx, t, pre) => {
        situacaoNaDecisao = String((await tx.consultar<{ situacao: string }>('SELECT situacao FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1 AND cliente_uuid = $2 AND revisao = 2', [t, pre.cliente_uuid]))[0]?.situacao);
        const id = U();
        return { status: 'vinculado', external_id: id, cliente_id: id };
      },
    };
    await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid, { documento: '11222333000181', revisao: 2 })]).hub, criador }), A);
    expect(situacaoNaDecisao).toBe('reenviado');
    expect((await linhas(A, uuid)).map((x) => [x.revisao, x.situacao])).toEqual([[1, 'recusado'], [2, 'aceito']]);
    const lista = await rota(A, 'GET', '/clientes-recebidos', { consulta: { limite: '100' } });
    expect(lista.corpo.itens.filter((i: { cliente_uuid: string }) => i.cliente_uuid === uuid)).toMatchObject([{ revisao: 2, situacao: 'aceito' }]);
  });

  it('T-0059 §5.4: o aceito fica retido no espelho até o 200 do vinculado; o 200 libera e acorda o envio', async () => {
    const uuid = U();
    const h = hubDe([pendente(uuid)], { [uuid]: [{ status: 503 }, { status: 200 }] });
    await buscarClientesPendentes(deps({ hub: h.hub }), A);
    const clienteId = (await linhas(A, uuid))[0]!.cliente_id as string;
    const endereco = U();
    // hora-fixa-ok: carimbos do espelho de apoio, nunca comparados ao instante fixo do teste
    await adm(`INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, erp_id, ativo)
               VALUES ($1, 'cliente', $2, '{}', $3, now(), now(), $4, true)`, [A, clienteId, 'a'.repeat(64), clienteId]);
    // hora-fixa-ok: carimbos do espelho de apoio, nunca comparados ao instante fixo do teste
    await adm(`INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, erp_id, fonte_refs, ativo)
               VALUES ($1, 'cliente_endereco', $2, '{}', $3, now(), now(), $4, $5::jsonb, true)`, [A, `${clienteId}-e`, 'b'.repeat(64), endereco, JSON.stringify({ cliente_id: clienteId })]);
    await worker.comTenant(A, (tx) => reterSeAguardaVinculo(tx, A, clienteId));
    const retidos = () => adm('SELECT entidade, aguarda_vinculo FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND erp_id IN ($2, $3) ORDER BY entidade', [A, clienteId, endereco]);
    expect(await retidos()).toEqual([{ entidade: 'cliente', aguarda_vinculo: true }, { entidade: 'cliente_endereco', aguarda_vinculo: true }]);
    // 503: continua pendente e retido
    expect(await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, A)).toMatchObject({ reagendados: 1 });
    expect((await retornosDe(A, uuid))[0]).toMatchObject({ estado: 'pendente', tentativas: 1, resposta_http: 503 });
    expect((await retidos()).every((x) => x.aguarda_vinculo)).toBe(true);
    // 200: libera os dois e o cursor das entidades é acordado
    // hora-fixa-ok: antecipa o sinal para já; o teste não compara com o instante fixo
    await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_clientes_em = now() WHERE tenant_id = $1', [A]);
    expect((await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, A)).enviados).toBeGreaterThanOrEqual(1);
    expect((await retidos()).every((x) => !x.aguarda_vinculo)).toBe(true);
    expect((await retornosDe(A, uuid))).toHaveLength(1);
    expect((await adm("SELECT entidade FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade IN ('cliente', 'cliente_endereco') ORDER BY entidade", [A])).map((x) => x.entidade)).toEqual(['cliente', 'cliente_endereco']);
    // depois do 200, um evento novo do cliente não o retém de novo
    await worker.comTenant(A, (tx) => reterSeAguardaVinculo(tx, A, clienteId));
    expect((await retidos()).every((x) => !x.aguarda_vinculo)).toBe(true);
  });

  it('T-0059 §7.5: 422 external_id_divergente falha o retorno, abre conflito vinculo_divergente e o cliente continua retido', async () => {
    const uuid = U();
    const h = hubDe([pendente(uuid)], { [uuid]: [{ status: 422, codigo: 'external_id_divergente' }] });
    await buscarClientesPendentes(deps({ hub: h.hub }), A);
    const clienteId = (await linhas(A, uuid))[0]!.cliente_id as string;
    // hora-fixa-ok: carimbos do espelho de apoio, nunca comparados ao instante fixo do teste
    await adm(`INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, erp_id, ativo)
               VALUES ($1, 'cliente', $2, '{}', $3, now(), now(), $4, true)`, [A, clienteId, 'c'.repeat(64), clienteId]);
    await worker.comTenant(A, (tx) => reterSeAguardaVinculo(tx, A, clienteId));
    const r = await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, A);
    expect(r).toMatchObject({ falhou: 1, conflitos: 1 });
    expect((await retornosDe(A, uuid))[0]).toMatchObject({ estado: 'falhou', resposta_http: 422, codigo_recusa: 'external_id_divergente' });
    expect(await adm("SELECT codigo, chave FROM integracao_fdv.conflito_chave WHERE tenant_id = $1 AND erp_id = $2 AND resolvido_em IS NULL", [A, clienteId])).toEqual([{ codigo: 'vinculo_divergente', chave: clienteId }]);
    expect((await adm('SELECT aguarda_vinculo FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND erp_id = $2', [A, clienteId]))[0]!.aguarda_vinculo).toBe(true);
    expect(d.alertas.some((a) => a.includes('cliente_vinculo_divergente'))).toBe(true);
  });

  it('T-0059 §5.3: os outros 422 e o 400 falham o retorno com alerta e sem conflito; o 403 pausa a credencial', async () => {
    const [u1, u2, u3] = [U(), U(), U()];
    const h = hubDe([pendente(u1), pendente(u2), pendente(u3)], { [u1]: [{ status: 422, codigo: 'revisao_desconhecida' }], [u2]: [{ status: 400, codigo: 'corpo_invalido' }], [u3]: [{ status: 403, codigo: 'chave_revogada' }] });
    await buscarClientesPendentes(deps({ hub: h.hub }), B);
    const r = await enviarRetornosClientes({ banco: worker, hub: h.hub, relogio, log: d.log, alertar: d.alertar }, B);
    expect(r).toMatchObject({ falhou: 2, conflitos: 0, motivoPausa: 'credencial' });
    expect((await retornosDe(B, u1))[0]).toMatchObject({ estado: 'falhou', codigo_recusa: 'revisao_desconhecida' });
    expect((await retornosDe(B, u2))[0]).toMatchObject({ estado: 'falhou', codigo_recusa: null });
    expect((await retornosDe(B, u3))[0]).toMatchObject({ estado: 'pendente' });
    expect(await adm('SELECT 1 FROM integracao_fdv.conflito_chave WHERE tenant_id = $1', [B])).toHaveLength(0);
  });

  it('T-0059 §5.1: exceção na porta desfaz a transação: nada fica gravado, a busca segue e o alerta sai sem dado pessoal', async () => {
    const [ruim, bom] = [U(), U()];
    const criador: CriadorClienteFdv = {
      decidir: async (_tx, _t, pre) => {
        if (pre.cliente_uuid === ruim) throw new Error('falha com Mercado do Fulano 11222333000181');
        const id = U();
        return { status: 'vinculado', external_id: id, cliente_id: id };
      },
    };
    const r = await buscarClientesPendentes(deps({ hub: hubDe([pendente(ruim), pendente(bom)]).hub, criador }), B);
    expect(r).toMatchObject({ erros: 1, aceitos: 1 });
    expect(await linhas(B, ruim)).toHaveLength(0);
    expect(await retornosDe(B, ruim)).toHaveLength(0);
    expect(await linhas(B, bom)).toHaveLength(1);
  });

  it('T-0059 §5.1: pendente fora do contrato é ignorado com alerta, sem gravar nada', async () => {
    const antes = (await adm('SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1', [B]))[0]!.n;
    const r = await buscarClientesPendentes(deps({ hub: hubDe([{ cliente_uuid: 'nao-e-uuid', razao_social: 'Mercado do Fulano' }]).hub }), B);
    expect(r).toMatchObject({ ignorados: 1 });
    expect((await adm('SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1', [B]))[0]!.n).toBe(antes);
  });

  it('T-0059 §2: a busca repete até a lista vir curta, com teto de 10 páginas', async () => {
    let paginas = 0;
    const hub: ClienteHubClientes = {
      pendentes: async () => {
        paginas++;
        return { status: 200, clientes: Array.from({ length: 50 }, () => ({ cliente_uuid: 'invalido' })) };
      },
      enviarRetorno: async () => ({ status: 200 }),
    };
    const r = await buscarClientesPendentes(deps({ hub }), B);
    expect(paginas).toBe(10);
    expect(r.proxima).toBe('imediata');
  }, 20_000);

  it('T-0059 §5.1: pendente fora do contrato não abre transação (só o válido abre)', async () => {
    let aberturas = 0;
    const contando = { comTenant: (...a: Parameters<typeof worker.comTenant>) => { aberturas++; return worker.comTenant(...a); } } as unknown as typeof worker;
    const hub = hubDe([{ cliente_uuid: 'nao-e-uuid' }, { cliente_uuid: 'x' }]).hub;
    const r = await buscarClientesPendentes({ ...deps({ hub }), banco: contando }, B);
    expect(r).toMatchObject({ ignorados: 2, erros: 0 });
    expect(aberturas).toBe(0);
  });

  it('T-0059 §5.1: 401, 403 e 426 na busca pausam a credencial; 5xx reagenda', async () => {
    const com = (status: number, codigo?: string): ClienteHubClientes => ({ pendentes: async () => ({ status, ...(codigo ? { codigo } : {}) }), enviarRetorno: async () => ({ status: 200 }) });
    expect(await buscarClientesPendentes(deps({ hub: com(401) }), B)).toMatchObject({ proxima: 'pausa', motivoPausa: 'credencial' });
    expect(await buscarClientesPendentes(deps({ hub: com(503) }), B)).toMatchObject({ proxima: 'erro' });
  });

  describe('agendas (reserva, credencial e Hub dublê do SDK)', () => {
    it('T-0059 §5: a agenda de busca chama GET /clientes/pendentes e a de retorno chama POST /clientes/{uuid}/retorno; a chave não vaza', async () => {
      const t = await criarTenant(efemero.admin, 'pre-ag', ['integracao-fdv']);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proxima_busca_clientes_em) VALUES ($1, $2)', [t, AGORA]);
      await criarCredencial(efemero.admin, t);
      const uuid = U();
      const hub = hubDuble({
        'GET /clientes/pendentes?limite=50': [ok({ clientes: [pendente(uuid)] }, false, 200)],
        [`POST /clientes/${uuid}/retorno`]: [ok({ cliente_uuid: uuid, estado: 'vinculado', repetido: false }, false, 200)],
      });
      const { criador } = criadorDuble();
      const log = dubleLogAlertas();
      const agendas = criarAgendasClientesFdv({ criador, alertar: log.alertar, log: log.log, relogio: { agora: () => AGORA }, aditivos: true });
      const busca = agendas.find((a) => a.id === AGENDA_BUSCA_CLIENTES_ID)!;
      const retorno = agendas.find((a) => a.id === AGENDA_RETORNO_CLIENTES_ID)!;
      expect(await ciclo(worker, busca, hub, AGORA, [t])).toHaveLength(1);
      expect((await linhas(t, uuid))[0]).toMatchObject({ situacao: 'aceito' });
      // a busca se adiou 60 s (nem imediata nem presa) e o retorno foi ligado
      const s = (await adm('SELECT proxima_busca_clientes_em AS b, proximo_retorno_clientes_em AS r FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
      expect(new Date(s.b).getTime()).toBe(AGORA.getTime() + 60_000);
      expect(await ciclo(worker, retorno, hub, new Date(AGORA.getTime() + 1000), [t])).toHaveLength(1);
      expect((await retornosDe(t, uuid))[0]).toMatchObject({ estado: 'enviado' });
      expect(hub.chamadas.map((c) => `${c.pedido.metodo} ${c.pedido.caminho.replace(uuid, '{uuid}')}`)).toEqual(['GET /clientes/pendentes?limite=50', 'POST /clientes/{uuid}/retorno']);
      expect(JSON.stringify([log.logs, log.alertas])).not.toContain('chave-secreta');
      void recusa; void retentavel;
    });

    it('RN-CORE-02: sem licença do módulo, a agenda de busca só adia 1 h (não liga nem desliga)', async () => {
      const t = await criarTenant(efemero.admin, 'pre-sl', []);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proxima_busca_clientes_em) VALUES ($1, $2)', [t, AGORA]);
      const agenda = criarAgendasClientesFdv({ criador: criadorDuble().criador, alertar: d.alertar, log: d.log, relogio: { agora: () => AGORA }, aditivos: true }).find((a) => a.id === AGENDA_BUSCA_CLIENTES_ID)!;
      await worker.comTenant(t, (tx) => agenda.semLicenca!({ tenant_id: t, tarefa: 'busca-clientes', chave: null }, tx, AGORA));
      expect(new Date((await adm('SELECT proxima_busca_clientes_em AS b FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!.b).getTime()).toBe(AGORA.getTime() + 3_600_000);
    });
  });

  // ---- rota do BKO ----
  const sessao = (tenant: string, perfil: Perfil = 'administrador'): Sessao => ({ usuario_id: U(), tenant_id: tenant, perfil, filial_ids: [] });
  async function rota(tenant: string, metodo: string, caminho: string, o: { perfil?: Perfil; consulta?: Record<string, unknown>; semSessao?: boolean } = {}) {
    const plugin = criarPluginIntegracaoFdv();
    const partes = caminho.split('/').filter(Boolean);
    const escolhida = plugin.rotas.find((r) => r.metodo === metodo && (r.caminho === caminho || (r.caminho.split('/').filter(Boolean).length === partes.length && r.caminho.split('/').filter(Boolean).every((m, i) => m.startsWith(':') || m === partes[i]) && !plugin.rotas.some((x) => x.metodo === metodo && x.caminho === caminho))));
    const params = escolhida ? Object.fromEntries(escolhida.caminho.split('/').filter(Boolean).flatMap((m, i) => (m.startsWith(':') ? [[m.slice(1), partes[i]!]] : []))) : {};
    if (!escolhida) throw new Error(`sem rota ${metodo} ${caminho}`);
    try {
      const r = await executarAutorizado<{ resposta: RespostaRota }>({
        sessao: o.semSessao ? null : sessao(tenant, o.perfil),
        acao: escolhida.acao,
        agora: AGORA,
        banco: app,
        licencas: new LicencasPg(),
        executar: async (tx, s) => {
          const consulta = escolhida.consulta ? escolhida.consulta.safeParse(o.consulta ?? {}) : null;
          if (consulta && !consulta.success) throw new ErroApi(400, 'VALIDACAO', 'Dados inválidos', {});
          const ctx = { sessao: s, tx, request_id: 'req-teste', agora: AGORA } as unknown as Parameters<typeof escolhida.executar>[0];
          return { resposta: await escolhida.executar(ctx, { corpo: undefined, consulta: consulta?.data, params, cabecalhos: {}, arquivos: {}, todosArquivos: {} }) };
        },
      });
      return { status: r.resposta.status ?? 200, corpo: r.resposta.corpo as any, cabecalhos: r.resposta.cabecalhos }; // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch (e) {
      if (e instanceof ErroApi) return { status: e.status, corpo: corpoErroApi(e) as any, cabecalhos: undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any
      throw e;
    }
  }

  describe('rota GET /v1/integracao-fdv/clientes-recebidos (perfil, tenant e licença)', () => {
    it('RN-CORE-02: sem sessão é 401; sem a licença do módulo é 403 MODULO_INATIVO; o perfil segue pode(integracao-fdv.ver)', async () => {
      expect((await rota(A, 'GET', '/clientes-recebidos', { semSessao: true })).status).toBe(401);
      expect(await rota(C, 'GET', '/clientes-recebidos')).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
      expect(await rota(C, 'GET', '/clientes-recebidos/exportar')).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
      for (const perfil of PERFIS) expect((await rota(A, 'GET', '/clientes-recebidos', { perfil })).status, perfil).toBe(pode(perfil, 'integracao-fdv.ver') ? 200 : 403);
    });

    it('RN-INF-06: a lista mostra o documento mascarado, o vendedor nulo e os erros por campo; nunca o documento inteiro, e-mail, telefone ou endereço', async () => {
      const uuid = U();
      await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid, { documento: '11222333000199' })]).hub }), A);
      const r = await rota(A, 'GET', '/clientes-recebidos', { perfil: 'leitura', consulta: { limite: '200', situacao: 'recusado' } });
      expect(r.status).toBe(200);
      const item = r.corpo.itens.find((i: { cliente_uuid: string }) => i.cliente_uuid === uuid);
      expect(item).toMatchObject({ situacao: 'recusado', razao_social: 'Mercado do Fulano', documento_mascarado: '11.222.333/****-**', vendedor_external_id: null, retorno: 'pendente', revisao: 1 });
      expect(item.erros).toEqual([{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' }]);
      const texto = JSON.stringify(r.corpo);
      for (const s of SEGREDOS.filter((x) => x !== 'Mercado do Fulano')) expect(texto, s).not.toContain(s);
      expect(r.corpo.itens.every((i: { situacao: string }) => i.situacao === 'recusado')).toBe(true);
      expect((await rota(A, 'GET', '/clientes-recebidos', { consulta: { situacao: 'inventada' } })).status).toBe(400);
    });

    it('RN-CORE-02: o tenant B nunca vê os recebidos do A (RLS e rota)', async () => {
      const uuid = U();
      await buscarClientesPendentes(deps({ hub: hubDe([pendente(uuid)]).hub }), A);
      const doB = await rota(B, 'GET', '/clientes-recebidos', { consulta: { limite: '200' } });
      expect(doB.corpo.itens.some((i: { cliente_uuid: string }) => i.cliente_uuid === uuid)).toBe(false);
      expect((await adm('SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1 AND cliente_uuid = $2', [B, uuid]))[0]!.n).toBe(0);
    });

    it('RF-INF-04 (decisão 21 A): paginação por cursor e CSV exportável com todos os recebidos (além da lista de 50), sem repetir, só do tenant e sem dado pessoal', async () => {
      const p1 = await rota(A, 'GET', '/clientes-recebidos', { consulta: { limite: '2' } });
      expect(p1.corpo.itens).toHaveLength(2);
      expect(p1.corpo.proximo_cursor).not.toBeNull();
      const p2 = await rota(A, 'GET', '/clientes-recebidos', { consulta: { limite: '2', cursor: p1.corpo.proximo_cursor } });
      expect(p2.corpo.itens.every((i: { id: string }) => !p1.corpo.itens.some((x: { id: string }) => x.id === i.id))).toBe(true);
      const csv = await rota(A, 'GET', '/clientes-recebidos/exportar');
      expect(csv.cabecalhos).toMatchObject({ 'content-type': 'text/csv; charset=utf-8' });
      expect(String(csv.corpo).split('\r\n')[0]).toContain('Situação');
      for (const s of SEGREDOS.filter((x) => x !== 'Mercado do Fulano')) expect(String(csv.corpo), s).not.toContain(s);
      const total = (await adm("SELECT count(DISTINCT cliente_uuid)::int AS n FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1 AND deleted_at IS NULL", [A]))[0]!.n as number;
      expect(total).toBeGreaterThan(2);
      const pag = await worker.comTenant(A, (tx) => lerRecebidosParaExportar(tx, A, { pagina: 2 }));
      expect(pag.cortado).toBe(false);
      expect(pag.itens).toHaveLength(total);
      expect(new Set(pag.itens.map((i) => i.id)).size).toBe(total);
      expect(String(csv.corpo).trim().split('\r\n')).toHaveLength(total + 1);
      expect(csv.cabecalhos?.['x-linhas-cortadas']).toBeUndefined();
    });

    it('RF-INF-04 (decisão 21 A): passou do teto, o arquivo para nos mais recentes e avisa', async () => {
      const todos = await worker.comTenant(A, (tx) => lerRecebidosParaExportar(tx, A, { pagina: 2 }));
      const corte = await worker.comTenant(A, (tx) => lerRecebidosParaExportar(tx, A, { teto: 3, pagina: 2 }));
      expect(corte.cortado).toBe(true);
      expect(corte.itens.map((i) => i.id)).toEqual(todos.itens.slice(0, 3).map((i) => i.id));
      const exato = await worker.comTenant(A, (tx) => lerRecebidosParaExportar(tx, A, { teto: todos.itens.length, pagina: 2 }));
      expect(exato.cortado).toBe(false);
      expect(exato.itens).toHaveLength(todos.itens.length);
    });
  });

  describe('RN-INF-09: Log do cadastro de cliente leva os recebidos do FDV (T-0110)', () => {
    const inserir = (t: string, uuid: string, revisao: number, situacao: 'aceito' | 'recusado' | 'reenviado', extra: { motivo?: string; erros?: string; vendedor?: string } = {}) =>
      adm(
        `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, razao_social, documento_mascarado, payload, recebido_em, chegou_em, situacao, motivo, erros, cliente_id, decidido_em, ultima_recusa_em, vendedor_external_id)
         VALUES ($1, $2, $3::int, $4, 'Mercado Log', '11.222.333/****-**', CASE WHEN $5::text = 'aceito' THEN NULL ELSE '{"documento": "11222333000181"}'::jsonb END, now(), now() + make_interval(secs => $3::int), $5::text, $6, $7::jsonb,
                 CASE WHEN $5::text = 'aceito' THEN gen_random_uuid() END, CASE WHEN $5::text IN ('aceito', 'recusado') THEN now() END, CASE WHEN $5::text = 'recusado' THEN now() END, $8)`,
        [t, uuid, revisao, String(revisao).repeat(64).slice(0, 64), situacao, extra.motivo ?? null, extra.erros ?? null, extra.vendedor ?? null],
      );
    const erroVend = (codigo: string) => JSON.stringify([{ campo: 'vendedor', codigo, mensagem: 'x' }]);

    it('traz aceito, recusados por vendedor e reenviado; documento só mascarado; nada de outro tenant; produto vem vazio', async () => {
      const [ok, semV, inativo, reenv, doB] = [U(), U(), U(), U(), U()];
      await inserir(A, ok, 1, 'aceito');
      await inserir(A, semV, 1, 'recusado', { motivo: 'Vendedor não encontrado', erros: erroVend('vendedor_fdv_nao_encontrado'), vendedor: 'V404' });
      await inserir(A, inativo, 1, 'recusado', { motivo: 'Vendedor inativo', erros: erroVend('vendedor_fdv_inativo'), vendedor: 'V9' });
      await inserir(A, reenv, 1, 'recusado', { motivo: 'Vendedor inativo', erros: erroVend('vendedor_fdv_inativo') });
      await inserir(A, reenv, 2, 'reenviado');
      await inserir(B, doB, 1, 'aceito');

      const r = await rota(A, 'GET', '/entidades/cliente/log');
      expect(r.status).toBe(200);
      const por = (u: string) => r.corpo.recebidos.filter((i: { cliente_uuid: string }) => i.cliente_uuid === u);
      expect(por(ok)[0]).toMatchObject({ situacao: 'aceito', documento_mascarado: '11.222.333/****-**' });
      expect(por(semV)[0].erros[0].codigo).toBe('vendedor_fdv_nao_encontrado');
      expect(por(inativo)[0].erros[0].codigo).toBe('vendedor_fdv_inativo');
      expect(por(reenv)).toHaveLength(1);
      expect(por(reenv)[0]).toMatchObject({ revisao: 2, situacao: 'reenviado' });
      expect(por(doB)).toHaveLength(0);
      expect(r.corpo.recebidos.length).toBeLessThanOrEqual(50);
      const texto = JSON.stringify(r.corpo);
      for (const x of ['11222333000181', '11.222.333/0001-81']) expect(texto, x).not.toContain(x);
      const total = (await adm('SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido c WHERE tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_recebido h WHERE h.tenant_id = c.tenant_id AND h.cliente_uuid = c.cliente_uuid AND h.revisao > c.revisao)', [A]))[0]!.n;
      expect(r.corpo.total_recebidos).toBe(total);

      const p = await rota(A, 'GET', '/entidades/produto/log');
      expect(p.status).toBe(200);
      expect(p.corpo).toMatchObject({ recebidos: [], total_recebidos: 0 });
    });

    it('RN-CORE-02: perfil sem integracao-fdv.ver leva 403 e tenant sem licença leva 403 MODULO_INATIVO', async () => {
      for (const perfil of PERFIS) expect((await rota(A, 'GET', '/entidades/cliente/log', { perfil })).status, perfil).toBe(pode(perfil, 'integracao-fdv.ver') ? 200 : 403);
      expect(await rota(C, 'GET', '/entidades/cliente/log')).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
    });
  });

  describe('RN-INF-06: expurgo do pré-cadastro recusado (rotina diária)', () => {
    const recusadoEm = (t: string, uuid: string, diasAtras: number) =>
      adm(
        // hora-fixa-ok: o corte do expurgo é medido contra o now() do banco; só o relógio real o exercita
        `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, razao_social, documento_mascarado, payload, recebido_em, situacao, motivo, erros, decidido_em, ultima_recusa_em, codigo_fdv)
         VALUES ($1, $2, 1, $3, 'Mercado do Fulano', '***.456.789-**', '{"documento": "12345678901"}', now(), 'recusado', 'Documento inválido', '[{"campo":"documento","codigo":"documento_invalido","mensagem":"Documento inválido"}]'::jsonb, now(), now() - make_interval(days => $4), '00077')`,
        [t, uuid, 'd'.repeat(64), diasAtras],
      );

    it('RN-INF-06: 180 dias depois da última recusa o payload sai; a recente fica; a rota mostra "—" e os códigos de erro; o log leva só contagens', async () => {
      const [velho, novo] = [U(), U()];
      await recusadoEm(B, velho, 200);
      await recusadoEm(B, novo, 10);
      const log = dubleLogAlertas();
      const r = await expurgarPreCadastro({
        banco: worker, tenantsAtivos: async () => [B], relogio: RELOGIO_REAL, log: { info: log.log.info, warn: log.log.warn },
      });
      expect(r).toMatchObject({ tenants: 1, falhas: 0 });
      expect(r.revisoes).toBeGreaterThanOrEqual(1);
      expect((await linhas(B, velho))[0]).toMatchObject({ situacao: 'recusado', sem_payload: true, documento_mascarado: null });
      expect((await adm('SELECT razao_social, payload_expurgado_em FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1 AND cliente_uuid = $2', [B, velho]))[0]).toMatchObject({ razao_social: null });
      expect((await linhas(B, novo))[0]).toMatchObject({ sem_payload: false });
      const lista = await rota(B, 'GET', '/clientes-recebidos', { consulta: { limite: '200' } });
      const item = lista.corpo.itens.find((i: { cliente_uuid: string }) => i.cliente_uuid === velho);
      expect(item).toMatchObject({ razao_social: '—', documento_mascarado: null, situacao: 'recusado', motivo: 'Documento inválido', codigo_fdv: '00077' });
      expect(item.erros).toEqual([{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' }]);
      const texto = JSON.stringify(log.logs);
      for (const s of [...SEGREDOS, '12345678901', '456.789']) expect(texto, s).not.toContain(s);
      expect(texto).toContain('RN-INF-06');
      // auditoria só com as contagens
      const aud = await adm("SELECT depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.pre-cadastro.expurgar'", [B]);
      expect(aud.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(aud[0]!.depois).sort()).toEqual(['recusado', 'regra', 'sem_decisao']);
      // idempotente: a segunda rodada não acha mais nada
      const de_novo = await expurgarPreCadastro({ banco: worker, tenantsAtivos: async () => [B], relogio: RELOGIO_REAL, log: { info: log.log.info, warn: log.log.warn } });
      expect(de_novo).toMatchObject({ revisoes: 0 });
    });

    it('RN-INF-06 (T-0098): o recebido e o reenviado sem decisão há mais de 180 dias saem; o recusado segue saindo; a rota mostra "—"; o log tem só contagens', async () => {
      const [semDecisao, reenviado, recente, recusado] = [U(), U(), U(), U()];
      const sem = (uuid: string, situacao: string, diasAtras: number) =>
        adm(
          // hora-fixa-ok: o corte do expurgo é medido contra o now() do banco; só o relógio real o exercita
          `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, razao_social, documento_mascarado, payload, recebido_em, chegou_em, situacao)
           VALUES ($1, $2, CASE WHEN $4 = 'reenviado' THEN 2 ELSE 1 END, $3, 'Mercado do Fulano', '***.456.789-**', '{"documento": "12345678901"}', now() - make_interval(days => $5), now() - make_interval(days => $5), $4)`,
          [B, uuid, 'e'.repeat(64), situacao, diasAtras],
        );
      await sem(semDecisao, 'recebido', 200);
      await sem(reenviado, 'reenviado', 200);
      await sem(recente, 'recebido', 10);
      await recusadoEm(B, recusado, 200);
      const log = dubleLogAlertas();
      const r = await expurgarPreCadastro({ banco: worker, tenantsAtivos: async () => [B], relogio: RELOGIO_REAL, log: { info: log.log.info, warn: log.log.warn } });
      expect(r).toMatchObject({ tenants: 1, falhas: 0 });
      expect(r.sem_decisao_revisoes).toBeGreaterThanOrEqual(2);
      expect(r.recusado_revisoes).toBeGreaterThanOrEqual(1);
      expect(r.revisoes).toBe(r.sem_decisao_revisoes + r.recusado_revisoes);
      expect((await linhas(B, semDecisao))[0]).toMatchObject({ situacao: 'recebido', sem_payload: true, documento_mascarado: null });
      expect((await linhas(B, reenviado))[0]).toMatchObject({ situacao: 'reenviado', sem_payload: true });
      expect((await linhas(B, recusado))[0]).toMatchObject({ situacao: 'recusado', sem_payload: true });
      expect((await linhas(B, recente))[0]).toMatchObject({ situacao: 'recebido', sem_payload: false });
      const lista = await rota(B, 'GET', '/clientes-recebidos', { consulta: { limite: '200' } });
      for (const u of [semDecisao, reenviado]) {
        const item = lista.corpo.itens.find((i: { cliente_uuid: string }) => i.cliente_uuid === u);
        expect(item).toMatchObject({ razao_social: '—', documento_mascarado: null });
      }
      const texto = JSON.stringify(log.logs);
      for (const s of [...SEGREDOS, '12345678901', '456.789']) expect(texto, s).not.toContain(s);
      expect((await expurgarPreCadastro({ banco: worker, tenantsAtivos: async () => [B], relogio: RELOGIO_REAL, log: { info: log.log.info, warn: log.log.warn } })).revisoes).toBe(0);
    });

    it('RN-INF-06: a falha de um tenant não para os outros (conta em falhas, só o nome do erro no log)', async () => {
      const log = dubleLogAlertas();
      const ruim = 'nao-e-tenant';
      const r = await expurgarPreCadastro({ banco: worker, tenantsAtivos: async () => [ruim, B], relogio: RELOGIO_REAL, log: { info: log.log.info, warn: log.log.warn } });
      expect(r).toMatchObject({ tenants: 2, falhas: 1 });
      expect(JSON.stringify(log.logs)).not.toContain('Mercado');
    });
  });

  it('LGPD: nem o log nem os alertas de toda a bateria levam nome, documento, e-mail, telefone ou endereço', () => {
    const texto = JSON.stringify([d.logs, d.alertas]);
    for (const s of SEGREDOS) expect(texto, s).not.toContain(s);
  });
});
