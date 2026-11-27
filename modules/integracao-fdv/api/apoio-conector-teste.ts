/**
 * Apoio dos testes de banco do conector (só teste): massa de tenant, eventos do `cadastros`, licenças e um dublê do
 * `ClienteHub` (sem rede). Não faz parte da API de produção: exposto só como `@macuxierp/integracao-fdv/api/testes`, para testes.
 */
import { randomUUID } from 'node:crypto';
import { cifrarCampo, decifrarCampo, ErroClienteHub, type AgendaModulo, type Banco, type ContextoAgenda, type ItemAgenda, type CredencialHub, type ClienteHub, type EnvelopeEvento, type FonteLicencas, type PedidoHub, type RespostaHub } from '@macuxierp/platform-sdk';
import { ENTIDADES_HUB_F2, type AmbienteHub, type EntidadeHub } from '../contracts';
import { hashRegistro } from '../domain';
import type { Alertar, LogPedidos } from './portas';

export { ErroClienteHub };

/**
 * O pool do admin do banco efêmero (`BancoEfemero['admin']`, só o `query`). Escrito à mão porque este arquivo não é `*.test.ts`
 * e a regra `modulo-abre-conexao` proíbe importar `platform-sdk/pg-testes` fora dos testes (nem como tipo).
 */
type AdminSql = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Consulta como admin (fora da RLS) devolvendo só as linhas: o `adm` dos testes de banco. */
export const admSql =
  (efemero: { admin: AdminSql }) =>
  async (sql: string, params: unknown[] = []): Promise<Record<string, any>[]> => // eslint-disable-line @typescript-eslint/no-explicit-any
    (await efemero.admin.query(sql, params)).rows;

export const U = (): string => randomUUID();
export const AGORA = new Date('2026-11-22T10:00:00.000Z');
export const CHAVE_MESTRA = Buffer.alloc(32, 7);
export const CHAVE_CLARA = 'chave-secreta-do-conector-0123456789abcdef-NAO-VAZAR';
const ENDERECO = { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000000', pais_bacen: '1058', municipio_nome: 'Manaus' };

/** CNPJs numéricos válidos (com dígitos verificadores) de três filiais de uma mesma raiz (ordens 0001, 0002 e 0003). */
const CNPJ_FILIAL_1 = '12345678000195';
export const CNPJ_FILIAL_2 = '12345678000276';
export const CNPJ_FILIAL_3 = '12345678000357';

export const licenciadas = (...modulos: string[]): FonteLicencas => ({
  ler: async () => modulos.map((modulo) => ({ modulo, ativo: true, valido_ate: null }) as never),
});

export function evento(tenant: string, nome: string, agregado: string, payload: Record<string, unknown>, ocorridoEm: string): EnvelopeEvento {
  return { id: U(), nome, tenant_id: tenant, agregado_id: agregado, versao: 1, ocorrido_em: ocorridoEm, ator: 'sistema', request_id: 'r-teste', payload };
}

export const cadFilial = (id: string, o: Record<string, unknown> = {}) => ({
  id, cnpj: CNPJ_FILIAL_1, ie: null, razao_social: 'Empresa LTDA', nome_fantasia: null, crt: '3', endereco: ENDERECO, padrao: true, emissora: true, nfe_serie: 1, nfe_numero_inicial: 1, external_id: null, inativo: false, ...o,
});
export const cadVendedor = (id: string, filialId: string, o: Record<string, unknown> = {}) => ({ id, codigo: 'V1', nome: 'Ana', filial_id: filialId, usuario_id: null, external_id: null, inativo: false, ...o });
export const cadProduto = (id: string, unidades: Array<{ id: string; unidade: string; fator: number; ean: string | null }>, o: Record<string, unknown> = {}) => ({
  id, codigo: 'SKU1', descricao: 'Arroz', ncm: '10063021', cest: null, unidade_comercial: 'CX', unidade_tributavel: 'UN', fator_tributavel: 120_000, ean: null, marca: 'Marca', origem: '0', grupo_tributacao: 'G', custo_centavos: 7771777, external_id: null, inativo: false, unidades, ...o,
});
export const cadTabela = (id: string, o: Record<string, unknown> = {}) => ({ id, nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: true, external_id: null, inativo: false, ...o });
export const cadPreco = (tabela: string, filial: string, produto: string, o: Record<string, unknown> = {}) => ({
  tabela_preco_id: tabela, filial_id: filial, produto_id: produto, preco_centavos: 1990, desconto_maximo_bp: 0, inativo: false, vigencia_inicio: '2026-01-01', vigencia_fim: null, ...o,
});
export const cadCondicao = (id: string, o: Record<string, unknown> = {}) => ({
  id, codigo: '28-56', descricao: '28 e 56', forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 42, forma_external_id: null, forma_codigo: null, forma_nome: null, external_id: null, inativo: false, ...o,
});
export const cadCliente = (id: string, filialId: string, o: Record<string, unknown> = {}) => ({
  id, tipo_pessoa: 'PJ', documento: CNPJ_FILIAL_1, ie: null, ind_ie_dest: '1', razao_social: 'Mercado LTDA', nome_fantasia: null, email_nfe: 'sigiloso@exemplo.com', limite_credito_centavos: 500_000,
  condicao_pagamento_id: null, tabela_preco_id: null, filial_id: filialId, vendedor_id: null, external_id: null, inativo: false,
  enderecos: [{ id: U(), tipo: 'principal', ...ENDERECO }], ...o,
});

export async function criarCredencial(admin: AdminSql, tenant: string, o: { conector?: string; ambiente?: AmbienteHub; chave?: string; entidades?: readonly EntidadeHub[] } = {}): Promise<string> {
  const cifrada = cifrarCampo({ chave: CHAVE_MESTRA, tenantId: tenant, claro: o.chave ?? CHAVE_CLARA });
  const r = await admin.query('INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo, entidades_habilitadas) VALUES ($1, $2, $3, $4, $5, $6::integracao_fdv.entidade_hub[]) RETURNING id', [tenant, o.conector ?? 'erp-teste', o.ambiente ?? 'teste', cifrada, 'chave-se', [...(o.entidades ?? ENTIDADES_HUB_F2)]]);
  return r.rows[0]!.id as string;
}

interface ChamadaHub {
  cred: CredencialHub;
  pedido: PedidoHub;
}
type RespostaRoteirizada = RespostaHub | ((p: PedidoHub) => RespostaHub);

/** Dublê do `ClienteHub`: respostas por `METODO caminho` (fila, a última se repete) e o registro de cada chamada. */
export function hubDuble(roteiro: Record<string, RespostaRoteirizada[]> = {}): ClienteHub & { chamadas: ChamadaHub[]; roteiro: Record<string, RespostaRoteirizada[]> } {
  const chamadas: ChamadaHub[] = [];
  const contagem = new Map<string, number>();
  return {
    chamadas,
    roteiro,
    async chamar(cred, pedido) {
      chamadas.push({ cred, pedido });
      const caminho = pedido.caminho.replace(/\/[0-9a-f-]{36}$/, '/{id}');
      const chave = `${pedido.metodo} ${caminho}`;
      const fila = roteiro[chave];
      if (!fila || fila.length === 0) throw new Error(`dublê do Hub: sem resposta para ${chave}`);
      const i = contagem.get(chave) ?? 0;
      contagem.set(chave, i + 1);
      const r = fila[Math.min(i, fila.length - 1)]!;
      return typeof r === 'function' ? r(pedido) : r;
    },
  };
}

export const ok = (corpo: unknown, replay = false, status = 202): RespostaHub => ({ tipo: 'ok', status, corpo, replay });
/** Resposta 202 do `POST /lotes` (lote aceito) e resultado final do `GET /lotes/{id}`: uma só forma para os testes de conector. */
export const loteAceito = (o: { id: string; entidade: string; recebidos: number; repetido?: boolean }) => ({ lote_id: o.id, status: 'recebido', entidade: o.entidade, modo: 'delta', recebidos: o.recebidos, repetido: o.repetido ?? false, consulta: `/integracao/v1/lotes/${o.id}` });
export const loteConcluido = (o: { id: string; entidade: string; erros?: unknown[]; recebidas?: number }) => {
  const erros = o.erros ?? [];
  const recebidas = o.recebidas ?? 1;
  return { lote_id: o.id, entidade: o.entidade, modo: 'delta', status: erros.length ? 'concluido_com_erros' : 'concluido', contagens: { recebidas, com_erro: erros.length, novas: recebidas }, erros };
};
export const recusa = (status: number, codigo: string | null = null): RespostaHub => ({ tipo: 'recusa', status, codigo });
export const retentavel = (status: number | null, retryAfterMs: number | null = null, codigo: string | null = null): RespostaHub => ({ tipo: 'retentavel', status, codigo, retryAfterMs });

// ---- massa do espelho e ciclo da agenda (testes do envio) ----

export function payloadProduto(chave: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { external_id: chave, ativo: true, sku: `SKU-${chave}`, nome: `Produto ${chave}`, unidade: 'UN', ...o };
}

export async function espelho(
  admin: AdminSql,
  tenant: string,
  entidade: string,
  payload: Record<string, unknown>,
  o: { pendente?: boolean; confirmado?: boolean; alterado?: Date; ativo?: boolean; refs?: Record<string, string> } = {},
): Promise<string> {
  const alterado = o.alterado ?? new Date('2026-11-22T09:00:00.000Z');
  const hash = hashRegistro(payload);
  const confirmado = o.confirmado ?? false;
  await admin.query(
    `INSERT INTO integracao_fdv.registro_publicado
       (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente, hash_confirmado, confirmado_em)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6, $7::jsonb, $8, $9, $10, $11)`,
    [tenant, entidade, String(payload.external_id), JSON.stringify(payload), hash, alterado, JSON.stringify(o.refs ?? {}), o.ativo ?? true, o.pendente ?? !confirmado, confirmado ? hash : null, confirmado ? alterado : null],
  );
  return hash;
}

export async function cursorEntidade(admin: AdminSql, tenant: string, entidade: string, o: { proximoEm?: Date; credencialId?: string | null; cursor?: { em: Date; id: string } | null } = {}): Promise<void> {
  await admin.query(
    `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em, cursor_alterado_em, cursor_external_id, credencial_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, entidade) DO UPDATE SET proximo_em = EXCLUDED.proximo_em, cursor_alterado_em = EXCLUDED.cursor_alterado_em, cursor_external_id = EXCLUDED.cursor_external_id`,
    [tenant, entidade, o.proximoEm ?? new Date('2026-11-22T09:59:00.000Z'), o.cursor?.em ?? null, o.cursor?.id ?? null, o.credencialId ?? null],
  );
}

/** Log e alerta que só acumulam texto: `logs` (JSON de objeto e mensagem) e `alertas` (`tenant:codigo:contexto`). */
export function dubleLogAlertas(): { logs: string[]; alertas: string[]; log: LogPedidos; alertar: Alertar } {
  const logs: string[] = [];
  const alertas: string[] = [];
  const registrar = (o: Record<string, unknown>, m: string): void => void logs.push(JSON.stringify([o, m]));
  return { logs, alertas, log: { info: registrar, warn: registrar, error: registrar }, alertar: (t, c, x) => void alertas.push(`${t}:${c}:${JSON.stringify(x ?? {})}`) };
}

/** Contexto da agenda como o laço do worker monta: transações curtas no tenant do item e a chave só em memória. */
export function contextoDaAgenda(banco: Banco, item: ItemAgenda, hub: ClienteHub, agora: Date, posseAte: Date): ContextoAgenda {
  return {
    agora,
    posseAte,
    hub,
    decifrarCredencial: (cifrada, tenantId) => decifrarCampo({ chave: CHAVE_MESTRA, tenantId, cifrado: cifrada }).toString('utf8'),
    emTransacao: (fn) => banco.comTenant(item.tenant_id, fn),
  };
}

/** Um ciclo do laço: reserva (sem tenant) e executa os itens dos tenants pedidos. Devolve os itens reservados desses tenants. */
export async function ciclo(banco: Banco, agenda: AgendaModulo, hub: ClienteHub, agora: Date, tenants: readonly string[]): Promise<ItemAgenda[]> {
  const posse = new Date(agora.getTime() + 120_000);
  const itens = (await banco.semTenant((tx) => agenda.reservar(tx, 100, agora, posse))).filter((i) => tenants.includes(i.tenant_id));
  for (const item of itens) await agenda.executar(item, contextoDaAgenda(banco, item, hub, agora, posse));
  return itens;
}

/** Criar o banco efêmero (migrações) e removê-lo passa dos 10 s padrão dos ganchos quando a máquina está carregada; sem espera real nos testes. */
export const TEMPO_PREPARO_MS = 90_000;
