/**
 * Contratos da OPERAÇÃO da Integração FDV nas telas (T-0086, desenho `docs/desenho/T-0086.md`): Monitor do conector no
 * topo da aba Integração do `/config`, Reprocessar (só falhas e pendentes), Log por cadastro e Atualizar (`lido_em`),
 * e o Zerar por cadastro que inativa no FDV (decisão do Alexandre, R-20261124-170915-alexandre, emenda da RN-CAD-10).
 *
 * Por que aqui: como em `portal-integracao.ts`, o SDK não importa módulo e estes Zod servem ao plugin de plataforma do
 * `integracao-fdv`, à rota do BKO e à apps/web. Regra 3: tipos só de Zod. Sem Node.
 *
 * ADR 0013: o superadmin não vê dado de negócio. O Log do `/config` (`LogCadastroFdvPlataforma`) leva só códigos, campos
 * e contagens; o do BKO (`LogCadastroFdvTenant`) leva o registro (`external_id` e nome curto) para o administrador da
 * empresa corrigir. Nenhum dos dois leva a mensagem crua do Hub: o texto sai do catálogo pelo código.
 */
import { z } from 'zod';
import { ClienteRecebidoFdv } from './cliente-fdv';
import { CampoErroFdv, CodigoErroFdv } from './erros-fdv';
import { ExternalId } from './hub-v1';
import { Instante } from './portal-config';
import { ConectorIdFdv, EntidadeEnvioFdv, MotivoFalhaEnvioFdv } from './portal-integracao';

const Contagem = z.number().int().min(0);

// ---- Monitor do conector (R-20261124-090734) ----

/** Situação do conector no Monitor, como no FDV: "Em dia", "Atrasado" e "Desativado". */
export const SITUACOES_CONECTOR_FDV = ['em_dia', 'atrasado', 'desativado'] as const;
export const SituacaoConectorFdv = z.enum(SITUACOES_CONECTOR_FDV);
export type SituacaoConectorFdv = z.infer<typeof SituacaoConectorFdv>;

/**
 * Sem sinal aceito há mais que isto, o conector está "Atrasado". O sinal sai a cada 60 s (`sinal-conector.ts`); 5 min =
 * cinco ciclos perdidos (premissa do desenho T-0086 §2, ajustável sem ADR).
 */
export const ATRASO_SINAL_FDV_MS = 5 * 60_000;

/**
 * Situação do conector (pura; a API monta e a tela só exibe). `desativado`: sem credencial ativa ou sem cadastro
 * habilitado. `atrasado`: nunca teve sinal aceito ou o último passou de `ATRASO_SINAL_FDV_MS`. Senão `em_dia`.
 */
export function situacaoConectorFdv(e: {
  credencial_ativa: boolean;
  habilitadas: number;
  ultimo_sinal_em: string | null;
  agora: Date;
}): SituacaoConectorFdv {
  if (!e.credencial_ativa || e.habilitadas === 0) return 'desativado';
  if (e.ultimo_sinal_em === null) return 'atrasado';
  return e.agora.getTime() - Date.parse(e.ultimo_sinal_em) > ATRASO_SINAL_FDV_MS ? 'atrasado' : 'em_dia';
}

/** Versão do conector (semver), como vai no `versao_conector` do sinal. */
export const VersaoConectorFdv = z.string().regex(/^\d+\.\d+\.\d+$/);

/**
 * `GET .../integracao-fdv/monitor`: o bloco Monitor (Identificador, Situação, Versão, Último sinal, Fila lotes · linhas).
 * `lido_em` alimenta o "Atualizado às hh:mm" do botão Atualizar. Sem credencial: identificador e versão nulos, fila zerada.
 */
export const MonitorConectorFdv = z
  .object({
    identificador: ConectorIdFdv.nullable(),
    situacao: SituacaoConectorFdv,
    /** `versao_conector` do último sinal enviado ao Hub (semver). */
    versao: VersaoConectorFdv.nullable(),
    ultimo_sinal_em: Instante.nullable(),
    fila: z.object({ lotes: Contagem, linhas: Contagem }),
    lido_em: Instante,
  })
  .superRefine((m, ctx) => {
    if (m.identificador === null && m.situacao !== 'desativado') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['situacao'], message: 'Sem credencial, o conector está desativado' });
    }
    if (m.situacao === 'em_dia' && m.ultimo_sinal_em === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ultimo_sinal_em'], message: 'Em dia exige um sinal aceito' });
    }
  });
export type MonitorConectorFdv = z.infer<typeof MonitorConectorFdv>;

// ---- Situação do registro e Reprocessar (R-20261124-090216) ----

/**
 * Situação de um registro no espelho do conector (`integracao_fdv.registro_publicado`): `integrado` (o Hub confirmou o
 * hash atual), `pendente` (ainda não foi ou mudou depois do último aceite) e `falha` (erro por linha aberto). A regra
 * que deriva a situação é do domain do `integracao-fdv`.
 */
export const SITUACOES_REGISTRO_FDV = ['integrado', 'pendente', 'falha'] as const;
export const SituacaoRegistroFdv = z.enum(SITUACOES_REGISTRO_FDV);
export type SituacaoRegistroFdv = z.infer<typeof SituacaoRegistroFdv>;

/** O Reprocessar reenvia só estes: nunca o `integrado`, sem carga completa e sem inativação nova. */
export const REPROCESSAVEIS_FDV: readonly SituacaoRegistroFdv[] = Object.freeze(['falha', 'pendente']);

/**
 * `POST .../integracao-fdv/entidades/:entidade/reprocessar` (`Idempotency-Key` obrigatória; ação
 * `plataforma.integracao_fdv.operar`). Com lote em voo no cadastro: 409 `CONFLITO` (a tela mostra "Enviando…" pelo
 * `lote_em_voo` e não chama). Nada a reprocessar: 200 com as duas contagens em 0. `pedido_em` (ISO UTC) é a partir de
 * quando o Log mostra o envio.
 */
export const RespostaReprocessarFdv = z.object({
  entidade: EntidadeEnvioFdv,
  falhas: Contagem,
  pendentes: Contagem,
  pedido_em: Instante,
});
export type RespostaReprocessarFdv = z.infer<typeof RespostaReprocessarFdv>;

// ---- Log por cadastro (R-20261124-085515) ----

/** Quantos envios recentes o Log mostra e o teto de erros na resposta (o CSV do BKO leva todos). */
export const LIMITE_ENVIOS_LOG_FDV = 20;
/** Recebidos do FDV no Log de clientes do BKO (T-0110): os mais recentes; a lista completa fica na seção dos recebidos. */
export const LIMITE_RECEBIDOS_LOG_FDV = 50;
export const LIMITE_ERROS_LOG_FDV = 200;

/** O que gerou o envio: o ciclo normal do conector, o Reprocessar ou a inativação do Zerar. */
export const ORIGENS_ENVIO_FDV = ['ciclo', 'reprocessar', 'zerar'] as const;
export const OrigemEnvioFdv = z.enum(ORIGENS_ENVIO_FDV);
export type OrigemEnvioFdv = z.infer<typeof OrigemEnvioFdv>;

/** Situação do envio na tela: `enviando` (lote em voo), `concluido`, `com_erros` (aceito com erro por linha) e `falhou` (o lote todo). */
export const SITUACOES_ENVIO_FDV = ['enviando', 'concluido', 'com_erros', 'falhou'] as const;

/** Um envio recente (um lote): data, situação, quantos foram e quantos falharam. Igual no `/config` e no BKO. */
export const EnvioLogFdv = z
  .object({
    em: Instante,
    origem: OrigemEnvioFdv,
    situacao: z.enum(SITUACOES_ENVIO_FDV),
    registros: Contagem,
    com_erro: Contagem,
  })
  .refine((e) => e.com_erro <= e.registros, { path: ['com_erro'], message: 'Falhas não passam dos registros' });
export type EnvioLogFdv = z.infer<typeof EnvioLogFdv>;

/** Tom do selo na tela (as cores do sistema: sucesso, aviso, erro e neutro). */
export type TomEnvioFdv = 'sucesso' | 'aviso' | 'erro' | 'neutro';

/** Rótulo da origem do envio no Log (fonte única: o módulo `integracao-fdv` e a apps/web importam daqui). */
export const ROTULO_ORIGEM_ENVIO_FDV: Readonly<Record<OrigemEnvioFdv, string>> = Object.freeze({
  ciclo: 'Ciclo normal',
  reprocessar: 'Reprocessar',
  zerar: 'Zerar (inativação)',
});

/** Rótulo e tom da situação do envio no Log: falhou = erro; concluído = sucesso; com erros = aviso; enviando = neutro. */
export const ROTULO_SITUACAO_ENVIO_FDV: Readonly<Record<EnvioLogFdv['situacao'], { texto: string; tom: TomEnvioFdv }>> = Object.freeze({
  enviando: { texto: 'Enviando…', tom: 'neutro' },
  concluido: { texto: 'Concluído', tom: 'sucesso' },
  com_erros: { texto: 'Com erros', tom: 'aviso' },
  falhou: { texto: 'Falhou', tom: 'erro' },
});

/** Base dos dois Logs: o cadastro, a leitura (`lido_em`, para o Atualizar), os envios recentes e o total de erros abertos. */
const LogCadastroFdvBase = z.object({
  entidade: EntidadeEnvioFdv,
  lido_em: Instante,
  envios: z.array(EnvioLogFdv).max(LIMITE_ENVIOS_LOG_FDV),
  total_erros: Contagem,
  /** Motivo do cadastro (pausa, lote recusado ou falhou, erros por linha), o mesmo de `falhaEnvioFdv`. */
  motivo: MotivoFalhaEnvioFdv.nullable(),
});

/** Reexport da folha `erros-fdv.ts` (sem ciclo com `cliente-fdv.ts`). */
export { CampoErroFdv, CodigoErroFdv } from './erros-fdv';

/**
 * `GET /v1/plataforma/empresas/:id/integracao-fdv/entidades/:entidade/log` (ação `plataforma.integracao_fdv.ver`): SÓ
 * códigos, campos e contagens (ADR 0013), agrupados por código e campo, sem `external_id`, nome nem valor. O link para
 * o Log do BKO da empresa é montado pela tela (desenho T-0086 §1), não vem na resposta.
 */
export const LogCadastroFdvPlataforma = LogCadastroFdvBase.extend({
  erros: z
    .array(z.object({ codigo: CodigoErroFdv, campo: CampoErroFdv, quantidade: z.number().int().min(1) }))
    .max(LIMITE_ERROS_LOG_FDV),
}).superRefine((l, ctx) => {
  const soma = l.erros.reduce((s, e) => s + e.quantidade, 0);
  if (soma > l.total_erros) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['erros'], message: 'A soma dos grupos não passa do total' });
  const chaves = l.erros.map((e) => `${e.codigo}|${e.campo ?? ''}`);
  if (new Set(chaves).size !== chaves.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['erros'], message: 'Código e campo repetidos' });
});
export type LogCadastroFdvPlataforma = z.infer<typeof LogCadastroFdvPlataforma>;

/**
 * `GET /v1/integracao-fdv/entidades/:entidade/log` (BKO, ação `integracao-fdv.ver`): um item por registro com erro
 * aberto (até `LIMITE_ERROS_LOG_FDV`; o CSV leva todos), com o código do registro, o nome curto, o campo, o motivo e a
 * ação do catálogo e o `corrigir_href` (tela do cadastro no BKO; nulo quando o registro foi apagado, como no Zerar).
 */
export const LogCadastroFdvTenant = LogCadastroFdvBase.extend({
  erros: z
    .array(
      z.object({
        registro_external_id: ExternalId,
        nome_curto: z.string().max(120).nullable(),
        campo: CampoErroFdv,
        codigo: CodigoErroFdv,
        motivo_texto: z.string().min(1),
        acao_texto: z.string().min(1),
        corrigir_href: z.string().startsWith('/').nullable(),
      }),
    )
    .max(LIMITE_ERROS_LOG_FDV),
  /**
   * T-0110: os pré-cadastros recebidos do FDV (só no Log de `cliente`), os mais recentes, até `LIMITE_RECEBIDOS_LOG_FDV`;
   * documento só mascarado (LGPD, `ClienteRecebidoFdv`). Opcionais nesta versão (expand): ausente = nenhum recebido.
   */
  recebidos: z.array(ClienteRecebidoFdv).max(LIMITE_RECEBIDOS_LOG_FDV).optional(),
  total_recebidos: Contagem.optional(),
}).superRefine((l, ctx) => {
  if (l.erros.length > l.total_erros) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['erros'], message: 'Os itens não passam do total' });
  const recebidos = l.recebidos ?? [];
  if (recebidos.length > (l.total_recebidos ?? 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recebidos'], message: 'Os recebidos não passam do total' });
  }
  if (l.entidade !== 'cliente' && (recebidos.length > 0 || (l.total_recebidos ?? 0) > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recebidos'], message: 'Recebidos só no Log de cliente' });
  }
});
export type LogCadastroFdvTenant = z.infer<typeof LogCadastroFdvTenant>;

/** Caminhos do BKO, relativos a `/v1` (fonte única para o módulo, a apps/web e os testes de rota). */
export const CAMINHOS_INTEGRACAO_FDV_TENANT = Object.freeze({
  status: '/integracao-fdv/status',
  log: '/integracao-fdv/entidades/:entidade/log',
  /** "Baixar erros (.csv)": todos os erros abertos do cadastro, com as colunas do `LogCadastroFdvTenant.erros`. */
  logCsv: '/integracao-fdv/entidades/:entidade/log.csv',
  /** T-0059: a rota dos clientes recebidos do FDV (`PaginaClientesRecebidosFdv` de `cliente-fdv.ts`); a tela saiu na T-0110 e a rota segue. */
  clientesRecebidos: '/integracao-fdv/clientes-recebidos',
});

// ---- Zerar por cadastro na aba Integração (R-20261124-170915-alexandre) ----

/**
 * Cadastro do Zerar (`CADASTROS_ZERAR_PORTAL`, `portal-cargas.ts`) de cada linha da tabela da Integração: forma e prazo
 * zeram `condicao_pagamento` juntos; cliente e endereço zeram `cliente` (com endereços e contatos). O Zerar continua a
 * rota `POST .../cadastros/zerar` com um cadastro só.
 */
export const CADASTRO_ZERAR_POR_ENTIDADE_FDV = Object.freeze({
  filial: 'filial',
  vendedor: 'vendedor',
  forma_pagamento: 'condicao_pagamento',
  prazo_pagamento: 'condicao_pagamento',
  produto: 'produto',
  produto_unidade: 'produto_unidade',
  preco: 'preco',
  estoque: 'estoque',
  cliente: 'cliente',
  cliente_endereco: 'cliente',
} as const satisfies Record<EntidadeEnvioFdv, string>);

/**
 * Inativação no FDV que o Zerar deixou pendente, por entidade do Hub: na prévia, os registros que seriam inativados;
 * no zerar, os que ficaram pendentes no espelho na mesma transação do apagar (o conector envia depois; o resultado vai
 * ao Log com origem `zerar`). Só registros já publicados (no espelho): o que nunca foi ao FDV não tem o que inativar.
 */
export const InativacaoZerarFdv = z.array(z.object({ entidade: EntidadeEnvioFdv, quantidade: z.number().int().min(1) })).refine(
  (xs) => new Set(xs.map((x) => x.entidade)).size === xs.length,
  { message: 'Entidade repetida' },
);
export type InativacaoZerarFdv = z.infer<typeof InativacaoZerarFdv>;
