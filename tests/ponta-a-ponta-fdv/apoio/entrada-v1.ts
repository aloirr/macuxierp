/**
 * T-0057 (T1): arnês da API de entrada `/entrada/v1` (ADR 0014 §1 a §4; decisão 34 B do Alexandre,
 * R-20261126-210816: sem carga completa, ela responde 422 `CARGA_COMPLETA_NAO_SUPORTADA`).
 *
 * Tudo é o código de produção: a API do `appPgDeTeste` (`modulos: 'producao'`, com o pepper de teste) monta o plugin
 * `montarEntrada` com as rotas do cadastros e a porta SQL da credencial (`cadastros.entrada_autenticar`, 0071); a chave
 * nasce pelo portal `/config` do superadmin (`POST /v1/plataforma/empresas/:id/entrada/credencial`), que guarda só o
 * HMAC; o worker roda o executor `TRABALHO_ENTRADA_LOTE` do `montarExecutores` (gravação pelo `gravarLinhas`), e os
 * eventos `cadastros.*@1` seguem pelo espelho e pela agenda do `integracao-fdv` até o dublê do Hub
 * (`apoio/duble-hub.ts`). A entrada nunca fala com o FDV; o dublê só confirma que o cadastro gravado pela entrada sai
 * como o do BKO.
 *
 * Tudo é fictício: CNPJ e CPF gerados com dígito válido, nomes inventados; a chave e o pepper são gerados na hora.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  armazenamentoIndisponivel,
  CABECALHO_CONECTOR_ID_ENTRADA,
  CABECALHO_IDEMPOTENCIA_ENTRADA,
  CAMINHOS_ENTRADA,
  CAMINHOS_ENTRADA_PLATAFORMA,
  CredencialEntradaCriada,
  decifrarCampo,
  ENTIDADES_ENTRADA,
  PREFIXO_ENTRADA,
  PREFIXO_PLATAFORMA,
  TRABALHO_ENTRADA_LOTE,
} from '../../../packages/platform-sdk/src/index';
import { CatalogoArquivosPg, LicencasPg, type BancoPg } from '../../../packages/platform-sdk/src/pg';
import { cnpjValido } from '../../../packages/platform-sdk/src/documentos';
import { CorpoLote, PAYLOADS_HUB, VERSAO_CONTRATO_HUB, type EntidadeHub, type RegistroLote } from '../../../packages/platform-sdk/src/hub-v1';
import { appPgDeTeste, destinoDeLogs } from '../../../apps/api/src/apoio-teste';
import { rodarAgendas } from '../../../apps/worker/src/agenda';
import { montarAgendas, montarConsumidores, montarExecutores } from '../../../apps/worker/src/modulos';
import { montarPedidosFdv } from '../../../apps/worker/src/pedidos-fdv';
import { ReservaTrabalhosPg } from '../../../apps/worker/src/pg';
import { processarTrabalhos, type ResumoTrabalhos } from '../../../apps/worker/src/trabalhos';
import { criarResolvedorChaveErp, repositoriosSql } from '../../../modules/cadastros/api/index';
import { filialValida, produtoValido } from '../../../modules/cadastros/api/fixtures-teste';
import { CHAVE_MESTRA, criarCredencial } from '../../../modules/integracao-fdv/api/apoio-conector-teste';
import { CNPJ_EMPRESA_PG, montarApiPg } from '../../apoio/api-pg';
import { preencherCaminho } from '../../apoio/caminhos';
import { atalhosPortal, inserirSuperadmin } from '../../apoio/portal-pg';
import { clienteDoSdk } from './adaptador-conector';
import { CredencialHub } from './config';
import { criarDubleHub, type DubleHub } from './duble-hub';
import { comDv, cpfFicticio } from './massa';
import { criarRegistroLgpd, despacharAteEsvaziar } from './erp-pedidos';
import type { RelogioDeTeste } from './relogio';

/** Pepper de teste (o `MACUXIERP_PEPPER_ENTRADA` de produção tem 32 bytes em hex; `lerPepperEntrada`). Gerado na hora. */
export const PEPPER_ENTRADA_DE_TESTE = randomBytes(32);

/** `PREFIXO_ENTRADA` + o caminho do SDK, com os parâmetros (`:id`, `:entidade`) preenchidos. */
export const urlEntrada = (caminho: keyof typeof CAMINHOS_ENTRADA, valores: Readonly<Record<string, string>> = {}): string =>
  PREFIXO_ENTRADA + preencherCaminho(CAMINHOS_ENTRADA[caminho], valores);

// ---------------------------------------------------------------------------------------------------------------------
// Credencial do conector (ADR 0014 §4; `ChaveEntrada` do SDK: 32 bytes em base64url, 43 caracteres)
// ---------------------------------------------------------------------------------------------------------------------

export interface CredencialEntrada {
  tenantId: string;
  conectorId: string;
  /** Só em memória do teste; nunca vai a log, recado ou mensagem de asserção. */
  chave: string;
}

/** Chave fictícia gerada na hora, no formato do `ChaveEntrada` (para as recusas: nunca é a de uma credencial). */
export const gerarChaveEntrada = (): string => randomBytes(32).toString('base64url');

/** Cabeçalhos de máquina da /entrada/v1 (sem JWT). `idempotencia` só no POST de lote. */
export function cabecalhosEntrada(c: Pick<CredencialEntrada, 'conectorId' | 'chave'>, idempotencia?: string): Record<string, string> {
  return {
    authorization: `Bearer ${c.chave}`,
    [CABECALHO_CONECTOR_ID_ENTRADA]: c.conectorId,
    ...(idempotencia ? { [CABECALHO_IDEMPOTENCIA_ENTRADA]: idempotencia } : {}),
  };
}
/** `PADRAO_CHAVE_IDEMPOTENCIA` do SDK (8 a 128, `[A-Za-z0-9_.:-]`). */
export const novaChaveIdempotencia = (): string => `entrada-${randomUUID()}`;

// ---------------------------------------------------------------------------------------------------------------------
// Envelopes (hub-v1)
// ---------------------------------------------------------------------------------------------------------------------

/** Lote delta: o único modo aceito nesta etapa (decisão 34 B). */
export function envelopeDelta(entidade: EntidadeHub, registros: readonly RegistroLote[], enviadoEm: Date, cursor: CorpoLote['cursor'] = null): CorpoLote {
  return CorpoLote.parse({
    versao_contrato: VERSAO_CONTRATO_HUB,
    entidade,
    modo: 'delta',
    enviado_em: enviadoEm.toISOString(),
    cursor,
    registros,
    linhas_invalidas: [],
    linhas_invalidas_omitidas: 0,
  });
}

/** Carga completa válida pelo contrato do Hub (uma parte, a última): a /entrada/v1 tem de responder 422 sem criar lote. */
export function envelopeCompleto(entidade: EntidadeHub, registros: readonly RegistroLote[], enviadoEm: Date): CorpoLote {
  return CorpoLote.parse({
    versao_contrato: VERSAO_CONTRATO_HUB,
    entidade,
    modo: 'completo',
    enviado_em: enviadoEm.toISOString(),
    cursor: null,
    sessao: { id: randomUUID(), parte: 1, ultimo: true },
    registros,
    linhas_invalidas: [],
    linhas_invalidas_omitidas: 0,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Massa fictícia dos 10 cadastros da F2, com as referências entre eles fechadas
// ---------------------------------------------------------------------------------------------------------------------

/** As 10 da F2 (`ENTIDADES_ENTRADA` do SDK, as chaves do `PAYLOADS_HUB`), na ordem de carga. */
export type EntidadeF2 = keyof typeof PAYLOADS_HUB;
export const ENTIDADES_F2 = ENTIDADES_ENTRADA as readonly EntidadeF2[];
export interface MassaEntrada {
  registros: Record<EntidadeF2, RegistroLote[]>;
  /** Valores que nunca podem aparecer em log nem na resposta (LGPD, regra 8). */
  sensiveis: string[];
}

/** CNPJ com a raiz da empresa do `montarApiPg` e a ordem dada (a filial é da mesma empresa). */
const cnpjDaEmpresa = (ordem: string): string => comDv(CNPJ_EMPRESA_PG.slice(0, 8) + ordem, cnpjValido);

/** `alterado_em` crescente a partir de `base`, 1 s por registro (o cursor anda na ordem). */
export function massaEntrada(base: Date): MassaEntrada {
  let seq = 0;
  const em = () => new Date(base.getTime() + 1000 * seq++).toISOString();
  const sufixo = randomUUID().slice(0, 6).toUpperCase();
  const ext = (p: string) => `THA-${p}-${sufixo}`;
  const cpf = cpfFicticio();
  const razao = `Mercearia Ficticia ${sufixo}`;
  const logradouro = 'Rua Ficticia das Palmeiras';

  const registros: Record<EntidadeF2, RegistroLote[]> = {
    filial: [{ external_id: ext('FIL-1'), alterado_em: em(), ativo: true, codigo: '0002', nome: `Filial Teste ${sufixo}`, cnpj: cnpjDaEmpresa('0002'), logradouro: 'Avenida Ficticia', numero: '100', bairro: 'Centro', cep: '69301000', cidade: 'Boa Vista', uf: 'RR' }],
    vendedor: [{ external_id: ext('VEN-1'), alterado_em: em(), ativo: true, nome: `Vendedora Ficticia ${sufixo}`, filial_external_id: ext('FIL-1') }],
    // o código da forma é o do dicionário do tPag (RN-CAD-09: BOLETO → 15)
    forma_pagamento: [{ external_id: ext('FOR-1'), alterado_em: em(), ativo: true, codigo: 'BOLETO', nome: 'Boleto' }],
    prazo_pagamento: [{ external_id: ext('PRZ-1'), alterado_em: em(), ativo: true, forma_external_id: ext('FOR-1'), codigo: `28-56-${sufixo}`, parcelas_dias: '28/56', descricao: 'Boleto 28/56' }],
    produto: [{ external_id: ext('PRO-1'), alterado_em: em(), ativo: true, sku: `SKU-${sufixo}`, nome: 'Arroz Ficticio 5 kg', unidade: 'UN', marca: 'Marca Teste' }],
    produto_unidade: [{ external_id: ext('PUN-1'), alterado_em: em(), ativo: true, produto_external_id: ext('PRO-1'), unidade: 'CX', fator: 6, padrao: false }],
    preco: [{ external_id: ext('PRE-1'), alterado_em: em(), ativo: true, tabela_external_id: ext('TAB-1'), tabela_nome: 'Tabela Varejo', vigencia_inicio: '2026-11-01', produto_external_id: ext('PRO-1'), preco_cents: 2899, filial_external_id: ext('FIL-1') }],
    estoque: [{ external_id: ext('EST-1'), alterado_em: em(), ativo: true, deposito_external_id: ext('DEP-1'), deposito_nome: 'Depósito Central', produto_external_id: ext('PRO-1'), saldo: 120, filial_external_id: ext('FIL-1') }],
    // o cliente novo traz o endereço principal (RN-CAD-03); o `cliente_endereco` acrescenta o de entrega
    cliente: [{ external_id: ext('CLI-1'), alterado_em: em(), ativo: true, razao_social: razao, documento: cpf, vendedor_external_id: ext('VEN-1'), filial_external_id: ext('FIL-1'), limite_credito_cents: 150000, formas_pagamento: ['BOLETO'], prazo_medio_max_dias: 42, endereco: { logradouro, numero: '45', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000' } }],
    cliente_endereco: [{ external_id: ext('END-1'), alterado_em: em(), ativo: true, cliente_external_id: ext('CLI-1'), logradouro: 'Travessa Ficticia do Porto', numero: '12', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000', tipo: 'entrega', principal: false }],
  };
  return { registros, sensiveis: [cpf, razao, logradouro] };
}

/** Índices das linhas que contêm algum dos valores; o teste compara só os índices (o valor nunca vai à mensagem). */
export function linhasComSensivel(linhas: readonly string[], valores: readonly string[]): number[] {
  return linhas.flatMap((l, i) => (valores.some((v) => v && l.includes(v)) ? [i] : []));
}

// ---------------------------------------------------------------------------------------------------------------------
// Montagem: API de produção com a /entrada/v1 + portal da credencial + worker + dublê do Hub
// ---------------------------------------------------------------------------------------------------------------------

const EMAIL_SA = 'sa-t0057@exemplo.invalid';

/**
 * Tenants: A e B com `cadastros` e `integracao-fdv` (B é o "outro tenant" das recusas); S com o `cadastros` licenciado
 * só até a chave nascer, e depois sem ele (403 `MODULO_INATIVO`, RN-CORE-02). O A também envia ao dublê do Hub pela
 * credencial de saída do `integracao-fdv`.
 */
export async function montarEntradaV1(relogio: RelogioDeTeste) {
  const logsApi: string[] = [];
  const api = await montarApiPg(
    { A: ['cadastros', 'integracao-fdv'], B: ['cadastros', 'integracao-fdv'], S: ['cadastros'] },
    { relogio, pepperEntrada: PEPPER_ENTRADA_DE_TESTE, logger: { level: 'debug', stream: destinoDeLogs(logsApi) } },
  );
  const { app } = api;

  // Portal /config: a chave nasce (e se troca) só pelo superadmin; a resposta traz a chave clara uma única vez. A sessão do
  // portal é conferida pelo `now()` do banco, então o portal roda com o relógio real (mesmo banco e mesmo pepper).
  await inserirSuperadmin(api.b, EMAIL_SA);
  const { app: appPortal } = await appPgDeTeste({ b: api.b, modulos: 'producao', pepperEntrada: PEPPER_ENTRADA_DE_TESTE });
  const portal = atalhosPortal(appPortal);
  const sessao = await portal.sessao(EMAIL_SA);
  const urlCredencial = (tenantId: string) => PREFIXO_PLATAFORMA + CAMINHOS_ENTRADA_PLATAFORMA.credencial.replace(':id', tenantId);
  /** Cria ou troca a chave do conector (ADR 0014 §4: a anterior para na hora). */
  async function definirChave(tenantId: string, conectorId: string): Promise<CredencialEntrada> {
    const r = await portal.pedir('POST', urlCredencial(tenantId), { token: sessao, corpo: { conector_id: conectorId } });
    if (r.statusCode !== 201) throw new Error(`portal: criar a chave respondeu ${r.statusCode}`);
    const c = CredencialEntradaCriada.parse(r.json());
    return { tenantId, conectorId: c.conector_id, chave: c.chave };
  }

  const credenciais = {
    A: await definirChave(api.t.A, 'tha-conector-a'),
    B: await definirChave(api.t.B, 'tha-conector-b'),
    S: await definirChave(api.t.S, 'tha-conector-s'),
  };
  await api.b.admin.query("UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = $1 AND modulo = 'cadastros'", [api.t.S]);

  const worker: BancoPg = api.b.banco('macuxierp_worker', 4);
  const reg = criarRegistroLgpd();
  const duble: DubleHub = await criarDubleHub({ relogio });
  const saida = duble.registrarConector({ tenant: 'fdv-a', conectorId: 'macuxierp-a' });
  await criarCredencial(api.b.admin, api.t.A, { conector: saida.conectorId, chave: saida.chave });
  const hub = clienteDoSdk({ url: duble.url, credencial: new CredencialHub(saida.conectorId, saida.chave), versaoErp: 'dev' }).cliente;

  const chamarEntrada = (
    c: Pick<CredencialEntrada, 'conectorId' | 'chave'> | null,
    metodo: 'GET' | 'POST',
    url: string,
    o: { corpo?: object; idempotencia?: string; cabecalhos?: Record<string, string> } = {},
  ) => app.inject({ method: metodo, url, headers: { ...(c ? cabecalhosEntrada(c, o.idempotencia) : {}), ...(o.cabecalhos ?? {}) }, ...(o.corpo ? { payload: o.corpo } : {}) });

  /** POST do lote com uma Idempotency-Key nova (ou a dada). */
  const enviarLote = (c: Pick<CredencialEntrada, 'conectorId' | 'chave'>, corpo: object, idempotencia: string = novaChaveIdempotencia()) =>
    chamarEntrada(c, 'POST', urlEntrada('lotes'), { corpo, idempotencia });

  const contar = async (sql: string, p: unknown[]): Promise<number> => (await api.b.admin.query(sql, p)).rows[0]!.n as number;
  /** Trabalhos da entrada na fila real, por tenant (sem o payload). */
  const trabalhosDaEntrada = (tenantId: string) => contar('SELECT count(*)::int AS n FROM plataforma.trabalho WHERE tenant_id = $1 AND tipo = $2', [tenantId, TRABALHO_ENTRADA_LOTE]);
  /** Lotes gravados no banco, por tenant. */
  const lotesNoBanco = (tenantId: string) => contar('SELECT count(*)::int AS n FROM cadastros.entrada_lote WHERE tenant_id = $1', [tenantId]);
  /** O lote como o banco o guarda (pelo admin, fora da RLS). */
  const loteNoBanco = async (id: string) =>
    (await api.b.admin.query('SELECT tenant_id, estado, corpo IS NULL AS corpo_nulo, hash_corpo FROM cadastros.entrada_lote WHERE id = $1', [id])).rows[0] as
      | { tenant_id: string; estado: string; corpo_nulo: boolean; hash_corpo: string }
      | undefined;
  /** As credenciais como o banco as guarda, em texto (para conferir que a chave clara nunca é guardada). */
  const credenciaisNoBanco = async (): Promise<string[]> =>
    (await api.b.admin.query("SELECT row_to_json(c)::text AS t, encode(chave_hmac, 'base64') AS b64, encode(chave_hmac, 'hex') AS hex FROM cadastros.entrada_credencial c")).rows.map((r) => `${r.t} ${r.b64} ${r.hex}`);

  /** Roda a fila com os executores do worker (o `TRABALHO_ENTRADA_LOTE` é o do cadastros). */
  const processarFila = (): Promise<ResumoTrabalhos> =>
    processarTrabalhos({
      banco: worker,
      fila: new ReservaTrabalhosPg(),
      executores: montarExecutores({ banco: worker, log: reg.pino as never, armazenamento: armazenamentoIndisponivel, catalogo: new CatalogoArquivosPg(), agora: () => relogio.agora() }),
      relogio,
      log: reg.pino as never,
    });

  /** Outbox → espelho do integracao-fdv → agenda do conector → dublê do Hub, até não sobrar pendente no tenant A. */
  async function assentarNoHub(voltas = 20): Promise<void> {
    await despacharAteEsvaziar({ banco: worker, relogio, consumidores: montarConsumidores({ log: reg.pino, relogio }), log: reg.pino });
    const pecas = montarPedidosFdv({ log: reg.pino as never, relogio, recebimento: 'desligado', resolvedor: criarResolvedorChaveErp(repositoriosSql), aditivosCliente: false });
    const agendas = montarAgendas({ log: reg.pino, relogio, pedidosFdv: pecas, envio: 'ligado' });
    const decifrarCredencial = (cifrada: Buffer, tenantId: string) => decifrarCampo({ chave: CHAVE_MESTRA, tenantId, cifrado: cifrada }).toString('utf8');
    for (let i = 0; i < voltas; i++) {
      await rodarAgendas(agendas, { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial: decifrarCredencial as never, relogio, log: reg.pino });
      const n = await contar('SELECT count(*)::int AS n FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND pendente AND deleted_at IS NULL', [api.t.A]);
      if (n === 0) return;
      relogio.avancar(16 * 60_000);
    }
    throw new Error('a agenda do conector não assentou');
  }

  /**
   * O que a entrada ainda não cria (D1 a D3 do T1, recado ao gerente de 27/11/2026 00h09): a filial (o `FilialHub` não tem
   * `crt`), o produto (o `ProdutoHub` não tem NCM, RN-CAD-04) e a 1ª condição de uma forma (o lote de formas não grava, e o
   * prazo busca a forma numa condição que já existe). O cliente cadastra os três pelo BKO, com as chaves da massa, e a
   * entrada passa a atualizá-los. A ligação da condição com a forma (`forma_external_id`) não tem campo no BKO e vai pelo
   * admin do banco.
   */
  async function semearPeloBko(massa: MassaEntrada): Promise<void> {
    const post = async (url: string, corpo: object): Promise<string> => {
      const r = await api.chamar('A', 'POST', url, corpo);
      if (r.statusCode >= 300) throw new Error(`BKO ${url}: ${r.statusCode}`);
      return (r.json() as { id: string }).id;
    };
    const { filial: [f], produto: [p], forma_pagamento: [forma] } = massa.registros;
    await post('/v1/cadastros/filiais', filialValida({ external_id: f!.external_id, cnpj: f!.cnpj, padrao: false }));
    await post('/v1/cadastros/produtos', produtoValido({ external_id: p!.external_id, codigo: p!.sku, cest: '0300700' }));
    const condicao = await post('/v1/cadastros/condicoes-pagamento', { codigo: `AV-${forma!.codigo}`, descricao: 'Boleto à vista', forma_tpag: '15', prazos_dias: [0], prazo_medio_dias: 0 });
    await api.b.admin.query('UPDATE cadastros.condicao_pagamento SET forma_external_id = $2, forma_codigo = $3, forma_nome = $4 WHERE id = $1', [condicao, forma!.external_id, forma!.codigo, forma!.nome]);
  }

  const fechar = async () => {
    await duble.fechar();
    await appPortal.close();
    await api.fechar();
  };
  return {
    api, app, credenciais, definirChave, worker, duble, reg, logsApi,
    chamarEntrada, enviarLote, trabalhosDaEntrada, lotesNoBanco, loteNoBanco, credenciaisNoBanco, processarFila, assentarNoHub, semearPeloBko, fechar,
  };
}
export type MontagemEntradaV1 = Awaited<ReturnType<typeof montarEntradaV1>>;
