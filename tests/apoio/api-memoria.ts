/**
 * T-0008: a API real (`criarApp` do apps/api) com os módulos montados pelo `montarModulos` de produção
 * (`apps/api/src/modulos.ts`, o mesmo que o `main.ts` chama, PR #19): os seis da v1, core e cadastros com rotas, os
 * outros só com o manifesto. Só os adaptadores trocam: repositórios em memória no lugar do SQL, nenhuma fonte HTTP e a
 * porta do A1 do cadastros em memória. O mesmo encaixe com os adaptadores SQL de verdade (os do `main.ts`) está em
 * `tests/apoio/api-pg.ts`.
 * O token de acesso é emitido direto (`emitirTokenAcesso`), sem passar pelo login, para testar qualquer perfil e tenant.
 */
import { randomBytes } from 'node:crypto';
import { afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { ArmazenamentoMemoria, type Licenca, type Perfil, type PluginModulo, type Sessao } from '../../packages/platform-sdk/src/index';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, OutboxMemoria, RelogioFixo } from '../../packages/platform-sdk/src/testes';
import { criarApp } from '../../apps/api/src/app';
import { emitirTokenAcesso } from '../../apps/api/src/auth/jwt';
import { RepositorioAuthMemoria } from '../../apps/api/src/auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from '../../apps/api/src/auth/servico';
import { montarModulos } from '../../apps/api/src/modulos';
import type { Fontes } from '../../modules/cadastros/api/index';
import { dependenciasEmMemoria } from '../../modules/cadastros/api/memoria';
import { lerChaveA1 } from '../../modules/core/api/cifra';
import type { DadosPfx, LeitorPfx } from '../../modules/core/api/portas';
import { PfxInvalido } from '../../modules/core/api/portas';
import { RepositorioCoreMemoria } from '../../modules/core/api/repositorio-memoria';

export const SEGREDO_JWT = 'segredo-de-teste-t0008-com-mais-de-32-caracteres';
export const INICIO = new Date('2026-11-21T15:00:00Z');
export const TENANT_A = 'a0000000-0000-4000-8000-00000000000a';
export const TENANT_B = 'b0000000-0000-4000-8000-00000000000b';
export const ADM_A = 'a1111111-1111-4111-8111-111111111111';
export const FILIAL_A = 'af111111-1111-4111-8111-111111111111';
export const CNPJ_EMPRESA = '11222333000181';

/** Leitor de .pfx de mentira: devolve o que o teste mandar, ou recusa (senha errada). */
export class LeitorPfxFalso implements LeitorPfx {
  dados: DadosPfx | null = null;
  async abrir(): Promise<DadosPfx> {
    if (!this.dados) throw new PfxInvalido('pfx de teste recusado');
    return this.dados;
  }
}

export interface OpcoesApi {
  /** Licenças do tenant (padrão: cadastros ativo). O core é base e não precisa de linha. */
  licencas?: Licenca[];
  /** Captura as linhas do log do pino (RN-CORE-07). */
  logs?: string[];
  /** Fontes externas de CNPJ e CEP (RN-CAD-05); padrão: nenhuma. */
  fontes?: Fontes;
}

export async function montarApiMemoria(o: OpcoesApi = {}) {
  const banco = new BancoMemoria();
  const relogio = new RelogioFixo(INICIO);
  const outbox = new OutboxMemoria();
  const auditoria = new AuditoriaMemoria();
  const trabalhos = new FilaDeTrabalhosMemoria();
  const repoAuth = new RepositorioAuthMemoria();
  repoAuth.tenants.push({ id: TENANT_A, slug: 'loja-a', razao_social: 'Loja A Ltda', fuso: 'America/Manaus', situacao: 'ativo' });

  const repoCore = new RepositorioCoreMemoria();
  repoCore.empresaLinha = { id: TENANT_A, razao_social: 'Loja A Ltda', nome_fantasia: null, cnpj: CNPJ_EMPRESA, ie: null, fuso: 'America/Manaus', updated_at: INICIO };
  repoCore.usuarios.push({ id: ADM_A, nome: 'Administração A', email: 'adm@loja-a.teste', perfil: 'administrador', filial_ids: [FILIAL_A], ativo: true, external_id: null, ultimo_acesso_em: null, updated_at: INICIO, senha_hash: 'h' });
  const leitorPfx = new LeitorPfxFalso();
  let seq = 0;
  const cad = dependenciasEmMemoria(o.fontes ? { fontes: o.fontes } : {});
  const modulos = montarModulos({
    core: {
      repo: repoCore,
      hashSenha: async (s) => `$argon2id$teste$${s.length}`,
      leitorPfx,
      chaveA1: lerChaveA1(randomBytes(32).toString('hex')),
      armazenamento: new ArmazenamentoMemoria(),
      novoId: () => `c0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    },
    cadastros: cad.deps,
  });
  const plugin = (id: string): PluginModulo => modulos.find((m) => m.manifesto.id === id)!;
  const core = plugin('core');
  const cadastros = plugin('cadastros');

  const licencas = o.licencas ?? [{ modulo: 'cadastros', ativo: true, valido_ate: null }];
  const logs = o.logs;
  const app = await criarApp({
    versao: 't0008',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: SEGREDO_JWT },
    cookieSeguro: true,
    banco,
    repoAuth,
    licencas: { ler: async () => licencas },
    outbox,
    auditoria,
    trabalhos,
    relogio,
    modulos,
    logger: logs ? { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) } : false,
  });

  /** Cabeçalho Authorization de uma sessão do perfil pedido (tenant A por padrão). */
  const auth = (perfil: Perfil = 'administrador', tenant = TENANT_A, usuario = ADM_A): Record<string, string> => {
    const s: Sessao = { usuario_id: usuario, tenant_id: tenant, perfil, filial_ids: [FILIAL_A] };
    return { authorization: `Bearer ${emitirTokenAcesso(s, SEGREDO_JWT, relogio.agora(), 900).token}` };
  };

  return { app, banco, relogio, outbox, auditoria, trabalhos, repoCore, leitorPfx, cad, modulos, plugins: { core, cadastros }, auth };
}

export type ApiMemoria = Awaited<ReturnType<typeof montarApiMemoria>>;

/**
 * Registra o afterEach que fecha os apps abertos no teste e devolve `api(o)`, que monta a API em memória.
 * Chame uma vez no topo do arquivo de teste.
 */
export function usarApiMemoria(): (o?: OpcoesApi) => Promise<ApiMemoria> {
  const abertas: ApiMemoria[] = [];
  afterEach(async () => {
    await Promise.all(abertas.splice(0).map((a) => a.app.close()));
  });
  return async (o?: OpcoesApi) => {
    const a = await montarApiMemoria(o);
    abertas.push(a);
    return a;
  };
}
