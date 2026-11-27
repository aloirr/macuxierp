/**
 * Ficha da Receita editável (RN-CORE-16, v0.3.24): funções puras. No /config o superadmin edita a ficha; "Atualizar pela
 * Receita" só devolve a prévia (nada grava sem "Salvar"); "Salvar" grava e audita só NOMES de campo e a contagem, nunca
 * valores. Nenhuma função aqui devolve valor em mensagem (e-mail, telefone, razão e endereço de MEI são dado pessoal).
 */
import { cnpjValido, normalizarDocumento } from '@macuxierp/platform-sdk';
import { FonteFichaReceita, MENSAGENS_BLOQUEIO_CNPJ, type SituacaoTrocaCnpj, type EdicaoFicha, type FichaReceitaPlana, type FichaReceitaPlanaMascarada, type MotivoBloqueioCnpj } from '../contracts';

/** Ficha comparável: a mascarada (contatos mascarados) com a razão social opcional; chave ausente = "não informado" (não conta como diferente). */
export type FichaComparavel = Partial<Omit<FichaReceitaPlanaMascarada, 'cnae_secundarios'>> & {
  razao_social?: string | null;
  cnae_secundarios?: readonly string[] | null;
};

/** Campos editáveis, na ordem em que os nomes saem; `email` e `telefone` comparam pelas versões mascaradas. */
const CAMPOS_TEXTO = [
  'razao_social', 'nome_fantasia', 'ie', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio_ibge', 'uf',
  'cnae_principal', 'regime_receita', 'situacao_cadastral', 'situacao_cadastral_data', 'data_abertura', 'natureza_juridica', 'porte',
] as const;
export const CAMPOS_EDITAVEIS_FICHA = [...CAMPOS_TEXTO, 'cnae_secundarios', 'email', 'telefone'] as const;

/** Espaços aparados e repetidos viram um; vazio vira nulo (a ficha já guarda assim). */
const norm = (v: unknown): string | null => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
};
const normCampo = (campo: string, v: unknown): string | null => {
  const t = norm(v);
  return t !== null && (campo === 'uf' || campo === 'ie') ? t.toUpperCase() : t;
};

/** "co****@teste.com.br" (mesmo padrão do banco). */
export const mascararEmail = (email: string): string => {
  const [local = '', dominio = ''] = email.toLowerCase().split('@');
  return `${local.slice(0, 2)}****@${dominio}`;
};
/** "(92) ****-1234" (só dígitos de entrada). */
export const mascararTelefone = (tel: string): string => {
  const d = tel.replace(/\D/g, '');
  return `(${d.slice(0, 2)}) ****-${d.slice(-4)}`;
};

/**
 * RN-CORE-16: nomes dos campos editáveis que diferem entre `salva` e `outra` (nunca valores). Textos comparados sem espaço
 * sobrando (UF sem diferença de caixa), CNAEs secundários sem ordem. Campo ausente (undefined) em qualquer lado não conta:
 * vale para os contatos (a edição só os traz quando editados; o salvo só existe mascarado) e para a razão social do salvo
 * enquanto o banco não a devolver.
 */
export function camposDiferentes(salva: FichaComparavel, outra: FichaComparavel): string[] {
  const dif: string[] = [];
  const a = salva as Record<string, unknown>;
  const b = outra as Record<string, unknown>;
  for (const c of CAMPOS_TEXTO) {
    if (a[c] === undefined || b[c] === undefined) continue;
    if (normCampo(c, a[c]) !== normCampo(c, b[c])) dif.push(c);
  }
  if (salva.cnae_secundarios !== undefined && outra.cnae_secundarios !== undefined) {
    const ordenar = (l: readonly string[] | null | undefined) => [...(l ?? [])].map(String).sort().join(',');
    if (ordenar(salva.cnae_secundarios) !== ordenar(outra.cnae_secundarios)) dif.push('cnae_secundarios');
  }
  if (salva.email_mascarado !== undefined && outra.email_mascarado !== undefined && norm(salva.email_mascarado) !== norm(outra.email_mascarado)) dif.push('email');
  if (salva.telefone_mascarado !== undefined && outra.telefone_mascarado !== undefined && norm(salva.telefone_mascarado) !== norm(outra.telefone_mascarado)) dif.push('telefone');
  return dif;
}

/**
 * RN-CORE-16 (Salvar): compara a edição com a ficha salva e monta a ficha para gravar (`empresa_salvar_ficha`).
 * Textos saem normalizados (espaços, UF maiúscula). `fonte` é decidida aqui: 'manual' na edição; em `origem` 'receita' mantém a
 * fonte e usa o instante da consulta que a prévia trouxe. E-mail e telefone só entram na ficha se vieram na edição.
 * `campos_alterados` vazio = nada a gravar nem a auditar ('sem_mudanca').
 */
export function aplicarEdicao(salva: FichaComparavel, edicao: EdicaoFicha, agora: Date): { ficha: FichaReceitaPlana; campos_alterados: string[] } {
  const { origem, consultado_em, email, telefone, ...resto } = edicao;
  const limpo = Object.fromEntries(
    CAMPOS_TEXTO.filter((c) => c !== 'ie').map((c) => [c, normCampo(c, (resto as Record<string, unknown>)[c])]),
  ) as Pick<FichaReceitaPlana, Exclude<(typeof CAMPOS_TEXTO)[number], 'ie'>>;
  // IE: ausente = não muda; presente (inclusive nula) = grava.
  const ie = resto.ie === undefined ? undefined : normCampo('ie', resto.ie);
  const secundarios = [...new Set(edicao.cnae_secundarios)];
  const comparavel: FichaComparavel = {
    ...limpo,
    ...(ie !== undefined ? { ie } : {}),
    cnae_secundarios: secundarios,
    ...(email !== undefined ? { email_mascarado: mascararEmail(email) } : {}),
    ...(telefone !== undefined ? { telefone_mascarado: mascararTelefone(telefone) } : {}),
  };
  const campos_alterados = camposDiferentes(salva, comparavel);
  const fonteSalva = FonteFichaReceita.safeParse(salva.receita_fonte);
  const daReceita = origem === 'receita' && fonteSalva.success;
  const ficha: FichaReceitaPlana = {
    ...limpo,
    razao_social: limpo.razao_social ?? edicao.razao_social,
    ...(ie !== undefined ? { ie } : {}),
    cnae_secundarios: secundarios,
    ...(email !== undefined ? { email: email.toLowerCase() } : {}),
    ...(telefone !== undefined ? { telefone: telefone.replace(/\D/g, '') } : {}),
    fonte: daReceita ? fonteSalva.data : 'manual',
    consultado_em: origem === 'receita' && consultado_em ? consultado_em : agora.toISOString(),
  };
  return { ficha, campos_alterados };
}

/**
 * RN-CORE-16 (troca de CNPJ): só superadmin, com confirmação, DV válido, diferente do atual e sem NF-e autorizada em
 * produção (homologação não bloqueia). A API revalida com este mesmo avaliador. O CNPJ não vai em mensagem.
 */
export function avaliarTrocaCnpj(p: {
  atual: string;
  novo: string;
  confirmacao: boolean;
  superadmin: boolean;
  temNfeAutorizadaProducao: boolean;
}): { ok: true; cnpj: string } | { ok: false; motivo: MotivoBloqueioCnpj } {
  if (!p.superadmin) return { ok: false, motivo: 'nao_superadmin' };
  if (!p.confirmacao) return { ok: false, motivo: 'sem_confirmacao' };
  const novo = normalizarDocumento(p.novo);
  if (!cnpjValido(novo)) return { ok: false, motivo: 'cnpj_invalido' };
  if (novo === normalizarDocumento(p.atual)) return { ok: false, motivo: 'cnpj_igual' };
  if (p.temNfeAutorizadaProducao) return { ok: false, motivo: 'nfe_autorizada_producao' };
  return { ok: true, cnpj: novo };
}

/**
 * RN-CORE-16: situação da troca de CNPJ para a leitura da empresa. `temNfeAutorizadaProducao` nulo = não foi possível
 * verificar (porta ausente ou falha): bloqueia (falha fechada) com `consulta_indisponivel`.
 */
export function situacaoTrocaCnpj(temNfeAutorizadaProducao: boolean | null): SituacaoTrocaCnpj {
  if (temNfeAutorizadaProducao === null) return { permitida: false, motivo: 'consulta_indisponivel', mensagem: MENSAGENS_BLOQUEIO_CNPJ.consulta_indisponivel };
  if (temNfeAutorizadaProducao) return { permitida: false, motivo: 'nfe_autorizada_producao', mensagem: MENSAGENS_BLOQUEIO_CNPJ.nfe_autorizada_producao };
  return { permitida: true };
}

/**
 * RN-CORE-16 (Atualizar pela Receita): transforma a ficha lida da Receita em prévia mascarada (nada é gravado) e marca os
 * campos diferentes da salva. Contato que a fonte não trouxe sai nulo na prévia e NÃO conta como diferente.
 */
export function previaDaConsulta(salva: FichaComparavel, ficha: FichaReceitaPlana): { previa: FichaReceitaPlanaMascarada; diferentes: string[] } {
  const previa: FichaReceitaPlanaMascarada = {
    razao_social: ficha.razao_social,
    nome_fantasia: ficha.nome_fantasia,
    ie: salva.ie ?? null,
    logradouro: ficha.logradouro,
    numero: ficha.numero,
    complemento: ficha.complemento,
    bairro: ficha.bairro,
    cep: ficha.cep,
    municipio_ibge: ficha.municipio_ibge,
    uf: ficha.uf,
    email_mascarado: ficha.email ? mascararEmail(ficha.email) : null,
    telefone_mascarado: ficha.telefone ? mascararTelefone(ficha.telefone) : null,
    cnae_principal: ficha.cnae_principal,
    regime_receita: ficha.regime_receita,
    situacao_cadastral: ficha.situacao_cadastral,
    situacao_cadastral_data: ficha.situacao_cadastral_data,
    data_abertura: ficha.data_abertura,
    natureza_juridica: ficha.natureza_juridica,
    porte: ficha.porte,
    cnae_secundarios: ficha.cnae_secundarios,
    receita_fonte: ficha.fonte,
    receita_consultada_em: ficha.consultado_em,
  };
  const outra: FichaComparavel = {
    ...previa,
    ...(ficha.email ? {} : { email_mascarado: undefined }),
    ...(ficha.telefone ? {} : { telefone_mascarado: undefined }),
  };
  // A Receita não traz IE: a prévia repete a salva e `ie` nunca aparece como diferente.
  return { previa, diferentes: camposDiferentes(salva, outra) };
}
