/**
 * Expurgo diário do pré-cadastro recusado (RN-INF-06, LGPD; decisão do Alexandre de 24/11/2026): 180 dias depois da última
 * recusa o payload (e a razão social e o documento mascarado) é apagado; ficam os códigos (external_id, cliente_uuid, revisão),
 * os códigos de erro e as contagens. A regra e a auditoria (só as contagens) estão na função do banco
 * `integracao_fdv.expurgar_pre_cadastro(p_corte)` (recusado e sem decisão); esta rotina só calcula o corte (`corteDoExpurgoPreCadastro`) e a
 * chama em cada tenant, na transação dele. O registro da rotina diária no `apps/worker` é do engenheiro-software
 * (`ROTINA_EXPURGO_PRE_CADASTRO`, `horaUtc` ao gosto dele; a função é idempotente). Roda mesmo sem licença do módulo: o prazo da
 * LGPD não depende do contrato.
 */
import type { Banco, Relogio, Transacao } from '@macuxierp/platform-sdk';
import { corteDoExpurgoPreCadastro } from '../domain';

export const ROTINA_EXPURGO_PRE_CADASTRO = 'integracao-fdv.expurgo-pre-cadastro';

export interface DepsExpurgoPreCadastro {
  banco: Pick<Banco, 'comTenant' | 'semTenant'>;
  /** Tenants ativos (`FonteTenants.ativos` do core, em `semTenant`). */
  tenantsAtivos(tx: Transacao): Promise<string[]>;
  relogio: Relogio;
  /** Só contagens, `tenant_id` e o nome do erro: nunca payload, nome nem documento. */
  log: { info(obj: Record<string, unknown>, msg: string): void; warn(obj: Record<string, unknown>, msg: string): void };
}

/** Só contagens (cabe no `RotinaDiaria.executar` do worker). `revisoes` e `pre_cadastros` somam as duas situações. */
export interface ResumoExpurgoPreCadastro extends Record<string, number> {
  tenants: number;
  falhas: number;
  revisoes: number;
  pre_cadastros: number;
  recusado_revisoes: number;
  recusado_pre_cadastros: number;
  sem_decisao_revisoes: number;
  sem_decisao_pre_cadastros: number;
}

type Contagem = { revisoes?: unknown; pre_cadastros?: unknown } | undefined;
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * A falha de um tenant não para os outros (conta em `falhas`); a falha da lista de tenants sobe. Chama
 * `integracao_fdv.expurgar_pre_cadastro(p_corte)`, que devolve `{recusado, sem_decisao}`.
 */
export async function expurgarPreCadastro(d: DepsExpurgoPreCadastro): Promise<ResumoExpurgoPreCadastro> {
  const corte = corteDoExpurgoPreCadastro(d.relogio.agora());
  const r: ResumoExpurgoPreCadastro = { tenants: 0, falhas: 0, revisoes: 0, pre_cadastros: 0, recusado_revisoes: 0, recusado_pre_cadastros: 0, sem_decisao_revisoes: 0, sem_decisao_pre_cadastros: 0 };
  for (const tenant of await d.banco.semTenant((tx) => d.tenantsAtivos(tx))) {
    r.tenants++;
    try {
      const [linha] = await d.banco.comTenant(tenant, (tx) => tx.consultar<{ r: { recusado?: Contagem; sem_decisao?: Contagem } | null }>('SELECT integracao_fdv.expurgar_pre_cadastro($1::timestamptz) AS r', [corte]));
      const c = { rr: num(linha?.r?.recusado?.revisoes), rp: num(linha?.r?.recusado?.pre_cadastros), sr: num(linha?.r?.sem_decisao?.revisoes), sp: num(linha?.r?.sem_decisao?.pre_cadastros) };
      r.recusado_revisoes += c.rr;
      r.recusado_pre_cadastros += c.rp;
      r.sem_decisao_revisoes += c.sr;
      r.sem_decisao_pre_cadastros += c.sp;
      r.revisoes += c.rr + c.sr;
      r.pre_cadastros += c.rp + c.sp;
      if (c.rr + c.sr > 0) {
        d.log.info(
          { tenant_id: tenant, modulo: 'integracao-fdv', rotina: ROTINA_EXPURGO_PRE_CADASTRO, regra: 'RN-INF-06', recusado: { revisoes: c.rr, pre_cadastros: c.rp }, sem_decisao: { revisoes: c.sr, pre_cadastros: c.sp } },
          'pré-cadastro expurgado',
        );
      }
    } catch (e) {
      r.falhas++;
      d.log.warn({ tenant_id: tenant, modulo: 'integracao-fdv', rotina: ROTINA_EXPURGO_PRE_CADASTRO, erro: e instanceof Error ? e.name : 'erro' }, 'expurgo do pré-cadastro falhou no tenant');
    }
  }
  return r;
}
