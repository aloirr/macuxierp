/**
 * RN-CORE-14: a empresa (core.empresa) nasce da primeira filial padrão viva (sem deleted_at) com razão social e CNPJ.
 * Evento repetido, segunda filial padrão ou mudança posterior na filial não alteram a empresa (só cria, nunca atualiza;
 * a ficha é atualizada pela Receita, T-0101). Função pura: recebe o subconjunto do payload de `cadastros.filial.alterada@1`
 * (sem importar o cadastros) e se a empresa do tenant já existe.
 */

export interface FilialParaEmpresa {
  cnpj?: string | null;
  ie?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  padrao: boolean;
  /** Cadastros publica `inativo` (vem do deleted_at da filial). */
  inativo?: boolean | null;
}

export interface DadosEmpresa {
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  ie: string | null;
}

const vazioParaNulo = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** Devolve os dados da empresa a criar, ou `null` quando não deve fazer nada. */
export function empresaDaFilialPadrao(filial: FilialParaEmpresa, empresaExiste: boolean): DadosEmpresa | null {
  if (empresaExiste) return null;
  if (!filial.padrao || filial.inativo) return null;
  const razao = vazioParaNulo(filial.razao_social);
  const cnpj = (filial.cnpj ?? '').replace(/\D/g, '');
  if (razao === null || cnpj === '') return null;
  return {
    razao_social: razao,
    nome_fantasia: vazioParaNulo(filial.nome_fantasia),
    cnpj,
    ie: vazioParaNulo(filial.ie)?.toUpperCase() ?? null,
  };
}
