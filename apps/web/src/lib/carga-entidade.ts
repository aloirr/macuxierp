/** Carga de cadastros por entidade (T-0051 F2): parte pura da tela, sem React. Um botão por entidade, na ordem do D13. */
import { ENTIDADES_CARGA, type EntidadeCarga, type RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { PAGINA_CARGA, ROTULOS_ENTIDADE } from '@macuxierp/cadastros/web';
import { CARGA_GRANDE_DEMAIS } from './textos';

export const arquivoDaEntidade = (e: EntidadeCarga): string => `${e}.csv`;
export const caminhoDoModelo = (e: EntidadeCarga): string => `${PAGINA_CARGA.api}/modelos/${e}`;

/** Botões na ordem do contrato (`ENTIDADES_CARGA`). */
export const BOTOES_CARGA = ENTIDADES_CARGA.map((entidade) => ({ entidade, rotulo: ROTULOS_ENTIDADE[entidade], arquivo: arquivoDaEntidade(entidade) }));

/** Endereço do proxy de download do modelo (a página usa só este). */
export const enderecoDoModelo = (e: EntidadeCarga): string => `/baixar-modelo?caminho=${encodeURIComponent(caminhoDoModelo(e))}`;

/** `/v1/cadastros/cargas/modelos/<entidade da lista>`; qualquer outro caminho (outra entidade, `..`, consulta, barra a mais) é recusado. */
export function entidadeDoModelo(caminho: string): EntidadeCarga | null {
  const prefixo = `${PAGINA_CARGA.api}/modelos/`;
  if (!caminho.startsWith(prefixo)) return null;
  const e = caminho.slice(prefixo.length);
  return (ENTIDADES_CARGA as readonly string[]).includes(e) ? (e as EntidadeCarga) : null;
}
export const modeloPermitido = (caminho: string): boolean => entidadeDoModelo(caminho) !== null;

/** Confere o arquivo escolhido para o botão (a API revalida: 400 e 413). Mensagens fixas, sem ler o arquivo. */
export function problemaDoArquivo(entidade: EntidadeCarga, arquivo: { nome: string; tamanho: number } | undefined): string | null {
  if (!arquivo) return 'Escolha o arquivo .csv.';
  if (arquivo.nome.toLowerCase() !== arquivoDaEntidade(entidade)) return `Envie só o arquivo ${arquivoDaEntidade(entidade)} neste botão.`;
  if (arquivo.tamanho > PAGINA_CARGA.maxBytes) return CARGA_GRANDE_DEMAIS;
  return null;
}

export interface DependenciaDoArquivo {
  arquivo: string;
  /** Motivos como a API mandou, sem repetir. */
  motivos: string[];
  /** Entidades que faltam, na ordem do D13; vazio se nenhum campo apontou uma. */
  faltam: EntidadeCarga[];
}

/** CARGA_DEPENDENCIA agrupado por arquivo. O texto é o motivo da API; o atalho vem de `entidade_faltante` (ausente ou null = não sei, só o motivo). */
export function dependenciasPorArquivo(r: RelatorioCarga): DependenciaDoArquivo[] {
  const mapa = new Map<string, { motivos: Set<string>; faltam: Set<EntidadeCarga> }>();
  for (const e of r.erros) {
    if (e.codigo !== 'CARGA_DEPENDENCIA') continue;
    const g = mapa.get(e.arquivo) ?? { motivos: new Set<string>(), faltam: new Set<EntidadeCarga>() };
    g.motivos.add(e.motivo);
    const falta = e.entidade_faltante as EntidadeCarga | null | undefined;
    if (falta && (ENTIDADES_CARGA as readonly string[]).includes(falta)) g.faltam.add(falta);
    mapa.set(e.arquivo, g);
  }
  return [...mapa].map(([arquivo, g]) => ({ arquivo, motivos: [...g.motivos], faltam: ENTIDADES_CARGA.filter((x) => g.faltam.has(x)) }));
}

/** Erros que não são de dependência (a tabela por linha), agrupados por arquivo; o motivo nunca traz o valor digitado. */
export function errosDaTabela(r: RelatorioCarga) {
  const mapa = new Map<string, RelatorioCarga['erros']>();
  for (const e of r.erros) if (e.codigo !== 'CARGA_DEPENDENCIA') mapa.set(e.arquivo, [...(mapa.get(e.arquivo) ?? []), e]);
  return [...mapa].map(([arquivo, erros]) => ({ arquivo, erros }));
}

/** O Gravar só vale depois de uma validação do mesmo arquivo, processada e sem nenhum erro (nem omitido). */
export function podeGravar(r: RelatorioCarga | null, entidade: EntidadeCarga): boolean {
  if (!r || r.modo !== 'validar' || r.erros.length > 0 || r.erros_omitidos > 0) return false;
  const e = r.entidades.find((x) => x.entidade === entidade);
  return !!e && e.situacao === 'processado';
}

export function formularioDaEntidade(modo: 'validar' | 'gravar', entidade: EntidadeCarga, arquivo: Blob): FormData {
  const f = new FormData();
  f.append('modo', modo);
  f.append('entidade', entidade);
  f.append(PAGINA_CARGA.campoArquivos, arquivo, arquivoDaEntidade(entidade));
  return f;
}
