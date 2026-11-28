/** RN-CORE-40: o usuário da empresa fica com pelo menos uma filial; as filiais precisam ser vivas e da própria empresa. */
import { MENSAGEM_FILIAL_DO_USUARIO, MENSAGEM_FILIAL_FORA_DA_EMPRESA } from '../contracts';

export type AvaliacaoFiliaisUsuario = { ok: true } | { ok: false; mensagem: string };

/**
 * `criar` exige `filial_ids` com ao menos uma; `editar` sem o campo mantém as atuais, e com `[]` é recusado.
 * `filiais_da_empresa` (as vivas do tenant, lidas por quem chama) liga a conferência de pertencimento; ausente = não confere.
 */
export function avaliarFiliaisDoUsuario(p: {
  operacao: 'criar' | 'editar';
  filial_ids?: readonly string[];
  filiais_da_empresa?: readonly string[];
}): AvaliacaoFiliaisUsuario {
  if (p.filial_ids === undefined && p.operacao === 'editar') return { ok: true };
  if (!p.filial_ids || p.filial_ids.length === 0) return { ok: false, mensagem: MENSAGEM_FILIAL_DO_USUARIO };
  if (p.filiais_da_empresa) {
    const vivas = new Set(p.filiais_da_empresa);
    if (p.filial_ids.some((id) => !vivas.has(id))) return { ok: false, mensagem: MENSAGEM_FILIAL_FORA_DA_EMPRESA };
  }
  return { ok: true };
}
