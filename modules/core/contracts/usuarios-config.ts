/**
 * Usuários da empresa (v0.3.28): a tabela Usuários na Config do superadmin (/config, aba Empresa) e as ações Inativar,
 * Reativar e Excluir dos dois lados (Config e BKO do tenant). RN-CORE-01 (último administrador ativo) e RN-CORE-17
 * (Inativar é reversível; Excluir é deleted_at, some da lista e libera o e-mail). Funções do banco: migração 0078.
 * O e-mail vem só mascarado (`plataforma.mascarar_email`, LGPD); a tela não recalcula regra: usa `acoes` e
 * `ultimo_admin_ativo` de cada linha.
 */
import { EmailUsuario, PERFIS } from '@macuxierp/platform-sdk';
import { z } from 'zod';

const Uuid = z.string().uuid();
const PerfilUsuario = z.enum(PERFIS);

/** RN-CORE-17: situações exibidas. `excluido` só aparece na resposta do Excluir (a linha some da lista). */
export const SITUACOES_USUARIO = ['ativo', 'bloqueado', 'inativo'] as const;
export const SituacaoUsuario = z.enum(SITUACOES_USUARIO);
export type SituacaoUsuario = z.infer<typeof SituacaoUsuario>;

export const ROTULOS_SITUACAO_USUARIO: Readonly<Record<SituacaoUsuario, string>> = {
  ativo: 'Ativo',
  bloqueado: 'Bloqueado',
  inativo: 'Inativo',
};

/** Itens do menu "Ações ▾" de cada linha (52 A), na ordem do menu. */
export const ACOES_USUARIO = ['editar', 'redefinir_senha', 'inativar', 'reativar', 'excluir'] as const;
export const AcaoUsuario = z.enum(ACOES_USUARIO);
export type AcaoUsuario = z.infer<typeof AcaoUsuario>;

export const ROTULOS_ACAO_USUARIO: Readonly<Record<AcaoUsuario, string>> = {
  editar: 'Editar',
  redefinir_senha: 'Redefinir senha',
  inativar: 'Inativar',
  reativar: 'Reativar',
  excluir: 'Excluir',
};

/** Etiqueta ao lado do perfil (46 A). */
export const ROTULO_ULTIMO_ADMIN = 'último administrador';
/** RN-CORE-01: mensagem da recusa (MXU01 no banco, 422 na API), igual nos dois lados. */
export const MENSAGEM_ULTIMO_ADMIN = 'A empresa precisa de ao menos um administrador ativo';
/** RN-CORE-17: e-mail de usuário não excluído (ativo, bloqueado ou inativo) do mesmo tenant. */
export const MENSAGEM_EMAIL_EM_USO = 'Já existe usuário com este e-mail';

/** Linha da tabela Usuários da Config. `email_mascarado`: 2 primeiros caracteres + '****@' + domínio. */
export const UsuarioConfig = z.object({
  id: Uuid,
  nome: z.string(),
  email_mascarado: z.string(),
  perfil: PerfilUsuario,
  filial_ids: z.array(Uuid),
  situacao: SituacaoUsuario,
  ultimo_acesso_em: z.string().datetime().nullable(),
  deve_trocar_senha: z.boolean(),
  ultimo_admin_ativo: z.boolean(),
  acoes: z.array(AcaoUsuario),
});
export type UsuarioConfig = z.infer<typeof UsuarioConfig>;

export const ListaUsuariosConfig = z.object({ itens: z.array(UsuarioConfig) });
export type ListaUsuariosConfig = z.infer<typeof ListaUsuariosConfig>;

export const UsuarioConfigCriar = z.object({
  nome: z.string().trim().min(2).max(80),
  email: EmailUsuario,
  perfil: PerfilUsuario,
  filial_ids: z.array(Uuid).default([]),
});
export type UsuarioConfigCriar = z.infer<typeof UsuarioConfigCriar>;

export const UsuarioConfigEditar = z
  .object({
    nome: z.string().trim().min(2).max(80),
    perfil: PerfilUsuario,
    filial_ids: z.array(Uuid),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para alterar' });
export type UsuarioConfigEditar = z.infer<typeof UsuarioConfigEditar>;

/** Criar e Redefinir senha: a senha provisória aparece só nesta resposta (no-store), uma vez. */
export const UsuarioConfigComSenha = z.object({ usuario: UsuarioConfig, senha_provisoria: z.string() });
export type UsuarioConfigComSenha = z.infer<typeof UsuarioConfigComSenha>;

export const UsuarioExcluido = z.object({ id: Uuid, situacao: z.literal('excluido') });
export type UsuarioExcluido = z.infer<typeof UsuarioExcluido>;

/** Rotas do portal (com o prefixo `/v1/plataforma`). Criar e Redefinir senha exigem Idempotency-Key. */
export const ROTAS_USUARIOS_CONFIG = {
  listar: { metodo: 'GET', caminho: '/v1/plataforma/empresas/:id/usuarios' },
  criar: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/usuarios' },
  editar: { metodo: 'PATCH', caminho: '/v1/plataforma/empresas/:id/usuarios/:usuario' },
  redefinirSenha: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/usuarios/:usuario/senha' },
  inativar: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/usuarios/:usuario/inativar' },
  reativar: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/usuarios/:usuario/reativar' },
  excluir: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/usuarios/:usuario/excluir' },
} as const;
