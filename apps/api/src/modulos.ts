/**
 * Registro dos módulos montados na API (T-0029) e dependências de produção numa função só (T-0042, achado A-06 da
 * T-0008). Desenho e regras: `docs/desenho/T-0002.md` (§2, "Integração de plataforma da F1", item "Registro dos módulos").
 */
import { criarPluginCadastros, fontesHttp, repositoriosSql, type Dependencias as DependenciasCadastros, type PortaCertificados } from '@macuxierp/cadastros/api';
import {
  avisosA1MaisRecentes,
  criarPluginCore,
  criarPortaA1,
  LeitorPfxTls,
  RepositorioCoreSql,
  type DependenciasCore,
  type RepositorioCore,
} from '@macuxierp/core/api';
import { manifest as faturamento } from '@macuxierp/faturamento/manifest';
import { manifest as fiscal } from '@macuxierp/fiscal/manifest';
import { manifest as integracaoFdv } from '@macuxierp/integracao-fdv/manifest';
import { manifest as pedido } from '@macuxierp/pedido/manifest';
import { armazenamentoIndisponivel, definirPlugin, MODULOS, relogioDoSistema, type Banco, type ManifestoModulo, type PluginModulo } from '@macuxierp/platform-sdk';
import { AuditoriaPg, FilaDeTrabalhosPg, IdempotenciaPg, LicencasPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
import type { DependenciasApp } from './app';
import { RepositorioAuthPg } from './auth/repositorio-pg';
import { gerarHashSenha } from './auth/senha';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import type { ConfigApi } from './config';

/** @deprecated use o de @macuxierp/platform-sdk */
export { armazenamentoIndisponivel } from '@macuxierp/platform-sdk';

export type EntradaModulo = PluginModulo | ManifestoModulo;

export class RegistroModulosInvalido extends Error {
  override readonly name = 'RegistroModulosInvalido';
}

const ehPlugin = (e: EntradaModulo): e is PluginModulo => 'manifesto' in e;

export function registrarModulos(entradas: readonly EntradaModulo[]): readonly PluginModulo[] {
  const porId = new Map<string, PluginModulo>();
  for (const e of entradas) {
    const plugin = ehPlugin(e) ? e : definirPlugin(e, []);
    const id = plugin.manifesto.id;
    if (!(MODULOS as readonly string[]).includes(id)) throw new RegistroModulosInvalido(`módulo "${id}" fora da v1`);
    if (porId.has(id)) throw new RegistroModulosInvalido(`módulo "${id}" montado duas vezes`);
    porId.set(id, plugin);
  }
  for (const p of porId.values()) {
    const falta = p.manifesto.depende.filter((dep) => !porId.has(dep));
    if (falta.length) throw new RegistroModulosInvalido(`${p.manifesto.id} depende de ${falta.join(', ')}, que não está montado`);
  }
  return Object.freeze(MODULOS.flatMap((id) => porId.get(id) ?? []));
}

/** Módulos da F1 ainda sem rotas: só o manifesto (menus do `/eu`). */
const SEM_ROTAS: readonly ManifestoModulo[] = [pedido, fiscal, faturamento, integracaoFdv];

/** A1 válido da filial para o cadastros (consulta de IE, RN-CORE-06), pela porta pública do core, na transação da rota. */
export function certificadosDoCore(repo: RepositorioCore): PortaCertificados {
  return {
    async filialTemA1Valido(tx, filialId, agora) {
      const porta = criarPortaA1({ repo, noTenant: (fn) => fn(tx), agora: () => agora });
      return (await porta.a1ValidoDaFilial(filialId)).valido;
    },
  };
}

export interface DependenciasModulos {
  core: DependenciasCore;
  /** Padrão: adaptador SQL, fontes HTTP reais e o A1 pela porta do core. Os testes trocam o que precisarem. */
  cadastros?: Partial<DependenciasCadastros>;
}

export function montarModulos(d: DependenciasModulos): readonly PluginModulo[] {
  const cadastros = criarPluginCadastros({
    repositorios: d.cadastros?.repositorios ?? repositoriosSql,
    fontes: d.cadastros?.fontes ?? fontesHttp(),
    certificados: d.cadastros?.certificados ?? certificadosDoCore(d.core.repo),
  });
  return registrarModulos([criarPluginCore(d.core), cadastros, ...SEM_ROTAS]);
}

export interface EntradaProducao {
  /** `BancoPg` sobre o pool da API, no papel `macuxierp_app` (o `main.ts` confere o papel antes). */
  banco: Banco;
  /** Chave mestra do A1 (ADR 0005), lida do secret do servidor; nunca vai para log. */
  chaveA1: Buffer;
  config: Pick<ConfigApi, 'versao' | 'jwtSegredo' | 'cookieSeguro'>;
}

/**
 * Dependências de produção da API (T-0042, achado A-06 da T-0008): adaptadores PostgreSQL da plataforma, auth em SQL,
 * argon2id, relógio do sistema, selo do A1 do core e os módulos com os adaptadores reais (`RepositorioCoreSql`,
 * `LeitorPfxTls`, armazenamento indisponível até a T-0024; cadastros com os padrões do `montarModulos`). O `main.ts` e
 * os testes de ponta a ponta usam esta mesma função: o que muda num muda no outro.
 */
export function montarDependenciasProducao(e: EntradaProducao): DependenciasApp {
  return {
    versao: e.config.versao,
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: e.config.jwtSegredo },
    cookieSeguro: e.config.cookieSeguro,
    banco: e.banco,
    repoAuth: new RepositorioAuthPg(),
    licencas: new LicencasPg(),
    outbox: new OutboxPg(),
    auditoria: new AuditoriaPg(),
    trabalhos: new FilaDeTrabalhosPg(),
    idempotencia: new IdempotenciaPg(),
    relogio: relogioDoSistema,
    avisosA1: avisosA1MaisRecentes,
    modulos: montarModulos({
      core: { repo: new RepositorioCoreSql(), hashSenha: (senha) => gerarHashSenha(senha), leitorPfx: new LeitorPfxTls(), chaveA1: e.chaveA1, armazenamento: armazenamentoIndisponivel },
    }),
  };
}
