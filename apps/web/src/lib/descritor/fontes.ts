/** Fontes de opções dos seletores (cliente, vendedor, filial, condição e produto): leitura do cadastros pela API (RN fronteiras: só HTTP). */
import { z } from 'zod';
import type { Perfil } from '@macuxierp/platform-sdk';
import { rotuloDoCliente } from '@macuxierp/pedido/web';
import type { FonteOpcoes } from './tipos';

/** Só lê do cadastros (`/v1/cadastros/<recurso>`); qualquer outro caminho é erro de programação do descritor. */
const FONTE_VALIDA = /^\/v1\/cadastros\/[a-z][a-z0-9-]*$/;
export function caminhoDaFonte(fonte: FonteOpcoes): string {
  if (!FONTE_VALIDA.test(fonte)) throw new Error('fonte de opções deve ser /v1/cadastros/<recurso>');
  return fonte;
}

export interface Opcao { valor: string; rotulo: string }

const Registro = z.object({ id: z.string().uuid() }).passthrough();
export const RespostaFonte = z.object({ itens: z.array(Registro), proximo_cursor: z.string().nullable().optional() });

/** Rótulo curto do registro por fonte ("codigo · descricao"). Só campos de cadastro, nunca para log. O cliente segue o perfil (LGPD): só o gerente vê o documento, com máscara. */
export function rotuloDaOpcao(fonte: FonteOpcoes, r: Readonly<Record<string, unknown>>, perfil: Perfil): string {
  const recurso = fonte.split('/').pop() ?? '';
  const t = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  const junta = (...p: string[]) => p.filter(Boolean).join(' · ');
  switch (recurso) {
    case 'clientes': return rotuloDoCliente({ razao_social: t('nome_fantasia') || t('razao_social'), documento: t('documento') || null }, perfil);
    case 'produtos': return junta(t('codigo'), t('descricao'));
    case 'vendedores': return junta(t('codigo'), t('nome'));
    case 'filiais': return t('nome') || t('razao_social');
    case 'condicoes-pagamento': return junta(t('codigo'), t('descricao'));
    default: return t('nome') || t('descricao') || t('codigo');
  }
}

export function opcoesDaResposta(fonte: FonteOpcoes, corpo: z.infer<typeof RespostaFonte>, perfil: Perfil): Opcao[] {
  return corpo.itens.map((r) => ({ valor: r.id, rotulo: rotuloDaOpcao(fonte, r, perfil) || r.id }));
}
