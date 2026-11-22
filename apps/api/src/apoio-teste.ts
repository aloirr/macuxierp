/**
 * Apoio dos testes da API: core e cadastros montados de verdade (`montarModulos`), com repositórios dublês. Método do
 * repositório que o teste não preparou lança na hora (o teste diz o que usa).
 */
import { randomBytes } from 'node:crypto';
import type { Dependencias as DependenciasCadastros, Repositorios } from '@macuxierp/cadastros/api';
import type { DependenciasCore, RepositorioCore } from '@macuxierp/core/api';
import { ArmazenamentoMemoria, type PluginModulo } from '@macuxierp/platform-sdk';
import { montarModulos } from './modulos';

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
