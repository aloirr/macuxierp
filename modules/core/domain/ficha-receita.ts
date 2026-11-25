/**
 * Ficha da empresa pela Receita (T-0101, ADR 0012 emenda da ficha, RF-CAD-02): funções puras. A API revalida e o banco
 * grava, mascara e audita (`empresa_gravar_receita`, `empresa_contato_revelar`). E-mail, telefone, razão social e
 * endereço de MEI podem ser dado pessoal: nenhuma função aqui devolve valor em mensagem de erro.
 * A fonte é a porta de consulta de CNPJ dos cadastros (RF-CAD-02); o core a declara de forma estrutural, sem importar o módulo.
 */
import { cnpjValido, EmailUsuario, normalizarDocumento } from '@macuxierp/platform-sdk';
import { FichaReceita, FonteFichaReceita, FORMATO_FICHA } from '../contracts';
import type { MotivoFalhaReceita } from '../contracts';

/** O que o core lê da `SugestaoCnpj` dos cadastros (subconjunto estrutural; os nomes são os da sugestão). */
export interface SugestaoReceita {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  cnae_fiscal: string | null;
  endereco: {
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cep?: string | null;
    municipio_ibge?: string | null;
    uf?: string | null;
  };
  cnae_secundarios?: string[] | null;
  porte?: string | null;
  natureza_juridica?: string | null;
  email?: string | null;
  telefone?: string | null;
  opcao_simples?: boolean | null;
  opcao_mei?: boolean | null;
  data_situacao_cadastral?: string | null;
  data_abertura?: string | null;
}

/** Resultado da porta de consulta (mesma forma do `ResultadoConsultaCnpj` dos cadastros). */
export type ResultadoConsultaReceita =
  | { ok: true; sugestao: SugestaoReceita; fonte: string; consultado_em: string }
  | { ok: false; motivo: 'fonte_indisponivel' | 'cnpj_invalido' | 'nao_encontrado' };

const M = FORMATO_FICHA.max;
const somenteDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
/** Texto aparado; nunca cortado: o que passa do máximo do contrato recusa a atualização (`campo_acima_do_limite`). */
const texto = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return t || null;
};
/** AAAA-MM-DD de uma data que existe no calendário (2014-02-30 vira nulo). */
const data = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  if (!FORMATO_FICHA.data.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
};
/** CNAE de 6 ou 7 dígitos (a fonte às vezes perde o zero à esquerda) vira 7; o resto é descartado. */
const cnae = (v: unknown): string | null => {
  const d = somenteDigitos(v);
  const c = d.length === 6 ? d.padStart(7, '0') : d;
  return FORMATO_FICHA.cnae.test(c) && c !== '0000000' ? c : null;
};

/**
 * Regime pela opção da fonte: MEI e Simples quando optou; "normal" só quando a fonte nega as duas opções
 * (lucro presumido ou real); sem informação, nulo.
 */
export function regimeDaOpcao(mei: boolean | null | undefined, simples: boolean | null | undefined): FichaReceita['regime_receita'] {
  if (mei === true) return 'mei';
  if (simples === true) return 'simples';
  return mei === false && simples === false ? 'normal' : null;
}

/** Motivo da falha da porta na linguagem do portal. */
function motivoDaFalhaDaFonte(m: Extract<ResultadoConsultaReceita, { ok: false }>['motivo']): MotivoFalhaReceita {
  if (m === 'fonte_indisponivel') return 'fonte_indisponivel';
  return m === 'nao_encontrado' ? 'cnpj_nao_encontrado' : 'cnpj_invalido';
}

const MENSAGENS: Record<MotivoFalhaReceita, string> = {
  fonte_indisponivel: 'Não foi possível consultar a Receita agora. Tente de novo em alguns minutos.',
  // O CNPJ da empresa não se edita pela empresa (EmpresaEditar não tem `cnpj`; RN-CORE-14): vem da filial padrão.
  cnpj_nao_encontrado: 'A Receita não encontrou o CNPJ desta empresa. Confira o CNPJ da empresa (veio da filial padrão) e tente de novo mais tarde.',
  cnpj_invalido: 'O CNPJ desta empresa é inválido. Ele veio da filial padrão: corrija o CNPJ da empresa pelo operador antes de atualizar pela Receita.',
  resposta_invalida: 'A Receita devolveu dados incompletos. Tente de novo mais tarde.',
  campo_acima_do_limite: 'A Receita enviou um dado maior do que o cadastro aceita. Tente de novo mais tarde; se continuar, avise a equipe técnica.',
  cnpj_divergente: 'A Receita respondeu sobre outro CNPJ. Tente de novo em alguns minutos.',
};
/** 409 das rotas e do 55000 do banco: a empresa nasce da filial padrão (RN-CORE-14), sem ela não há CNPJ nem ficha. */
export const MENSAGEM_SEM_CNPJ = 'Esta empresa ainda não tem CNPJ. Cadastre a filial padrão com razão social e CNPJ e tente de novo.';
export const mensagemDaFalhaReceita = (m: MotivoFalhaReceita): string => MENSAGENS[m];

/**
 * "Atualizar pela Receita": monta a ficha para o `empresa_gravar_receita` a partir da consulta. O CNPJ vem da
 * `core.empresa` e nunca muda por aqui: resposta de outro CNPJ ou sem razão social não grava nada (a ficha anterior fica).
 * E-mail e telefone só entram quando a fonte os trouxe (consulta em cache não os traz; chave ausente mantém no banco).
 */
export function prepararFichaDaConsulta(p: {
  cnpj: string;
  resposta: ResultadoConsultaReceita;
}): { ok: true; ficha: FichaReceita } | { ok: false; motivo: MotivoFalhaReceita } {
  if (!p.resposta.ok) return { ok: false, motivo: motivoDaFalhaDaFonte(p.resposta.motivo) };
  const { sugestao: s, fonte, consultado_em } = p.resposta;
  const cnpj = normalizarDocumento(String(s.cnpj ?? ''));
  if (!cnpjValido(cnpj)) return { ok: false, motivo: 'resposta_invalida' };
  if (cnpj !== normalizarDocumento(p.cnpj)) return { ok: false, motivo: 'cnpj_divergente' };
  const razao = texto(s.razao_social);
  const f = FonteFichaReceita.safeParse(fonte);
  if (!razao || razao.length < 2 || !f.success) return { ok: false, motivo: 'resposta_invalida' };

  const principal = cnae(s.cnae_fiscal);
  const secundarios = [...new Set((s.cnae_secundarios ?? []).map(cnae).filter((c): c is string => c !== null && c !== principal))].slice(0, M.cnaeSecundarios);
  const end = s.endereco ?? {};
  const cep = somenteDigitos(end.cep);
  const ibge = somenteDigitos(end.municipio_ibge);
  const uf = String(end.uf ?? '').trim().toUpperCase();
  const tel = somenteDigitos(s.telefone);
  const email = EmailUsuario.safeParse(s.email ?? '');
  const ficha = {
      razao_social: razao,
      nome_fantasia: texto(s.nome_fantasia),
      logradouro: texto(end.logradouro),
      numero: texto(end.numero),
      complemento: texto(end.complemento),
      bairro: texto(end.bairro),
      cep: FORMATO_FICHA.cep.test(cep) ? cep : null,
      municipio_ibge: FORMATO_FICHA.ibge.test(ibge) ? ibge : null,
      uf: FORMATO_FICHA.uf.test(uf) ? uf : null,
      ...(email.success ? { email: email.data } : {}),
      ...(FORMATO_FICHA.telefone.test(tel) ? { telefone: tel } : {}),
      cnae_principal: principal,
      regime_receita: regimeDaOpcao(s.opcao_mei, s.opcao_simples),
      situacao_cadastral: texto(s.situacao_cadastral),
      situacao_cadastral_data: data(s.data_situacao_cadastral),
      data_abertura: data(s.data_abertura),
      natureza_juridica: texto(s.natureza_juridica),
      porte: texto(s.porte),
      cnae_secundarios: secundarios,
      fonte: f.data,
      consultado_em,
  };
  // Campo acima do máximo do contrato recusa a atualização inteira: nada é cortado em silêncio (o motivo não leva o valor).
  return FichaReceita.safeParse(ficha).success ? { ok: true, ficha } : { ok: false, motivo: 'campo_acima_do_limite' };
}
