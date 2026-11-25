/**
 * API da etapa 1 da ficha da Receita (#637), mantida só para o expand/contract: o teste
 * tests/integracao/rn/ficha-receita-contrato.test.ts ainda importa estas funções. Nada do core usa este arquivo; sai no
 * PR de remoção, depois que o `testes` reescrever o teste para a ficha plana (`prepararFichaDaConsulta`).
 * Os helpers são locais de propósito: não colidem com os exports da API nova.
 */
import { cnpjValido, EmailUsuario, normalizarDocumento } from '@macuxierp/platform-sdk';
import type { FichaReceita, FichaReceitaMascarada, RespostaReceitaBruta, ResultadoAtualizarReceita } from '../contracts';

type Cnae = NonNullable<FichaReceita['cnae_principal']>;
type Fonte = FichaReceita['fonte'];
type Regime = NonNullable<FichaReceita['regime']>;
type Motivo = Extract<ResultadoAtualizarReceita, { estado: 'erro' }>['motivo'];

const FORMATO = { cnae: /^\d{7}$/, data: /^\d{4}-\d{2}-\d{2}$/, cep: /^\d{8}$/, ibge: /^\d{7}$/, uf: /^[A-Z]{2}$/, telefone: /^\d{10,11}$/ } as const;
const M = { razao: 150, fantasia: 150, situacao: 60, natureza: 120, porte: 60, cnaeDescricao: 200, cnaeSecundarios: 200, logradouro: 120, numero: 20, complemento: 120, bairro: 80, municipio: 80 } as const;

const somenteDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown, max: number): string | null => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

function mascararEmail(email: string | null | undefined): string | null {
  if (email == null) return null;
  const i = email.lastIndexOf('@');
  if (i < 0) return '****';
  const local = email.slice(0, i);
  return `${local.length <= 2 ? '*' : local.slice(0, 2)}****${email.slice(i)}`;
}

function mascararTelefone(telefone: string | null | undefined): string | null {
  if (telefone == null || telefone === '') return null;
  const d = somenteDigitos(telefone);
  if (d.length < 10 || d.length > 11) return '****';
  return `(${d.slice(0, 2)}) ****-${d.slice(-4)}`;
}

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export function mascararFicha(f: FichaReceita): FichaReceitaMascarada {
  const { email, telefone, ...resto } = f;
  return { ...resto, email_mascarado: mascararEmail(email), telefone_mascarado: mascararTelefone(telefone) };
}

function cnae(codigo: unknown, descricao: unknown): Cnae | null {
  const c = somenteDigitos(codigo);
  return FORMATO.cnae.test(c) && c !== '0000000' ? { codigo: c, descricao: texto(descricao, M.cnaeDescricao) } : null;
}

function regimeDe(r: RespostaReceitaBruta): Regime | null {
  if (r.opcao_pelo_mei === true) return 'mei';
  if (r.opcao_pelo_simples === true) return 'simples';
  return null;
}

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export function mapearRespostaReceita(r: RespostaReceitaBruta, fonte: Fonte, agora: string): FichaReceita | null {
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
    data_abertura: FORMATO.data.test(abertura) ? abertura : null,
    natureza_juridica: texto(r.natureza_juridica, M.natureza),
    porte: texto(r.porte, M.porte),
    cnae_principal: cnae(r.cnae_fiscal, r.cnae_fiscal_descricao),
    cnae_secundarios: (r.cnaes_secundarios ?? [])
      .map((c) => cnae(c.codigo, c.descricao))
      .filter((c): c is Cnae => c !== null)
      .slice(0, M.cnaeSecundarios),
    endereco: {
      logradouro: texto([r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' '), M.logradouro),
      numero: texto(r.numero, M.numero),
      complemento: texto(r.complemento, M.complemento),
      bairro: texto(r.bairro, M.bairro),
      cep: FORMATO.cep.test(cep) ? cep : null,
      municipio: texto(r.municipio, M.municipio),
      municipio_ibge: FORMATO.ibge.test(ibge) ? ibge : null,
      uf: FORMATO.uf.test(uf) ? uf : null,
    },
    regime: regimeDe(r),
    email: email.success ? email.data : null,
    telefone: FORMATO.telefone.test(tel) ? tel : null,
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

function camposAlterados(anterior: FichaReceita | null, nova: FichaReceita): string[] {
  return COMPARADOS.filter((c) => {
    const novo = JSON.stringify(nova[c]);
    if (!anterior) return nova[c] !== null && !(Array.isArray(nova[c]) && (nova[c] as unknown[]).length === 0);
    return JSON.stringify(anterior[c]) !== novo;
  }).sort();
}

type RespostaDaFonte =
  | { ok: true; dados: RespostaReceitaBruta; fonte: Fonte }
  | { ok: false; motivo: Extract<Motivo, 'fonte_indisponivel' | 'cnpj_nao_encontrado'> };

const MENSAGENS: Record<Motivo, string> = {
  fonte_indisponivel: 'A Receita não respondeu. Tente de novo em alguns minutos.',
  cnpj_nao_encontrado: 'A Receita não encontrou este CNPJ.',
  resposta_invalida: 'A resposta da Receita veio incompleta. Tente de novo mais tarde.',
  cnpj_divergente: 'A Receita respondeu com outro CNPJ. Tente de novo.',
};

/** @deprecated T-0101: só para tests/integracao/rn/ficha-receita-contrato.test.ts; sai no PR de remoção depois da reescrita do testes. */
export function atualizarFichaPelaReceita(p: {
  cnpj: string;
  anterior: FichaReceita | null;
  resposta: RespostaDaFonte;
  agora: string;
}): { gravar: FichaReceita | null; campos_alterados: string[]; resultado: ResultadoAtualizarReceita } {
  const erro = (motivo: Motivo) => ({
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
