/**
 * Textos e tom dos usuários, iguais no BKO (`lib/telas/core.ts`) e na Config (`usuarios.tsx`), RN-CORE-17: Inativar é reversível
 * (Reativar) e Excluir é definitivo (some da lista e libera o e-mail).
 */
export const AVISO_USUARIO = {
  inativar: 'A pessoa deixa de entrar. Dá para reativar depois.',
  reativar: 'A pessoa volta a entrar com a senha atual.',
  excluir: 'O usuário some da lista e o e-mail fica livre para outro cadastro. Não dá para desfazer; para só impedir a entrada, use Inativar.',
} as const;

/** O contrato chama o amarelo de 'alerta'; o selo e o Chip, de 'aviso'. */
export const tomAmarelo = <T extends string>(t: T): Exclude<T, 'alerta'> | 'aviso' => (t === 'alerta' ? 'aviso' : t) as Exclude<T, 'alerta'> | 'aviso';
