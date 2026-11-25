/**
 * API da etapa 1 da ficha da Receita (#637), mantida só para o expand/contract: o teste
 * tests/integracao/rn/ficha-receita-contrato.test.ts ainda importa estes nomes. Nada do core usa este arquivo; sai no PR
 * de remoção, depois que o `testes` reescrever o teste para a ficha plana (`FichaReceitaPlana`, `ficha-receita.ts`).
 * Os helpers abaixo são locais de propósito: não colidem com os exports da API nova.
 */
import { Cnpj, EmailUsuario } from '@macuxierp/platform-sdk';
import { z } from 'zod';

const FORMATO = {
  cnae: /^\d{7}$/,
  data: /^\d{4}-\d{2}-\d{2}$/,
  cep: /^\d{8}$/,
  ibge: /^\d{7}$/,
  uf: /^[A-Z]{2}$/,
  telefone: /^\d{10,11}$/,
  max: { razao: 150, fantasia: 150, situacao: 60, natureza: 120, porte: 60, cnaeDescricao: 200, cnaeSecundarios: 200, logradouro: 120, numero: 20, complemento: 120, bairro: 80, municipio: 80 },
} as const;
const M = FORMATO.max;

const Fonte = z.enum(['brasilapi', 'receita-aberta']);
const Cnae = z.object({ codigo: z.string().regex(FORMATO.cnae), descricao: z.string().max(M.cnaeDescricao).nullable() });
const Endereco = z.object({
  logradouro: z.string().max(M.logradouro).nullable(),
  numero: z.string().max(M.numero).nullable(),
  complemento: z.string().max(M.complemento).nullable(),
  bairro: z.string().max(M.bairro).nullable(),
  cep: z.string().regex(FORMATO.cep).nullable(),
  municipio: z.string().max(M.municipio).nullable(),
  municipio_ibge: z.string().regex(FORMATO.ibge).nullable(),
  uf: z.string().regex(FORMATO.uf).nullable(),
});
const Regime = z.enum(['mei', 'simples', 'normal']);

const DadosFicha = z.object({
  razao_social: z.string().min(1).max(M.razao),
  nome_fantasia: z.string().max(M.fantasia).nullable(),
  cnpj: Cnpj,
  situacao_cadastral: z.string().max(M.situacao).nullable(),
  data_abertura: z.string().regex(FORMATO.data).nullable(),
  natureza_juridica: z.string().max(M.natureza).nullable(),
  porte: z.string().max(M.porte).nullable(),
  cnae_principal: Cnae.nullable(),
  cnae_secundarios: z.array(Cnae).max(M.cnaeSecundarios),
  endereco: Endereco,
  regime: Regime.nullable(),
  consultado_em: z.string().datetime(),
  fonte: Fonte,
});

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export const FichaReceita = DadosFicha.extend({
  email: EmailUsuario.nullable(),
  telefone: z.string().regex(FORMATO.telefone).nullable(),
});
/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export type FichaReceita = z.infer<typeof FichaReceita>;

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export const FichaReceitaMascarada = DadosFicha.extend({
  email_mascarado: z.string().nullable(),
  telefone_mascarado: z.string().nullable(),
});
/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export type FichaReceitaMascarada = z.infer<typeof FichaReceitaMascarada>;

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export const RespostaReceitaBruta = z
  .object({
    cnpj: z.union([z.string(), z.number()]),
    razao_social: z.string().nullish(),
    nome_fantasia: z.string().nullish(),
    descricao_situacao_cadastral: z.string().nullish(),
    data_inicio_atividade: z.string().nullish(),
    natureza_juridica: z.string().nullish(),
    porte: z.string().nullish(),
    cnae_fiscal: z.union([z.string(), z.number()]).nullish(),
    cnae_fiscal_descricao: z.string().nullish(),
    cnaes_secundarios: z.array(z.object({ codigo: z.union([z.string(), z.number()]), descricao: z.string().nullish() }).passthrough()).nullish(),
    descricao_tipo_de_logradouro: z.string().nullish(),
    logradouro: z.string().nullish(),
    numero: z.string().nullish(),
    complemento: z.string().nullish(),
    bairro: z.string().nullish(),
    cep: z.union([z.string(), z.number()]).nullish(),
    municipio: z.string().nullish(),
    codigo_municipio_ibge: z.union([z.string(), z.number()]).nullish(),
    uf: z.string().nullish(),
    email: z.string().nullish(),
    ddd_telefone_1: z.string().nullish(),
    opcao_pelo_simples: z.boolean().nullish(),
    opcao_pelo_mei: z.boolean().nullish(),
  })
  .passthrough();
/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export type RespostaReceitaBruta = z.infer<typeof RespostaReceitaBruta>;

const MotivoFalha = z.enum(['fonte_indisponivel', 'cnpj_nao_encontrado', 'resposta_invalida', 'cnpj_divergente']);

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export const ResultadoAtualizarReceita = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('ok'), campos_alterados: z.array(z.string()), ficha: FichaReceitaMascarada }),
  z.object({ estado: z.literal('erro'), motivo: MotivoFalha, mensagem: z.string(), ficha: FichaReceitaMascarada.nullable() }),
]);
/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export type ResultadoAtualizarReceita = z.infer<typeof ResultadoAtualizarReceita>;
