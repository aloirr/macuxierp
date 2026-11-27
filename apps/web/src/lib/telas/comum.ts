/**
 * Peças comuns dos adaptadores de tela (lib/telas): tom e selo do módulo para o selo da vista, chave de idempotência, as colunas do módulo
 * para as colunas da lista e o texto de quem não tem permissão. Sem regra de negócio.
 */
import type { SeloVista } from '../descritor/tipos';

export const TEXTO_SEM_PERMISSAO = 'Seu perfil não pode ver esta tela.';
export const TEXTO_INDISPONIVEL = 'Não foi possível carregar agora. Tente de novo em instantes.';

export const TOM = { ok: 'ok', alerta: 'aviso', erro: 'erro', neutro: 'neutro' } as const;

/** Selo do módulo (tom `alerta`) no selo da vista (tom `aviso`). */
export const seloDoModulo = (s: { texto: string; tom: keyof typeof TOM; dica?: string | undefined }): SeloVista => ({ texto: s.texto, tom: TOM[s.tom], ...(s.dica ? { dica: s.dica } : {}) });

export const novaChave = (): string => globalThis.crypto.randomUUID();

/** Colunas do módulo (`id`, `titulo`) na lista da tela; `status` e `data` pelo id da coluna. A coluna de status se chama "Situação". */
export function colunasDoModulo(colunas: readonly { id: string; titulo: string }[], tipos: Readonly<Record<string, 'status' | 'data'>> = {}) {
  return colunas.map((c) => {
    const tipo = tipos[c.id];
    return { id: c.id, rotulo: tipo === 'status' ? 'Situação' : c.titulo, ...(tipo ? { tipo } : {}) };
  });
}
