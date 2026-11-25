/**
 * Ficha da empresa pela Receita (T-0101, ADR 0012 emenda da ficha, RF-CAD-02): funções puras. A API revalida e o banco
 * grava e audita (`empresa_gravar_receita`, `empresa_contato_revelar`). E-mail, telefone, razão social e endereço de MEI
 * podem ser dado pessoal: nenhuma função aqui devolve valor na lista de campos alterados nem em mensagem de erro.
 */
import { cnpjValido, EmailUsuario, normalizarDocumento } from '@macuxierp/platform-sdk';
import { FORMATO_FICHA } from '../contracts';
import type {
  CampoContato,
  CnaeFicha,
  FichaReceita,
  FichaReceitaMascarada,
  FonteFichaReceita,
  MotivoFalhaReceita,
  RegimeFicha,
  RespostaReceitaBruta,
  ResultadoAtualizarReceita,
} from '../contracts';

const somenteDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown, max: number): string | null => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};
const M = FORMATO_FICHA.max;

/**
 * ADR 0012: "do****@gmail.com" (2 primeiras letras do local, ****, @, domínio); local de 1–2 letras vira "*" + "****".
 * Mesmo resultado de `plataforma.mascarar_email` (migração 0035): nulo = nulo, sem "@" = "****", o "@" é o último.
 */
export function mascararEmail(email: string | null | undefined): string | null {
  if (email == null) return null;
  const e = email;
  const i = e.lastIndexOf('@');
  if (i < 0) return '****';
  const local = e.slice(0, i);
  return `${local.length <= 2 ? '*' : local.slice(0, 2)}****${e.slice(i)}`;
}

/**
 * ADR 0012: "(92) ****-1234" (DDD, **** e os 4 últimos dígitos), igual para fixo e celular. Telefone com menos de 10
 * dígitos não tem DDD confiável: sai só "****", sem nenhum dígito.
 */
export function mascararTelefone(telefone: string | null | undefined): string | null {
  if (telefone == null || telefone === '') return null;
  const d = somenteDigitos(telefone);
  if (d.length < 10 || d.length > 11) return '****';
  return `(${d.slice(0, 2)}) ****-${d.slice(-4)}`;
}

/** "(92) 3222-1234" ou "(92) 99123-1234", só para o Revelar. */
function formatarTelefone(d: string): string {
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

/** A ficha do detalhe: tira o e-mail e o telefone completos e põe os mascarados. */
export function mascararFicha(f: FichaReceita): FichaReceitaMascarada {
  const { email, telefone, ...resto } = f;
  return { ...resto, email_mascarado: mascararEmail(email), telefone_mascarado: mascararTelefone(telefone) };
}

function cnae(codigo: unknown, descricao: unknown): CnaeFicha | null {
  const c = somenteDigitos(codigo);
  return FORMATO_FICHA.cnae.test(c) && c !== '0000000' ? { codigo: c, descricao: texto(descricao, M.cnaeDescricao) } : null;
}

function regimeDe(r: RespostaReceitaBruta): RegimeFicha | null {
  if (r.opcao_pelo_mei === true) return 'mei';
  if (r.opcao_pelo_simples === true) return 'simples';
  return null;
}

/**
 * Mapeia a resposta da fonte (BrasilAPI) para a ficha, normalizando. Nulo quando a resposta não serve: CNPJ inválido ou
 * sem razão social. O regime só vem quando a fonte diz que optou pelo MEI ou pelo Simples; o resto (lucro presumido ou
 * real) a fonte não informa e fica nulo.
 */
export function mapearRespostaReceita(r: RespostaReceitaBruta, fonte: FonteFichaReceita, agora: string): FichaReceita | null {
  const cnpj = normalizarDocumento(String(r.cnpj ?? '').padStart(14, '0'));
  const razao = texto(r.razao_social, M.razao);
  if (!razao || !cnpjValido(cnpj)) return null;
  const tel = somenteDigitos(r.ddd_telefone_1);
  const email = EmailUsuario.safeParse(r.email ?? '');
  const cep = somenteDigitos(r.cep);
  const ibge = somenteDigitos(r.codigo_municipio_ibge);
  const uf = (r.uf ?? '').trim().toUpperCase();
  const abertura = (r.data_inicio_atividade ?? '').trim();
  return {
    razao_social: razao,
    nome_fantasia: texto(r.nome_fantasia, M.fantasia),
    cnpj,
    situacao_cadastral: texto(r.descricao_situacao_cadastral, M.situacao),
    data_abertura: FORMATO_FICHA.data.test(abertura) ? abertura : null,
    natureza_juridica: texto(r.natureza_juridica, M.natureza),
    porte: texto(r.porte, M.porte),
    cnae_principal: cnae(r.cnae_fiscal, r.cnae_fiscal_descricao),
    cnae_secundarios: (r.cnaes_secundarios ?? [])
      .map((c) => cnae(c.codigo, c.descricao))
      .filter((c): c is CnaeFicha => c !== null)
      .slice(0, M.cnaeSecundarios),
    endereco: {
      // Igual aos cadastros: o tipo ("AVENIDA") vem separado do nome na BrasilAPI.
      logradouro: texto([r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' '), M.logradouro),
      numero: texto(r.numero, M.numero),
      complemento: texto(r.complemento, M.complemento),
      bairro: texto(r.bairro, M.bairro),
      cep: FORMATO_FICHA.cep.test(cep) ? cep : null,
      municipio: texto(r.municipio, M.municipio),
      municipio_ibge: FORMATO_FICHA.ibge.test(ibge) ? ibge : null,
      uf: FORMATO_FICHA.uf.test(uf) ? uf : null,
    },
    regime: regimeDe(r),
    email: email.success ? email.data : null,
    telefone: FORMATO_FICHA.telefone.test(tel) ? tel : null,
    consultado_em: agora,
    fonte,
  };
}

const COMPARADOS = [
  'razao_social',
  'nome_fantasia',
  'situacao_cadastral',
  'data_abertura',
  'natureza_juridica',
  'porte',
  'cnae_principal',
  'cnae_secundarios',
  'endereco',
  'regime',
  'email',
  'telefone',
] as const satisfies readonly (keyof FichaReceita)[];

/**
 * ADR 0012: os NOMES (ordenados) dos campos que mudaram, para a auditoria `plataforma.empresa.atualizar_receita`; nunca
 * os valores. Data e fonte da consulta não contam (são gravadas sempre). Sem ficha anterior, contam os preenchidos.
 */
export function camposAlterados(anterior: FichaReceita | null, nova: FichaReceita): string[] {
  return COMPARADOS.filter((c) => {
    const novo = JSON.stringify(nova[c]);
    if (!anterior) return nova[c] !== null && !(Array.isArray(nova[c]) && (nova[c] as unknown[]).length === 0);
    return JSON.stringify(anterior[c]) !== novo;
  }).sort();
}

export type RespostaDaFonte =
  | { ok: true; dados: RespostaReceitaBruta; fonte: FonteFichaReceita }
  | { ok: false; motivo: Extract<MotivoFalhaReceita, 'fonte_indisponivel' | 'cnpj_nao_encontrado'> };

const MENSAGENS: Record<MotivoFalhaReceita, string> = {
  fonte_indisponivel: 'A Receita não respondeu. Tente de novo em alguns minutos.',
  cnpj_nao_encontrado: 'A Receita não encontrou este CNPJ.',
  resposta_invalida: 'A resposta da Receita veio incompleta. Tente de novo mais tarde.',
  cnpj_divergente: 'A Receita respondeu com outro CNPJ. Tente de novo.',
};

/**
 * "Atualizar pela Receita": o CNPJ vem da `core.empresa` e nunca muda por aqui. `gravar` é a ficha para o
 * `empresa_gravar_receita` (nulo em qualquer erro: a ficha anterior fica intacta) e `campos_alterados` vai à auditoria.
 * A consulta é guardada mesmo quando nada muda.
 */
export function atualizarFichaPelaReceita(p: {
  cnpj: string;
  anterior: FichaReceita | null;
  resposta: RespostaDaFonte;
  agora: string;
}): { gravar: FichaReceita | null; campos_alterados: string[]; resultado: ResultadoAtualizarReceita } {
  const erro = (motivo: MotivoFalhaReceita) => ({
    gravar: null,
    campos_alterados: [] as string[],
    resultado: { estado: 'erro' as const, motivo, mensagem: MENSAGENS[motivo], ficha: p.anterior ? mascararFicha(p.anterior) : null },
  });
  if (!p.resposta.ok) return erro(p.resposta.motivo);
  const nova = mapearRespostaReceita(p.resposta.dados, p.resposta.fonte, p.agora);
  if (!nova) return erro('resposta_invalida');
  if (nova.cnpj !== normalizarDocumento(p.cnpj)) return erro('cnpj_divergente');
  const campos = camposAlterados(p.anterior, nova);
  return { gravar: nova, campos_alterados: campos, resultado: { estado: 'ok', campos_alterados: campos, ficha: mascararFicha(nova) } };
}

/**
 * Revelar (ADR 0012): só `email` ou `telefone`. Sem ficha ou sem o dado, resposta vazia (`valor` nulo) e `auditar` falso,
 * porque nada foi revelado. O telefone sai formatado.
 */
export function revelarContato(campo: CampoContato, ficha: FichaReceita | null): { valor: string | null; auditar: boolean } {
  if (campo !== 'email' && campo !== 'telefone') throw new Error('Campo de contato inválido');
  const bruto = ficha ? ficha[campo] : null;
  if (!bruto) return { valor: null, auditar: false };
  return { valor: campo === 'telefone' ? formatarTelefone(bruto) : bruto, auditar: true };
}
