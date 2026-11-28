/**
 * Contratos do portal de configuração da plataforma (`/config`, ADR 0012): a identidade do superadmin fica FORA dos
 * tenants e das rotas de módulo (`/v1/<modulo>`), por isso o contrato mora no SDK, como o `EuResposta`: a apps/api
 * (rotas `/v1/plataforma/*`), o modulo-core (o executar das rotas de empresa) e a apps/web (o portal) importam a mesma
 * fonte. Regra 3: tipos só de Zod.
 *
 * - O superadmin cria a empresa, liga e desliga módulos (respeitando o `depende` dos manifestos, RN-CORE-02), cria o 1º
 *   administrador, redefine a senha dele e suspende/reativa a empresa. Sem impersonação e sem dado de negócio do tenant.
 * - A senha provisória aparece só na resposta (`PrimeiroAdminResposta`), com `CABECALHOS_SENHA_PROVISORIA`; nunca o hash.
 * - O token da sessão do superadmin vai só no cookie (`COOKIE_CONFIG`); nunca no corpo.
 * Sem Node: serve à apps/web.
 */
import { z } from 'zod';
import { moduloLicenciado, MODULOS_BASE, type Licenca } from './acesso';
import { PADRAO_UUID } from './banco';
import { PADRAO_CNPJ, PADRAO_UF, UFS } from './documentos';
import { violacao, type Violacao } from './erros';
import { MOTIVOS_TROCA_SENHA, TrocarSenhaEntrada } from './eu';
import { MODULOS, type ModuloId } from './modulo';
import { SenhaInformada } from './senha';

const Id = z.string().regex(PADRAO_UUID);
/** Instante ISO 8601 UTC (como sai do `toISOString`). */
export const Instante = z.string().datetime();
/** E-mail de usuário (superadmin e usuário do tenant): sem espaços nas pontas, minúsculo, até 254 (RFC 5321). */
export const EmailUsuario = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'E-mail inválido');
export type EmailUsuario = z.infer<typeof EmailUsuario>;

/** Cookie da sessão do superadmin: próprio, httpOnly, Secure, SameSite=Strict, nunca o `macuxierp_refresh` do tenant. */
export const COOKIE_CONFIG = 'macuxierp_config';
/** Prefixo das rotas de plataforma na API (fora do `/v1/<modulo>`). */
export const PREFIXO_PLATAFORMA = '/v1/plataforma';
/** Cabeçalho anti-CSRF das escritas do portal (o navegador não o manda em formulário de outro site). */
export const CABECALHO_CSRF_CONFIG = 'x-macuxierp-config';
/**
 * Prova do BFF da apps/web (T-0050): o valor de `MACUXIERP_SEGREDO_BFF`, que só a api e o web recebem (gerado na VM).
 * Com a prova certa, a API usa `CABECALHO_IP_CLIENTE` no limite de login por IP; sem ela, o cabeçalho é ignorado.
 */
export const CABECALHO_PROVA_BFF = 'x-macuxierp-bff';
/** IP do navegador que o BFF viu (o `cf-connecting-ip` que chegou a ele); só vale junto com `CABECALHO_PROVA_BFF`. */
export const CABECALHO_IP_CLIENTE = 'x-macuxierp-ip-cliente';

/** CHECK de `plataforma.tenant.slug` (0002). `referencia` é o slug do tenant das tabelas oficiais: nunca se cria. */
export const PADRAO_SLUG_EMPRESA = /^[a-z0-9][a-z0-9-]{1,39}$/;
/**
 * Slug reservado da plataforma (T-0076): nunca vira empresa (está em `SLUGS_RESERVADOS`). Desde a ADR 0021 (§5) não é
 * mais caminho de login: o superadmin entra com e-mail e senha na mesma tela.
 */
export const SLUG_RESERVADO_SUPERADMIN = 'macuxi';
/**
 * Slugs que a criação de empresa recusa. Espelho no banco: 0033 e 0037 (`referencia`, `config`, `plataforma`) e o CHECK
 * do código reservado (`macuxi`, T-0076: 23514 com DETAIL `DETALHE_CODIGO_RESERVADO`); mudou aqui, muda lá (migração nova).
 */
export const SLUGS_RESERVADOS: readonly string[] = Object.freeze(['referencia', 'config', 'plataforma', SLUG_RESERVADO_SUPERADMIN]);
/** DETAIL do 23514 do CHECK do código reservado: a API repassa em `detalhes.codigo`, com `MENSAGEM_CODIGO_RESERVADO`. */
export const DETALHE_CODIGO_RESERVADO = 'codigo_reservado_superadmin';
export const MENSAGEM_CODIGO_RESERVADO = `O código ${SLUG_RESERVADO_SUPERADMIN.toUpperCase()} é reservado e não pode ser usado por uma empresa.`;

/**
 * Código da empresa (RN-CORE-11, T-0053): o MESMO código da licença do Macuxi FDV, UF + 4 dígitos (ex.: AM2808). Único
 * sem diferenciar maiúsculas; o login também não diferencia. Empresa sem FDV recebe UF + 4 dígitos sorteados. No banco
 * fica em `plataforma.tenant.slug`, em minúsculas (cabe no CHECK de 0002, que não muda); na tela, em maiúsculas.
 * O scripts/deploy/producao/empresa.mjs tem cópia de `UFS` e deste padrão (o teste apps/api/src/operador-codigo.test.ts trava).
 */
export const PADRAO_CODIGO_EMPRESA = /^[A-Za-z]{2}[0-9]{4}$/;
const MENSAGEM_CODIGO = 'Código do FDV: UF + 4 dígitos, ex.: AM2808';
const ufValida = (uf: string): boolean => (UFS as readonly string[]).includes(uf);

/** Código do FDV informado: aparado, em maiúsculas, UF + 4 dígitos com UF existente. */
export const CodigoEmpresa = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PADRAO_CODIGO_EMPRESA, MENSAGEM_CODIGO)
  .refine((c) => ufValida(c.slice(0, 2)), MENSAGEM_CODIGO);
export type CodigoEmpresa = z.infer<typeof CodigoEmpresa>;

/** Código → `plataforma.tenant.slug` (minúsculas). Não valida: passe antes por `CodigoEmpresa`. */
export function codigoParaSlug(codigo: string): string {
  return codigo.trim().toLowerCase();
}

/** `plataforma.tenant.slug` → código em maiúsculas; `null` quando o slug não é UF válida + 4 dígitos (ex.: slug antigo). */
export function codigoDaEmpresa(slug: string): string | null {
  if (!PADRAO_CODIGO_EMPRESA.test(slug)) return null;
  const codigo = slug.toUpperCase();
  return ufValida(codigo.slice(0, 2)) ? codigo : null;
}

/** Situações visíveis no portal. `referencia` (tabelas oficiais) nunca é listada. */
export const SITUACOES_EMPRESA = ['ativo', 'suspenso', 'encerrado'] as const;

export const LicencaModuloPlataforma = z.object({ modulo: z.enum(MODULOS), ativo: z.boolean(), valido_ate: Instante.nullable() });
export type LicencaModuloPlataforma = z.infer<typeof LicencaModuloPlataforma>;

/**
 * A empresa (tenant) como o superadmin vê: cadastro de plataforma, licenças e o estado do 1º admin (sem e-mail completo
 * nem nome). Detalhe da empresa (T-0050, decisão do Alexandre e do PO em 23/11/2026): razão social, CNPJ, cidade/UF e o
 * e-mail do 1º admin mascarado; todos opcionais e anuláveis (contrato antigo continua válido; a lista pode omiti-los).
 * O e-mail completo só por ação explícita e auditada (`plataforma.admin.revelar_email` → `EmailPrimeiroAdminResposta`).
 */
export const EmpresaPlataforma = z.object({
  id: Id,
  slug: z.string().regex(PADRAO_SLUG_EMPRESA),
  nome: z.string().min(2).max(120),
  fuso: z.string().min(1),
  situacao: z.enum(SITUACOES_EMPRESA),
  modulos: z.array(LicencaModuloPlataforma),
  primeiro_admin: z
    .object({
      id: Id,
      ativo: z.boolean(),
      bloqueado: z.boolean(),
      /**
       * E-mail mascarado, gerado pelo banco (padrão do PO): as 2 primeiras letras do local + `****` + `@` + o domínio
       * inteiro (`admin@acme.com.br` → `ad****@acme.com.br`); local com 1 ou 2 letras vira `*` + `****`
       * (`ab@acme.com.br` → `*****@acme.com.br`). Só string: o formato é do banco, sem regex aqui.
       */
      email_mascarado: z.string().nullable().optional(),
    })
    .nullable(),
  /** Razão social do cadastro da empresa (de MEI pode ser dado pessoal: nunca vai para log nem para a auditoria). */
  razao_social: z.string().nullable().optional(),
  /**
   * CNPJ sem máscara, como no banco; numérico ou alfanumérico. Contrato de RESPOSTA (não derruba a resposta por DV):
   * formato do domínio plataforma.cnpj; o DV é conferido no cadastro (RN-CAD-01).
   */
  cnpj: z.string().regex(PADRAO_CNPJ).nullable().optional(),
  cidade: z.string().nullable().optional(),
  uf: z.string().regex(PADRAO_UF, 'UF com 2 letras maiúsculas').nullable().optional(),
  /** Código da empresa (RN-CORE-11) em maiúsculas, preenchido pelo core (`codigoDaEmpresa(slug)`); null em slug antigo. */
  codigo: z.string().nullable().optional(),
  /**
   * A empresa também usa o Macuxi FDV (`plataforma.empresa_json`, migração 0080; mapeado pelo core). Ausente = `false`
   * (contrato antigo continua válido).
   */
  tem_fdv: z.boolean().default(false),
  created_at: Instante,
  updated_at: Instante,
});
export type EmpresaPlataforma = z.infer<typeof EmpresaPlataforma>;

/** Resposta da revelação do e-mail completo do 1º admin (T-0050). */
export const EmailPrimeiroAdminResposta = z.object({ email: EmailUsuario });
export type EmailPrimeiroAdminResposta = z.infer<typeof EmailPrimeiroAdminResposta>;

/**
 * Criação da empresa (RN-CORE-11), fase 2: entrada com exatamente um entre `codigo` (o código da licença do FDV) e
 * `slug` (legado), ou então só a `uf`, para o core sortear UF + 4 dígitos. Com `codigo`, a `uf`, se vier, é o prefixo dele.
 * Na SAÍDA, `slug` é o código em minúsculas (ou o slug legado) e fica `null` quando veio só a `uf` (o core sorteia).
 */
export const CriarEmpresaEntrada = z
  .object({
    codigo: CodigoEmpresa.optional(),
    /**
     * LEGADO: até o /config do apps enviar `codigo`. Nunca junto com `codigo` nem com `uf`. `null` = ausente (a saída
     * manda `slug: null` quando veio só a `uf`, e o apps reenvia a saída à API).
     */
    slug: z
      .string()
      .regex(PADRAO_SLUG_EMPRESA, 'Use de 2 a 40 letras minúsculas, dígitos ou hífen, começando por letra ou dígito')
      .refine((s) => !SLUGS_RESERVADOS.includes(s), 'Slug reservado')
      .nullish(),
    /** `null` = ausente (a saída manda `uf: null`, e o apps reenvia a saída à API). */
    uf: z.enum(UFS).nullish(),
    /** Nome legal (de MEI pode ser dado pessoal): nunca vai para log nem para a auditoria (ADR 0012). */
    nome: z.string().trim().min(2).max(120),
    fuso: z
      .string()
      .regex(/^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/, 'Fuso IANA, ex.: America/Manaus')
      .default('America/Manaus'),
  })
  .transform((e, ctx) => {
    const uf = e.uf ?? null;
    const slugLegado = e.slug ?? null;
    if (e.codigo === undefined && slugLegado === null) {
      if (uf !== null) return { slug: null, uf, nome: e.nome, fuso: e.fuso };
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['codigo'], message: 'Informe o código do FDV ou a UF para sortear' });
      return z.NEVER;
    }
    if (e.codigo !== undefined && slugLegado !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slug'], message: 'Informe o código do FDV, sem o slug' });
      return z.NEVER;
    }
    if (uf !== null && (e.codigo === undefined || !e.codigo.startsWith(uf))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uf'], message: 'A UF precisa ser a do código' });
      return z.NEVER;
    }
    const slug: string | null = e.codigo !== undefined ? codigoParaSlug(e.codigo) : slugLegado;
    return { slug, uf, nome: e.nome, fuso: e.fuso };
  });
/** Depois do parse: `slug` é o código em minúsculas (ou o legado), ou `null` quando veio só a `uf` (sorteio no core). */
export type CriarEmpresaEntrada = z.infer<typeof CriarEmpresaEntrada>;

/** Mudança de licenças: só os módulos citados mudam; o core (`MODULOS_BASE`) nunca é desligado. */
export const AlterarModulosEntrada = z.object({
  modulos: z
    .array(LicencaModuloPlataforma.extend({ valido_ate: Instante.nullable().default(null) }))
    .min(1)
    .max(MODULOS.length)
    .refine((ms) => new Set(ms.map((m) => m.modulo)).size === ms.length, 'Módulo repetido')
    .refine((ms) => ms.every((m) => m.ativo || !MODULOS_BASE.includes(m.modulo)), 'O core não pode ser desligado'),
});
export type AlterarModulosEntrada = z.infer<typeof AlterarModulosEntrada>;

export const PrimeiroAdminEntrada = z.object({
  email: EmailUsuario,
  nome: z.string().trim().min(2).max(80).default('Administrador'),
});
export type PrimeiroAdminEntrada = z.infer<typeof PrimeiroAdminEntrada>;

/** Criação do 1º admin e redefinição da senha dele: a senha provisória sai só aqui, uma vez. */
export const PrimeiroAdminResposta = z.object({ usuario_id: Id, senha_provisoria: z.string().min(16).max(64) });
export type PrimeiroAdminResposta = z.infer<typeof PrimeiroAdminResposta>;

/** Toda resposta com senha provisória leva estes cabeçalhos (nada de cache no navegador nem em proxy). */
export const CABECALHOS_SENHA_PROVISORIA = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

/** Suspender ou reativar. Encerrar (e a exclusão com guarda fiscal) fica fora do portal na v0.3.0. */
export const SituacaoEmpresaEntrada = z.object({
  situacao: z.enum(['ativo', 'suspenso']),
  /** Vai para a auditoria: o portal avisa "sem dado pessoal". */
  motivo: z.string().trim().min(3).max(200),
});
export type SituacaoEmpresaEntrada = z.infer<typeof SituacaoEmpresaEntrada>;

/**
 * Corpo do `POST /v1/plataforma/auth/entrar` (o `/config/entrar`).
 * @deprecated Login único (RN-CORE-12, ADR 0018 e 0021): use `LoginEntrada` (e-mail e senha) em `POST /v1/auth/login`.
 * Fica até a rota antiga sair.
 */
export const EntrarPlataformaEntrada = z.object({ email: EmailUsuario, senha: SenhaInformada });
export type EntrarPlataformaEntrada = z.infer<typeof EntrarPlataformaEntrada>;

/**
 * Troca de senha do superadmin: o mesmo contrato do tenant (`TrocarSenhaEntrada`), com a regra única de senha do ERP
 * (T-0052; o mínimo de 14 da v0.3.1 saiu). Alias mantido para não quebrar a apps/api e a apps/web.
 */
export const TrocarSenhaPlataformaEntrada = TrocarSenhaEntrada;
export type TrocarSenhaPlataformaEntrada = TrocarSenhaEntrada;

/** Resposta do login do superadmin: só o vencimento; o token vai no cookie `COOKIE_CONFIG`. */
export const SessaoPlataformaResposta = z.object({ expira_em: Instante });
export type SessaoPlataformaResposta = z.infer<typeof SessaoPlataformaResposta>;

/**
 * `GET /v1/plataforma/auth/eu`. `deve_trocar_senha`: a senha provisória do operador.sh (ou a temporária do "esqueci")
 * ainda não foi trocada; `motivo_troca` (opcional, T-0076): qual das duas (`MOTIVOS_TROCA_SENHA`).
 */
export const EuPlataforma = z.object({
  superadmin: z.object({ id: Id, nome: z.string().min(1) }),
  deve_trocar_senha: z.boolean(),
  motivo_troca: z.enum(MOTIVOS_TROCA_SENHA).optional(),
  sessao_expira_em: Instante,
});
export type EuPlataforma = z.infer<typeof EuPlataforma>;

// ---- Entrar no /config pela sessão do BKO (45 A, v0.3.20; emenda §1-A da ADR 0012) ----

/**
 * `POST /v1/auth/config`: o usuário do BKO que tem acesso ao `/config` entra no portal sem novo login. Fica no `/v1/auth`
 * do tenant (não no `/v1/plataforma`, onde o JWT do tenant nunca vale): autentica pelo refresh da sessão do BKO
 * (o cookie do `/v1/auth`, que o BFF repassa, como no `/v1/auth/sair`) e pelo `CABECALHO_CSRF_CONFIG`. Sem corpo.
 * Resposta 200 `SessaoPlataformaResposta`, com o cookie `COOKIE_CONFIG` (Path=/v1/plataforma; o token nunca vai no corpo).
 * Erros: 401 (sessão do BKO inválida, vencida ou revogada), 403 `CODIGO_TROCAR_SENHA` (troca pendente no BKO), 403
 * `CODIGO_SEM_ACESSO_CONFIG`. Quem tem acesso (`acesso_config` no `EuResposta`): um superadmin ativo, não travado, sem
 * troca de senha pendente e com o mesmo e-mail normalizado do usuário da sessão. O superadmin continua fora do tenant
 * (sem impersonação): só o 2º login sai. Decisão do PO (45 A, v0.3.21), emenda §1-A da ADR 0012.
 */
export const CAMINHO_ENTRAR_PELO_BKO = '/v1/auth/config';
/** 403 de quem não tem um superadmin válido com o mesmo e-mail (a mensagem não diz por quê: não revela se o e-mail existe). */
export const CODIGO_SEM_ACESSO_CONFIG = 'SEM_ACESSO_CONFIG';
export const MENSAGEM_SEM_ACESSO_CONFIG = 'Seu usuário não tem acesso à Configuração.';
/** Auditoria da troca (tenant de origem, `usuario_id` de origem no `depois`, `superadmin_id` como autor). */
export const ACAO_ENTRAR_PELO_BKO = 'plataforma.superadmin.entrar_pelo_bko';
/** Teto da sessão do portal (o mesmo do login: 8 h). Pelo BKO, a 0076 corta também no fim da sessão do BKO (least). */
export const VALIDADE_SESSAO_CONFIG_MS = 8 * 60 * 60 * 1000;

// ---- Licenças × `depende` dos manifestos (função pura; a API sempre revalida, regra 2) ----

/** O manifesto só no que importa aqui; a API passa os manifestos reais (o SDK não importa módulo). */
export interface DependenciasModulo {
  id: ModuloId;
  depende: readonly ModuloId[];
}

/** Módulos ligados depois de aplicar `mudancas` sobre `atuais`, na ordem de `MODULOS` (o core sempre). */
export function modulosAtivosApos(atuais: readonly Licenca[], mudancas: readonly Licenca[], agora: Date): ModuloId[] {
  const porModulo = new Map<ModuloId, Licenca>(atuais.map((l) => [l.modulo, l]));
  for (const m of mudancas) porModulo.set(m.modulo, m);
  const licencas = [...porModulo.values()];
  return MODULOS.filter((m) => moduloLicenciado(licencas, m, agora));
}

/**
 * RN-CORE-02 (ADR 0012): todo módulo ligado tem todas as dependências ligadas (ex.: faturamento exige fiscal). Vale ao
 * ligar e ao desligar (desligar o fiscal com o faturamento ligado é recusado). Uma violação por dependência faltando,
 * com `campo` = `modulos.<módulo que ficaria sem a dependência>`. Lista vazia = pode gravar.
 */
export function conferirModulosPlataforma(
  atuais: readonly Licenca[],
  mudancas: readonly Licenca[],
  manifestos: readonly DependenciasModulo[],
  agora: Date,
): Violacao[] {
  const ativos = new Set(modulosAtivosApos(atuais, mudancas, agora));
  const saida: Violacao[] = [];
  for (const id of MODULOS) {
    if (!ativos.has(id)) continue;
    const deps = manifestos.find((m) => m.id === id)?.depende ?? [];
    for (const d of deps) {
      if (!ativos.has(d)) saida.push(violacao('RN-CORE-02', `modulos.${id}`, `O módulo ${id} exige o módulo ${d} ligado`));
    }
  }
  return saida;
}
