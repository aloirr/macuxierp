import type { Crt, ErroFiscal, RegraTributaria, TipoContribuinte } from '../contracts';
import { CSOSN_ICMS, CST_ICMS } from '../contracts';

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erros: ErroFiscal[] };

export interface AlvoRegra {
  ncm: string;
  cfop: string;
  uf_origem: string;
  uf_destino: string;
  tipo_cliente: TipoContribuinte;
  crt: Crt;
  data_emissao: string;
  item_id?: string;
}

/** Critério único de "é CSOSN": código de 3 dígitos (CST tem 2). */
export function ehCsosn(codigo: string): boolean {
  return codigo.length === 3;
}

/** RN-FIS-02: Simples (CRT 1 e 4) usa CSOSN; CRT 2 e 3 usam CST. */
export function usaCsosn(crt: Crt): boolean {
  return crt === 1 || crt === 4;
}

/** RN-FIS-02: o código da regra precisa ser do tipo certo para o CRT da filial. */
export function codigoCompativel(crt: Crt, codigo: string): boolean {
  const lista: readonly string[] = usaCsosn(crt) ? CSOSN_ICMS : CST_ICMS;
  return lista.includes(codigo);
}

/** RN-FIS-04: regra só vale com fonte preenchida e dentro da vigência na data de emissão (datas AAAA-MM-DD). */
function foraDaVigencia(r: RegraTributaria, dataEmissao: string): boolean {
  return dataEmissao < r.vigencia_inicio || (r.vigencia_fim !== null && dataEmissao > r.vigencia_fim);
}

type MotivoInvalida = Extract<ErroFiscal['codigo'], 'REGRA_SEM_FONTE' | 'REGRA_FORA_DA_VIGENCIA'>;
export function motivoInvalida(r: RegraTributaria, dataEmissao: string): MotivoInvalida | null {
  if (!r.fonte || r.fonte.referencia.trim() === '' || r.versao.trim() === '') return 'REGRA_SEM_FONTE';
  if (foraDaVigencia(r, dataEmissao)) return 'REGRA_FORA_DA_VIGENCIA';
  return null;
}

function casa(r: RegraTributaria, a: AlvoRegra): boolean {
  return (
    (r.ncm_prefixo === null || a.ncm.startsWith(r.ncm_prefixo)) &&
    (r.uf_origem === null || r.uf_origem === a.uf_origem) &&
    (r.uf_destino === null || r.uf_destino === a.uf_destino) &&
    (r.tipo_cliente === null || r.tipo_cliente === a.tipo_cliente) &&
    (r.crt === null || r.crt === a.crt) &&
    (r.cfop === null || r.cfop === a.cfop)
  );
}

/** Vetor de especificidade comparado campo a campo: NCM (tamanho do prefixo) > UF destino > tipo de cliente > UF origem > CRT > CFOP. */
function especificidade(r: RegraTributaria): number[] {
  return [r.ncm_prefixo?.length ?? 0, r.uf_destino ? 1 : 0, r.tipo_cliente ? 1 : 0, r.uf_origem ? 1 : 0, r.crt !== null ? 1 : 0, r.cfop ? 1 : 0];
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return 0;
}

/**
 * RN-FIS-01: escolhe a regra mais específica entre as que casam e valem (RN-FIS-04).
 * Empate na maior especificidade = erro de cadastro (nunca escolha silenciosa); sem regra = erro.
 * RN-FIS-02: a regra escolhida precisa ter código compatível com o CRT.
 */
export function selecionarRegra(regras: RegraTributaria[], alvo: AlvoRegra): Resultado<RegraTributaria> {
  const item_id = alvo.item_id;
  const base = { ...(item_id !== undefined ? { item_id } : {}) };
  const candidatas = regras.filter((r) => casa(r, alvo));
  // Vigência primeiro: a regra fora da vigência é descartada. A fonte só é checada na escolhida (sem escolha silenciosa).
  const validas = candidatas.filter((r) => !foraDaVigencia(r, alvo.data_emissao));
  if (validas.length === 0) {
    const fora = candidatas;
    if (fora.length > 0) {
      return {
        ok: false,
        erros: [
          {
            rn: 'RN-FIS-04',
            codigo: 'REGRA_FORA_DA_VIGENCIA',
            mensagem: 'A regra encontrada está fora da vigência na data de emissão e não pode ser aplicada.',
            regra_ids: fora.map((x) => x.id),
            ...base,
          },
        ],
      };
    }
    return {
      ok: false,
      erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA', mensagem: `Nenhuma regra tributária para NCM ${alvo.ncm}, CFOP ${alvo.cfop} e ${alvo.uf_origem}→${alvo.uf_destino}.`, ...base }],
    };
  }
  const ordenadas = [...validas].sort((x, y) => cmp(especificidade(y), especificidade(x)));
  const melhor = ordenadas[0] as RegraTributaria;
  const empatadas = ordenadas.filter((r) => cmp(especificidade(r), especificidade(melhor)) === 0);
  if (empatadas.length > 1) {
    return {
      ok: false,
      erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_EMPATE', mensagem: 'Mais de uma regra com a mesma especificidade: erro de cadastro, ajuste as regras.', regra_ids: empatadas.map((r) => r.id), ...base }],
    };
  }
  if (motivoInvalida(melhor, alvo.data_emissao) === 'REGRA_SEM_FONTE') {
    return {
      ok: false,
      erros: [{ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE', mensagem: 'A regra mais específica não tem fonte (NT, convênio ou anexo) e não pode ser aplicada.', regra_ids: [melhor.id], ...base }],
    };
  }
  if (!codigoCompativel(alvo.crt, melhor.codigo)) {
    return {
      ok: false,
      erros: [
        {
          rn: 'RN-FIS-02',
          codigo: 'CODIGO_INCOMPATIVEL_CRT',
          mensagem: `O código ${melhor.codigo} da regra não serve para o CRT ${alvo.crt} da filial (${usaCsosn(alvo.crt) ? 'Simples usa CSOSN' : 'regime normal usa CST'}).`,
          regra_ids: [melhor.id],
          ...base,
        },
      ],
    };
  }
  return { ok: true, valor: melhor };
}
