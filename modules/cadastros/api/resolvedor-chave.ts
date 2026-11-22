/**
 * `ResolvedorChaveErp` (ADR 0010, item 2; T-0016): traduz a chave do Hub do FDV no `id` do ERP, em lote. O
 * `integracao-fdv` declara a porta (`integracao-fdv/api/portas.ts`) e o `apps/worker` a liga; o cadastros não importa o
 * `integracao-fdv`, só cumpre a mesma assinatura. Ordem: 1) `external_id = ANY(chaves)`; 2) só para as que faltaram e
 * estão no UUID canônico (RD-0317), `id = ANY(...)` de registro com `external_id` nulo. Nunca por código, documento ou
 * nome. Inativo resolve (a situação é conferida pelo pedido). No máximo 2 consultas por chamada.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { ehUuidCanonico } from '../domain';
import type { Dependencias, TabelaChave } from './portas';

/** Nome da entidade na chave do Hub → tabela do cadastros. Outra entidade resolve para um mapa vazio. */
export const ENTIDADES_RESOLVIDAS = {
  cliente: 'cliente', vendedor: 'vendedor', filial: 'filial', produto: 'produto',
  prazo_pagamento: 'condicao_pagamento', cliente_endereco: 'cliente_endereco',
} as const satisfies Record<string, TabelaChave>;

export interface ResolvedorChaveErp {
  /** Chave do Hub → UUID do ERP. Chave sem registro fica fora do mapa. */
  resolver(tx: Transacao, entidade: string, chaves: readonly string[]): Promise<Map<string, string>>;
}

export function criarResolvedorChaveErp(repositorios: Dependencias['repositorios']): ResolvedorChaveErp {
  return {
    async resolver(tx, entidade, chaves) {
      if (!Object.hasOwn(ENTIDADES_RESOLVIDAS, entidade)) return new Map();
      const tabela = ENTIDADES_RESOLVIDAS[entidade as keyof typeof ENTIDADES_RESOLVIDAS];
      const unicas = [...new Set(chaves)];
      if (unicas.length === 0) return new Map();
      const repo = repositorios(tx).chaves;
      const achadas = await repo.idsPorExternalId(tabela, unicas);
      const faltam = unicas.filter((k) => !achadas.has(k) && ehUuidCanonico(k));
      if (faltam.length > 0) for (const id of await repo.idsSemExternalId(tabela, faltam)) achadas.set(id, id);
      return achadas;
    },
  };
}
