/**
 * Ordem de checagem de toda rota (RN-CORE-02; desenho T-0002, seção 2):
 *   sessão (401) → perfil da ação (403 PERFIL_SEM_PERMISSAO) → tenant (transação com RLS) → licença (403 MODULO_INATIVO).
 * A licença é lida dentro da transação do tenant (a RLS de `plataforma.tenant_modulo` só mostra a dele). O tenant só
 * lê a licença; ela muda pelo script do operador (D12).
 */
import type { Banco, Transacao } from './banco';
import { erros } from './erros';
import { MODULOS, type ModuloId, type Perfil } from './modulo';
import { moduloDaAcao, pode, type Acao } from './permissoes';

/** Linha de `plataforma.tenant_modulo`. `valido_ate` nulo = sem prazo. */
export interface Licenca {
  modulo: ModuloId;
  ativo: boolean;
  valido_ate: Date | null;
}

/** O core é a base do tenant (empresa, usuários, licenças): sempre licenciado. */
export const MODULOS_BASE: readonly ModuloId[] = ['core'];

export function moduloLicenciado(licencas: readonly Licenca[], modulo: ModuloId, agora: Date): boolean {
  if (MODULOS_BASE.includes(modulo)) return true;
  return licencas.some(
    (l) => l.modulo === modulo && l.ativo && (l.valido_ate === null || l.valido_ate.getTime() > agora.getTime()),
  );
}

/** Módulos licenciados, na ordem de `MODULOS` (o shell monta o menu por aqui). */
export function modulosLicenciados(licencas: readonly Licenca[], agora: Date): ModuloId[] {
  return MODULOS.filter((m) => moduloLicenciado(licencas, m, agora));
}

/** Sessão autenticada (claims do JWT de acesso). */
export interface Sessao {
  usuario_id: string;
  tenant_id: string;
  perfil: Perfil;
  filial_ids: readonly string[];
}

export interface FonteLicencas {
  ler(tx: Transacao, tenantId: string): Promise<Licenca[]>;
}

/**
 * Licenças e o fuso IANA do tenant (`plataforma.tenant.fuso`) na mesma consulta (T-0042): a API preenche o `fuso` do
 * `ContextoRota` sem ida extra ao banco. `fuso` nulo = tenant invisível na transação (RLS). Adaptador: `LicencasPg`.
 */
export interface FonteLicencasComFuso extends FonteLicencas {
  lerComFuso(tx: Transacao, tenantId: string): Promise<{ licencas: Licenca[]; fuso: string | null }>;
}

export function temFuso(f: FonteLicencas): f is FonteLicencasComFuso {
  return typeof (f as Partial<FonteLicencasComFuso>).lerComFuso === 'function';
}

/**
 * TODOS os tenants de `plataforma.tenant`, inclusive os desativados (roda em `semTenant`), para as rotinas de retenção (LGPD). Mesmo formato da
 * `FonteTenants` do worker (um método `(tx) => ids`). Adaptador: `TodosTenantsPg` (`platform-sdk/pg`).
 */
export interface FonteTodosTenants {
  todos(tx: Transacao): Promise<string[]>;
}

export interface PedidoAutorizacao<R> {
  sessao: Sessao | null;
  /** Ação da rota; `'sessao'` = só exige sessão (ex.: `GET /v1/auth/eu`). */
  acao: Acao | 'sessao';
  agora: Date;
  banco: Banco;
  licencas: FonteLicencas;
  executar: (tx: Transacao, sessao: Sessao) => Promise<R>;
}

/** RN-CORE-02: checa na ordem e só então executa, dentro da transação do tenant. */
export async function executarAutorizado<R>(p: PedidoAutorizacao<R>): Promise<R> {
  const { sessao, acao } = p;
  if (!sessao) throw erros.naoAutenticado();
  if (acao !== 'sessao' && !pode(sessao.perfil, acao)) throw erros.perfilSemPermissao();
  return p.banco.comTenant(sessao.tenant_id, async (tx) => {
    if (acao !== 'sessao') {
      const modulo = moduloDaAcao(acao);
      if (!moduloLicenciado(await p.licencas.ler(tx, sessao.tenant_id), modulo, p.agora)) throw erros.moduloInativo(modulo);
    }
    return p.executar(tx, sessao);
  });
}
