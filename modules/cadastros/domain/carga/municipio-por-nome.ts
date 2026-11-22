export interface MunicipioOficial {
  ibge: string;
  nome: string;
}

export type ResultadoMunicipio = { ok: true; ibge: string } | { ok: false; motivo: string };

/** Tira acentos, passa para maiúsculas, apara, junta espaços e trata `'`, `’` e `-` como espaço. */
export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/['’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** RN-CAD-03: cidade + UF viram o IBGE pelo nome vigente da UF; nenhum ou mais de um resultado recusa a linha. */
export function resolverMunicipio(cidade: string, municipiosDaUf: readonly MunicipioOficial[]): ResultadoMunicipio {
  const alvo = normalizarNome(cidade);
  const achados = municipiosDaUf.filter((m) => normalizarNome(m.nome) === alvo);
  if (achados.length === 0) return { ok: false, motivo: 'município não encontrado na UF' };
  if (achados.length > 1) return { ok: false, motivo: 'município ambíguo: informe municipio_ibge' };
  return { ok: true, ibge: (achados[0] as MunicipioOficial).ibge };
}
