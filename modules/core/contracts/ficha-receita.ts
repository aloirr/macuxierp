/**
 * Ficha da empresa pela Receita (T-0101, ADR 0012 emenda da ficha, RF-CAD-02). A ficha é guardada com a data e a fonte
 * da consulta. E-mail e telefone podem ser dado pessoal (MEI): o detalhe só os devolve MASCARADOS e o valor completo só
 * sai no Revelar, auditado. Nada disso vai para log, auditoria (só nomes de campo), lista nem busca (regra 8).
 */
import { Cnpj, EmailUsuario } from '@macuxierp/platform-sdk';
import { z } from 'zod';

/** Formatos e limites da ficha: fonte única, usada aqui e pelo domínio na normalização. */
export const FORMATO_FICHA = {
  cnae: /^\d{7}$/,
  data: /^\d{4}-\d{2}-\d{2}$/,
  cep: /^\d{8}$/,
  ibge: /^\d{7}$/,
  uf: /^[A-Z]{2}$/,
  telefone: /^\d{10,11}$/,
  max: { razao: 150, fantasia: 150, situacao: 60, natureza: 120, porte: 60, cnaeDescricao: 200, cnaeSecundarios: 200, logradouro: 120, numero: 20, complemento: 120, bairro: 80, municipio: 80 },
} as const;
const M = FORMATO_FICHA.max;

/** Fontes públicas da consulta (as mesmas do RF-CAD-02 dos cadastros). */
export const FonteFichaReceita = z.enum(['brasilapi', 'receita-aberta']);
export type FonteFichaReceita = z.infer<typeof FonteFichaReceita>;

export const CnaeFicha = z.object({ codigo: z.string().regex(FORMATO_FICHA.cnae), descricao: z.string().max(M.cnaeDescricao).nullable() });
export type CnaeFicha = z.infer<typeof CnaeFicha>;

export const EnderecoFicha = z.object({
  logradouro: z.string().max(M.logradouro).nullable(),
  numero: z.string().max(M.numero).nullable(),
  complemento: z.string().max(M.complemento).nullable(),
  bairro: z.string().max(M.bairro).nullable(),
  cep: z.string().regex(FORMATO_FICHA.cep).nullable(),
  municipio: z.string().max(M.municipio).nullable(),
  /** Código IBGE do município (7 dígitos). */
  municipio_ibge: z.string().regex(FORMATO_FICHA.ibge).nullable(),
  uf: z.string().regex(FORMATO_FICHA.uf).nullable(),
});
export type EnderecoFicha = z.infer<typeof EnderecoFicha>;

/** Regime tributário que a fonte informa; o CRT da NF-e sai daqui só como sugestão (a escolha é do fiscal). */
export const RegimeFicha = z.enum(['mei', 'simples', 'normal']);
export type RegimeFicha = z.infer<typeof RegimeFicha>;

/** Os dados da Receita, sem e-mail e telefone (o completo e o mascarado se montam por cima). */
const DadosFicha = z.object({
  razao_social: z.string().min(1).max(M.razao),
  nome_fantasia: z.string().max(M.fantasia).nullable(),
  cnpj: Cnpj,
  situacao_cadastral: z.string().max(M.situacao).nullable(),
  /** Data de abertura, AAAA-MM-DD. */
  data_abertura: z.string().regex(FORMATO_FICHA.data).nullable(),
  natureza_juridica: z.string().max(M.natureza).nullable(),
  porte: z.string().max(M.porte).nullable(),
  cnae_principal: CnaeFicha.nullable(),
  cnae_secundarios: z.array(CnaeFicha).max(M.cnaeSecundarios),
  endereco: EnderecoFicha,
  regime: RegimeFicha.nullable(),
  consultado_em: z.string().datetime(),
  fonte: FonteFichaReceita,
});

/** Ficha completa como a empresa a guarda: e-mail em minúsculas e telefone só com dígitos (DDD + número). */
export const FichaReceita = DadosFicha.extend({
  email: EmailUsuario.nullable(),
  telefone: z.string().regex(FORMATO_FICHA.telefone).nullable(),
});
export type FichaReceita = z.infer<typeof FichaReceita>;

/** Ficha do detalhe da empresa no portal: nunca leva o e-mail nem o telefone completos. */
export const FichaReceitaMascarada = DadosFicha.extend({
  /** "do****@gmail.com" (padrão do e-mail do 1º admin). */
  email_mascarado: z.string().nullable(),
  /** "(92) ****-1234". */
  telefone_mascarado: z.string().nullable(),
});
export type FichaReceitaMascarada = z.infer<typeof FichaReceitaMascarada>;

/** Resposta bruta da fonte (formato da BrasilAPI), tolerante: o domínio normaliza e descarta o que não conhece. */
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
export type RespostaReceitaBruta = z.infer<typeof RespostaReceitaBruta>;

/** Revelar (ADR 0012, emenda da ficha): só `email` ou `telefone`; o corpo é vazio e o campo vem na URL. */
export const CampoContato = z.enum(['email', 'telefone']);
export type CampoContato = z.infer<typeof CampoContato>;

/** Retorno do Revelar: o valor completo (telefone formatado) ou nulo quando a ficha não tem o dado. */
export const ContatoRevelado = z.object({ valor: z.string().nullable() });
export type ContatoRevelado = z.infer<typeof ContatoRevelado>;

/** Motivos tratados da falha de "Atualizar pela Receita"; a ficha anterior fica como estava. */
export const MotivoFalhaReceita = z.enum(['fonte_indisponivel', 'cnpj_nao_encontrado', 'resposta_invalida', 'cnpj_divergente']);
export type MotivoFalhaReceita = z.infer<typeof MotivoFalhaReceita>;

/** Resultado de "Atualizar pela Receita": só os NOMES dos campos que mudaram (nunca valores) e a ficha mascarada. */
export const ResultadoAtualizarReceita = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('ok'), campos_alterados: z.array(z.string()), ficha: FichaReceitaMascarada }),
  z.object({ estado: z.literal('erro'), motivo: MotivoFalhaReceita, mensagem: z.string(), ficha: FichaReceitaMascarada.nullable() }),
]);
export type ResultadoAtualizarReceita = z.infer<typeof ResultadoAtualizarReceita>;
