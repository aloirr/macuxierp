/** C-6 e C-4: eventos publicados (payloads v1; .coord/contratos/eventos.md). Sem dado pessoal. */
import { z } from 'zod';
import { CodigoErro, ENTIDADES_HUB_F2, EntidadeHub, ModoLote } from './hub';

/** Nomes aceitos pelo `cadastros` na carga inicial: as 10 entidades do Hub da F2 + `tabela_preco` e `condicao_pagamento` (ERP). */
export const ENTIDADES_CARGA_INICIAL = [...ENTIDADES_HUB_F2, 'tabela_preco', 'condicao_pagamento'] as const;

export const EVENTO_LOTE_ENVIADO = 'integracao-fdv.lote.enviado@1' as const;
export const EVENTO_LOTE_FALHOU = 'integracao-fdv.lote.falhou@1' as const;
export const EVENTO_CARGA_INICIAL = 'integracao-fdv.carga_inicial.solicitada@1' as const;

export const EVENTOS = {
  [EVENTO_LOTE_ENVIADO]: z.object({
    lote_envio_id: z.string().uuid(),
    entidade: EntidadeHub,
    modo: ModoLote,
    geracao: z.number().int().min(1),
    registros: z.number().int().min(0),
    aceitos: z.number().int().min(0),
    com_erro: z.number().int().min(0),
    concluido_em: z.string().datetime(),
  }),
  [EVENTO_LOTE_FALHOU]: z.object({
    lote_envio_id: z.string().uuid(),
    entidade: EntidadeHub,
    modo: ModoLote,
    geracao: z.number().int().min(1),
    estado: z.enum(['falhou', 'recusado']),
    codigo: CodigoErro,
    tentativas: z.number().int().min(0),
    falhou_em: z.string().datetime(),
  }),
  /**
   * C-4: o `cadastros` republica os `alterado@1` do tenant (leitor tolerante próprio). Lista explícita (mín. 1); nomes do Hub
   * ou do ERP; para `preco`, peça também `tabela_preco`.
   */
  [EVENTO_CARGA_INICIAL]: z.object({ entidades: z.array(z.string()).min(1) }),
} as const;
export type NomeEventoIntegracaoFdv = keyof typeof EVENTOS;
