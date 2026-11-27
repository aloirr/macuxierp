/**
 * Contratos do portal `/config` para as cargas de cadastros (T-0058: cargas na v0.3.5a, zerar na v0.3.5b): a aba
 * "Cargas" da ficha da empresa, só do superadmin. Molde: `portal-integracao.ts`.
 *
 * Por que aqui, e não em `modules/cadastros/contracts`: o SDK não importa módulo (fronteira), e a rota de plataforma é
 * consumida pela apps/web (portal), pelo plugin de plataforma do cadastros e pelo worker. O módulo passa a REEXPORTAR a
 * ordem (`ENTIDADES_CARGA` = `ENTIDADES_CARGA_PORTAL`), como na T-0056. Desde a v0.3.6 (R-20261123-160749) nenhuma carga
 * depende de outra e os cadastros são 8. Regra 3: tipos só de Zod. Sem Node: serve à apps/web.
 *
 * - O tenant vem do `:id` da rota (o superadmin não tem tenant na sessão); o D10 da T-0026 continua valendo no BKO.
 * - Carga SÍNCRONA, sem S3, sem fila e sem worker: o validar e o gravar recebem o arquivo (multipart, mesmo limite do
 *   BKO). O gravar roda em três transações: tx1 como config, `cadastros.portal_carga_iniciar(p_tenant, p_cadastro,
 *   p_modo, p_request_id)` confere empresa ativa e licença (MXC04) e audita o início com `superadmin_id`; tx2 como
 *   `macuxierp_app`, com `app.tenant_id` = tenant da rota, roda o mesmo `executarCarga` do BKO; tx3 como config,
 *   `cadastros.portal_carga_concluir(...)` audita o resultado.
 * - O validar só lê: nada vai ao banco e nada fica guardado.
 * - Nada de valor de célula nem dado pessoal: as linhas com erro levam só o número, o motivo e a ação (texto fixo).
 */
import { z } from 'zod';
import { PADRAO_UUID } from './banco';
import { Instante } from './portal-config';
import { InativacaoZerarFdv } from './portal-integracao-operacao';
import { plural } from './texto';

const Id = z.string().regex(PADRAO_UUID);
const Contagem = z.number().int().min(0);

/**
 * Os 8 cadastros da carga (v0.3.6, R-20261123-160749), na ordem do D13 da T-0026 (a mesma do Hub, doc 06). `numero` é a
 * posição na aba; nenhuma carga depende de outra; `opcional` só muda o rótulo
 * ("Unidades (opcional)"); `substituir_permitido` = o cadastro aceita o "Substituir tudo" (decisão do PO, 23/11 15h49: o
 * estoque só aceita o "Adicionar", e a tela nem mostra o "Substituir tudo" nele). `condicao_pagamento` junta forma e
 * prazo; `cliente` absorve o endereço (uma linha por endereço, chave (external_id, tipo_endereco, seq)).
 */
export const CADASTROS_CARGA_PORTAL = Object.freeze([
  { cadastro: 'filial', numero: 1, nome: 'Filiais', opcional: false, substituir_permitido: true },
  { cadastro: 'vendedor', numero: 2, nome: 'Vendedores', opcional: false, substituir_permitido: true },
  { cadastro: 'condicao_pagamento', numero: 3, nome: 'Condições de pagamento', opcional: false, substituir_permitido: true },
  { cadastro: 'produto', numero: 4, nome: 'Produtos', opcional: false, substituir_permitido: true },
  { cadastro: 'produto_unidade', numero: 5, nome: 'Unidades', opcional: true, substituir_permitido: true },
  { cadastro: 'preco', numero: 6, nome: 'Tabelas de preço', opcional: false, substituir_permitido: true },
  { cadastro: 'estoque', numero: 7, nome: 'Estoque', opcional: false, substituir_permitido: false },
  { cadastro: 'cliente', numero: 8, nome: 'Clientes', opcional: false, substituir_permitido: true },
] as const);

/** A ordem (`ENTIDADES_CARGA` do cadastros passa a ser reexport desta lista). */
export const ENTIDADES_CARGA_PORTAL = Object.freeze(CADASTROS_CARGA_PORTAL.map((c) => c.cadastro)) as readonly [
  (typeof CADASTROS_CARGA_PORTAL)[number]['cadastro'],
  ...(typeof CADASTROS_CARGA_PORTAL)[number]['cadastro'][],
];
export const CadastroCargaPortal = z.enum(ENTIDADES_CARGA_PORTAL);
export type CadastroCargaPortal = z.infer<typeof CadastroCargaPortal>;

/** Rótulo da linha na aba: "Unidades (opcional)". */
export function rotuloCadastroCarga(cadastro: CadastroCargaPortal): string {
  const c = CADASTROS_CARGA_PORTAL.find((x) => x.cadastro === cadastro);
  if (!c) throw new RangeError(`rotuloCadastroCarga: cadastro desconhecido "${cadastro}"`);
  return c.opcional ? `${c.nome} (opcional)` : c.nome;
}

// ---- Frases de confirmação ----

/** Confirmação do "Substituir tudo" (Alexandre, R-20261123-145123). */
export const FRASE_SUBSTITUIR_TUDO = 'autorizo substituir tudo';
/** Confirmação do "Zerar dados" (RN-CAD-10 ajustada: no lugar do código da empresa). */
export const FRASE_ZERAR_DADOS = 'autorizo zerar os dados';

/**
 * Normaliza a frase digitada: NFC, sem espaços nas pontas, espaços internos viram um só, minúsculas e sem o ponto final
 * (um ou mais). A tela liga o botão só quando `normalizarFrase(digitado) === FRASE_*`, e a API revalida pelo Zod.
 */
export function normalizarFrase(frase: string): string {
  return frase.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\s*\.+$/, '');
}

/** A frase confere com a esperada (pela normalização acima). */
export const fraseConfere = (digitada: string, esperada: string): boolean => normalizarFrase(digitada) === esperada;

const Frase = z.string().max(200, 'Frase longa demais');

// ---- Situação da aba ----

export const SITUACOES_CARGA = ['carregado', 'com_erro', 'nao_carregado'] as const;
export const SituacaoCarga = z.enum(SITUACOES_CARGA);
export type SituacaoCarga = z.infer<typeof SituacaoCarga>;

/**
 * Situação de um cadastro: `com_erro` se a última carga recusou linhas; senão `carregado` se há registro ativo do
 * cadastro no tenant (venha da carga ou do BKO); senão `nao_carregado`. Pura: o plugin monta a linha com ela.
 */
export function situacaoCarga(e: { ativos: number; erros: number }): SituacaoCarga {
  if (e.erros > 0) return 'com_erro';
  return e.ativos > 0 ? 'carregado' : 'nao_carregado';
}

export const UltimaCarga = z.object({ em: Instante, quantidade: Contagem });
export type UltimaCarga = z.infer<typeof UltimaCarga>;

/**
 * Uma linha da aba. Na carga síncrona não há estado de "em andamento": a concorrência é o 409 `MXC01` na hora de gravar.
 */
export const LinhaSituacaoCarga = z.object({
  numero: z.number().int().min(1).max(ENTIDADES_CARGA_PORTAL.length),
  cadastro: CadastroCargaPortal,
  situacao: SituacaoCarga,
  /** Linhas recusadas na última carga (o chip "N com erro"); 0 fora do `com_erro`. */
  erros: Contagem,
  ultima_carga: UltimaCarga.nullable(),
  /** Sempre true desde a v0.3.6 (nenhuma carga depende de outra); sai quando o apps parar de usar. */
  liberado: z.boolean(),
  opcional: z.boolean(),
});
export type LinhaSituacaoCarga = z.infer<typeof LinhaSituacaoCarga>;

/**
 * `GET .../cadastros/cargas`: as 8 linhas, na ordem da carga (a tela não ordena nem completa). O Zod confere a ordem,
 * o número, o `opcional` e os erros.
 */
export const SituacaoCargasPlataforma = z
  .object({
    empresa_id: Id,
    /** O módulo `cadastros` está licenciado e ativo na empresa; sem ele, as escritas são 422 `RN-CORE-02`. */
    modulo_licenciado: z.boolean(),
    cadastros: z.array(LinhaSituacaoCarga),
  })
  .superRefine((r, ctx) => {
    if (r.cadastros.map((c) => c.cadastro).join(',') !== ENTIDADES_CARGA_PORTAL.join(',')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros'], message: 'Uma linha por cadastro, na ordem da carga' });
      return;
    }
    r.cadastros.forEach((c, i) => {
      const def = CADASTROS_CARGA_PORTAL[i];
      if (!def) return;
      if (c.numero !== def.numero || c.opcional !== def.opcional) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros', i], message: 'Número e opcional são os de CADASTROS_CARGA_PORTAL' });
      }
      if (!c.liberado) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros', i, 'liberado'], message: 'liberado é sempre true' });
      }
      if ((c.erros > 0) !== (c.situacao === 'com_erro')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cadastros', i, 'erros'], message: 'Erros só na situação com_erro' });
      }
    });
  });
export type SituacaoCargasPlataforma = z.infer<typeof SituacaoCargasPlataforma>;

// ---- Modo e efeito do "Substituir tudo" ----

export const MODOS_GRAVAR_CARGA = ['adicionar', 'substituir_tudo'] as const;
export const ModoGravarCarga = z.enum(MODOS_GRAVAR_CARGA);
export type ModoGravarCarga = z.infer<typeof ModoGravarCarga>;

/**
 * Query do validar e do gravar: `?modo=adicionar|substituir_tudo` (padrão `adicionar`). Decisão: o modo vai na query, e
 * não no multipart, para a rota saber o modo antes de ler o arquivo; a frase vai no multipart (campo `frase`), fora da URL.
 */
export const ModoCargaQuery = z.object({ modo: ModoGravarCarga.default('adicionar') });
export type ModoCargaQuery = z.infer<typeof ModoCargaQuery>;

/** O cadastro aceita o "Substituir tudo" (`substituir_permitido` de `CADASTROS_CARGA_PORTAL`; o estoque não aceita). */
export function substituirPermitido(cadastro: CadastroCargaPortal): boolean {
  const c = CADASTROS_CARGA_PORTAL.find((x) => x.cadastro === cadastro);
  if (!c) throw new RangeError(`substituirPermitido: cadastro desconhecido "${cadastro}"`);
  return c.substituir_permitido;
}

export const MENSAGEM_SUBSTITUIR_NAO_PERMITIDO = 'Este cadastro só aceita o Adicionar';

/** Recusa `substituir_tudo` em cadastro com `substituir_permitido = false`: 400 `VALIDACAO` no campo `modo`. */
function conferirModoPermitido(r: { cadastro: CadastroCargaPortal; modo: ModoGravarCarga }, ctx: z.RefinementCtx): void {
  if (r.modo === 'substituir_tudo' && !substituirPermitido(r.cadastro)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modo'], message: MENSAGEM_SUBSTITUIR_NAO_PERMITIDO });
  }
}

/**
 * Entrada do validar: o plugin monta com o `:cadastro` da rota e o `modo` da query (`ModoCargaQuery`). `substituir_tudo`
 * em cadastro que não aceita (estoque) = 400 `VALIDACAO` no campo `modo`.
 */
export const ValidarCargaPlataformaEntrada = z
  .object({ cadastro: CadastroCargaPortal, modo: ModoGravarCarga })
  .superRefine(conferirModoPermitido);
export type ValidarCargaPlataformaEntrada = z.infer<typeof ValidarCargaPlataformaEntrada>;

/** Limite do FDV para inativação, em % dos ativos (o Hub segura o lote acima disso); o ERP só avisa, não bloqueia. */
export const LIMITE_INATIVACAO_FDV_PCT = 30;

/**
 * Efeito do "Substituir tudo" num cadastro: `total` = ativos de hoje no tenant; `a_inativar` = os que não vêm no arquivo;
 * `percentual` = `a_inativar * 100 / total` (0 sem ativos, sem arredondar: a tela formata); `acima_limite_fdv` =
 * `percentual > LIMITE_INATIVACAO_FDV_PCT`; `sem_chave` (opcional) = registros sem `external_id`, criados no BKO, que
 * ficam fora da inativação (o banco devolve pela `carga_inativar_ausentes`); `inativados_em_uso` (opcional, ≤
 * `a_inativar`) = os inativados que estavam em uso em pedido, título ou nota e continuam no histórico (decisão do PO,
 * 23/11 21h57); `enderecos_a_inativar` (opcional, só no cadastro `cliente`) = endereços de cliente que o Substituir
 * tudo inativa junto; `enderecos_sem_chave` (opcional, só no cadastro `cliente`) = endereços sem `external_id` que
 * ficam fora da substituição. Textos de exibição em `AVISOS_CARGA_PORTAL`.
 */
export const EfeitoSubstituir = z
  .object({
    total: Contagem,
    a_inativar: Contagem,
    percentual: z.number().min(0).max(100),
    acima_limite_fdv: z.boolean(),
    sem_chave: Contagem.optional(),
    enderecos_a_inativar: Contagem.optional(),
    inativados_em_uso: Contagem.optional(),
    enderecos_sem_chave: Contagem.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.a_inativar > e.total) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['a_inativar'], message: 'Não inativa mais que os ativos' });
      return;
    }
    if (e.inativados_em_uso !== undefined && e.inativados_em_uso > e.a_inativar) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inativados_em_uso'], message: 'Em uso não passa de a_inativar' });
    }
    const esperado = efeitoSubstituir({ total: e.total, a_inativar: e.a_inativar });
    if (e.percentual !== esperado.percentual || e.acima_limite_fdv !== esperado.acima_limite_fdv) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentual'], message: 'Percentual e limite derivados de efeitoSubstituir' });
    }
  });
export type EfeitoSubstituir = z.infer<typeof EfeitoSubstituir>;

const MENSAGEM_ENDERECOS_SO_CLIENTE = 'Endereços só no Substituir tudo do cadastro cliente';

/** Recusa `efeito.enderecos_a_inativar` e `efeito.enderecos_sem_chave` fora do cadastro `cliente` (validar e gravar). */
function conferirEnderecosEfeito(
  r: { cadastro: CadastroCargaPortal; efeito?: EfeitoSubstituir | undefined },
  ctx: z.RefinementCtx,
): void {
  if (r.cadastro === 'cliente' || r.efeito === undefined) return;
  for (const campo of ['enderecos_a_inativar', 'enderecos_sem_chave'] as const) {
    if (r.efeito[campo] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['efeito', campo], message: MENSAGEM_ENDERECOS_SO_CLIENTE });
    }
  }
}

/** Calcula o efeito (pura; o plugin e a tela usam a mesma). */
export function efeitoSubstituir(e: {
  total: number;
  a_inativar: number;
  sem_chave?: number;
  enderecos_a_inativar?: number;
  inativados_em_uso?: number;
  enderecos_sem_chave?: number;
}): EfeitoSubstituir {
  if (!Number.isInteger(e.total) || !Number.isInteger(e.a_inativar) || e.total < 0 || e.a_inativar < 0 || e.a_inativar > e.total) {
    throw new RangeError('efeitoSubstituir: contagens inteiras, com a_inativar entre 0 e total');
  }
  const conferirContagemOpcional = (nome: string, v: number | undefined): void => {
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
      throw new RangeError(`efeitoSubstituir: ${nome} é contagem inteira e não negativa`);
    }
  };
  const opcionais = ['sem_chave', 'enderecos_a_inativar', 'inativados_em_uso', 'enderecos_sem_chave'] as const;
  for (const nome of opcionais) conferirContagemOpcional(nome, e[nome]);
  if (e.inativados_em_uso !== undefined && e.inativados_em_uso > e.a_inativar) {
    throw new RangeError('efeitoSubstituir: inativados_em_uso entre 0 e a_inativar');
  }
  const percentual = e.total === 0 ? 0 : (e.a_inativar * 100) / e.total;
  const efeito: EfeitoSubstituir = { total: e.total, a_inativar: e.a_inativar, percentual, acima_limite_fdv: percentual > LIMITE_INATIVACAO_FDV_PCT };
  for (const nome of opcionais) {
    const v = e[nome];
    if (v !== undefined) efeito[nome] = v;
  }
  return efeito;
}

// ---- Validar ----

/** Quantas linhas com erro a resposta do validar traz; o resto sai no "Baixar erros" (até `MAX_ERROS_RELATORIO` do cadastros). */
export const LIMITE_LINHAS_ERRO_VALIDACAO = 200;
/** Teto do arquivo no portal: o mesmo do lote do BKO (D7 da T-0026, `MAX_BYTES_LOTE` e `MAX_LINHAS_LOTE`). */
export const MAX_BYTES_ARQUIVO_CARGA_PORTAL = 10 * 1024 * 1024;
export const MAX_LINHAS_ARQUIVO_CARGA_PORTAL = 20_000;
/** Campos do multipart do validar, do erros e do gravar (`frase` só no gravar). */
export const CAMPO_ARQUIVO_CARGA_PORTAL = 'arquivo';
export const CAMPO_FRASE_CARGA_PORTAL = 'frase';

/** Uma linha com erro: número da linha do CSV (`null` = o arquivo inteiro, ex.: cabeçalho), motivo e ação, em texto fixo. */
export const LinhaErroValidacao = z.object({
  linha: z.number().int().min(1).nullable(),
  motivo: z.string().min(1).max(200),
  acao: z.string().min(1).max(200),
});
export type LinhaErroValidacao = z.infer<typeof LinhaErroValidacao>;

/**
 * `POST .../cargas/:cadastro/validar?modo=...` (multipart, campo `arquivo`): conferência sem gravar nada. `prontas` e
 * `com_erro` contam linhas do CSV (arquivo recusado inteiro, ex.: cabeçalho: `prontas` 0 e `com_erro` = linhas lidas, no
 * mínimo 1, com um item de `linha` nula); `linhas` traz até `LIMITE_LINHAS_ERRO_VALIDACAO` erros e `linhas_omitidas` o
 * resto. `efeito` vem só no modo `substituir_tudo`.
 */
export const ValidarCargaPlataformaResposta = z
  .object({
    cadastro: CadastroCargaPortal,
    modo: ModoGravarCarga,
    prontas: Contagem,
    com_erro: Contagem,
    linhas: z.array(LinhaErroValidacao).max(LIMITE_LINHAS_ERRO_VALIDACAO),
    linhas_omitidas: Contagem,
    efeito: EfeitoSubstituir.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.linhas_omitidas > 0 && r.linhas.length < LIMITE_LINHAS_ERRO_VALIDACAO) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linhas_omitidas'], message: 'Só há omitidas com a lista cheia' });
    }
    if ((r.com_erro === 0) !== (r.linhas.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linhas'], message: 'Lista de erros só com linhas com erro' });
    }
    conferirModoPermitido(r, ctx);
    if ((r.modo === 'substituir_tudo') !== (r.efeito !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['efeito'], message: 'Efeito só, e sempre, no Substituir tudo' });
    }
    conferirEnderecosEfeito(r, ctx);
  });
export type ValidarCargaPlataformaResposta = z.infer<typeof ValidarCargaPlataformaResposta>;

// ---- Gravar ----

export const MENSAGEM_FRASE_SUBSTITUIR = `Digite "${FRASE_SUBSTITUIR_TUDO}" para confirmar`;
export const MENSAGEM_FRASE_ZERAR = `Digite "${FRASE_ZERAR_DADOS}" para confirmar`;

/**
 * `POST .../cargas/:cadastro/gravar?modo=...` (multipart: `arquivo` de novo e `frase?`; sem `Idempotency-Key` (rota por etapa,
 * ADR 0013 A1): a concorrência é barrada pelo MXC01 e o reenvio não duplica dados (o `external_id` protege), mas grava uma
 * execução e auditorias novas; deduplicar o reenvio fica para a versão seguinte). O plugin monta esta entrada com o `:cadastro` da rota, o `modo` da query e a `frase` do multipart. `adicionar` = o delta de hoje (acrescenta
 * e atualiza, sem tirar nada), sem frase. `substituir_tudo` = carga completa: exige `frase` = `FRASE_SUBSTITUIR_TUDO`
 * (pela `normalizarFrase`) e inativa o que não vem no arquivo, nunca apaga. Frase errada ou fora do modo = 400 `VALIDACAO`;
 * `substituir_tudo` em cadastro que não aceita (estoque) = 400 `VALIDACAO` no campo `modo`.
 */
export const GravarCargaPlataformaEntrada = z
  .object({ cadastro: CadastroCargaPortal, modo: ModoGravarCarga, frase: Frase.optional() })
  .superRefine((r, ctx) => {
    conferirModoPermitido(r, ctx);
    if (r.modo === 'substituir_tudo' && (r.frase === undefined || !fraseConfere(r.frase, FRASE_SUBSTITUIR_TUDO))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['frase'], message: MENSAGEM_FRASE_SUBSTITUIR });
    }
    if (r.modo === 'adicionar' && r.frase !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['frase'], message: 'A frase é só do Substituir tudo' });
    }
  });
export type GravarCargaPlataformaEntrada = z.infer<typeof GravarCargaPlataformaEntrada>;

/**
 * `200`: a carga terminou na própria requisição. `gravadas` = linhas aceitas; `com_erro` = recusadas; `inativadas` e
 * `efeito` só no `substituir_tudo`; `enderecos_inativados` (opcional) = endereços de cliente inativados, só no
 * `substituir_tudo` do cadastro `cliente`. Nenhuma linha pronta = 409 `nada_a_gravar` (nada roda).
 */
export const GravarCargaPlataformaResposta = z
  .object({
    cadastro: CadastroCargaPortal,
    modo: ModoGravarCarga,
    gravadas: Contagem,
    com_erro: Contagem,
    inativadas: Contagem.optional(),
    efeito: EfeitoSubstituir.optional(),
    enderecos_inativados: Contagem.optional(),
  })
  .superRefine((r, ctx) => {
    conferirModoPermitido(r, ctx);
    if (r.enderecos_inativados !== undefined && (r.modo !== 'substituir_tudo' || r.cadastro !== 'cliente')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['enderecos_inativados'], message: MENSAGEM_ENDERECOS_SO_CLIENTE });
    }
    conferirEnderecosEfeito(r, ctx);
    const substituir = r.modo === 'substituir_tudo';
    if (substituir !== (r.inativadas !== undefined) || substituir !== (r.efeito !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inativadas'], message: 'Inativadas e efeito só, e sempre, no Substituir tudo' });
    }
    if (r.gravadas === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gravadas'], message: 'Sem linha gravada a resposta é 409 nada_a_gravar' });
    }
  });
export type GravarCargaPlataformaResposta = z.infer<typeof GravarCargaPlataformaResposta>;

// ---- Zerar (v0.3.5b) ----

/**
 * Os cadastros do "Zerar dados" (RN-CAD-10): os mesmos 8 da carga, na mesma ordem (v0.3.6). Lista literal, e não
 * derivada, para o enum ficar explícito; o teste trava a igualdade com `ENTIDADES_CARGA_PORTAL`. `condicao_pagamento`
 * zera forma e prazo juntos; `cliente` zera o cliente com os endereços e os contatos.
 */
export const CADASTROS_ZERAR_PORTAL = [
  'filial',
  'vendedor',
  'condicao_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
] as const;
export const CadastroZerarPortal = z.enum(CADASTROS_ZERAR_PORTAL);
export type CadastroZerarPortal = z.infer<typeof CadastroZerarPortal>;

/** As tabelas do schema `cadastros` que o zerar apaga (as tabelas oficiais e a `consulta_externa` ficam). */
export const TABELAS_ZERAGEM = [
  'filial',
  'vendedor',
  'condicao_pagamento',
  'produto',
  'produto_unidade',
  'tabela_preco',
  'tabela_preco_item',
  'estoque_saldo',
  'estoque_movimento',
  'cliente',
  'cliente_contato',
  'cliente_endereco',
] as const;
export const TabelaZeragem = z.enum(TABELAS_ZERAGEM);
export type TabelaZeragem = z.infer<typeof TabelaZeragem>;

/**
 * Por que um registro ficou: está em uso por pedido, título ou nota, ou é filial com dado fiscal (`fiscal`, decisão do
 * PO, 23/11 16h18).
 */
export const MOTIVOS_USO = ['pedido', 'titulo', 'nota', 'fiscal'] as const;
export type MotivoUsoZerar = (typeof MOTIVOS_USO)[number];

/** `detalhes.codigo` do 422 do zerar quando `bloqueios` não está vazio (sem SQLSTATE: o plugin decide). */
export const CODIGO_ZERAGEM_BLOQUEADA = 'zeragem_bloqueada';

/** `detalhes.codigo` do 422 RN-CAD-10 quando a frase de confirmação (`FRASE_ZERAR_DADOS`, `FRASE_SUBSTITUIR_TUDO`) não confere. */
export const CODIGO_FRASE_NAO_CONFERE = 'frase_nao_confere';

const semRepetir = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length;

/** `POST .../cadastros/zerar/previa` (só lê, sem `Idempotency-Key`): o que o zerar faria com estes cadastros. */
export const PreviaZerarPlataformaEntrada = z.object({
  cadastros: z
    .array(CadastroZerarPortal)
    .min(1)
    .max(CADASTROS_ZERAR_PORTAL.length)
    .refine(semRepetir, { message: 'Cadastro repetido' }),
});
export type PreviaZerarPlataformaEntrada = z.infer<typeof PreviaZerarPlataformaEntrada>;

/**
 * A frase de confirmação de todo "Zerar" do portal (RN-CAD-10): `FRASE_ZERAR_DADOS` pela `normalizarFrase`, até 200
 * caracteres. Fonte única para o zerar por cadastro e o de pedidos (RD-1824).
 */
export const FraseZerarDados = Frase.refine((f) => fraseConfere(f, FRASE_ZERAR_DADOS), { message: MENSAGEM_FRASE_ZERAR });

/** `POST .../cadastros/zerar` (`Idempotency-Key` obrigatória): RN-CAD-10, confirmado por `FRASE_ZERAR_DADOS`. */
export const ZerarDadosPlataformaEntrada = PreviaZerarPlataformaEntrada.extend({ frase: FraseZerarDados });
export type ZerarDadosPlataformaEntrada = z.infer<typeof ZerarDadosPlataformaEntrada>;

/**
 * Resposta da prévia (`simulado` true) e do zerar (`simulado` false). `efetivos` = cadastros zerados (ou que seriam);
 * `apagados` por tabela; `anulados` = referências do cliente que viram `null`; `mantidos` = registros em uso que ficam;
 * `bloqueios` = cadastros que impedem o zerar (só na prévia: no zerar, bloqueio é 422 `CODIGO_ZERAGEM_BLOQUEADA`);
 * `sem_chave` = registros sem `external_id`; `inativacao_fdv` (T-0086, emenda da RN-CAD-10 de 24/11/2026) = registros
 * já publicados no FDV que o zerar deixa com a inativação pendente (ausente = nada a inativar).
 */
export const ZeragemPlataformaResposta = z
  .object({
    empresa_id: Id,
    simulado: z.boolean(),
    efetivos: z.array(CadastroZerarPortal),
    apagados: z.array(z.object({ tabela: TabelaZeragem, quantidade: Contagem })),
    anulados: z.array(
      z.object({
        tabela: z.literal('cliente'),
        coluna: z.enum(['vendedor_id', 'tabela_preco_id', 'condicao_pagamento_id']),
        quantidade: Contagem,
      }),
    ),
    mantidos: z.array(z.object({ cadastro: CadastroZerarPortal, motivo: z.enum(MOTIVOS_USO), quantidade: Contagem })),
    /** Só 'lote_em_andamento' bloqueia; a integração ligada inativa no FDV (migração 0053, RN-CAD-10). */
    bloqueios: z.array(z.object({ cadastro: CadastroZerarPortal, motivo: z.enum(['lote_em_andamento']) })),
    sem_chave: Contagem,
    inativacao_fdv: InativacaoZerarFdv.optional(),
  })
  .superRefine((r, ctx) => {
    if (!semRepetir(r.efetivos)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['efetivos'], message: 'Cadastro repetido' });
    if (!semRepetir(r.apagados.map((a) => a.tabela))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apagados'], message: 'Tabela repetida' });
    if (!r.simulado && r.bloqueios.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bloqueios'], message: `Zerar com bloqueio é 422 ${CODIGO_ZERAGEM_BLOQUEADA}` });
    }
  });
export type ZeragemPlataformaResposta = z.infer<typeof ZeragemPlataformaResposta>;

// ---- Erros ----

/**
 * SQLSTATE da `cadastros.portal_carga_iniciar` (banco-dados) e do plugin → erro HTTP (`apps/api/src/plataforma/erros.ts`).
 * O DETAIL só passa a `detalhes.codigo` quando está em `CODIGOS_DETALHE_CARGA_PORTAL`.
 */
export const SQLSTATES_CARGA_PORTAL = Object.freeze({
  /** 409 `CONFLITO` "carga em andamento": já há carga rodando nesta empresa (uma por vez). */
  cargaEmAndamento: 'MXC01',
  /** 422 `RN-CORE-02`: empresa fora de `ativo` ou sem o módulo `cadastros` (molde do `MXI04`). */
  semLicenca: 'MXC04',
});

export const MENSAGENS_CARGA_PORTAL = Object.freeze({
  cargaEmAndamento: 'Já há uma carga em andamento nesta empresa.',
  semLicenca: 'A empresa precisa estar ativa e com o módulo Cadastros licenciado.',
  nadaAGravar: 'Nenhuma linha pronta para gravar.',
  zeragemBloqueada: 'Há um envio ao Macuxi FDV em andamento. Espere terminar para zerar.',
  /** 409 `CONFLITO` do `MXC03` do zerar (`CODIGOS_ESTADO_MUDOU_ZERAR`): o estado mudou entre o plano e o efeito. */
  estadoMudouZerar: 'Os dados mudaram. Confira de novo.',
});

/** `n` do aviso: contagem inteira e não negativa; fora disso, RangeError. */
function contagemAviso(nome: string, n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`AVISOS_CARGA_PORTAL.${nome}: contagem inteira e não negativa`);
  return n;
}

/**
 * Avisos do Substituir tudo (T-0075), a partir do `EfeitoSubstituir`, para a prévia e o resultado do BKO: `null` com 0
 * (nada a avisar); RangeError fora de inteiro ≥ 0.
 */
export const AVISOS_CARGA_PORTAL = Object.freeze({
  /**
   * Resultado do Substituir tudo: `efeito.a_inativar` e `efeito.inativados_em_uso` (ausente = 0). "Inativados: 12" ou
   * "Inativados: 12 (3 em uso: continuam nos pedidos, títulos e notas)", sem flexão. `null` com 0 inativados;
   * RangeError com `emUso` > `inativados`.
   */
  inativados(inativados: number, emUso: number): string | null {
    contagemAviso('inativados', inativados);
    contagemAviso('inativados', emUso);
    if (emUso > inativados) throw new RangeError('AVISOS_CARGA_PORTAL.inativados: emUso entre 0 e inativados');
    if (inativados === 0) return null;
    return emUso === 0 ? `Inativados: ${inativados}` : `Inativados: ${inativados} (${emUso} em uso: continuam nos pedidos, títulos e notas)`;
  },
  /** `efeito.sem_chave`. */
  semChave(n: number): string | null {
    if (contagemAviso('semChave', n) === 0) return null;
    const [ficou, ele, entrar] = n === 1 ? ['ficou', 'ele', 'entrar'] : ['ficaram', 'eles', 'entrarem'];
    return `${plural(n, 'registro', 'registros')} sem código ${ficou} fora da substituição: dê um código a ${ele} para ${entrar} na próxima`;
  },
  /** `efeito.enderecos_sem_chave` (só no cliente). */
  enderecosSemChave(n: number): string | null {
    if (contagemAviso('enderecosSemChave', n) === 0) return null;
    return `${plural(n, 'endereço', 'endereços')} sem código ${n === 1 ? 'ficou' : 'ficaram'} fora da substituição`;
  },
});

/**
 * DETAIL do `MXC03` da `cadastros.portal_zerar` (0043, RN-CAD-10): o estado mudou entre o plano e o efeito. A API repassa
 * em `detalhes.codigo` do 409 `CONFLITO` só estes; fora da lista, o texto do banco não passa.
 */
export const CODIGOS_ESTADO_MUDOU_ZERAR = ['em_uso', 'sumiu', 'anular_fora_do_plano', 'referencia'] as const;

/**
 * `detalhes.codigo` dos erros do portal de cargas (409 `CONFLITO` e 422): do DETAIL das funções e do plugin. Fora desta
 * lista, o texto do banco não passa.
 */
export const CODIGOS_DETALHE_CARGA_PORTAL = [
  'carga_em_andamento',
  'empresa_inativa',
  'modulo_desligado',
  'nada_a_gravar',
  CODIGO_ZERAGEM_BLOQUEADA,
  CODIGO_FRASE_NAO_CONFERE,
] as const;
export const CodigoDetalheCargaPortal = z.enum(CODIGOS_DETALHE_CARGA_PORTAL);
export type CodigoDetalheCargaPortal = z.infer<typeof CodigoDetalheCargaPortal>;

// ---- Carga do cliente (endereços) ----

/** Tipos de endereço da carga do cliente (uma linha por endereço, chave (external_id, tipo_endereco, seq)). */
export const TIPOS_ENDERECO_CLIENTE = ['principal', 'entrega', 'cobranca'] as const;
export type TipoEnderecoCliente = (typeof TIPOS_ENDERECO_CLIENTE)[number];

/**
 * Erro da linha do cliente cujos dados do cliente (fora do endereço) diferem da primeira linha do mesmo cliente:
 * `linha` = a linha do CSV de referência. Texto fixo, sem valor de célula.
 */
export function dadosClienteDiferentes(linha: number): string {
  if (!Number.isInteger(linha) || linha < 1) throw new RangeError('dadosClienteDiferentes: linha inteira a partir de 1');
  return `Dados do cliente diferentes da linha ${linha}: deixe iguais em todas as linhas do cliente`;
}

// ---- Rotas ----

/**
 * Caminhos relativos a `/v1/plataforma` (fonte única para o plugin do cadastros, a apps/web e os testes de isolamento).
 * `erros`: `POST` com o mesmo arquivo do validar (nada fica guardado) e resposta em CSV com todas as linhas com erro
 * (`TIPO_CSV` do SDK, como o `modelo`).
 */
export const CAMINHOS_CARGAS_PLATAFORMA = Object.freeze({
  situacao: '/empresas/:id/cadastros/cargas',
  modelo: '/empresas/:id/cadastros/cargas/:cadastro/modelo',
  validar: '/empresas/:id/cadastros/cargas/:cadastro/validar',
  erros: '/empresas/:id/cadastros/cargas/:cadastro/erros',
  gravar: '/empresas/:id/cadastros/cargas/:cadastro/gravar',
  previa: '/empresas/:id/cadastros/zerar/previa',
  zerar: '/empresas/:id/cadastros/zerar',
});

/** Nome do arquivo dos downloads: `modelo-<cadastro>.csv` e `erros-<cadastro>.csv`. */
export const nomeModeloCarga = (cadastro: CadastroCargaPortal): string => `modelo-${cadastro}.csv`;
export const nomeErrosCarga = (cadastro: CadastroCargaPortal): string => `erros-${cadastro}.csv`;
