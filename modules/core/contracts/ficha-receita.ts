/**
 * Ficha da empresa pela Receita (T-0101, ADR 0012 emenda da ficha, RF-CAD-02). Os nomes são os da migração 0065
 * (`empresa_gravar_receita` recebe `FichaReceita`; `empresa_ler` devolve `FichaReceitaMascarada` na chave `ficha`).
 * E-mail e telefone podem ser dado pessoal (MEI): o detalhe só os devolve MASCARADOS (pelo banco) e o valor completo só
 * sai no Revelar, auditado. Nada disso vai para log, auditoria (só nomes de campo), lista nem busca (regra 8).
 */
import { EmailUsuario } from '@macuxierp/platform-sdk';
import { z } from 'zod';

/** Formatos e limites da ficha (os mesmos da 0065): fonte única, usada aqui e pelo domínio na normalização. */
export const FORMATO_FICHA = {
  cnae: /^\d{7}$/,
  data: /^\d{4}-\d{2}-\d{2}$/,
  cep: /^\d{8}$/,
  ibge: /^\d{7}$/,
  uf: /^[A-Z]{2}$/,
  telefone: /^\d{10,11}$/,
  max: { razao: 150, numero: 20, logradouro: 120, complemento: 120, bairro: 80, situacao: 60, natureza: 120, porte: 60, cnaeSecundarios: 200 },
} as const;
const M = FORMATO_FICHA.max;

/** Fontes que o banco aceita em `fonte` (a `FonteConsulta` dos cadastros). */
export const FonteFichaReceita = z.enum(['brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz']);
export type FonteFichaReceita = z.infer<typeof FonteFichaReceita>;

/** Regime tributário que a fonte informa; o CRT da NF-e sai daqui só como sugestão (a escolha é do fiscal). */
export const RegimeFicha = z.enum(['mei', 'simples', 'normal']);
export type RegimeFicha = z.infer<typeof RegimeFicha>;

const Cnae = z.string().regex(FORMATO_FICHA.cnae);
const Data = z.string().regex(FORMATO_FICHA.data);

/**
 * Ficha para gravar (entrada de `empresa_gravar_receita`). Chave ausente = o banco mantém o valor; chave presente
 * (inclusive nula) = grava. Por isso e-mail e telefone só entram quando a fonte os trouxe (consulta em cache não os traz).
 */
export const FichaReceita = z.object({
  razao_social: z.string().min(2).max(M.razao),
  nome_fantasia: z.string().max(M.razao).nullable(),
  logradouro: z.string().max(M.logradouro).nullable(),
  numero: z.string().max(M.numero).nullable(),
  complemento: z.string().max(M.complemento).nullable(),
  bairro: z.string().max(M.bairro).nullable(),
  cep: z.string().regex(FORMATO_FICHA.cep).nullable(),
  municipio_ibge: z.string().regex(FORMATO_FICHA.ibge).nullable(),
  uf: z.string().regex(FORMATO_FICHA.uf).nullable(),
  /** Minúsculas. Ausente = mantém. */
  email: EmailUsuario.optional(),
  /** Só dígitos (DDD + número). Ausente = mantém. */
  telefone: z.string().regex(FORMATO_FICHA.telefone).optional(),
  cnae_principal: Cnae.nullable(),
  regime_receita: RegimeFicha.nullable(),
  situacao_cadastral: z.string().max(M.situacao).nullable(),
  situacao_cadastral_data: Data.nullable(),
  data_abertura: Data.nullable(),
  natureza_juridica: z.string().max(M.natureza).nullable(),
  porte: z.string().max(M.porte).nullable(),
  cnae_secundarios: z.array(Cnae).max(M.cnaeSecundarios),
  fonte: FonteFichaReceita,
  consultado_em: z.string().datetime(),
});
export type FichaReceita = z.infer<typeof FichaReceita>;

/** Ficha do detalhe da empresa no portal (`empresa_ler`, chave `ficha`): nunca leva o e-mail nem o telefone completos. */
export const FichaReceitaMascarada = z.object({
  nome_fantasia: z.string().nullable(),
  ie: z.string().nullable(),
  logradouro: z.string().nullable(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  cep: z.string().nullable(),
  municipio_ibge: z.string().nullable(),
  uf: z.string().nullable(),
  /** "do****@gmail.com" (padrão do e-mail do 1º admin). */
  email_mascarado: z.string().nullable(),
  /** "(92) ****-1234". */
  telefone_mascarado: z.string().nullable(),
  cnae_principal: z.string().nullable(),
  regime_receita: RegimeFicha.nullable(),
  situacao_cadastral: z.string().nullable(),
  situacao_cadastral_data: z.string().nullable(),
  data_abertura: z.string().nullable(),
  natureza_juridica: z.string().nullable(),
  porte: z.string().nullable(),
  cnae_secundarios: z.array(z.string()).nullable(),
  receita_fonte: z.string().nullable(),
  receita_consultada_em: z.string().nullable(),
});
export type FichaReceitaMascarada = z.infer<typeof FichaReceitaMascarada>;

/** Revelar (ADR 0012, emenda da ficha): só `email` ou `telefone`; o corpo é vazio e o campo vem na URL. */
export const CampoContato = z.enum(['email', 'telefone']);
export type CampoContato = z.infer<typeof CampoContato>;

/** Retorno do Revelar: o valor completo (telefone só com dígitos) ou nulo quando a ficha não tem o dado. */
export const ContatoRevelado = z.object({ valor: z.string().nullable() });
export type ContatoRevelado = z.infer<typeof ContatoRevelado>;

/** Motivos tratados da falha de "Atualizar pela Receita"; a ficha anterior fica como estava. */
export const MotivoFalhaReceita = z.enum(['fonte_indisponivel', 'cnpj_nao_encontrado', 'cnpj_invalido', 'resposta_invalida', 'cnpj_divergente', 'campo_acima_do_limite']);
export type MotivoFalhaReceita = z.infer<typeof MotivoFalhaReceita>;

/** Resultado de "Atualizar pela Receita": só os NOMES dos campos que mudaram (nunca valores) e a ficha mascarada. */
export const ResultadoAtualizarReceita = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('ok'), campos_alterados: z.array(z.string()), ficha: FichaReceitaMascarada.nullable() }),
  z.object({ estado: z.literal('erro'), motivo: MotivoFalhaReceita, mensagem: z.string(), ficha: FichaReceitaMascarada.nullable() }),
]);
export type ResultadoAtualizarReceita = z.infer<typeof ResultadoAtualizarReceita>;
