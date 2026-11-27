/**
 * Plugin de plataforma da Integração FDV (portal `/config`, ADR 0013 seções 2 a 5; T-0056): a credencial do conector, a configuração
 * do envio e a operação (carga completa e retomar) saem do BKO do tenant e passam a ser só do superadmin, em `/v1/plataforma`.
 *
 * - Banco: o repositório chama SÓ as funções `integracao_fdv.portal_*` (0038, SECURITY DEFINER; o papel `macuxierp_config` não lê
 *   tabela do módulo). Elas revalidam a sessão do superadmin, travam a empresa alvo e gravam a auditoria na mesma transação.
 * - Regras no domain (`planejarTrocaCredencial`, `validarConfiguracao`, `decidirCargaCompleta`, `decidirRetomar`, `prefixoExibido`);
 *   a função do banco só confere de novo a pré-condição mínima (`MXI03`).
 * - A chave do conector é só de escrita: cifrada aqui (AES-256-GCM, AAD = `:id` da empresa ALVO) e some. Nunca vai a log, resposta,
 *   auditoria, evento nem erro. O módulo não lê variável de ambiente: a apps/api injeta a chave mestra.
 * - Erros do banco: sobem crus para o `erroDaPlataforma` da apps/api (`P0002`→404, `23514`/`MXI04`→422, demais `MXI*`→409). O plugin só devolve o 422
 *   `RN-CORE-02` da conferência prévia por `modulo_licenciado` do `portal_ler` (ADR 0013 seção 2).
 * - O `PUT /credencial` não tem `Idempotency-Key` (o hash do corpo levaria a chave); a troca é idempotente por si e o `p_anterior_id`
 *   recusa a troca baseada em leitura velha (`MXI02`).
 */
import {
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA,
  ConfigurarIntegracaoPlataformaEntrada,
  DefinirCredencialPlataformaEntrada,
  EntidadeEnvioFdv,
  ErroApi,
  IntegracaoFdvPlataforma,
  LogCadastroFdvPlataforma,
  MENSAGEM_SEM_CREDENCIAL_FDV,
  MonitorConectorFdv,
  OrigemEnvioFdv,
  RespostaReprocessarFdv,
  UltimoSinalFdv,
  cifrarCampo,
  definirPluginPlataforma,
  definirRotaPlataforma,
  erros,
  falhaEnvioFdv,
  integracaoFdvLigada,
  type PluginPlataforma,
  type RespostaAceitoFdv,
  type RespostaRetomadaFdv,
  type RespostaTestarPlataforma,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { entidadeDaRota } from './operacao';
import { EVENTOS, EVENTO_CARGA_INICIAL, MotivoPausa } from '../contracts';
import { MSG_SEM_LICENCA, decidirCargaCompleta, decidirRetomar, entidadesParaCargaInicial, montarLogPlataforma, montarMonitor, planejarTrocaCredencial, prefixoExibido, validarConfiguracao } from '../domain';

const Uuid = z.string().uuid();
const Instante = z.string().datetime();

/** O jsonb do `portal_ler` (0038): os insumos crus. A falha do cadastro sai do `falhaEnvioFdv` do SDK, aqui. */
const EstadoPortal = z.object({
  empresa_id: Uuid,
  modulo_licenciado: z.boolean(),
  credencial: z
    .object({
      id: Uuid,
      conector_id: z.string(),
      ambiente: DefinirCredencialPlataformaEntrada.shape.ambiente,
      chave_prefixo: z.string().min(1).max(8),
      criada_em: Instante,
      ultimo_uso_em: Instante.nullable(),
    })
    .nullable(),
  entidades_habilitadas: z.array(EntidadeEnvioFdv),
  limite_registros_lote: z.number().int().nullable(),
  /** Chave de topo do banco: `sinal` (no contrato do portal vira `ultimo_sinal`). */
  sinal: UltimoSinalFdv.nullable(),
  cadastros: z.array(
    z.object({
      entidade: EntidadeEnvioFdv,
      pausada_motivo: MotivoPausa.nullable(),
      lote_em_voo: z.boolean(),
      ultimo_envio_em: Instante.nullable(),
      ultimo_lote: z.object({ estado: z.string(), erro_codigo: z.string().nullable(), em: Instante }).nullable(),
      erros_abertos: z.number().int().min(0),
    }),
  ),
});
export type EstadoPortal = z.infer<typeof EstadoPortal>;

/**
 * Insumos crus do Monitor (`portal_monitor`, banco-dados): credencial ativa, sinal aceito e fila. Sem dado de negócio.
 * O `pausada_motivo` e o estado do último lote vêm no Log; o texto e a falha saem do SDK e do catálogo.
 */
const InsumosMonitorPortal = z.object({
  credencial_ativa: z.boolean(),
  conector_id: z.string().nullable(),
  habilitadas: z.number().int().min(0),
  ultimo_sinal_aceito_em: Instante.nullable(),
  fila: z.object({ lotes: z.number().int().min(0), linhas: z.number().int().min(0) }),
});
export type InsumosMonitorPortal = z.infer<typeof InsumosMonitorPortal>;

/**
 * Insumos crus do Log (`portal_log`): os envios recentes e os erros JÁ AGRUPADOS por código e campo, com a contagem. A função do
 * banco não devolve `external_id`, nome nem payload (ADR 0013); este `parse` descarta qualquer chave a mais.
 */
const InsumosLogPortal = z.object({
  envios: z.array(z.object({ em: Instante, estado: z.string(), registros: z.number().int().min(0), com_erro: z.number().int().min(0), origem: OrigemEnvioFdv })),
  erros: z.array(z.object({ codigo: z.string(), campo: z.string().nullable(), quantidade: z.number().int().min(1) })),
  total_erros: z.number().int().min(0),
  pausada_motivo: MotivoPausa.nullable(),
});
export type InsumosLogPortal = z.infer<typeof InsumosLogPortal>;

const ResultadoReprocessarPortal = z.object({ falhas: z.number().int().min(0), pendentes: z.number().int().min(0), pedido_em: z.union([Instante, z.date()]) });

/** Porta do banco do portal: uma função SQL por método. O dublê dos testes unitários implementa esta interface. */
export interface RepositorioPortalIntegracaoFdv {
  ler(tx: Transacao, tenant: string): Promise<EstadoPortal>;
  definirCredencial(
    tx: Transacao,
    p: {
      tenant: string;
      anterior_id: string | null;
      conector_id: string;
      ambiente: string;
      chave_cifrada: Buffer;
      chave_prefixo: string;
      chave_mestra_versao: number;
      zerar_espelho: boolean;
      evento_carga_inicial: Record<string, unknown> | null;
      /** Primeira credencial: `[]` explícito (os cadastros são ligados um por um, no `PUT /configuracao`). Troca: a lista da ativa, explícita (a função copia da ativa; a 0038 recusa NULL). */
      entidades: string[];
      request_id: string;
    },
  ): Promise<EstadoPortal>;
  configurar(
    tx: Transacao,
    p: { tenant: string; entidades: string[]; limite: number; evento_carga_inicial: Record<string, unknown> | null; antes: string[]; request_id: string },
  ): Promise<EstadoPortal>;
  testar(tx: Transacao, p: { tenant: string; request_id: string }): Promise<Date | string>;
  cargaCompleta(tx: Transacao, p: { tenant: string; entidade: string; request_id: string }): Promise<void>;
  retomar(tx: Transacao, p: { tenant: string; entidade: string; request_id: string }): Promise<RespostaRetomadaFdv>;
  /** T-0086 §2: só leitura, sem auditoria. */
  monitor(tx: Transacao, tenant: string): Promise<InsumosMonitorPortal>;
  /** T-0086 §4: só leitura, sem auditoria; só códigos, campos e contagens. */
  log(tx: Transacao, p: { tenant: string; entidade: EntidadeEnvioFdv }): Promise<InsumosLogPortal>;
  /** T-0086 §3: marca para envio só falha e pendente; com lote em voo a função recusa (`MXI03`, 409). Audita. */
  reprocessar(tx: Transacao, p: { tenant: string; entidade: EntidadeEnvioFdv; request_id: string }): Promise<{ falhas: number; pendentes: number; pedido_em: Date | string }>;
}

async function funcao<L>(tx: Transacao, sql: string, parametros: readonly unknown[]): Promise<L> {
  const [l] = await tx.consultar<{ r: L }>(sql, parametros);
  if (!l) throw new Error('função do portal sem retorno');
  return l.r;
}

/** Adaptador SQL: chama só `integracao_fdv.portal_*`, nunca tabela. */
export const repositorioPortalSql: RepositorioPortalIntegracaoFdv = {
  async ler(tx, tenant) {
    return EstadoPortal.parse(await funcao(tx, 'SELECT integracao_fdv.portal_ler($1::uuid) AS r', [tenant]));
  },
  async definirCredencial(tx, p) {
    // p_limite fica no DEFAULT (5.000 na primeira; a troca copia da ativa). p_entidades sempre explícito (`[]` na primeira: nada ligado)
    const r = await funcao(
      tx,
      `SELECT integracao_fdv.portal_credencial_definir($1::uuid, $2::uuid, $3, $4, $5::bytea, $6, $7::int, $8::boolean, $9::jsonb, $10, $11::text[]) AS r`,
      [
        p.tenant, p.anterior_id, p.conector_id, p.ambiente, p.chave_cifrada, p.chave_prefixo, p.chave_mestra_versao, p.zerar_espelho,
        p.evento_carga_inicial === null ? null : JSON.stringify(p.evento_carga_inicial), p.request_id,
        p.entidades,
      ],
    );
    return EstadoPortal.parse(r);
  },
  async configurar(tx, p) {
    // 6 argumentos (0042): p_antes é a lista lida no portal_ler; se mudou (comparação por conjunto) a função dá MXI02 sem efeito (a apps/api mapeia para 409).
    return EstadoPortal.parse(
      await funcao(
        tx,
        'SELECT integracao_fdv.portal_configurar($1::uuid, $2::text[], $3::int, $4, $5::jsonb, $6::text[]) AS r',
        [p.tenant, p.entidades, p.limite, p.request_id, p.evento_carga_inicial === null ? null : JSON.stringify(p.evento_carga_inicial), p.antes],
      ),
    );
  },
  testar(tx, p) {
    return funcao<Date | string>(tx, 'SELECT integracao_fdv.portal_testar($1::uuid, $2) AS r', [p.tenant, p.request_id]);
  },
  async cargaCompleta(tx, p) {
    await funcao(tx, 'SELECT integracao_fdv.portal_carga_completa($1::uuid, $2, $3) AS r', [p.tenant, p.entidade, p.request_id]);
  },
  async retomar(tx, p) {
    const r = await funcao<{ retomada: boolean }>(tx, 'SELECT integracao_fdv.portal_retomar($1::uuid, $2, $3) AS r', [p.tenant, p.entidade, p.request_id]);
    return { retomada: r.retomada === true };
  },
  async monitor(tx, tenant) {
    return InsumosMonitorPortal.parse(await funcao(tx, 'SELECT integracao_fdv.portal_monitor($1::uuid) AS r', [tenant]));
  },
  async log(tx, p) {
    return InsumosLogPortal.parse(await funcao(tx, 'SELECT integracao_fdv.portal_log($1::uuid, $2) AS r', [p.tenant, p.entidade]));
  },
  async reprocessar(tx, p) {
    return ResultadoReprocessarPortal.parse(await funcao(tx, 'SELECT integracao_fdv.portal_reprocessar($1::uuid, $2, $3) AS r', [p.tenant, p.entidade, p.request_id]));
  },
};

/** O jsonb do banco no formato público do portal (`IntegracaoFdvPlataforma`): a validação do Zod confere a derivação de `ligada`. */
export function paraPlataforma(e: EstadoPortal): IntegracaoFdvPlataforma {
  const c = e.credencial;
  return IntegracaoFdvPlataforma.parse({
    empresa_id: e.empresa_id,
    modulo_licenciado: e.modulo_licenciado,
    credencial_id: c?.id ?? null,
    conector_id: c?.conector_id ?? null,
    ambiente: c?.ambiente ?? null,
    chave_prefixo: c?.chave_prefixo ?? null,
    criada_em: c?.criada_em ?? null,
    ultimo_uso_em: c?.ultimo_uso_em ?? null,
    entidades_habilitadas: e.entidades_habilitadas,
    limite_registros_lote: e.limite_registros_lote,
    cadastros: e.cadastros.map((k) => ({
      entidade: k.entidade,
      ligada: integracaoFdvLigada({ credencial_id: c?.id ?? null, entidades_habilitadas: e.entidades_habilitadas }, k.entidade),
      ultimo_envio_em: k.ultimo_envio_em,
      falha: falhaEnvioFdv({ pausada_motivo: k.pausada_motivo, ultimo_lote_estado: k.ultimo_lote?.estado ?? null, erros_abertos: k.erros_abertos }),
      lote_em_voo: k.lote_em_voo,
    })),
    ultimo_sinal: e.sinal,
  });
}

export interface DependenciasPlataformaIntegracaoFdv {
  /** `MACUXIERP_CHAVE_INTEGRACAO` já lida pela apps/api (32 bytes). `null` = ausente: só o `PUT /credencial` responde 503. */
  chaveIntegracao: Buffer | null;
  /** Versão gravada em `credencial.chave_mestra_versao` (o worker abre pela versão). Padrão 1. */
  chaveVersao?: number;
  /** Só para teste: o padrão é o adaptador SQL (`portal_*`). */
  repo?: RepositorioPortalIntegracaoFdv;
}

const CHAVE_AUSENTE = (): ErroApi =>
  new ErroApi(503, 'CHAVE_INTEGRACAO_AUSENTE', 'O cadastro da credencial está indisponível: a chave de criptografia do servidor não foi configurada. Fale com o suporte.');

function copiarChaveIntegracao(chave: Buffer | null): Buffer | null {
  if (chave === null) return null;
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('chaveIntegracao da integração-fdv deve ter 32 bytes');
  return Buffer.from(chave);
}

const idDaRota = (params: Record<string, string>): string => {
  const r = Uuid.safeParse(params.id);
  if (!r.success) throw erros.validacao({ id: 'UUID inválido' });
  return r.data;
};

const MSG_LOTE_EM_VOO = 'Este cadastro está enviando agora. Espere terminar.';
const MSG_MODULO_DESLIGADO = MSG_SEM_LICENCA;
const semModulo = () => erros.regra('RN-CORE-02', MSG_MODULO_DESLIGADO, undefined, { codigo: 'modulo_desligado' });

export function criarPluginPlataformaIntegracaoFdv(deps: DependenciasPlataformaIntegracaoFdv): PluginPlataforma {
  const chaveIntegracao = copiarChaveIntegracao(deps.chaveIntegracao);
  const versaoDaChave = deps.chaveVersao ?? 1;
  const repo = deps.repo ?? repositorioPortalSql;

  /** Lê o estado e recusa (422 `RN-CORE-02`) a escrita em empresa sem o módulo licenciado. */
  const lerLicenciado = async (tx: Transacao, tenant: string): Promise<EstadoPortal> => {
    const estado = await repo.ler(tx, tenant);
    if (!estado.modulo_licenciado) throw semModulo();
    return estado;
  };
  const exigirCredencial = (e: EstadoPortal) => {
    if (!e.credencial) throw erros.conflito(MENSAGEM_SEM_CREDENCIAL_FDV);
    return e.credencial;
  };
  const C = CAMINHOS_INTEGRACAO_FDV_PLATAFORMA;

  return definirPluginPlataforma([
    definirRotaPlataforma({
      metodo: 'GET',
      caminho: C.ler,
      acao: 'plataforma.integracao_fdv.ver',
      async executar(c, { params }) {
        const estado = await repo.ler(c.tx, idDaRota(params));
        return { corpo: paraPlataforma(estado) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'PUT',
      caminho: C.credencial,
      acao: 'plataforma.integracao_fdv.configurar',
      corpo: DefinirCredencialPlataformaEntrada,
      async executar(c, { corpo, params }) {
        const tenant = idDaRota(params);
        if (!chaveIntegracao) throw CHAVE_AUSENTE();
        const atual = await lerLicenciado(c.tx, tenant);
        const plano = planejarTrocaCredencial(
          atual.credencial ? { conector_id: atual.credencial.conector_id, ambiente: atual.credencial.ambiente } : null,
          { conector_id: corpo.conector_id, ambiente: corpo.ambiente },
        );
        // AAD = a empresa ALVO (`:id`), nunca o tenant de referência da sessão de plataforma
        const chave_cifrada = cifrarCampo({ chave: chaveIntegracao, tenantId: tenant, claro: corpo.chave });
        const ligadas = plano.zerarEspelho ? entidadesParaCargaInicial([], atual.entidades_habilitadas) : null;
        const evento = ligadas ? EVENTOS[EVENTO_CARGA_INICIAL].parse({ entidades: ligadas }) : null;
        const estado = await repo.definirCredencial(c.tx, {
            tenant,
            anterior_id: atual.credencial?.id ?? null,
            conector_id: corpo.conector_id,
            ambiente: corpo.ambiente,
            chave_cifrada,
            chave_prefixo: prefixoExibido(corpo.chave),
            chave_mestra_versao: versaoDaChave,
            zerar_espelho: plano.zerarEspelho,
            evento_carga_inicial: evento,
            entidades: plano.primeira ? [] : [...atual.entidades_habilitadas],
            request_id: c.request_id,
          });
        return { status: plano.primeira ? 201 : 200, corpo: paraPlataforma(estado) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.testar,
      acao: 'plataforma.integracao_fdv.configurar',
      idempotencia: 'opcional',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        exigirCredencial(await lerLicenciado(c.tx, tenant));
        const pedido = await repo.testar(c.tx, { tenant, request_id: c.request_id });
        const corpo: RespostaTestarPlataforma = { aceito: true, pedido_em: new Date(pedido).toISOString() };
        return { status: 202, corpo };
      },
    }),
    definirRotaPlataforma({
      metodo: 'PUT',
      caminho: C.configuracao,
      acao: 'plataforma.integracao_fdv.configurar',
      corpo: ConfigurarIntegracaoPlataformaEntrada,
      idempotencia: 'opcional',
      async executar(c, { corpo, params }) {
        const tenant = idDaRota(params);
        const violacoes = validarConfiguracao(corpo); // a API revalida o que o Zod já barrou
        if (violacoes.length > 0) throw erros.regra(violacoes[0]!.rn, violacoes[0]!.mensagem, Object.fromEntries(violacoes.map((v) => [v.campo, v.mensagem])));
        const antes = await lerLicenciado(c.tx, tenant);
        exigirCredencial(antes);
        const ligadas = entidadesParaCargaInicial(antes.entidades_habilitadas, corpo.entidades_habilitadas);
        const evento = ligadas ? EVENTOS[EVENTO_CARGA_INICIAL].parse({ entidades: ligadas }) : null;
        const estado = await repo.configurar(c.tx, { tenant, entidades: corpo.entidades_habilitadas, limite: corpo.limite_registros_lote, evento_carga_inicial: evento, antes: antes.entidades_habilitadas, request_id: c.request_id });
        return { corpo: paraPlataforma(estado) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.cargaCompleta,
      acao: 'plataforma.integracao_fdv.operar',
      idempotencia: 'obrigatoria',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        const entidade = entidadeDaRota(params.entidade);
        const atual = await lerLicenciado(c.tx, tenant);
        exigirCredencial(atual);
        const decisao = decidirCargaCompleta({
          habilitada: atual.entidades_habilitadas.includes(entidade),
          loteEmVoo: atual.cadastros.find((k) => k.entidade === entidade)?.lote_em_voo ?? false,
        });
        if (!decisao.ok) {
          if (decisao.codigo === 'lote_em_voo') throw erros.conflito(decisao.mensagem);
          throw erros.regra('RN-INF-02', decisao.mensagem, { entidade: decisao.mensagem }, { codigo: decisao.codigo });
        }
        await repo.cargaCompleta(c.tx, { tenant, entidade, request_id: c.request_id });
        const corpo: RespostaAceitoFdv = { aceito: true };
        return { status: 202, corpo };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.retomar,
      acao: 'plataforma.integracao_fdv.operar',
      idempotencia: 'opcional',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        const entidade = entidadeDaRota(params.entidade);
        const atual = await lerLicenciado(c.tx, tenant);
        const pausa = atual.cadastros.find((k) => k.entidade === entidade)?.pausada_motivo ?? null;
        if (decidirRetomar(pausa).acao === 'nada') {
          const nada: RespostaRetomadaFdv = { retomada: false };
          return { corpo: nada };
        }
        return { corpo: await repo.retomar(c.tx, { tenant, entidade, request_id: c.request_id }) };
      },
    }),
    // ---- T-0086: operação nas telas (Monitor, Log, Reprocessar) ----
    definirRotaPlataforma({
      metodo: 'GET',
      caminho: C.monitor,
      acao: 'plataforma.integracao_fdv.ver',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        await lerLicenciado(c.tx, tenant);
        const i = await repo.monitor(c.tx, tenant);
        const corpo: MonitorConectorFdv = montarMonitor({
          ...i,
          ultimo_sinal_aceito_em: i.ultimo_sinal_aceito_em ? new Date(i.ultimo_sinal_aceito_em) : null,
          agora: c.agora,
        });
        return { corpo };
      },
    }),
    definirRotaPlataforma({
      metodo: 'GET',
      caminho: C.log,
      acao: 'plataforma.integracao_fdv.ver',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        const entidade = entidadeDaRota(params.entidade);
        await lerLicenciado(c.tx, tenant);
        const i = await repo.log(c.tx, { tenant, entidade });
        // ADR 0013: só código, campo e contagem; `montarLogPlataforma` passa pelo Zod do SDK, que descarta o resto
        const corpo: LogCadastroFdvPlataforma = montarLogPlataforma({
          entidade,
          lidoEm: c.agora,
          envios: i.envios.map((e) => ({ ...e, em: new Date(e.em) })),
          erros: i.erros,
          totalErros: i.total_erros,
          motivo: falhaEnvioFdv({ pausada_motivo: i.pausada_motivo, ultimo_lote_estado: i.envios[0]?.estado ?? null, erros_abertos: i.total_erros })?.motivo ?? null,
        });
        return { corpo };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.reprocessar,
      acao: 'plataforma.integracao_fdv.operar',
      idempotencia: 'obrigatoria',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        const entidade = entidadeDaRota(params.entidade);
        const atual = await lerLicenciado(c.tx, tenant);
        exigirCredencial(atual);
        // dois envios do mesmo cadastro nunca andam juntos: com lote em voo a tela mostra "Enviando…" e não chama
        if (atual.cadastros.find((k) => k.entidade === entidade)?.lote_em_voo) throw erros.conflito(MSG_LOTE_EM_VOO);
        const r = await repo.reprocessar(c.tx, { tenant, entidade, request_id: c.request_id });
        const corpo: RespostaReprocessarFdv = RespostaReprocessarFdv.parse({ entidade, falhas: r.falhas, pendentes: r.pendentes, pedido_em: new Date(r.pedido_em).toISOString() });
        return { corpo };
      },
    }),
  ]);
}
