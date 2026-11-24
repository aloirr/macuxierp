/**
 * T-0059 / RN-INT-22: tipos do pré-cadastro de cliente vindo do FDV (nomes combinados com o modulo-integracao-fdv).
 */
import { z } from 'zod';

/** RN-CAD-02: indicador de IE do destinatário. */
export const IndIeDest = z.enum(['1', '2', '9']);
export type IndIeDest = z.infer<typeof IndIeDest>;

/** RN-CAD-03: número do endereço quando não informado. */
export const NUMERO_SEM_NUMERO = 'S/N';

export const SituacaoPreCadastro = z.enum(['aguardando_vinculo', 'recusado', 'aceito', 'reenviado']);
export type SituacaoPreCadastro = z.infer<typeof SituacaoPreCadastro>;

/** Motivo por campo que volta ao FDV. `mensagem` é texto fixo, nunca o valor recebido. */
export const ErroPreCadastro = z.object({ campo: z.string(), codigo: z.string(), mensagem: z.string() });
export type ErroPreCadastro = z.infer<typeof ErroPreCadastro>;

export const PreCadastroEntrada = z.object({
  tipo: z.enum(['PJ', 'PF']),
  documento: z.string(),
  razao_social: z.string(),
  ie: z.string().nullable(),
  /** Ausente: o domínio sugere pelo IE (RN-CAD-02). */
  ind_ie_dest: IndIeDest.optional(),
  endereco: z.object({
    logradouro: z.string(),
    numero: z.string().optional(),
    bairro: z.string(),
    municipio_ibge: z.string(),
    uf: z.string(),
    cep: z.string(),
  }),
});
export type PreCadastroEntrada = z.infer<typeof PreCadastroEntrada>;

export const ResultadoPreCadastro = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), erros: z.array(ErroPreCadastro) }),
]);
export type ResultadoPreCadastro = z.infer<typeof ResultadoPreCadastro>;
