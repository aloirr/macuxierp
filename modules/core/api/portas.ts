/**
 * Portas do plugin do core. A API monta as implementações (PostgreSQL, argon2id, S3, chave do secret) e passa a
 * `criarPluginCore`; os testes usam `RepositorioCoreMemoria`. Linhas com `Date`: a serialização para o contrato é das rotas.
 */
import type { Armazenamento, Perfil, Transacao } from '@macuxierp/platform-sdk';
import type { OrigemCertificado } from '@macuxierp/platform-sdk/certificado-origem';

/** Colunas cifradas do A1 em `core.certificado`; o formato (cifrado, tag, nonce) está em `colunas-a1.ts`. */
export interface A1Cifrado {
  pfx_cifrado: Buffer;
  pfx_nonce: Buffer;
  senha_cifrada: Buffer;
  senha_nonce: Buffer;
}

export interface LinhaEmpresa {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  ie: string | null;
  fuso: string;
  updated_at: Date;
}

export interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  filial_ids: string[];
  ativo: boolean;
  external_id: string | null;
  ultimo_acesso_em: Date | null;
  /** Trava do login (falhas): vigente = situação bloqueado (RN-CORE-17). */
  bloqueado_ate?: Date | null;
  updated_at: Date;
}

export type PatchUsuario = Partial<Pick<LinhaUsuario, 'nome' | 'perfil' | 'filial_ids' | 'ativo'>>;

export interface NovoUsuario extends Omit<LinhaUsuario, 'ultimo_acesso_em' | 'updated_at'> {
  senha_hash: string;
}

export interface LinhaLicenca {
  modulo: string;
  ativo: boolean;
  valido_ate: Date | null;
}

/** Resumo do certificado: nunca as colunas cifradas (o app nem tem permissão de lê-las, ADR 0005). */
export interface LinhaCertificado {
  id: string;
  filial_id: string;
  titular: string;
  cnpj: string;
  valido_de: Date;
  valido_ate: Date;
  impressao_digital: string;
  ativo: boolean;
  origem: OrigemCertificado;
}

export interface NovoCertificado extends Omit<LinhaCertificado, 'ativo' | 'origem'>, A1Cifrado {
  chave_versao: number;
  /** Omitida = ORIGEM_CERTIFICADO_PADRAO; o A1 de teste do operador informa 'teste'. */
  origem?: OrigemCertificado;
}

export interface LinhaAmbiente {
  filial_id: string;
  ambiente: 'homologacao' | 'producao';
  recado_aprovacao: string | null;
}

export interface LinhaAuditoria {
  id: string;
  usuario_id: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  antes: unknown;
  depois: unknown;
  ocorrido_em: Date;
}

export interface LinhaExportacao {
  id: string;
  estado: 'pendente' | 'gerando' | 'pronta' | 'falhou' | 'expirada';
  arquivo_id: string | null;
  concluida_em: Date | null;
  expira_em: Date | null;
}

export interface RepositorioCore {
  empresa(tx: Transacao): Promise<LinhaEmpresa | null>;
  /** token: 0 linhas = null */
  atualizarEmpresa(tx: Transacao, dados: Omit<LinhaEmpresa, 'id' | 'cnpj' | 'updated_at'>, agora: Date, token?: Date): Promise<LinhaEmpresa | null>;

  listarUsuarios(tx: Transacao, f: { limite: number; cursor?: string; busca?: string; inativos: boolean }): Promise<LinhaUsuario[]>;
  usuarioPorId(tx: Transacao, id: string): Promise<LinhaUsuario | null>;
  usuarioPorEmail(tx: Transacao, email: string): Promise<LinhaUsuario | null>;
  usuarioPorExternalId(tx: Transacao, externalId: string): Promise<LinhaUsuario | null>;
  /** RN-CORE-18: existe e-mail vivo (já normalizado) em outra empresa (só usuários; o superadmin fica fora). Banco-dados 0079 entrega a visão global (`plataforma.conta_por_email`, assinatura a confirmar); `exceto_usuario_id` é o próprio usuário na edição. */
  existeEmailVivoEmOutraConta(tx: Transacao, email: string, exceto_usuario_id?: string): Promise<boolean>;
  criarUsuario(tx: Transacao, u: NovoUsuario, agora: Date): Promise<LinhaUsuario>;
  /** token: 0 linhas = null */
  atualizarUsuario(tx: Transacao, id: string, patch: PatchUsuario, agora: Date, token?: Date): Promise<LinhaUsuario | null>;
  /** RN-CORE-17: exclusão lógica (ativo = false e deleted_at); some da lista e libera o e-mail. Já excluído = null. */
  excluirUsuario(tx: Transacao, id: string, agora: Date): Promise<LinhaUsuario | null>;
  /** Zera também `senha_temporaria_hash` e `senha_temporaria_expira_em` (RN-CORE-13). */
  definirSenha(tx: Transacao, id: string, senhaHash: string, agora: Date): Promise<void>;
  /**
   * RN-CORE-13: o primeiro login certo com a senha atual cancela a temporária pendente. Zera `senha_temporaria_hash` e
   * `senha_temporaria_expira_em` só se havia hash (vencida também é limpa: não há motivo para guardar hash morto).
   * Devolve true se cancelou (a API audita `core.usuario.senha_temporaria_cancelada`, sem a senha), false se não havia.
   * Nunca toca em `senha_hash` nem em `deve_trocar_senha`.
   */
  cancelarSenhaTemporaria(tx: Transacao, usuarioId: string): Promise<boolean>;
  /** RN-CORE-13: grava a temporária (hash argon2id) e a expiração, em paralelo à senha atual, que não muda; um pedido novo substitui a temporária anterior. */
  emitirSenhaTemporaria(tx: Transacao, usuarioId: string, hash: string, expiraEm: Date): Promise<void>;
  /** RN-CORE-01: chamar antes de contar. */
  travarAdministradoresAtivos(tx: Transacao): Promise<void>;
  contarAdministradoresAtivos(tx: Transacao, exceto: string): Promise<number>;

  licencas(tx: Transacao): Promise<LinhaLicenca[]>;

  certificados(tx: Transacao, filialId?: string): Promise<LinhaCertificado[]>;
  /** Marca o ativo da filial como substituído e grava o novo, na mesma transação. */
  substituirCertificado(tx: Transacao, novo: NovoCertificado, agora: Date): Promise<void>;

  ambientes(tx: Transacao, filialId?: string): Promise<LinhaAmbiente[]>;
  gravarAmbiente(tx: Transacao, a: LinhaAmbiente & { ambiente: 'homologacao'; alterado_por: string }, agora: Date): Promise<void>;

  auditoria(tx: Transacao, f: { entidade?: string; usuario_id?: string; de?: Date; ate?: Date; limite: number; cursor?: string }): Promise<LinhaAuditoria[]>;

  criarExportacao(tx: Transacao, id: string, pedidoPor: string, agora: Date): Promise<LinhaExportacao>;
  exportacao(tx: Transacao, id: string): Promise<LinhaExportacao | null>;
  chaveDoArquivo(tx: Transacao, arquivoId: string): Promise<string | null>;

  parametros(tx: Transacao): Promise<{ chave: string; valor: unknown }[]>;
  gravarParametro(tx: Transacao, chave: string, valor: unknown, agora: Date): Promise<string>;
}

export interface DadosPfx {
  titular: string;
  cnpj: string;
  valido_de: Date;
  valido_ate: Date;
  impressao_digital: string;
}

export class PfxInvalido extends Error {
  override readonly name = 'PfxInvalido';
}

/** Abre o `.pfx` com a senha. Lança `PfxInvalido` (senha errada ou arquivo corrompido); CNPJ ausente, divergente ou com DV inválido sai como `ErroCertificado` do SDK. */
export interface LeitorPfx {
  abrir(pfx: Buffer, senha: string): Promise<DadosPfx>;
}

export interface DependenciasCore {
  repo: RepositorioCore;
  /** argon2id da plataforma (apps/api/src/auth/senha.ts): o módulo não conhece o algoritmo. */
  hashSenha(senha: string): Promise<string>;
  leitorPfx: LeitorPfx;
  /** MACUXIERP_CHAVE_A1, já lida com `lerChaveA1` no arranque. */
  chaveA1: Buffer;
  /** Versão da chave mestra gravada em `chave_versao` (rotação futura). */
  chaveVersao?: number;
  armazenamento: Armazenamento;
  /** Bytes aleatórios seguros (padrão: `crypto.randomBytes`). */
  aleatorios?: (n: number) => Uint8Array;
  novoId?: () => string;
}
