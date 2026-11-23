/**
 * Portal `/config` (T-0050, ADR 0012): regras puras das ações do superadmin sobre a empresa. O slug e o nome são do
 * Zod do SDK (`CriarEmpresaEntrada`) e as dependências dos módulos do `conferirModulosPlataforma` (RN-CORE-02); aqui
 * ficam o 1º administrador (RN-CORE-01) e a situação da empresa. A API revalida; as funções da 0033 gravam e auditam.
 * O `primeiro_admin` da empresa é o administrador ATIVO mais antigo (`plataforma.primeiro_admin` da 0033), ou nulo.
 */
import { violacao, type EmpresaPlataforma, type SituacaoEmpresaEntrada, type Violacao } from '@macuxierp/platform-sdk';

type Empresa = Pick<EmpresaPlataforma, 'situacao' | 'primeiro_admin'>;

export const MENSAGEM_JA_TEM_ADMIN = 'A empresa já tem administrador';

/**
 * RN-CORE-01: o portal cria o 1º administrador só em empresa ativa e sem administrador ativo; os seguintes o próprio
 * administrador cria no BKO. O reenvio do mesmo pedido cai aqui e vira 409 (a senha provisória nunca sai duas vezes).
 */
export function avaliarPrimeiroAdmin(e: Empresa): Violacao[] {
  if (e.situacao !== 'ativo') return [violacao('RN-CORE-01', 'situacao', 'Reative a empresa antes de criar o administrador')];
  if (e.primeiro_admin) return [violacao('RN-CORE-01', 'primeiro_admin', MENSAGEM_JA_TEM_ADMIN)];
  return [];
}

/** O portal redefine só a senha do 1º administrador; os demais usuários são do administrador da empresa. */
export function avaliarRedefinirSenhaPrimeiroAdmin(e: Empresa): Violacao[] {
  if (!e.primeiro_admin) return [violacao('RN-CORE-01', 'primeiro_admin', 'A empresa não tem administrador ativo')];
  return [];
}

/**
 * Suspender bloqueia o login e revoga as sessões, deixando a fila fiscal terminar; reativar devolve o login sem recriar
 * sessão (os efeitos são da função `empresa_situacao` da 0033). Repetir a situação atual não grava nada (`mudou` falso).
 * Empresa encerrada não muda pelo portal (fora da v0.3.0).
 */
export function avaliarSituacaoEmpresa(p: { atual: EmpresaPlataforma['situacao']; nova: SituacaoEmpresaEntrada['situacao'] }): {
  mudou: boolean;
  violacoes: Violacao[];
} {
  if (p.atual === 'encerrado') return { mudou: false, violacoes: [violacao('ADR-0012', 'situacao', 'Empresa encerrada não muda pelo portal')] };
  return { mudou: p.atual !== p.nova, violacoes: [] };
}
