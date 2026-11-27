/**
 * Ficha da empresa pela Receita (T-0101, ADR 0012 emenda da ficha, RF-CAD-02). Os nomes são os da migração 0063
 * (`empresa_gravar_receita` recebe `FichaReceitaPlana`; `empresa_ler` devolve `FichaReceitaPlanaMascarada` na chave `ficha`).
 * E-mail e telefone podem ser dado pessoal (MEI): o detalhe só os devolve MASCARADOS (pelo banco) e o valor completo só
 * sai no Revelar, auditado. Nada disso vai para log, auditoria (só nomes de campo), lista nem busca (regra 8).
 */
import { Cnpj, EmailUsuario } from '@macuxierp/platform-sdk';
import { z } from 'zod';

/** Formatos e limites da ficha (os mesmos da 0063): fonte única, usada aqui e pelo domínio na normalização. */
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
export const FonteFichaReceita = z.enum(['brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz', 'manual']);
export type FonteFichaReceita = z.infer<typeof FonteFichaReceita>;

/** Regime tributário que a fonte informa; o CRT da NF-e sai daqui só como sugestão (a escolha é do fiscal). */
export const RegimeFicha = z.enum(['mei', 'simples', 'normal']);
export type RegimeFicha = z.infer<typeof RegimeFicha>;

/** IE editável (RN-CORE-16): até 14 posições, só dígitos ou "ISENTO", em maiúsculas (mesma largura da IE dos cadastros). */
export const IeFicha = z.string().trim().toUpperCase().max(14).regex(/^(\d+|ISENTO)$/, 'IE: só dígitos ou ISENTO');

const Cnae = z.string().regex(FORMATO_FICHA.cnae);
const Data = z.string().regex(FORMATO_FICHA.data);

/**
 * Ficha para gravar (entrada de `empresa_gravar_receita`). Chave ausente = o banco mantém o valor; chave presente
 * (inclusive nula) = grava. Por isso e-mail e telefone só entram quando a fonte os trouxe (consulta em cache não os traz).
 */
export const FichaReceitaPlana = z.object({
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
  /** IE (RN-CORE-16, editável no Salvar). Ausente = mantém; nula = limpa. A Receita não a traz. */
  ie: IeFicha.nullable().optional(),
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
export type FichaReceitaPlana = z.infer<typeof FichaReceitaPlana>;

/** CNAE com a descrição oficial (CNAE 2.3, `plataforma.cnae_descricoes`, 0066); `descricao` nula = código fora da tabela. */
export const CnaeDescrito = z.object({ codigo: z.string(), descricao: z.string().nullable() });
export type CnaeDescrito = z.infer<typeof CnaeDescrito>;

/** Ficha do detalhe da empresa no portal (`empresa_ler`, chave `ficha`): nunca leva o e-mail nem o telefone completos. */
export const FichaReceitaPlanaMascarada = z.object({
  /** Razão social (RN-CORE-16, v0.3.24): base do Salvar para detectar mudança. Aditivo: ausente = banco anterior (a comparação a ignora). */
  razao_social: z.string().nullable().optional(),
  nome_fantasia: z.string().nullable(),
  /** IE (RN-CORE-16). Aditivo: o banco passa a devolver; ausente = banco anterior (a comparação a ignora). */
  ie: z.string().nullable().optional(),
  logradouro: z.string().nullable(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  cep: z.string().nullable(),
  municipio_ibge: z.string().nullable(),
  /** Nome oficial do município (`plataforma.municipio_nomes`, 0066); nulo sem código ou com código desconhecido. Aditivo: ausente = core anterior. */
  municipio_nome: z.string().nullable().optional(),
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
  /** Descrição do CNAE principal (0066); nula sem CNAE ou fora da tabela. Aditivo: `cnae_principal` segue string. */
  cnae_principal_descricao: z.string().nullable().optional(),
  /** Os `cnae_secundarios`, na mesma ordem, com a descrição; nulo quando a ficha não tem CNAE secundário. */
  cnae_secundarios_descritos: z.array(CnaeDescrito).nullable().optional(),
  receita_fonte: z.string().nullable(),
  receita_consultada_em: z.string().nullable(),
});
export type FichaReceitaPlanaMascarada = z.infer<typeof FichaReceitaPlanaMascarada>;

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
export const ResultadoReceitaPlana = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('ok'), campos_alterados: z.array(z.string()), ficha: FichaReceitaPlanaMascarada.nullable() }),
  z.object({ estado: z.literal('erro'), motivo: MotivoFalhaReceita, mensagem: z.string(), ficha: FichaReceitaPlanaMascarada.nullable() }),
]);
export type ResultadoReceitaPlana = z.infer<typeof ResultadoReceitaPlana>;

/**
 * Entrada do Salvar da ficha editável (RN-CORE-16, v0.3.24, a confirmar no doc 03): os campos de `FichaReceitaPlana`
 * sem `fonte` e `consultado_em` (o servidor decide a fonte gravada). `origem` 'receita' = dados vieram do Atualizar e
 * foram salvos sem mexer; 'manual' = o usuário editou. E-mail e telefone só entram se editados (ausente = não muda).
 */
export const EdicaoFicha = FichaReceitaPlana.omit({ fonte: true, consultado_em: true }).extend({
  origem: z.enum(['manual', 'receita']),
  /** Instante da consulta à Receita; usado quando `origem` = 'receita'. */
  consultado_em: z.string().datetime().optional(),
});
export type EdicaoFicha = z.infer<typeof EdicaoFicha>;

/** Motivos tratados da falha do Salvar (RN-CORE-16). */
export const MotivoSalvarFicha = z.enum(['validacao', 'sem_permissao', 'empresa_nao_encontrada', 'conflito']);
export type MotivoSalvarFicha = z.infer<typeof MotivoSalvarFicha>;

/** Resultado do Salvar (RN-CORE-16): só NOMES de campo alterados, nunca valores. */
export const ResultadoSalvarFicha = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('ok'), campos_alterados: z.array(z.string()), ficha: FichaReceitaPlanaMascarada }),
  z.object({ estado: z.literal('sem_mudanca'), ficha: FichaReceitaPlanaMascarada }),
  z.object({ estado: z.literal('erro'), motivo: MotivoSalvarFicha, mensagem: z.string(), campos: z.record(z.string(), z.string()).optional() }),
]);
export type ResultadoSalvarFicha = z.infer<typeof ResultadoSalvarFicha>;

/** Resposta do "Atualizar pela Receita" (RN-CORE-16): NÃO grava; contatos mascarados; `diferentes` = nomes de campo que diferem do salvo. */
export const PreviaReceita = z.discriminatedUnion('estado', [
  z.object({
    estado: z.literal('ok'),
    previa: FichaReceitaPlanaMascarada,
    diferentes: z.array(z.string()),
    fonte: FonteFichaReceita,
    consultado_em: z.string().datetime(),
  }),
  z.object({ estado: z.literal('erro'), motivo: MotivoFalhaReceita, mensagem: z.string() }),
]);
export type PreviaReceita = z.infer<typeof PreviaReceita>;

/** Troca de CNPJ, só superadmin (RN-CORE-16): CNPJ novo com DV válido e confirmação explícita. */
export const TrocaCnpj = z.object({ cnpj_novo: Cnpj, confirmacao: z.literal(true) });
export type TrocaCnpj = z.infer<typeof TrocaCnpj>;

/** Evento publicado quando o CNPJ da empresa muda (RN-CORE-16): sem o CNPJ antigo; cadastros e FDV propagam consumindo. */
export const EVENTO_CNPJ_ALTERADO = 'core.empresa.cnpj_alterado@1' as const;
export const CnpjAlterado = z.object({
  tenant_id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  cnpj_novo: Cnpj,
  /** Livre (ex.: 'migracao-0077:<empresa_id>' na reemissão da migração). */
  request_id: z.string().min(1).max(200),
  alterado_em: z.string().datetime(),
});
export type CnpjAlterado = z.infer<typeof CnpjAlterado>;

/** Motivos de bloqueio da troca de CNPJ (RN-CORE-16). */
export const MotivoBloqueioCnpj = z.enum(['nfe_autorizada_producao', 'cnpj_igual', 'cnpj_invalido', 'cnpj_em_uso', 'sem_confirmacao', 'nao_superadmin', 'consulta_indisponivel']);
export type MotivoBloqueioCnpj = z.infer<typeof MotivoBloqueioCnpj>;

export const ResultadoTrocaCnpj = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('ok'), cnpj: Cnpj }),
  z.object({ estado: z.literal('bloqueado'), motivo: MotivoBloqueioCnpj, mensagem: z.string() }),
]);
export type ResultadoTrocaCnpj = z.infer<typeof ResultadoTrocaCnpj>;

/** Mensagens em português de cada bloqueio da troca de CNPJ (RN-CORE-16). */
export const MENSAGENS_BLOQUEIO_CNPJ: Record<MotivoBloqueioCnpj, string> = {
  nfe_autorizada_producao: 'O CNPJ não pode ser trocado: a empresa já tem NF-e autorizada em produção',
  cnpj_igual: 'O CNPJ novo é igual ao atual',
  cnpj_invalido: 'CNPJ inválido: confira os 14 dígitos e os dígitos verificadores',
  cnpj_em_uso: 'Este CNPJ já está cadastrado em outra empresa',
  sem_confirmacao: 'Confirme a troca de CNPJ para continuar',
  nao_superadmin: 'Só o superadmin pode trocar o CNPJ da empresa',
  consulta_indisponivel: 'Não foi possível verificar as notas agora; tente de novo',
};

/**
 * Situação da troca de CNPJ na leitura da empresa (RN-CORE-16): a tela sabe ANTES de tentar se o campo fica somente leitura.
 * Aditivo e opcional na resposta (resposta de `GET .../cnpj`); a rota de troca continua revalidando.
 */
export const SituacaoTrocaCnpj = z.discriminatedUnion('permitida', [
  z.object({ permitida: z.literal(true) }),
  z.object({ permitida: z.literal(false), motivo: MotivoBloqueioCnpj, mensagem: z.string() }),
]);
export type SituacaoTrocaCnpj = z.infer<typeof SituacaoTrocaCnpj>;

/** Rotas da ficha editável (RN-CORE-16), com o prefixo do portal; o plugin registra o trecho depois de `PREFIXO_ROTAS_PLATAFORMA`. */
export const PREFIXO_ROTAS_PLATAFORMA = '/v1/plataforma' as const;
export const ROTAS_FICHA = {
  salvar: { metodo: 'PUT', caminho: '/v1/plataforma/empresas/:id/ficha' },
  previaReceita: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/ficha/receita' },
  situacaoCnpj: { metodo: 'GET', caminho: '/v1/plataforma/empresas/:id/cnpj' },
  trocarCnpj: { metodo: 'POST', caminho: '/v1/plataforma/empresas/:id/cnpj' },
} as const;
