/**
 * T-0012: configuração do alvo dos testes de ponta a ponta da ida ERP → FDV, só por variáveis de ambiente.
 *
 *   MACUXI_HUB_ALVO          duble (padrão) | real
 *   MACUXI_HUB_PERFIL        obrigatória no real, sem padrão: tenant-teste | thathyany-seguro
 *   MACUXI_HUB_URL           base do Hub, com `/integracao/v1` (padrão no real: https://api.macuxifdv.com.br/integracao/v1)
 *   MACUXI_HUB_TENANT        nome do tenant no FDV (só para conferir e relatar)
 *   MACUXI_HUB_MODO_CARGA    completo | delta (padrão: completo no dublê, delta no real; o thathyany-seguro só aceita delta)
 *   MACUXI_HUB_LADO_ERP      conector (padrão) | emissor-minimo: adaptador do lado ERP no alvo real (no dublê rodam os
 *                            dois; o thathyany-seguro só aceita conector)
 *   MACUXI_HUB_ENTIDADES     entidades enviadas, separadas por vírgula (padrão no tenant-teste: as 11 do ERP;
 *                            obrigatória no thathyany-seguro: só as já viradas para o Conector do ERP)
 *   MACUXIERP_VERSAO         versão do ERP no `User-Agent: macuxierp/<versão>` (padrão `dev`)
 * Credencial: uma chave e um Conector POR PERFIL, em variáveis separadas (quem decide o tenant no Hub é a chave). A chave
 * `mxc_…` é segredo de rede do ambiente, lida só daqui e nunca impressa. `MACUXI_HUB_CHAVE` e `MACUXI_HUB_CONECTOR_ID`
 * genéricas não valem no real (recusadas).
 *   MACUXI_HUB_CHAVE_TENANT_TESTE e MACUXI_HUB_CONECTOR_ID_TENANT_TESTE   perfil tenant-teste
 *   MACUXI_HUB_CHAVE_THATHYANY e MACUXI_HUB_CONECTOR_ID_THATHYANY         perfil thathyany-seguro
 * Perfil tenant-teste:
 *   MACUXI_HUB_TENANT_TESTE  tem de ser `1`: quem roda confirma que a chave é de um tenant de TESTE
 * Perfil thathyany-seguro (decisão do Alexandre, 21/11/2026 23h12 de Manaus):
 *   MACUXI_HUB_RECEBE_PEDIDOS  tem de ser `0`: o Conector do ERP é NOVO e nasceu sem "recebe pedidos"
 *   MACUXI_HUB_MASSA_KIT       caminho do JSON com os dados idênticos aos do kit (T-0026), fora do repositório
 *   MACUXI_HUB_LIMITE_LOTE     registros por lote, de 1 a 100 (padrão 50)
 *
 * Trava: com o alvo real, recusa sem o perfil, sem https, com a chave ou o Conector genéricos, sem a chave do perfil,
 * com a chave fora do formato ou sem o Conector do perfil. No perfil tenant-teste, recusa sem a confirmação de tenant
 * de teste, com qualquer variável `MACUXI_HUB_*THATHYANY*` no ambiente, com a chave ou o Conector iguais aos da
 * thathyany e com qualquer sinal da thathyany no texto (tenant, Conector, URL). No perfil thathyany-seguro, só aceita a
 * thathyany, com o lado conector, o Conector sem pedidos, a massa do kit, o delta, lotes pequenos e só os cenários
 * "carga idêntica" e "reenvio idempotente". A mensagem de recusa nunca cita o valor da chave.
 */
import { inspect } from 'node:util';
import {
  FORMATO_CHAVE,
  FORMATO_CONECTOR_ID,
  ORDEM_DO_ERP,
  type EntidadeHub,
  type ModoLote,
} from './contrato-hub';
import { LADOS_ERP, type NomeLadoErp } from './lado-erp';
import { ErroMassaKit, lerMassaKit, type MassaKit } from './massa-kit';

export const URL_HUB_PADRAO = 'https://api.macuxifdv.com.br/integracao/v1';

export const PERFIS_REAL = ['tenant-teste', 'thathyany-seguro'] as const;
export type PerfilReal = (typeof PERFIS_REAL)[number];

/** Limite de registros por lote no perfil seguro: padrão e teto (lotes pequenos, conferidos no monitor do Hub). */
export const LIMITE_LOTE_SEGURO_PADRAO = 50;
export const LIMITE_LOTE_SEGURO_MAXIMO = 100;

/**
 * Cenários da T-0012 por nome (um `it` pode exigir mais de um: a carga sintética em modo completo exige também
 * `carga-completa`). Os sintéticos usam a massa gerada (`massa.ts`) e só rodam no dublê e no tenant de teste; os seguros
 * usam só a massa do kit e são os únicos do perfil thathyany-seguro.
 */
export const CENARIOS_SINTETICOS = [
  'carga-sintetica',
  'carga-completa',
  'reenvio-identico',
  'remontagem',
  'delta',
  'inativacao',
  'dado-novo',
  'divisao-5001',
  'sem-divisao',
  'ordem-quebrada',
  'retry-after-forcado',
  'versao-426',
  'filial-mapeada-a01',
  'lgpd',
] as const;
export const CENARIOS_SEGUROS = ['carga-identica', 'reenvio-idempotente'] as const;
/**
 * T-0017: a volta (pedido aprovado no FDV → ERP → retorno ao Hub). Rodam no dublê e, no alvo real, só no perfil
 * tenant-teste: na thathyany o Conector do ERP nasceu sem "recebe pedidos" (`MACUXI_HUB_RECEBE_PEDIDOS=0`), e os pedidos
 * reais dela ficam para depois da confirmação da virada (T-0027).
 */
export const CENARIOS_PEDIDOS = [
  'pedido-caminho-feliz',
  'pedido-cancelado',
  'pedido-recebimento-recusado',
  'pedido-reentrega',
  'pedido-retorno-repetido',
  'pedido-retencao',
  'pedido-endereco',
  'pedido-faturado',
  'pedido-lgpd',
  'pedido-multi-tenant',
  'pedido-licenca',
  'pedido-fila-real',
] as const;
export type NomeCenario =
  | (typeof CENARIOS_SINTETICOS)[number]
  | (typeof CENARIOS_SEGUROS)[number]
  | (typeof CENARIOS_PEDIDOS)[number];
const ehCenarioDePedido = (nome: NomeCenario) => (CENARIOS_PEDIDOS as readonly string[]).includes(nome);

export class ErroConfigHub extends Error {
  override readonly name = 'ErroConfigHub';
}

/** Credencial do Conector: a chave fica num campo privado e só sai no cabeçalho `Authorization`. */
export class CredencialHub {
  readonly #chave: string;

  constructor(
    readonly conectorId: string,
    chave: string,
  ) {
    this.#chave = chave;
  }

  autorizacao(): string {
    return `Bearer ${this.#chave}`;
  }

  /** Só para o adaptador que entrega a credencial à porta do SDK (que monta o mesmo cabeçalho). */
  chaveParaCabecalho(): string {
    return this.#chave;
  }

  /** Para comparar com o que chegou no dublê sem expor a chave em mensagem de asserção. */
  confere(cabecalho: string | undefined): boolean {
    return cabecalho === this.autorizacao();
  }

  toJSON(): Record<string, string> {
    return { conectorId: this.conectorId, chave: '[oculta]' };
  }

  toString(): string {
    return `CredencialHub(${this.conectorId}, chave oculta)`;
  }

  [inspect.custom](): string {
    return this.toString();
  }
}

export interface ConfigDuble {
  alvo: 'duble';
  modoCarga: ModoLote;
  versaoErp: string;
  ladoErp: NomeLadoErp;
}

interface BaseReal {
  alvo: 'real';
  url: string;
  credencial: CredencialHub;
  tenant: string;
  modoCarga: ModoLote;
  versaoErp: string;
  ladoErp: NomeLadoErp;
  entidades: readonly EntidadeHub[];
}

export interface ConfigTenantTeste extends BaseReal {
  perfil: 'tenant-teste';
}

export interface ConfigThathyanySeguro extends BaseReal {
  perfil: 'thathyany-seguro';
  modoCarga: 'delta';
  recebePedidos: false;
  limiteLote: number;
  massaKit: MassaKit;
}

export type ConfigReal = ConfigTenantTeste | ConfigThathyanySeguro;
export type ConfigHub = ConfigDuble | ConfigReal;

type Ambiente = Record<string, string | undefined>;

/** Sem acento e em minúsculas, para a trava não ser contornada por grafia. */
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const THATHYANY = 'thathyany';
const citaThathyany = (s: string) => normal(s).includes(THATHYANY);

/**
 * O cenário pode rodar com esta configuração? Dublê: todos; tenant de teste: os sintéticos e os de pedidos; thathyany:
 * só os seguros (nunca os de pedidos: `recebePedidos: false`).
 */
export function cenarioPermitido(config: ConfigHub, nome: NomeCenario): boolean {
  if (config.alvo === 'duble') return true;
  if (config.perfil === 'tenant-teste')
    return (CENARIOS_SINTETICOS as readonly string[]).includes(nome) || ehCenarioDePedido(nome);
  return (CENARIOS_SEGUROS as readonly string[]).includes(nome);
}

/** Recusa o cenário fora do perfil (segunda barreira, dentro do próprio cenário). */
export function exigirCenario(config: ConfigHub, nome: NomeCenario): void {
  if (!cenarioPermitido(config, nome)) {
    if (config.alvo === 'real' && config.perfil === 'thathyany-seguro' && ehCenarioDePedido(nome))
      throw new ErroConfigHub(
        `Recusado: o cenário "${nome}" é de pedidos e não roda no perfil thathyany-seguro (MACUXI_HUB_RECEBE_PEDIDOS=0, sem "recebe pedidos"): real só depois da confirmação da virada pelo Alexandre (T-0027).`,
      );
    const perfil = config.alvo === 'real' ? config.perfil : 'duble';
    throw new ErroConfigHub(`Recusado: o cenário "${nome}" não roda no perfil ${perfil}.`);
  }
}

function lerModo(valor: string | undefined, padrao: ModoLote): ModoLote {
  if (valor === undefined || valor === '') return padrao;
  if (valor === 'completo' || valor === 'delta') return valor;
  throw new ErroConfigHub('MACUXI_HUB_MODO_CARGA deve ser "completo" ou "delta".');
}

function lerLado(valor: string | undefined): NomeLadoErp {
  if (valor === undefined || valor === '') return 'conector';
  if ((LADOS_ERP as readonly string[]).includes(valor)) return valor as NomeLadoErp;
  throw new ErroConfigHub('MACUXI_HUB_LADO_ERP deve ser "conector" ou "emissor-minimo".');
}

function lerPerfil(valor: string | undefined): PerfilReal {
  if (valor === undefined || valor === '')
    throw new ErroConfigHub(
      'MACUXI_HUB_PERFIL é obrigatória no alvo real (sem padrão): "tenant-teste" ou "thathyany-seguro".',
    );
  if ((PERFIS_REAL as readonly string[]).includes(valor)) return valor as PerfilReal;
  throw new ErroConfigHub('MACUXI_HUB_PERFIL deve ser "tenant-teste" ou "thathyany-seguro".');
}

/** Variáveis da credencial de cada perfil: uma chave e um Conector por perfil (a chave decide o tenant no Hub). */
export const VARIAVEIS_CREDENCIAL: Readonly<Record<PerfilReal, { chave: string; conector: string }>> = {
  'tenant-teste': {
    chave: 'MACUXI_HUB_CHAVE_TENANT_TESTE',
    conector: 'MACUXI_HUB_CONECTOR_ID_TENANT_TESTE',
  },
  'thathyany-seguro': {
    chave: 'MACUXI_HUB_CHAVE_THATHYANY',
    conector: 'MACUXI_HUB_CONECTOR_ID_THATHYANY',
  },
};
/** Genéricas: não valem no real (não dá para saber de que tenant é a chave). */
const VARIAVEIS_GENERICAS = ['MACUXI_HUB_CHAVE', 'MACUXI_HUB_CONECTOR_ID'] as const;
/** Qualquer variável do arnês com THATHYANY no nome é "da thathyany". */
const ehVariavelDaThathyany = (nome: string) => /^MACUXI_HUB_.*THATHYANY/i.test(nome);

/** Lê a chave e o Conector do perfil, sem nunca citar o valor da chave. */
function lerCredencial(env: Ambiente, perfil: PerfilReal): CredencialHub {
  const nomes = VARIAVEIS_CREDENCIAL[perfil];
  const genericas = VARIAVEIS_GENERICAS.filter((v) => env[v] !== undefined);
  if (genericas.length)
    throw new ErroConfigHub(
      `${genericas.join(' e ')} não vale no alvo real: use as variáveis do perfil (${nomes.chave} e ${nomes.conector}).`,
    );
  const chave = env[nomes.chave] ?? '';
  if (!chave)
    throw new ErroConfigHub(
      `${nomes.chave} ausente: com o alvo real a chave do perfil vem do segredo do ambiente.`,
    );
  if (!FORMATO_CHAVE.test(chave))
    throw new ErroConfigHub(`${nomes.chave} fora do formato mxc_ + 43 caracteres (valor não exibido).`);
  const conectorId = env[nomes.conector]?.trim() ?? '';
  if (!FORMATO_CONECTOR_ID.test(conectorId))
    throw new ErroConfigHub(`${nomes.conector} ausente ou fora do formato.`);
  return new CredencialHub(conectorId, chave);
}

/**
 * O tenant-teste nunca usa nada da thathyany: a chave (que decide o tenant) e o Conector não podem ser os dela, e
 * nenhuma variável dela pode estar no ambiente.
 */
function recusarThathyanyNoTenantTeste(env: Ambiente, credencial: CredencialHub): void {
  const dela = VARIAVEIS_CREDENCIAL['thathyany-seguro'];
  const chaveDela = env[dela.chave];
  if (chaveDela && credencial.confere(`Bearer ${chaveDela}`))
    throw new ErroConfigHub(
      'Recusado: a chave do tenant-teste é a mesma da thathyany (a chave decide o tenant; valor não exibido).',
    );
  const conectorDela = env[dela.conector]?.trim();
  if (conectorDela && conectorDela === credencial.conectorId)
    throw new ErroConfigHub('Recusado: o Conector do tenant-teste é o mesmo da thathyany.');
  const presentes = Object.keys(env).filter((k) => ehVariavelDaThathyany(k) && env[k] !== undefined);
  if (presentes.length)
    throw new ErroConfigHub(
      `Recusado: o perfil tenant-teste não roda com variável da thathyany no ambiente (${presentes.sort().join(', ')}).`,
    );
}

/** Lista de entidades na ordem do ERP; só entidades que o ERP alimenta, sem repetição. */
function lerEntidades(valor: string | undefined): EntidadeHub[] | null {
  if (valor === undefined || valor.trim() === '') return null;
  const pedidas = valor
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (new Set(pedidas).size !== pedidas.length)
    throw new ErroConfigHub('MACUXI_HUB_ENTIDADES repete uma entidade.');
  for (const e of pedidas) {
    if (!(ORDEM_DO_ERP as readonly string[]).includes(e))
      throw new ErroConfigHub(`MACUXI_HUB_ENTIDADES: "${e.slice(0, 40)}" não é entidade que o ERP alimenta.`);
  }
  return ORDEM_DO_ERP.filter((e) => pedidas.includes(e));
}

function lerLimiteLote(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === '') return LIMITE_LOTE_SEGURO_PADRAO;
  const n = Number(valor);
  if (!/^\d+$/.test(valor.trim()) || !Number.isInteger(n) || n < 1 || n > LIMITE_LOTE_SEGURO_MAXIMO) {
    throw new ErroConfigHub(
      `MACUXI_HUB_LIMITE_LOTE deve ser um inteiro de 1 a ${LIMITE_LOTE_SEGURO_MAXIMO} (lotes pequenos).`,
    );
  }
  return n;
}

function validarUrl(bruta: string): string {
  let u: URL;
  try {
    u = new URL(bruta);
  } catch {
    throw new ErroConfigHub('MACUXI_HUB_URL não é uma URL válida.');
  }
  if (u.protocol !== 'https:') throw new ErroConfigHub('MACUXI_HUB_URL tem de ser https com o alvo real.');
  if (u.username || u.password || u.search || u.hash)
    throw new ErroConfigHub('MACUXI_HUB_URL não pode ter usuário, senha, consulta nem fragmento.');
  if (u.hostname === 'localhost' || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) {
    throw new ErroConfigHub('MACUXI_HUB_URL do alvo real tem de ser um nome de host, não localhost nem IP.');
  }
  const caminho = u.pathname.replace(/\/+$/, '');
  if (!caminho.endsWith('/integracao/v1'))
    throw new ErroConfigHub('MACUXI_HUB_URL tem de terminar em /integracao/v1.');
  return `${u.origin}${caminho}`;
}

export function lerConfigHub(env: Ambiente = process.env): ConfigHub {
  const alvo = env.MACUXI_HUB_ALVO?.trim() || 'duble';
  const versaoErp = env.MACUXIERP_VERSAO?.trim() || 'dev';
  const ladoErp = lerLado(env.MACUXI_HUB_LADO_ERP?.trim());
  if (alvo === 'duble')
    return { alvo, modoCarga: lerModo(env.MACUXI_HUB_MODO_CARGA, 'completo'), versaoErp, ladoErp };
  if (alvo !== 'real') throw new ErroConfigHub('MACUXI_HUB_ALVO deve ser "duble" ou "real".');

  const perfil = lerPerfil(env.MACUXI_HUB_PERFIL?.trim());
  const url = validarUrl(env.MACUXI_HUB_URL?.trim() || URL_HUB_PADRAO);
  const credencial = lerCredencial(env, perfil);
  const tenant = env.MACUXI_HUB_TENANT?.trim() ?? '';
  if (!tenant) throw new ErroConfigHub('MACUXI_HUB_TENANT ausente: declare o nome do tenant do FDV.');
  const entidades = lerEntidades(env.MACUXI_HUB_ENTIDADES);
  const base = { alvo: 'real' as const, url, credencial, tenant, versaoErp, ladoErp };

  if (perfil === 'tenant-teste') {
    if (env.MACUXI_HUB_TENANT_TESTE !== '1') {
      throw new ErroConfigHub(
        'MACUXI_HUB_TENANT_TESTE=1 é obrigatório no perfil tenant-teste: confirme que a chave é de um tenant de TESTE do FDV.',
      );
    }
    recusarThathyanyNoTenantTeste(env, credencial);
    if ([tenant, credencial.conectorId, url].some(citaThathyany)) {
      throw new ErroConfigHub(
        'Recusado: o perfil tenant-teste nunca vai ao tenant da thathyany. Para ela, só o perfil thathyany-seguro.',
      );
    }
    return {
      ...base,
      perfil,
      modoCarga: lerModo(env.MACUXI_HUB_MODO_CARGA, 'delta'),
      entidades: entidades ?? ORDEM_DO_ERP,
    };
  }

  // thathyany-seguro (decisão de 23h12): Conector novo sem pedidos, dados idênticos aos do kit, delta, lotes pequenos.
  if (!citaThathyany(tenant))
    throw new ErroConfigHub(
      'O perfil thathyany-seguro é só para o tenant da thathyany; para outro tenant use tenant-teste.',
    );
  if (env.MACUXI_HUB_TENANT_TESTE === '1')
    throw new ErroConfigHub(
      'MACUXI_HUB_TENANT_TESTE=1 contradiz o perfil thathyany-seguro: a thathyany não é tenant de teste.',
    );
  if (ladoErp !== 'conector')
    throw new ErroConfigHub(
      'O perfil thathyany-seguro só usa o lado conector (o código do ERP); o emissor-minimo do arnês é recusado.',
    );
  if (env.MACUXI_HUB_RECEBE_PEDIDOS !== '0') {
    throw new ErroConfigHub(
      'MACUXI_HUB_RECEBE_PEDIDOS=0 é obrigatório no perfil thathyany-seguro: o Conector do ERP é novo e sem "recebe pedidos" (receber pedidos é a virada, T-0027).',
    );
  }
  const modoCarga = lerModo(env.MACUXI_HUB_MODO_CARGA, 'delta');
  if (modoCarga !== 'delta')
    throw new ErroConfigHub(
      'O perfil thathyany-seguro só envia delta: a carga completa pode inativar no FDV o que não veio.',
    );
  if (!entidades)
    throw new ErroConfigHub(
      'MACUXI_HUB_ENTIDADES é obrigatória no perfil thathyany-seguro: só as entidades já viradas para o Conector do ERP.',
    );
  const limiteLote = lerLimiteLote(env.MACUXI_HUB_LIMITE_LOTE);
  let massaKit: MassaKit;
  try {
    massaKit = lerMassaKit(env.MACUXI_HUB_MASSA_KIT?.trim() ?? '');
  } catch (e) {
    if (e instanceof ErroMassaKit) throw new ErroConfigHub(e.message);
    throw e;
  }
  const semDados = entidades.filter((e) => !massaKit.registros[e]?.length);
  if (semDados.length)
    throw new ErroConfigHub(
      `A massa do kit não tem registros de: ${semDados.join(', ')}. Nada é inventado no perfil thathyany-seguro.`,
    );
  return { ...base, perfil, modoCarga, recebePedidos: false, limiteLote, massaKit, entidades };
}
