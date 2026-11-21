/**
 * Consultas externas de CNPJ e CEP (RF-CAD-02, RN-CAD-05): devolvem só sugestão, com a fonte e o instante, e nunca
 * gravam cadastro. Fonte principal, uma de reserva e cache de 24 h em `cadastros.consulta_externa`, que não guarda
 * quadro de sócios, contato de pessoa nem CPF (`paraCacheCnpj`).
 */
import { cacheValido, expiraEm, paraCacheCnpj, removerCpf, TIMEOUT_FONTE_MS } from '../domain';
import { ErroApi } from '@macuxierp/platform-sdk';
import { SugestaoCep, SugestaoCnpj } from '../contracts';
import type { ConsultaGravada, FonteExterna, RepoConsultaExterna } from './portas';

export interface ResultadoSugestao<T> {
  sugestao: T;
  fonte: 'brasilapi' | 'viacep' | 'receita-aberta' | 'cache';
  consultado_em: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const dig = (v: unknown, n: number): string | null => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s.length === n ? s : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Do jeito de cada fonte para a sugestão do cadastro. Sem sócios, e-mail ou telefone: o que não está aqui não vaza. */
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
  montar(fonte: string, bruto: Record<string, unknown>): T;
}): Promise<ResultadoSugestao<T>> {
  const guardado = await p.repo.obter(p.tipo, p.chave);
  if (guardado && cacheValido(guardado.expira_em, p.agora)) {
    return { sugestao: guardado.resposta as T, fonte: 'cache', consultado_em: guardado.consultado_em.toISOString() };
  }
  const r = await consultarComReserva(p.fontes, p.chave);
  if (!r) throw new ErroApi(404, 'NAO_ENCONTRADO', p.tipo === 'cnpj' ? 'CNPJ não encontrado' : 'CEP não encontrado');
  const sugestao = p.montar(r.fonte, r.bruto);
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
  return { sugestao: limpa as T, fonte: r.fonte, consultado_em: p.agora.toISOString() };
}
