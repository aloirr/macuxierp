/**
 * Apoio dos testes da API: core e cadastros montados de verdade (`montarModulos`), com repositórios dublês. Método do
 * repositório que o teste não preparou lança na hora (o teste diz o que usa).
 * T-0042: `appPgDeTeste` sobe a API no PostgreSQL efêmero com as dependências de produção (`montarDependenciasProducao`);
 * o `tests/` passa a importar este arquivo por caminho relativo (recado ao testes).
 */
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { Dependencias as DependenciasCadastros, Repositorios } from '@macuxierp/cadastros/api';
import { RepositorioCoreSql, type DependenciasCore, type RepositorioCore } from '@macuxierp/core/api';
import { ArmazenamentoMemoria, type PluginModulo, type Relogio } from '@macuxierp/platform-sdk';
import type { BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { criarApp, type DependenciasApp } from './app';
import { gerarHashSenha, type ParametrosArgon2 } from './auth/senha';
import { montarDependenciasProducao, montarModulos } from './modulos';

function duble<T extends object>(nome: string, preparado: Partial<T>): T {
  return new Proxy(preparado, {
    get(alvo, prop) {
      if (prop in alvo) return (alvo as Record<PropertyKey, unknown>)[prop];
      if (prop === 'then') return undefined;
      return () => {
        throw new Error(`dublê ${nome}: ${String(prop)} não preparado no teste`);
      };
    },
  }) as T;
}

export const repoCoreDuble = (preparado: Partial<RepositorioCore> = {}): RepositorioCore => duble('RepositorioCore', preparado);

export function dependenciasCoreDeTeste(repo: RepositorioCore = repoCoreDuble()): DependenciasCore {
  return {
    repo,
    hashSenha: async (s) => `hash-de-teste-${s.length}`,
    leitorPfx: { abrir: async () => Promise.reject(new Error('leitor de .pfx não preparado no teste')) },
    chaveA1: randomBytes(32),
    armazenamento: new ArmazenamentoMemoria(),
  };
}

export function modulosDeTeste(o: { core?: RepositorioCore; cadastros?: Partial<Repositorios>; certificados?: DependenciasCadastros['certificados'] } = {}): readonly PluginModulo[] {
  const repositorios = duble<Repositorios>('Repositorios', o.cadastros ?? {});
  return montarModulos({
    core: dependenciasCoreDeTeste(o.core),
    cadastros: { repositorios: () => repositorios, fontes: { cnpj: [], cep: [] }, ...(o.certificados ? { certificados: o.certificados } : {}) },
  });
}

/** Senha dos usuários de teste e argon2id barato (só teste; produção usa o padrão da OWASP). */
export const SENHA_DE_TESTE = 'senha-de-teste-123';
export const ARGON2_RAPIDO: ParametrosArgon2 = { memoria: 64, passes: 1, paralelismo: 1 };
export const JWT_SEGREDO_DE_TESTE = 'segredo-de-teste-com-mais-de-32-caracteres';

type AdminPg = BancoEfemero['admin'];

/** Filial fictícia (AM, Manaus) no tenant, pela conexão do admin (fora da RLS). */
export async function inserirFilialDeTeste(admin: AdminPg, tenantId: string, f: { id: string; cnpj: string; nome: string }): Promise<void> {
  await admin.query(
    `INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, nome_fantasia, crt, logradouro, numero, bairro,
       municipio_ibge, uf, cep) VALUES ($1, $2, $3, $4, $4, '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000')`,
    [f.id, tenantId, f.cnpj, f.nome],
  );
}

/** Administrador com a `SENHA_DE_TESTE` (hash com `ARGON2_RAPIDO`), pela conexão do admin. */
export async function inserirAdministradorDeTeste(
  admin: AdminPg,
  tenantId: string,
  u: { id: string; email: string; nome: string; filialIds: readonly string[] },
): Promise<void> {
  await admin.query(
    `INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids)
     VALUES ($1, $2, $3, $4, $5, 'administrador', $6::uuid[])`,
    [u.id, tenantId, u.email, u.nome, await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO), u.filialIds],
  );
}

export interface OpcoesAppPg {
  /** Banco efêmero migrado; a API usa `b.banco('macuxierp_app')` (RLS valendo). */
  b: BancoEfemero;
  versao?: string;
  jwtSegredo?: string;
  relogio?: Relogio;
  avisosA1?: DependenciasApp['avisosA1'];
  /**
   * `'teste'` (padrão): core com `RepositorioCoreSql` e armazenamento em memória (`dependenciasCoreDeTeste`), cadastros
   * com os padrões. `'producao'`: exatamente os módulos do `main.ts` (`LeitorPfxTls`, armazenamento indisponível), com
   * chave do A1 aleatória. Ou a lista pronta.
   */
  modulos?: 'teste' | 'producao' | readonly PluginModulo[];
  /** Chave mestra do A1 de teste (ADR 0005) para o modo `'producao'`; padrão aleatória. O teste que a passa a conhece. */
  chaveA1?: Buffer;
  /** Chave mestra do conector de teste (T-0011) para o modo `'producao'`; padrão sem chave (o `PUT /credencial` responde 503). */
  chaveIntegracao?: Buffer | null;
  /** Logger da API (padrão desligado). Os testes de vazamento passam um `stream` em memória. */
  logger?: DependenciasApp['logger'];
}

/**
 * API no PostgreSQL efêmero com as dependências de produção (`montarDependenciasProducao`: adaptadores PG, auth SQL,
 * idempotência, selo do A1), argon2id rápido, cookie seguro e logger desligado. Só a chave do A1 e o segredo do JWT são
 * de teste. Quem chama fecha o `app` antes de remover o banco.
 */
export async function appPgDeTeste(o: OpcoesAppPg): Promise<{ app: FastifyInstance; modulos: readonly PluginModulo[] }> {
  const jwtSegredo = o.jwtSegredo ?? JWT_SEGREDO_DE_TESTE;
  const producao = montarDependenciasProducao({ banco: o.b.banco('macuxierp_app'), chaveA1: o.chaveA1 ?? randomBytes(32), chaveIntegracao: o.chaveIntegracao ?? null, config: { versao: o.versao ?? 'teste', jwtSegredo, cookieSeguro: true } });
  const modulos =
    o.modulos === undefined || o.modulos === 'teste'
      ? montarModulos({ core: dependenciasCoreDeTeste(new RepositorioCoreSql()) })
      : o.modulos === 'producao'
        ? producao.modulos
        : o.modulos;
  const app = await criarApp({
    ...producao,
    auth: { ...producao.auth, argon2: ARGON2_RAPIDO },
    ...(o.relogio ? { relogio: o.relogio } : {}),
    ...(o.avisosA1 ? { avisosA1: o.avisosA1 } : {}),
    modulos,
    logger: o.logger ?? false,
  });
  return { app, modulos };
}

/** Destino do logger do Fastify que guarda cada linha de log em `linhas` (para o teste conferir o que vai para log). */
export function destinoDeLogs(linhas: string[]): Writable {
  return new Writable({
    write(pedaco, _cod, pronto) {
      linhas.push(String(pedaco));
      pronto();
    },
  });
}
