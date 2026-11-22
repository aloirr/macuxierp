/**
 * T-0012: monta o alvo dos cenários a partir da configuração (`config.ts`): o dublê em processo (padrão) ou o tenant real
 * do FDV, num dos perfis (`tenant-teste` ou `thathyany-seguro`). Os cenários recebem o mesmo `Alvo` nos dois casos; só o
 * dublê expõe a inspeção (`duble`). No dublê, `topologiaDuble` monta "como na thathyany hoje" (o kit dono de tudo) ou
 * uma virada parcial (o kit sem as entidades do ERP).
 */
import { CredencialHub, type ConfigHub } from './config';
import { criarDubleHub, type DubleHub, type OpcoesDuble } from './duble-hub';
import { criarAdaptadorConector } from './adaptador-conector';
import { criarEmissorMinimo } from './emissor-minimo';
import type { EntidadeHub } from './contrato-hub';
import type { EventoLog, LadoErp, NomeLadoErp } from './lado-erp';
import { RelogioDeTeste, relogioReal, type Relogio } from './relogio';

export const TENANT_DUBLE = 'tenant-teste-duble';
export const CONECTOR_DUBLE = 'macuxierp-t0012';
/** O Conector do kit da thathyany, simulado no dublê (o dono das entidades antes da virada). */
export const CONECTOR_KIT_DUBLE = 'kit-thathyany-duble';

export interface Alvo {
  tipo: ConfigHub['alvo'];
  config: ConfigHub;
  /** Nome do tenant (no real, o declarado em MACUXI_HUB_TENANT). */
  tenant: string;
  relogio: Relogio;
  /** Só com o dublê: inspeção do estado e das requisições. */
  duble: DubleHub | null;
  relogioDeTeste: RelogioDeTeste | null;
  credencial: CredencialHub;
  url: string;
  /** Tudo o que o lado ERP registrou em log nesta execução. */
  logs: EventoLog[];
  /** Adaptador do lado ERP (padrão: o da configuração); `limiteRegistros` = registros por lote. */
  criarLadoErp(nome?: NomeLadoErp, o?: { limiteRegistros?: number }): LadoErp;
  encerrar(): Promise<void>;
}

export interface OpcoesAlvo {
  /** Início do relógio do dublê (o real usa o relógio do sistema). */
  inicioDuble: Date;
  duble?: Omit<OpcoesDuble, 'relogio'>;
  /**
   * Só no dublê: as entidades de cada Conector no tenant (um Conector por entidade). Ausente = o Conector do ERP dono de
   * tudo, sem kit. `kit` é cadastrado antes do ERP; `erp` vazio = o Conector do ERP existe sem nenhuma entidade.
   */
  topologiaDuble?: { kit: readonly EntidadeHub[]; erp: readonly EntidadeHub[] };
}

export async function prepararAlvo(config: ConfigHub, o: OpcoesAlvo): Promise<Alvo> {
  const logs: EventoLog[] = [];
  let duble: DubleHub | null = null;
  let relogioDeTeste: RelogioDeTeste | null = null;
  let relogio: Relogio;
  let credencial: CredencialHub;
  let url: string;
  let tenant: string;
  if (config.alvo === 'duble') {
    relogioDeTeste = new RelogioDeTeste(o.inicioDuble);
    relogio = relogioDeTeste;
    duble = await criarDubleHub({ ...o.duble, relogio });
    const t = o.topologiaDuble;
    if (t)
      duble.registrarConector({ tenant: TENANT_DUBLE, conectorId: CONECTOR_KIT_DUBLE, entidades: t.kit });
    const c = duble.registrarConector({
      tenant: TENANT_DUBLE,
      conectorId: CONECTOR_DUBLE,
      ...(t ? { entidades: t.erp } : {}),
    });
    credencial = new CredencialHub(c.conectorId, c.chave);
    url = duble.url;
    tenant = TENANT_DUBLE;
  } else {
    relogio = relogioReal;
    credencial = config.credencial;
    url = config.url;
    tenant = config.tenant;
  }
  return {
    tipo: config.alvo,
    config,
    tenant,
    relogio,
    duble,
    relogioDeTeste,
    credencial,
    url,
    logs,
    criarLadoErp: (nome = config.ladoErp, x = {}) => {
      const base = {
        url,
        credencial,
        versaoErp: config.versaoErp,
        relogio,
        log: (e: EventoLog) => logs.push(e),
      };
      return nome === 'conector'
        ? criarAdaptadorConector({ ...base, ...x })
        : criarEmissorMinimo({ ...base, ...x });
    },
    encerrar: async () => {
      await duble?.fechar();
    },
  };
}
