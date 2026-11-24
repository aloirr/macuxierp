/**
 * Pré-cadastro de cliente FDV -> ERP (T-0059; RN-INT-22; hub-api do FDV v1.0.27 §6.6b).
 * Nomes dos campos do `/pendentes` a conferir com o PO do FDV (pergunta 3); por isso `passthrough` e quase tudo opcional.
 */
import { z } from 'zod';

const Texto = (max: number) => z.string().max(max);

/**
 * Item do `GET /integracao/v1/clientes/pendentes`.
 * campos provisórios até conferir o hub-api §6.6b do FDV v1.0.27
 */
export const ClienteParaErp = z
  .object({
    cliente_uuid: z.string().uuid(),
    documento: Texto(20),
    razao_social: Texto(200).nullish(),
    nome_fantasia: Texto(200).nullish(),
    inscricao_estadual: Texto(20).nullish(),
    vendedor_external_id: Texto(200).nullish(),
    telefone: Texto(30).nullish(),
    email: Texto(200).nullish(),
    logradouro: Texto(200).nullish(),
    numero: Texto(20).nullish(),
    complemento: Texto(100).nullish(),
    bairro: Texto(100).nullish(),
    cep: Texto(10).nullish(),
    uf: Texto(2).nullish(),
    municipio_ibge: Texto(7).nullish(),
    municipio: Texto(100).nullish(),
    criado_em: z.string().datetime({ offset: true }).nullish(),
    tentativa: z.number().int().nullish(),
  })
  .passthrough();
export type ClienteParaErp = z.infer<typeof ClienteParaErp>;

/** Erro por campo (aditivo, premissa P2): `codigo` é texto opaco do cadastros (ex.: `RN-CAD-01`, `CARGA_OBRIGATORIO`). */
export const ErroCampoPreCadastro = z.object({
  campo: z.string().min(1).max(60),
  codigo: z.string().min(1).max(60),
  mensagem: z.string().min(1).max(300),
});
export type ErroCampoPreCadastro = z.infer<typeof ErroCampoPreCadastro>;

/** Corpo do `POST /integracao/v1/clientes/{cliente_uuid}/retorno`. */
export const RetornoCliente = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('vinculado'),
    external_id: z.string().min(1).max(200),
  }),
  z.object({
    status: z.literal('rejeitado_erp'),
    motivo: z.string().min(1).max(300),
    /** Opcional e aditivo: o FDV antigo ignora. */
    erros: z.array(ErroCampoPreCadastro).max(50).optional(),
  }),
]);
export type RetornoCliente = z.infer<typeof RetornoCliente>;
