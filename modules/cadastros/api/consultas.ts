/**
 * Consultas externas de CNPJ e CEP (RF-CAD-02, RN-CAD-05): devolvem só sugestão, com a fonte e o instante, e nunca
 * gravam cadastro. Fonte principal, uma de reserva e cache de 24 h em `cadastros.consulta_externa`, que não guarda
 * quadro de sócios, contato de pessoa nem CPF (`paraCacheCnpj`).
 */
import { resolverMunicipio, type MunicipioOficial } from '../domain/carga/municipio-por-nome';
import { cacheValido, expiraEm, paraCacheCnpj, removerCpf, TIMEOUT_FONTE_MS, validarDocumentoCliente, type Violacao } from '../domain';
import { ErroApi } from '@macuxierp/platform-sdk';
import { SugestaoCep, SugestaoCnpj } from '../contracts';
import type { ConsultaGravada, FonteExterna, RepoConsultaExterna, Repositorios } from './portas';
import { dataIso } from './util';

export interface ResultadoSugestao<T> {
  sugestao: T;
  fonte: 'brasilapi' | 'viacep' | 'receita-aberta' | 'cache';
  consultado_em: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const dig = (v: unknown, n: number): string | null => {
  const s = digitos(v);
  return s.length === n ? s : null;
};
const sim = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : typeof v === 'string' ? (/^s(im)?$/i.test(v.trim()) ? true : /^n([aã]o)?$/i.test(v.trim()) ? false : null) : null);
const data = (v: unknown): string | null => str(v)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
const lista = (v: unknown, chave: string, principal: string | null): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((i) => dig(obj(i)[chave], 7)).filter((c): c is string => c !== null && c !== principal))]
    : [];
const fone = (ddd: unknown, num: unknown): string | null => {
  const n = digitos(num);
  return n === '' ? null : `${digitos(ddd)}${n}`;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Do jeito de cada fonte para a sugestão do cadastro. Sem sócios nem CPF; e-mail e telefone só na resposta (o cache os tira, RN-CAD-05). */
export function sugestaoCnpj(fonte: string, bruto: Record<string, unknown>, cnpj: string): SugestaoCnpj {
  if (fonte === 'receita-aberta') {
    const est = obj(bruto.estabelecimento);
    const cidade = obj(est.cidade);
    return SugestaoCnpj.parse({
      cnpj,
      razao_social: nome(bruto.razao_social),
      nome_fantasia: nome(est.nome_fantasia),
      situacao_cadastral: str(est.situacao_cadastral),
      cnae_fiscal: str(obj(est.atividade_principal).id),
      cnae_secundarios: lista(est.atividades_secundarias, 'id', dig(obj(est.atividade_principal).id, 7)),
      porte: str(obj(bruto.porte).descricao),
      natureza_juridica: str(obj(bruto.natureza_juridica).descricao),
      email: str(est.email),
      telefone: fone(est.ddd1, est.telefone1),
      opcao_simples: sim(obj(bruto.simples).simples),
      opcao_mei: sim(obj(bruto.simples).mei),
      data_situacao_cadastral: data(est.data_situacao_cadastral),
      endereco: {
        logradouro: str([est.tipo_logradouro, est.logradouro].filter(Boolean).join(' ')) ?? undefined,
        numero: str(est.numero) ?? undefined,
        complemento: str(est.complemento),
        bairro: str(est.bairro) ?? undefined,
        municipio: str(cidade.nome),
        municipio_ibge: dig(cidade.ibge_id, 7) ?? undefined,
        uf: str(obj(est.estado).sigla) ?? undefined,
        cep: dig(est.cep, 8) ?? undefined,
      },
    });
  }
  return SugestaoCnpj.parse({
    cnpj,
    razao_social: nome(bruto.razao_social),
    nome_fantasia: nome(bruto.nome_fantasia),
    situacao_cadastral: str(bruto.descricao_situacao_cadastral),
    cnae_fiscal: str(bruto.cnae_fiscal)?.toString() ?? (typeof bruto.cnae_fiscal === 'number' ? String(bruto.cnae_fiscal) : null),
    cnae_secundarios: lista(bruto.cnaes_secundarios, 'codigo', dig(bruto.cnae_fiscal, 7)),
    porte: str(bruto.porte),
    natureza_juridica: str(bruto.natureza_juridica),
    email: str(bruto.email),
    telefone: digitos(bruto.ddd_telefone_1) || null,
    opcao_simples: sim(bruto.opcao_pelo_simples),
    opcao_mei: sim(bruto.opcao_pelo_mei),
    data_situacao_cadastral: data(bruto.data_situacao_cadastral),
    endereco: {
      logradouro: str([bruto.descricao_tipo_de_logradouro, bruto.logradouro].filter(Boolean).join(' ')) ?? undefined,
      numero: str(bruto.numero) ?? undefined,
      complemento: str(bruto.complemento),
      bairro: str(bruto.bairro) ?? undefined,
      municipio: str(bruto.municipio),
      municipio_ibge: dig(bruto.codigo_municipio_ibge, 7) ?? undefined,
      uf: str(bruto.uf) ?? undefined,
      cep: dig(bruto.cep, 8) ?? undefined,
    },
  });
}

/** Razão social de MEI traz o CPF do titular: sai antes de a sugestão ir à tela ou ao cache. */
const nome = (v: unknown): string | null => {
  const s = str(v);
  return s === null ? null : str(removerCpf(s));
};

export function sugestaoCep(fonte: string, bruto: Record<string, unknown>, cep: string): SugestaoCep {
  if (fonte === 'viacep') {
    return SugestaoCep.parse({
      cep,
      logradouro: str(bruto.logradouro),
      bairro: str(bruto.bairro),
      complemento: str(bruto.complemento),
      municipio: str(bruto.localidade),
      municipio_ibge: dig(bruto.ibge, 7),
      uf: str(bruto.uf),
    });
  }
  return SugestaoCep.parse({
    cep,
    logradouro: str(bruto.street),
    bairro: str(bruto.neighborhood),
    complemento: null,
    municipio: str(bruto.city),
    municipio_ibge: null,
    uf: str(bruto.state),
  });
}

/** Sem IBGE da fonte, resolve cidade + UF pela tabela oficial vigente (RN-CAD-03); sem achar (ou ambíguo), segue sem. */
export async function completarIbge(
  s: SugestaoCnpj,
  municipiosDaUf: (uf: string) => Promise<readonly MunicipioOficial[]>,
): Promise<SugestaoCnpj> {
  const { municipio, municipio_ibge: ibge, uf } = s.endereco;
  if (ibge || !municipio || !uf) return s;
  const r = resolverMunicipio(municipio, await municipiosDaUf(uf));
  return r.ok ? { ...s, endereco: { ...s.endereco, municipio_ibge: r.ibge } } : s;
}

export const fonteIndisponivel = () =>
  new ErroApi(422, 'FONTE_INDISPONIVEL', 'Não foi possível consultar agora; preencha manualmente ou tente de novo');

/** Tenta a principal e, se ela falhar (tempo, rede, erro), a reserva. `null` = a fonte respondeu que não existe. */
export async function consultarComReserva(
  fontes: readonly FonteExterna<Record<string, unknown>>[],
  chave: string,
): Promise<{ fonte: FonteExterna<Record<string, unknown>>['id']; bruto: Record<string, unknown> } | null> {
  let respondeu = false;
  for (const fonte of fontes) {
    try {
      const bruto = await fonte.consultar(chave, { timeoutMs: TIMEOUT_FONTE_MS });
      respondeu = true;
      if (bruto) return { fonte: fonte.id, bruto };
    } catch {
      // próxima fonte; o motivo da falha não vai ao log (pode ter dado do cadastro na URL)
    }
  }
  if (!respondeu) throw fonteIndisponivel();
  return null;
}

/** Sugestão com cache de 24 h. Só a sugestão (já sem sócios e CPF) vai ao cache. */
export async function sugestaoComCache<T>(p: {
  tipo: 'cnpj' | 'cep';
  chave: string;
  agora: Date;
  repo: RepoConsultaExterna;
  fontes: readonly FonteExterna<Record<string, unknown>>[];
  montar(fonte: string, bruto: Record<string, unknown>): T | Promise<T>;
}): Promise<ResultadoSugestao<T>> {
  const guardado = await p.repo.obter(p.tipo, p.chave);
  if (guardado && cacheValido(guardado.expira_em, p.agora)) {
    return { sugestao: guardado.resposta as T, fonte: 'cache', consultado_em: guardado.consultado_em.toISOString() };
  }
  const r = await consultarComReserva(p.fontes, p.chave);
  if (!r) throw new ErroApi(404, 'NAO_ENCONTRADO', p.tipo === 'cnpj' ? 'CNPJ não encontrado' : 'CEP não encontrado');
  const sugestao = await p.montar(r.fonte, r.bruto);
  const limpa = (p.tipo === 'cnpj' ? paraCacheCnpj(sugestao) : sugestao) as Record<string, unknown>;
  const gravada: ConsultaGravada = {
    tipo: p.tipo,
    chave: p.chave,
    resposta: limpa,
    fonte: r.fonte,
    consultado_em: p.agora,
    expira_em: expiraEm(p.agora),
    external_id: null,
  };
  await p.repo.gravar(gravada);
  // A resposta leva e-mail e telefone (a ficha da empresa os usa); só o cache os descarta.
  return { sugestao, fonte: r.fonte, consultado_em: p.agora.toISOString() };
}

/**
 * Consulta de CNPJ única (RF-CAD-02): valida o documento, consulta com reserva e cache de 24 h e completa o IBGE pela tabela
 * oficial. CNPJ inválido volta como valor; fonte fora (422) e não encontrado (404) lançam `ErroApi` para quem chama traduzir.
 */
export async function consultarCnpj(p: {
  cnpj: string;
  agora: Date;
  repos: Repositorios;
  fontes: readonly FonteExterna<Record<string, unknown>>[];
}): Promise<{ ok: true; resultado: ResultadoSugestao<SugestaoCnpj> } | { ok: false; violacao: Violacao }> {
  const d = validarDocumentoCliente('PJ', p.cnpj);
  if (!d.ok) return { ok: false, violacao: d.violacao };
  const cnpj = d.documento;
  const resultado = await sugestaoComCache({
    tipo: 'cnpj', chave: cnpj, agora: p.agora, repo: p.repos.consultaExterna, fontes: p.fontes,
    montar: (fonte, bruto) => completarIbge(sugestaoCnpj(fonte, bruto, cnpj), (uf) => p.repos.oficiais.municipiosDaUf(uf, dataIso(p.agora))),
  });
  return { ok: true, resultado };
}
