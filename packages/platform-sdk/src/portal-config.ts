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
import { PADRAO_CNPJ, PADRAO_UF } from './documentos';
import { violacao, type Violacao } from './erros';
import { TrocarSenhaEntrada } from './eu';
import { MODULOS, type ModuloId } from './modulo';
import { SenhaInformada } from './senha';

const Id = z.string().regex(PADRAO_UUID);
const Instante = z.string().datetime();
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
const SLUGS_RESERVADOS = ['referencia', 'config', 'plataforma'] as const;

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
  created_at: Instante,
  updated_at: Instante,
});
export type EmpresaPlataforma = z.infer<typeof EmpresaPlataforma>;

/** Resposta da revelação do e-mail completo do 1º admin (T-0050). */
export const EmailPrimeiroAdminResposta = z.object({ email: EmailUsuario });
export type EmailPrimeiroAdminResposta = z.infer<typeof EmailPrimeiroAdminResposta>;

export const CriarEmpresaEntrada = z.object({
  slug: z
    .string()
    .regex(PADRAO_SLUG_EMPRESA, 'Use de 2 a 40 letras minúsculas, dígitos ou hífen, começando por letra ou dígito')
    .refine((s) => !(SLUGS_RESERVADOS as readonly string[]).includes(s), 'Slug reservado'),
  /** Nome legal (de MEI pode ser dado pessoal): nunca vai para log nem para a auditoria (ADR 0012). */
  nome: z.string().trim().min(2).max(120),
  fuso: z
    .string()
    .regex(/^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/, 'Fuso IANA, ex.: America/Manaus')
    .default('America/Manaus'),
});
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

/** `GET /v1/plataforma/auth/eu`. `deve_trocar_senha`: a senha provisória do operador.sh ainda não foi trocada. */
export const EuPlataforma = z.object({
  superadmin: z.object({ id: Id, nome: z.string().min(1) }),
  deve_trocar_senha: z.boolean(),
  sessao_expira_em: Instante,
});
export type EuPlataforma = z.infer<typeof EuPlataforma>;

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
