/**
 * RN-CORE-14: a empresa (core.empresa) nasce da primeira filial padrão viva (sem deleted_at)
 * com razão social e CNPJ. Evento repetido, segunda filial padrão ou mudança posterior na filial
 * não alteram a empresa (a ficha é atualizada pela Receita, T-0101).
 * Função pura: recebe o payload da filial (subconjunto estrutural de
 * `cadastros.filial.alterada@1`, sem importar o cadastros) e a empresa atual.
 *
 * Regras:
 *  - só a filial padrão e ativa conta;
 *  - razão social e CNPJ são obrigatórios na filial;
 *  - empresa com CNPJ preenchido nunca é alterada (o CNPJ amarra o A1);
 *  - PENDENTE (R-20261124-230054, fora da RN-CORE-14): empresa sem CNPJ é completada nos vazios;
 *  - repetir o evento, ou chegar uma segunda filial padrão, é ignorado.
 */

export interface FilialParaEmpresa {
  cnpj: string;
  ie?: string | null;
  razao_social: string;
  nome_fantasia?: string | null;
  padrao: boolean;
  /** Cadastros publica `inativo` (a Filial do contrato não traz deleted_at); `deleted_at` vale se vier. */
  inativo?: boolean;
  deleted_at?: string | null;
}

export interface EmpresaAtual {
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  ie: string | null;
}

export type CamposEmpresa = EmpresaAtual & { razao_social: string; cnpj: string };

export type DecisaoEmpresaDaFilial =
  | { acao: 'criar'; campos: CamposEmpresa }
  | { acao: 'ignorar'; motivo: 'filial_nao_padrao' | 'filial_inativa' | 'dados_incompletos' | 'empresa_ja_preenchida' };

const vazioParaNulo = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export function decidirEmpresaDaFilial(filial: FilialParaEmpresa, atual: EmpresaAtual | null): DecisaoEmpresaDaFilial {
  if (!filial.padrao) return { acao: 'ignorar', motivo: 'filial_nao_padrao' };
  if (filial.inativo || filial.deleted_at) return { acao: 'ignorar', motivo: 'filial_inativa' };

  const razao = vazioParaNulo(filial.razao_social);
  const cnpj = (filial.cnpj ?? '').replace(/\D/g, '');
  if (razao === null || cnpj === '') return { acao: 'ignorar', motivo: 'dados_incompletos' };

  if (atual && vazioParaNulo(atual.cnpj) !== null) return { acao: 'ignorar', motivo: 'empresa_ja_preenchida' };

  const ie = vazioParaNulo(filial.ie)?.toUpperCase() ?? null;
  return {
    acao: 'criar',
    campos: {
      razao_social: vazioParaNulo(atual?.razao_social) ?? razao,
      nome_fantasia: vazioParaNulo(atual?.nome_fantasia) ?? vazioParaNulo(filial.nome_fantasia),
      cnpj,
      ie: vazioParaNulo(atual?.ie) ?? ie,
    },
  };
}
