/**
 * Registro dos módulos montados na API (T-0029) e dependências de produção numa função só (T-0042, achado A-06 da
 * T-0008). Desenho e regras: `docs/desenho/T-0002.md` (§2, "Integração de plataforma da F1", item "Registro dos módulos").
 */
import {
  criarConsultaParaFaturamento,
  criarConsultaParaFiscal,
  criarConsultaParaPedido,
  criarPluginCadastros,
  fontesHttp,
  repositoriosSql,
  type Dependencias as DependenciasCadastros,
  type PortaCertificados,
} from '@macuxierp/cadastros/api';
import {
  avisosA1MaisRecentes,
  criarPluginCore,
  criarPortaA1,
  LeitorPfxTls,
  RepositorioCoreSql,
  type DependenciasCore,
  type RepositorioCore,
} from '@macuxierp/core/api';
import {
  consultaTitulosPedido,
  criarPluginFaturamento,
  repositoriosSql as repositoriosFaturamento,
  type ConsultaA1Ativo,
  type DependenciasFaturamento,
  type LogFaturamento,
} from '@macuxierp/faturamento/api';
import { criarCalculoFiscal } from '@macuxierp/fiscal/api';
import { manifest as fiscal } from '@macuxierp/fiscal/manifest';
import { criarPluginIntegracaoFdv, type DependenciasRotas as DependenciasIntegracaoFdv } from '@macuxierp/integracao-fdv/api';
import { criarEmissorNFe } from '@macuxierp/nfe-emissor';
import {
  criarConsultaParaFaturar,
  criarPluginPedido,
  dependenciasDeProducao as dependenciasPedido,
  type Dependencias as DependenciasPedido,
  type LogPedido,
} from '@macuxierp/pedido/api';
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

/** Módulos ainda sem rotas: só o manifesto (menus do `/eu`). O faturamento tem rotas desde a T-0045 (lote A). */
const SEM_ROTAS: readonly ManifestoModulo[] = [fiscal];

/** A1 válido da filial para o cadastros (consulta de IE, RN-CORE-06), pela porta pública do core, na transação da rota. */
export function certificadosDoCore(repo: RepositorioCore): PortaCertificados {
  return {
    async filialTemA1Valido(tx, filialId, agora) {
      const porta = criarPortaA1({ repo, noTenant: (fn) => fn(tx), agora: () => agora });
      return (await porta.a1ValidoDaFilial(filialId)).valido;
    },
  };
}

/**
 * `ConsultaA1Ativo` do faturamento (RN-CORE-06) sobre a porta pública do core, na transação da rota (`noTenant: fn => fn(tx)`).
 * Só o veredito sobre os metadados (`valido_de`, `valido_ate`, `ativo`): a API nunca decifra o A1 (ADR 0005 item 4).
 */
export function a1AtivoDoCore(repo: RepositorioCore, agora?: () => Date): ConsultaA1Ativo {
  return {
    temA1Ativo: (tx, filial_id) => criarPortaA1({ repo, noTenant: (fn) => fn(tx), ...(agora ? { agora } : {}) }).a1ValidoDaFilial(filial_id),
  };
}

/**
 * RN-FAT-04 e regra 7: emissão (e reenvio) em filial de PRODUÇÃO fiscal recusada com 422 antes de reservar o número, até a T-0046 (transporte
 * real homologado). Constante de propósito, sem variável de ambiente: ligar a produção é mudança de código, por PR, na T-0046.
 */
export const EMISSAO_PRODUCAO_HABILITADA = false;

/** Sem log (testes que não passam um): descarta. Em produção o `main.ts` passa o pino da API. */
const SEM_LOG: LogPedido = { info: () => undefined, warn: () => undefined };

/**
 * `LogFaturamento` sobre o log da API: uma linha `warn` por ocorrência (geração de título pendente, leitura da bandeira que falhou), com
 * `modulo` e só o que o faturamento manda (ids, códigos e motivo de regra; nunca dado pessoal, regra 8).
 */
export function logFaturamentoDe(log: LogPedido = SEM_LOG): LogFaturamento {
  return (e) => log.warn({ modulo: 'faturamento', ...e }, e.evento);
}

/**
 * Dependências de produção do faturamento na API (README do faturamento, "O que o apps/api e o apps/worker ligam"): repositórios SQL, a
 * consulta do pedido, a de cadastros (#165), o cálculo do fiscal (emitente pela `criarConsultaParaFiscal` do cadastros, #189), o emissor
 * só para `montar` e o veredito do A1 pelo core. SEM `lerA1` e sem assinatura: o tipo `DependenciasFaturamento` não os aceita (ADR 0005
 * item 4); quem assina é o worker.
 */
function dependenciasFaturamento(o: {
  repos: ReturnType<typeof repositoriosFaturamento>;
  repoCore: RepositorioCore;
  repositoriosCadastros: DependenciasCadastros['repositorios'];
  log?: LogPedido;
}): DependenciasFaturamento {
  const { repos } = o;
  const cadastros = criarConsultaParaFaturamento(o.repositoriosCadastros);
  return {
    emissor: criarEmissorNFe(),
    pedidos: repos.pedidos,
    situacao: criarConsultaParaFaturar(),
    cadastros,
    calculo: criarCalculoFiscal({ emitentes: criarConsultaParaFiscal(o.repositoriosCadastros) }),
    ambiente: repos.ambiente,
    notas: repos.notas,
    eventos: repos.eventos,
    certificado: a1AtivoDoCore(o.repoCore),
    titulos: repos.titulos,
    configuracao: repos.configuracao,
    contingencia: repos.contingencia,
    log: logFaturamentoDe(o.log),
    emissaoProducaoHabilitada: EMISSAO_PRODUCAO_HABILITADA,
  };
}

export interface DependenciasModulos {
  core: DependenciasCore;
  /** Padrão: adaptador SQL, fontes HTTP reais e o A1 pela porta do core. Os testes trocam o que precisarem. */
  cadastros?: Partial<DependenciasCadastros>;
  /**
   * Padrão (T-0016, R-20261121-234202): `dependenciasDeProducao` do pedido (adaptador SQL, com a nota em aberto e os títulos
   * do faturamento) sobre a `criarConsultaParaPedido` do cadastros com os mesmos repositórios do cadastros.
   */
  pedido?: Partial<DependenciasPedido>;
  /** Rotas do BKO do conector (T-0011). Padrão: sem chave mestra (ver `EntradaProducao.chaveIntegracao`). */
  integracaoFdv?: DependenciasIntegracaoFdv;
  /** Padrão: `dependenciasFaturamento` (SQL, cadastros, fiscal, emissor e o A1 pelo core). Os testes trocam o que precisarem. */
  faturamento?: Partial<DependenciasFaturamento>;
  /** Log dos módulos que recebem um (pedido e faturamento): o pino da API. Só ids e códigos (regra 8). Sem ele, o módulo não loga. */
  log?: LogPedido;
}

export function montarModulos(d: DependenciasModulos): readonly PluginModulo[] {
  const repositoriosCadastros = d.cadastros?.repositorios ?? repositoriosSql;
  const cadastros = criarPluginCadastros({
    repositorios: repositoriosCadastros,
    fontes: d.cadastros?.fontes ?? fontesHttp(),
    certificados: d.cadastros?.certificados ?? certificadosDoCore(d.core.repo),
  });
  const reposFaturamento = repositoriosFaturamento({ outbox: new OutboxPg() });
  const faturamento = { ...dependenciasFaturamento({ repos: reposFaturamento, repoCore: d.core.repo, repositoriosCadastros, ...(d.log ? { log: d.log } : {}) }), ...d.faturamento };
  // P-2: nota em aberto bloqueia o cancelamento do pedido (a porta inversa vem do faturamento, `notaEmAbertoSql`). RN-PED-04: o saldo
  // aberto do cliente vem dos títulos do faturamento (produção ou `conta_como_real`, titulos.md).
  // RN-PED-02 (#210, #222): a porta do faturamento entrega também `notasAutorizadas`, usada pelo pedido sem ler tabela de outro schema.
  const pedido = criarPluginPedido({
    ...dependenciasPedido(criarConsultaParaPedido(repositoriosCadastros), {
      notas: reposFaturamento.notaEmAberto,
      titulos: consultaTitulosPedido(reposFaturamento.titulos),
      ...(d.log ? { log: d.log } : {}),
    }),
    ...d.pedido,
  });
  const integracaoFdv = criarPluginIntegracaoFdv(d.integracaoFdv ?? { chaveMestra: null });
  return registrarModulos([criarPluginCore(d.core), cadastros, pedido, criarPluginFaturamento(faturamento), integracaoFdv, ...SEM_ROTAS]);
}

export interface EntradaProducao {
  /** `BancoPg` sobre o pool da API, no papel `macuxierp_app` (o `main.ts` confere o papel antes). */
  banco: Banco;
  /** Chave mestra do A1 (ADR 0005), lida do secret do servidor; nunca vai para log. */
  chaveA1: Buffer;
  /**
   * Chave mestra das credenciais do conector (`MACUXIERP_CHAVE_INTEGRACAO`, versão 1), lida pelo `lerConfigApi`; nunca vai para
   * log. `null` ou ausente = variável não configurada: só o `PUT /v1/integracao-fdv/credencial` fica indisponível (503).
   */
  chaveIntegracao?: Buffer | null;
  config: Pick<ConfigApi, 'versao' | 'jwtSegredo' | 'cookieSeguro'>;
  /** Pino da API para o log dos módulos (o `main.ts` cria; os testes passam um com destino em memória). */
  log?: LogPedido;
}

/**
 * Dependências de produção da API (T-0042, achado A-06 da T-0008): adaptadores PostgreSQL da plataforma, auth em SQL,
 * argon2id, relógio do sistema, selo do A1 do core e os módulos com os adaptadores reais (`RepositorioCoreSql`,
 * `LeitorPfxTls`, armazenamento indisponível até a T-0024; cadastros e pedido com os padrões do `montarModulos`; integração FDV
 * com a chave do conector, T-0011). O `main.ts` e
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
      integracaoFdv: { chaveMestra: e.chaveIntegracao ?? null },
      ...(e.log ? { log: e.log } : {}),
    }),
  };
}
