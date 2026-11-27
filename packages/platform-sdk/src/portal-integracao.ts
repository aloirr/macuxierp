/**
 * Contratos do portal `/config` para a Integração FDV (ADR 0013, T-0056): a credencial do conector
 * e a configuração do envio e a OPERAÇÃO (carga completa e retomar, ADR 0013 seção 2) saem do BKO do
 * tenant e passam a ser só do superadmin. O BKO fica só com a leitura, por cadastro (`StatusIntegracaoFdvTenant`).
 *
 * Por que aqui, e não em `modules/integracao-fdv/contracts`: o SDK não importa módulo (fronteira), e a rota de plataforma
 * é consumida pela apps/web (portal) e pelo plugin de plataforma do módulo, como os demais contratos do portal
 * (`portal-config.ts`). O módulo passa a REEXPORTAR estes Zod e constantes (`CredencialEntrada`,
 * `ConfiguracaoEntrada`, `MotivoPausa`, `AmbienteHub`, `LIMITE_REGISTROS_LOTE` e a parte F2 de `ENTIDADES_HUB` viram
 * reexport daqui). Regra 3: tipos só de Zod. Sem Node: serve à apps/web.
 *
 * - A chave do conector é só de escrita: entra em `DefinirCredencialPlataformaEntrada`, é cifrada na API (AES-256-GCM,
 *   AAD = tenant alvo, `MACUXIERP_CHAVE_INTEGRACAO`) e nunca volta; a resposta traz só o prefixo e as datas.
 * - Nada de dado pessoal nem de mensagem do Hub: o último sinal leva só datas, o HTTP e a parada por versão; a falha
 *   do cadastro leva só o código do motivo e o da ação sugerida (o texto sai do catálogo da tela).
 * - "Ligada" é POR CADASTRO (decisão do PO, 23/11 12h43): credencial ativa e o cadastro habilitado.
 */
import { z } from 'zod';
import { PADRAO_UUID } from './banco';
import { AMBIENTES_HUB } from './hub';
import { CodigoErroFdv } from './erros-fdv';

const Id = z.string().regex(PADRAO_UUID);
const Instante = z.string().datetime();

/**
 * Entidades que o conector envia nesta fase (F2), na ordem de carga (RN-INF-02). O módulo reexporta
 * (`ENTIDADES_HUB` de `modules/integracao-fdv/contracts/hub.ts` = `[...ENTIDADES_ENVIO_FDV, ...demais]`; domínio
 * `integracao_fdv.entidade_hub` no banco).
 */
export const ENTIDADES_ENVIO_FDV = [
  'filial',
  'vendedor',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
  'cliente_endereco',
] as const;
export const EntidadeEnvioFdv = z.enum(ENTIDADES_ENVIO_FDV);
export type EntidadeEnvioFdv = z.infer<typeof EntidadeEnvioFdv>;

/** Teto de registros por lote do Hub (doc 06). O `LIMITE_REGISTROS_LOTE` do módulo passa a ser reexport deste valor. */
export const LIMITE_REGISTROS_LOTE_FDV = 5000;

/** Mensagem do 409 `MXI01` (ação que exige a credencial ativa): a API e o módulo usam a mesma (ADR 0013 §2). */
export const MENSAGEM_SEM_CREDENCIAL_FDV = 'Salve a chave do conector antes.';

/** Ambiente do Hub do FDV (não é o ambiente fiscal da SEFAZ): `AMBIENTES_HUB` da porta do Hub. */
export const AmbienteIntegracaoFdv = z.enum(AMBIENTES_HUB);
export type AmbienteIntegracaoFdv = z.infer<typeof AmbienteIntegracaoFdv>;

/** Código do conector no Hub: o CHECK de `integracao_fdv.credencial.conector_id` (0007). */
export const PADRAO_CONECTOR_FDV = /^[A-Za-z0-9_-]{1,64}$/;
export const ConectorIdFdv = z.string().regex(PADRAO_CONECTOR_FDV, 'Código do conector: 1 a 64 letras, dígitos, "_" ou "-"');

/**
 * `PUT /v1/plataforma/empresas/:id/integracao-fdv/credencial`. Mesmo formato do `CredencialEntrada` do módulo (que passa a
 * ser reexport deste). Sem `Idempotency-Key`: o hash do corpo levaria a chave (a troca é idempotente por si).
 * Erro de validação devolve só o campo e a mensagem fixa, nunca o valor.
 */
export const DefinirCredencialPlataformaEntrada = z.object({
  conector_id: ConectorIdFdv,
  chave: z.string().regex(/^\S+$/, 'A chave não tem espaços').min(32, 'A chave tem pelo menos 32 caracteres').max(512, 'A chave tem no máximo 512 caracteres'),
  ambiente: AmbienteIntegracaoFdv,
});
export type DefinirCredencialPlataformaEntrada = z.infer<typeof DefinirCredencialPlataformaEntrada>;

/**
 * `PUT /v1/plataforma/empresas/:id/integracao-fdv/configuracao` (RN-INF-02): liga e desliga o envio por cadastro
 * (`entidades_habilitadas`, lista vazia = nada é enviado) e o teto por lote. Mesmo formato do `ConfiguracaoEntrada` do
 * módulo, mais a recusa de entidade repetida (o `validarConfiguracao` do domain já recusa; aqui o portal erra antes).
 */
export const ConfigurarIntegracaoPlataformaEntrada = z.object({
  entidades_habilitadas: z
    .array(EntidadeEnvioFdv)
    .max(ENTIDADES_ENVIO_FDV.length)
    .refine((es) => new Set(es).size === es.length, 'Cadastro repetido'),
  limite_registros_lote: z.number().int().min(1).max(LIMITE_REGISTROS_LOTE_FDV),
});
export type ConfigurarIntegracaoPlataformaEntrada = z.infer<typeof ConfigurarIntegracaoPlataformaEntrada>;

/** Último sinal do conector (a resposta do "Testar" aparece aqui, a partir do `pedido_em`). Sem `politica_versao` nem mensagem do Hub. */
export const UltimoSinalFdv = z.object({
  ultimo_envio_em: Instante.nullable(),
  ultimo_aceito_em: Instante.nullable(),
  ultimo_http: z.number().int().min(100).max(599).nullable(),
  parado_por_versao: z.boolean(),
  /**
   * v0.3.18 (25 B): o código que o Hub devolveu no último sinal recusado (`integracao_fdv.sinal.ultimo_codigo`, 0074); só
   * o código, nunca a mensagem. Opcional na leitura enquanto o módulo não manda (expand).
   */
  ultimo_codigo: CodigoErroFdv.nullable().optional(),
});
export type UltimoSinalFdv = z.infer<typeof UltimoSinalFdv>;

/**
 * Um cadastro está ligado quando há credencial ativa e ele está em `entidades_habilitadas` (sem coluna própria: é
 * derivado, por cadastro; decisão do PO, 23/11 12h43).
 */
export function integracaoFdvLigada(
  c: { credencial_id: string | null; entidades_habilitadas: readonly string[] },
  entidade: EntidadeEnvioFdv,
): boolean {
  return c.credencial_id !== null && c.entidades_habilitadas.includes(entidade);
}

/**
 * Motivo da falha de envio de um cadastro: as pausas do conector (`MotivoPausa` do módulo, reexport de
 * `z.enum(MOTIVOS_PAUSA_FDV)`), o último lote `falhou` (o próximo ciclo reenvia com geração nova) ou `recusado` pelo Hub, e erros por linha
 * abertos (dado do cadastro no ERP). Só o código: nunca a mensagem do Hub, o lote, a linha nem o `external_id`.
 */
export const MOTIVOS_PAUSA_FDV = ['credencial', 'licenca_fdv', 'licenca_erp', 'versao', 'envelope', 'idempotencia', 'topologia'] as const;
export const MOTIVOS_FALHA_ENVIO_FDV = [...MOTIVOS_PAUSA_FDV, 'lote_recusado', 'lote_falhou', 'erros_por_linha'] as const;
export const MotivoFalhaEnvioFdv = z.enum(MOTIVOS_FALHA_ENVIO_FDV);
export type MotivoFalhaEnvioFdv = z.infer<typeof MotivoFalhaEnvioFdv>;

/** Ação sugerida para a falha. As de `ACOES_FDV_SO_DO_PORTAL` o BKO mostra como "Fale com o suporte Macuxi". */
export const ACOES_SUGERIDAS_FDV = [
  'corrigir_cadastros',
  'aguardar_retentativa',
  'regularizar_licenca',
  'corrigir_credencial',
  'atualizar_conector',
  'retomar',
  'acionar_suporte',
] as const;
export const AcaoSugeridaFdv = z.enum(ACOES_SUGERIDAS_FDV);
export type AcaoSugeridaFdv = z.infer<typeof AcaoSugeridaFdv>;
/** Só o superadmin resolve, no `/config` (credencial, retomar, análise do lote recusado) ou a Macuxi (versão do conector). */
export const ACOES_FDV_SO_DO_PORTAL: readonly AcaoSugeridaFdv[] = Object.freeze(['corrigir_credencial', 'atualizar_conector', 'retomar', 'acionar_suporte']);

/** Ação sugerida por motivo (fonte única: o `portal_ler`, o status do BKO e as telas usam esta tabela). */
export const ACAO_SUGERIDA_POR_MOTIVO_FDV: Readonly<Record<MotivoFalhaEnvioFdv, AcaoSugeridaFdv>> = Object.freeze({
  credencial: 'corrigir_credencial',
  licenca_fdv: 'regularizar_licenca',
  licenca_erp: 'regularizar_licenca',
  versao: 'atualizar_conector',
  envelope: 'retomar',
  idempotencia: 'retomar',
  topologia: 'retomar',
  lote_recusado: 'acionar_suporte',
  lote_falhou: 'aguardar_retentativa',
  erros_por_linha: 'corrigir_cadastros',
});

export const FalhaEnvioFdv = z
  .object({ motivo: MotivoFalhaEnvioFdv, acao: AcaoSugeridaFdv })
  .refine((f) => ACAO_SUGERIDA_POR_MOTIVO_FDV[f.motivo] === f.acao, { path: ['acao'], message: 'A ação sugerida é a do motivo' });
export type FalhaEnvioFdv = z.infer<typeof FalhaEnvioFdv>;

/**
 * Falha do cadastro, por precedência: pausa do conector → último lote `recusado` → último lote `falhou` → erros por linha
 * abertos. Nada disso = `null`. Pura: o módulo a usa para montar o status (BKO) e conferir o `portal_ler` (portal).
 */
export function falhaEnvioFdv(e: {
  pausada_motivo: (typeof MOTIVOS_PAUSA_FDV)[number] | null;
  ultimo_lote_estado: string | null;
  erros_abertos: number;
}): FalhaEnvioFdv | null {
  let motivo: MotivoFalhaEnvioFdv | null = null;
  if (e.pausada_motivo) motivo = e.pausada_motivo;
  else if (e.ultimo_lote_estado === 'recusado') motivo = 'lote_recusado';
  else if (e.ultimo_lote_estado === 'falhou') motivo = 'lote_falhou';
  else if (e.erros_abertos > 0) motivo = 'erros_por_linha';
  return motivo ? { motivo, acao: ACAO_SUGERIDA_POR_MOTIVO_FDV[motivo] } : null;
}

/** Um cadastro na leitura (BKO e portal): ligado ou não, último envio e a falha, se houver. */
export const CadastroIntegracaoFdv = z.object({
  entidade: EntidadeEnvioFdv,
  ligada: z.boolean(),
  ultimo_envio_em: Instante.nullable(),
  falha: FalhaEnvioFdv.nullable(),
  /**
   * v0.3.18 (25 B): quando a sondagem de 30 min tenta de novo o cadastro pausado por `credencial` ou `licenca_fdv`; nulo
   * (ou ausente, expand) nas outras situações.
   */
  proxima_tentativa_em: Instante.nullable().optional(),
});
export type CadastroIntegracaoFdv = z.infer<typeof CadastroIntegracaoFdv>;

/**
 * Um cadastro no portal: o do BKO mais `lote_em_voo` (há lote do cadastro nos `ESTADOS_EM_VOO` do módulo, lido pelo
 * `portal_ler`). O domain recusa a carga completa com lote em voo (409 `CONFLITO`) antes de chamar a função; se o estado
 * mudar entre a leitura e a escrita, a função confere de novo (`MXI03`). Só o portal: o BKO do tenant não leva o campo.
 */
export const CadastroIntegracaoFdvPlataforma = CadastroIntegracaoFdv.extend({ lote_em_voo: z.boolean() });
export type CadastroIntegracaoFdvPlataforma = z.infer<typeof CadastroIntegracaoFdvPlataforma>;

/** As pausas que a sondagem de 30 min retoma sozinha (25 B). */
const MOTIVOS_COM_SONDAGEM_FDV: ReadonlySet<string> = new Set(['credencial', 'licenca_fdv']);

/** Os 10 cadastros da F2, um por linha, na ordem de `ENTIDADES_ENVIO_FDV` (a tela não precisa ordenar nem completar). */
function conferirCadastros(cadastros: readonly CadastroIntegracaoFdv[], ctx: z.RefinementCtx, ligadaEsperada?: (e: EntidadeEnvioFdv) => boolean): void {
  const ordem = cadastros.map((c) => c.entidade).join(',');
  if (ordem !== ENTIDADES_ENVIO_FDV.join(',')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros'], message: 'Um item por cadastro da F2, na ordem de carga' });
    return;
  }
  cadastros.forEach((c, i) => {
    if (c.proxima_tentativa_em && !MOTIVOS_COM_SONDAGEM_FDV.has(c.falha?.motivo ?? '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros', i, 'proxima_tentativa_em'], message: 'Próxima tentativa só na pausa por credencial ou licença do FDV' });
    }
  });
  if (!ligadaEsperada) return;
  cadastros.forEach((c, i) => {
    if (c.ligada !== ligadaEsperada(c.entidade)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros', i, 'ligada'], message: 'ligada é derivada da credencial e do cadastro habilitado' });
    }
  });
}

const CAMPOS_DA_CREDENCIAL = ['credencial_id', 'conector_id', 'ambiente', 'chave_prefixo', 'criada_em'] as const;

/**
 * A Integração FDV de uma empresa como o superadmin vê (`GET .../integracao-fdv` e a resposta das escritas). Sem
 * credencial ativa: os campos da credencial e o limite ficam nulos, a lista de habilitados vazia e todo cadastro
 * desligado. Nunca a chave nem o cifrado: só o prefixo (até 8 caracteres) e as datas.
 */
export const IntegracaoFdvPlataforma = z
  .object({
    empresa_id: Id,
    /** O módulo `integracao-fdv` está licenciado e ativo na empresa; sem ele, as escritas são 422 `RN-CORE-02`. */
    modulo_licenciado: z.boolean(),
    credencial_id: Id.nullable(),
    conector_id: ConectorIdFdv.nullable(),
    ambiente: AmbienteIntegracaoFdv.nullable(),
    chave_prefixo: z.string().min(1).max(8).nullable(),
    criada_em: Instante.nullable(),
    /** Entrada do formulário de configuração (o `PUT .../configuracao` grava esta lista). */
    entidades_habilitadas: z.array(EntidadeEnvioFdv),
    limite_registros_lote: z.number().int().min(1).max(LIMITE_REGISTROS_LOTE_FDV).nullable(),
    /** Por cadastro: `ligada` derivada (`integracaoFdvLigada`), último envio, falha com a ação sugerida e `lote_em_voo`. */
    cadastros: z.array(CadastroIntegracaoFdvPlataforma),
    ultimo_sinal: UltimoSinalFdv.nullable(),
  })
  .superRefine((r, ctx) => {
    const comCredencial = r.credencial_id !== null;
    for (const campo of CAMPOS_DA_CREDENCIAL) {
      if ((r[campo] !== null) !== comCredencial) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: 'Credencial incompleta' });
    }
    if ((r.limite_registros_lote !== null) !== comCredencial) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['limite_registros_lote'], message: 'O limite existe só com credencial ativa' });
    }
    if (!comCredencial && r.entidades_habilitadas.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entidades_habilitadas'], message: 'Cadastros habilitados só com credencial ativa' });
    }
    conferirCadastros(r.cadastros, ctx, (e) => integracaoFdvLigada(r, e));
  });
export type IntegracaoFdvPlataforma = z.infer<typeof IntegracaoFdvPlataforma>;

/**
 * Vista SÓ LEITURA do BKO do tenant (`GET /v1/integracao-fdv/status`, ação `integracao-fdv.ver`): por cadastro, ligada ou
 * desligada, último envio e falha (motivo e ação sugerida). Leva o conector, o ambiente e o prefixo da chave (mitigação
 * do risco da ADR 0013: a empresa vê se alguém trocou a credencial), sem o id da credencial, sem a lista de habilitados
 * (já está em `ligada`) e sem limite: nada ali é editável pelo tenant. Sem credencial: os três nulos e tudo desligado.
 */
export const StatusIntegracaoFdvTenant = z
  .object({
    conector_id: ConectorIdFdv.nullable(),
    ambiente: AmbienteIntegracaoFdv.nullable(),
    chave_prefixo: z.string().min(1).max(8).nullable(),
    cadastros: z.array(CadastroIntegracaoFdv),
    ultimo_sinal: UltimoSinalFdv.nullable(),
  })
  .superRefine((r, ctx) => {
    const comCredencial = r.conector_id !== null;
    for (const campo of ['ambiente', 'chave_prefixo'] as const) {
      if ((r[campo] !== null) !== comCredencial) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: 'Credencial incompleta' });
    }
    conferirCadastros(r.cadastros, ctx, comCredencial ? undefined : () => false);
  });
export type StatusIntegracaoFdvTenant = z.infer<typeof StatusIntegracaoFdvTenant>;

/**
 * Formatos de resposta da operação, os mesmos do módulo (`RespostaAceito` e `RespostaRetomada` de
 * `modules/integracao-fdv/contracts/credencial.ts` passam a ser reexport destes).
 */
export const RespostaAceitoFdv = z.object({ aceito: z.literal(true) });
export type RespostaAceitoFdv = z.infer<typeof RespostaAceitoFdv>;
/** `false` quando o cadastro não estava pausado (nada a retomar). */
export const RespostaRetomadaFdv = z.object({ retomada: z.boolean() });
export type RespostaRetomadaFdv = z.infer<typeof RespostaRetomadaFdv>;

/**
 * `202` de `POST .../integracao-fdv/credencial/testar`: o pedido antecipa o sinal do conector; o resultado aparece em
 * `ultimo_sinal` a partir de `pedido_em` (ISO UTC). Mesmo formato do `RespostaTestar` do módulo.
 */
export const RespostaTestarPlataforma = RespostaAceitoFdv.extend({ pedido_em: Instante });
export type RespostaTestarPlataforma = z.infer<typeof RespostaTestarPlataforma>;

/** Caminhos relativos a `/v1/plataforma` (fonte única para o plugin do módulo, a apps/web e os testes de isolamento). */
export const CAMINHOS_INTEGRACAO_FDV_PLATAFORMA = Object.freeze({
  ler: '/empresas/:id/integracao-fdv',
  credencial: '/empresas/:id/integracao-fdv/credencial',
  testar: '/empresas/:id/integracao-fdv/credencial/testar',
  configuracao: '/empresas/:id/integracao-fdv/configuracao',
  cargaCompleta: '/empresas/:id/integracao-fdv/entidades/:entidade/carga-completa',
  retomar: '/empresas/:id/integracao-fdv/entidades/:entidade/retomar',
  /** T-0086 (`portal-integracao-operacao.ts`): Monitor, Reprocessar (só falhas e pendentes) e Log por cadastro. */
  monitor: '/empresas/:id/integracao-fdv/monitor',
  reprocessar: '/empresas/:id/integracao-fdv/entidades/:entidade/reprocessar',
  log: '/empresas/:id/integracao-fdv/entidades/:entidade/log',
});
