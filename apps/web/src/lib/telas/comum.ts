/**
 * Peças comuns dos adaptadores de tela (lib/telas): tom e selo do módulo para o selo da vista, chave de idempotência, as colunas do módulo
 * para as colunas da lista e o texto de quem não tem permissão. Sem regra de negócio.
 */
import type { SeloVista } from '../descritor/tipos';

/** Vazio padrão das listas sem texto declarado pelo módulo. */
export const TEXTO_VAZIO = 'Nenhum registro ainda.';
export const TEXTO_VAZIO_COM_FILTRO = 'Nenhum registro com estes filtros.';
export const TEXTO_SEM_PERMISSAO = 'Seu perfil não pode ver esta tela.';
export const TEXTO_INDISPONIVEL = 'Não foi possível carregar agora. Tente de novo em instantes.';

export const TOM = { ok: 'ok', alerta: 'aviso', erro: 'erro', neutro: 'neutro' } as const;

/** Selo do módulo (tom `alerta`) no selo da vista (tom `aviso`). */
export const seloDoModulo = (s: { texto: string; tom: keyof typeof TOM; dica?: string | undefined }): SeloVista => ({ texto: s.texto, tom: TOM[s.tom], ...(s.dica ? { dica: s.dica } : {}) });

export const novaChave = (): string => globalThis.crypto.randomUUID();

type TipoColuna = 'texto' | 'numero' | 'dinheiro' | 'data' | 'status';

/**
 * Colunas do módulo (`id`, `titulo`, `tipo`) na lista da tela. O `tipo` vem da própria coluna do descritor; o mapa `sobrescritas` (id → tipo)
 * só vale como sobrescrita, quando presente. Coluna sem tipo fica sem `tipo` (texto). A coluna de status se chama "Situação".
 */
export function colunasDoModulo(colunas: readonly { id: string; titulo: string; tipo?: TipoColuna }[], sobrescritas: Readonly<Record<string, TipoColuna>> = {}) {
  return colunas.map((c) => {
    const tipo = sobrescritas[c.id] ?? c.tipo;
    return { id: c.id, rotulo: tipo === 'status' ? 'Situação' : c.titulo, ...(tipo ? { tipo } : {}) };
  });
}
