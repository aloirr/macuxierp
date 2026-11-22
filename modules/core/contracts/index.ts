/**
 * Contratos públicos do módulo core (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 * JSON em snake_case, igual às colunas (desenho T-0002, seção 3).
 */
import { Cnpj, ConsultaLista, MODULOS, paginaDe, PERFIS } from '@macuxierp/platform-sdk';
import { z } from 'zod';

export const MODULO = 'core' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

export const Id = z.string().uuid();
const Instante = z.string().datetime();

/** RN-CORE-01: perfis da v1, um por usuário por empresa. */
export const Perfil = z.enum(PERFIS);
export type Perfil = z.infer<typeof Perfil>;

/** RN-CORE-08: id do recado em que o Alexandre aprovou a produção fiscal (`R-AAAAMMDD-HHMMSS[-n]-alexandre`). */
export const PADRAO_RECADO_APROVACAO = /^R-\d{8}-\d{6}(-\d+)?-alexandre$/;
/** ADR 0005: tamanho máximo do `.pfx` enviado. */
export const PFX_TAMANHO_MAXIMO = 50 * 1024;
/** RF-CORE-04: o aviso de vencimento do A1 começa a 30 dias ou menos. */
export const DIAS_ALERTA_A1 = 30;

/** Consulta das listas (contrato `.coord/contratos/listas.md`): `limite`, `cursor`, `busca` e `inativos`, do SDK. */
export const ListaConsulta = ConsultaLista;
export type ListaConsulta = ConsultaLista;

// Empresa (RF-CORE-01)
export const Empresa = z.object({
  id: Id,
  razao_social: z.string().min(2).max(60),
  nome_fantasia: z.string().max(60).nullable(),
  cnpj: Cnpj,
  ie: z.string().max(14).nullable(),
  fuso: z.string().default('America/Manaus'),
  updated_at: Instante,
});
export type Empresa = z.infer<typeof Empresa>;

/** O CNPJ da empresa não muda por aqui: ele amarra a raiz do A1 (D4). `updated_at` é o token de concorrência. */
export const EmpresaEditar = z.object({
  razao_social: z.string().trim().min(2).max(60),
  nome_fantasia: z.string().trim().max(60).nullable(),
  ie: z.string().trim().max(14).nullable(),
  fuso: z.string().min(3).max(60),
  updated_at: Instante.optional(),
});
export type EmpresaEditar = z.infer<typeof EmpresaEditar>;

// Usuários (RF-CORE-02)
export const Usuario = z.object({
  id: Id,
  nome: z.string().min(2).max(80),
  email: z.string().email(),
  perfil: Perfil,
  filial_ids: z.array(Id),
  ativo: z.boolean(),
  external_id: z.string().max(64).nullable(),
  ultimo_acesso_em: Instante.nullable(),
  updated_at: Instante,
});
export type Usuario = z.infer<typeof Usuario>;

export const UsuarioCriar = z.object({
  nome: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  perfil: Perfil,
  filial_ids: z.array(Id).min(1),
  external_id: z.string().max(64).optional(),
});
export type UsuarioCriar = z.infer<typeof UsuarioCriar>;

export const UsuarioEditar = z
  .object({
    nome: z.string().trim().min(2).max(80),
    perfil: Perfil,
    filial_ids: z.array(Id).min(1),
    ativo: z.boolean(),
    updated_at: Instante,
  })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'updated_at'), { message: 'Nada para alterar' });
export type UsuarioEditar = z.infer<typeof UsuarioEditar>;

/** A senha provisória aparece só nesta resposta; o banco guarda apenas o hash (regra 9). */
export const UsuarioComSenhaProvisoria = Usuario.extend({ senha_provisoria: z.string() });
export type UsuarioComSenhaProvisoria = z.infer<typeof UsuarioComSenhaProvisoria>;
export const SenhaProvisoria = z.object({ senha_provisoria: z.string() });
export type SenhaProvisoria = z.infer<typeof SenhaProvisoria>;

export const ListaUsuarios = paginaDe(Usuario);
export type ListaUsuarios = z.infer<typeof ListaUsuarios>;

// Perfis e licenças, só leitura (RF-CORE-03, D12)
export const PerfilComAcoes = z.object({ perfil: Perfil, acoes: z.array(z.string()) });
export type PerfilComAcoes = z.infer<typeof PerfilComAcoes>;

export const Licenca = z.object({ modulo: z.enum(MODULOS), ativo: z.boolean(), valido_ate: Instante.nullable() });
export type Licenca = z.infer<typeof Licenca>;

// Certificado A1 (RF-CORE-04, ADR 0005). Nunca existe campo de `.pfx` nem de senha na resposta.
// POST /certificados é multipart: o `.pfx` vai no campo de arquivo `arquivo` (até 50 KB); estes são os campos de texto.
export const CertificadoEnviar = z.object({
  filial_id: Id,
  senha: z.string().min(1).max(200),
});
export type CertificadoEnviar = z.infer<typeof CertificadoEnviar>;

export const CertificadoResumo = z.object({
  id: Id,
  filial_id: Id,
  titular: z.string(),
  cnpj: Cnpj,
  valido_de: Instante,
  valido_ate: Instante,
  impressao_digital: z.string().length(64),
  dias_para_vencer: z.number().int(),
  /** RF-CORE-04: vence em 30 dias ou menos (ou já venceu). */
  alerta_vencimento: z.boolean(),
  ativo: z.boolean(),
});
export type CertificadoResumo = z.infer<typeof CertificadoResumo>;

export const CertificadosConsulta = z.object({ filial_id: Id.optional() });
export const ListaCertificados = z.object({ itens: z.array(CertificadoResumo) });
export type ListaCertificados = z.infer<typeof ListaCertificados>;

// Ambiente fiscal por filial emissora (RN-CORE-08)
export const AmbienteFiscal = z.object({
  filial_id: Id,
  ambiente: z.enum(['homologacao', 'producao']),
  recado_aprovacao: z.string().nullable(),
});
export type AmbienteFiscal = z.infer<typeof AmbienteFiscal>;

export const AmbienteConsulta = z.object({ filial_id: Id.optional() });
export const AmbienteTrocar = z.object({
  ambiente: z.enum(['homologacao', 'producao']),
  recado_aprovacao: z.string().trim().max(80).nullable().default(null),
});
export type AmbienteTrocar = z.infer<typeof AmbienteTrocar>;
export const ListaAmbientes = z.object({ itens: z.array(AmbienteFiscal) });

// Auditoria (RF-CORE-05)
export const AuditoriaConsulta = ListaConsulta.pick({ limite: true, cursor: true }).extend({
  entidade: z.string().max(60).optional(),
  de: Instante.optional(),
  ate: Instante.optional(),
});
export type AuditoriaConsulta = z.infer<typeof AuditoriaConsulta>;

export const AuditoriaItem = z.object({
  id: Id,
  usuario_id: Id.nullable(),
  acao: z.string(),
  entidade: z.string(),
  entidade_id: z.string().nullable(),
  antes: z.unknown(),
  depois: z.unknown(),
  ocorrido_em: Instante,
});
export type AuditoriaItem = z.infer<typeof AuditoriaItem>;
export const ListaAuditoria = paginaDe(AuditoriaItem);

// Exportação LGPD (RF-CORE-06): a API responde 202 e o worker gera o .zip
export const ExportacaoEstado = z.enum(['pendente', 'gerando', 'pronta', 'falhou', 'expirada']);
export type ExportacaoEstado = z.infer<typeof ExportacaoEstado>;
export const Exportacao = z.object({
  id: Id,
  estado: ExportacaoEstado,
  /** Link assinado de 24 h, só com o estado `pronta`. */
  url: z.string().nullable(),
  concluida_em: Instante.nullable(),
  expira_em: Instante.nullable(),
});
export type Exportacao = z.infer<typeof Exportacao>;
/** Tipo do trabalho que o worker executa (`plataforma.trabalho`); payload `{ exportacao_id }`. */
export const TRABALHO_EXPORTAR = 'core.exportar_dados' as const;

// Parâmetros do tenant
export const ParametroChave = z.string().regex(/^[a-z][a-z0-9_.]{1,79}$/);
export const Parametro = z.object({ chave: ParametroChave, valor: z.unknown() });
export type Parametro = z.infer<typeof Parametro>;
export const ParametroGravar = z.object({ valor: z.unknown().refine((v) => v !== undefined, 'valor obrigatório') });

// Eventos publicados (payload completo, `.coord/contratos/eventos.md`; nunca nome, e-mail, .pfx nem senha)
export const EVENTO_EMPRESA = 'core.empresa.alterada@1' as const;
export const EVENTO_USUARIO = 'core.usuario.alterado@1' as const;
export const EVENTO_CERTIFICADO = 'core.certificado.alterado@1' as const;
export const EVENTO_AMBIENTE = 'core.ambiente_fiscal.alterado@1' as const;

export const EventoEmpresaAlterada = Empresa;
export const EventoUsuarioAlterado = z.object({ id: Id, perfil: Perfil, filial_ids: z.array(Id), ativo: z.boolean() });
export const EventoCertificadoAlterado = z.object({
  id: Id,
  filial_id: Id,
  cnpj: Cnpj,
  valido_ate: Instante,
  impressao_digital: z.string().length(64),
  ativo: z.boolean(),
});
export const EventoAmbienteAlterado = AmbienteFiscal;

// Porta "filial tem A1 válido" (RN-CORE-06): o cadastros (consulta de IE) e o fiscal consultam sem ler a tabela do core.
export const A1ValidoDaFilial = z.discriminatedUnion('valido', [
  z.object({ valido: z.literal(true), valido_ate: Instante, dias_para_vencer: z.number().int() }),
  z.object({ valido: z.literal(false), motivo: z.enum(['sem_certificado', 'vencido', 'ainda_nao_vale']), mensagem: z.string() }),
]);
export type A1ValidoDaFilial = z.infer<typeof A1ValidoDaFilial>;

/** Porta pública implementada pela API do core. Nunca devolve certificado, senha nem CNPJ: só o veredito. */
export interface PortaA1 {
  a1ValidoDaFilial(filial_id: string): Promise<A1ValidoDaFilial>;
}
