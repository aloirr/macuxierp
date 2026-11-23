import type { EntidadeCarga, LinhasCarga } from '../../contracts';
import { ARQUIVO_DO_ALVO, motivoDependencia, type AlvoReferencia } from './dependencias';
import { erroLinha, type ErroLinha } from './erros';

/** Ordem de carga (D13) e a dependência de cada arquivo. */
export { ENTIDADES_CARGA as ORDEM_CARGA } from '../../contracts';

/** Campo `refs.<campo>` → entidade onde o `external_id` precisa existir. */
export const REFS_CARGA: Readonly<Record<EntidadeCarga, Readonly<Record<string, AlvoReferencia>>>> = {
  filial: {},
  vendedor: { filial: 'filial' },
  condicao_pagamento: {},
  produto: {},
  produto_unidade: { produto: 'produto' },
  preco: { produto: 'produto', filial: 'filial' },
  estoque: { produto: 'produto', filial: 'filial' },
  cliente: { filial: 'filial', vendedor: 'vendedor', tabela_preco: 'tabela_preco', condicao_pagamento: 'condicao_pagamento' },
};

/** Cadastro que o `external_id` da linha identifica em cada arquivo (o preço cria a tabela pelo `tabela_external_id`). */
const ALVO_CRIADO: Readonly<Partial<Record<EntidadeCarga, AlvoReferencia>>> = {
  filial: 'filial', vendedor: 'vendedor', condicao_pagamento: 'condicao_pagamento', produto: 'produto', cliente: 'cliente',
};
export const alvoCriado = (entidade: EntidadeCarga): AlvoReferencia | undefined => ALVO_CRIADO[entidade];

/** O que cada arquivo cria (entra em `idsDoLote` quando a linha é válida). */
function idsCriados(entidade: EntidadeCarga, l: LinhasCarga[EntidadeCarga]): [AlvoReferencia, string][] {
  if (entidade === 'preco') return [['tabela_preco', (l as LinhasCarga['preco']).tabela.external_id]];
  const alvo = ALVO_CRIADO[entidade];
  return alvo ? [[alvo, l.external_id]] : [];
}

export type IdsConhecidos = Record<AlvoReferencia, Set<string>>;
export const idsVazios = (): IdsConhecidos => ({
  filial: new Set(), vendedor: new Set(), condicao_pagamento: new Set(), produto: new Set(), tabela_preco: new Set(), cliente: new Set(),
});

/** Soma ao conjunto os `external_id` das linhas VÁLIDAS do lote (linha ou arquivo recusado não conta). */
export function acrescentarIdsDoLote<E extends EntidadeCarga>(conhecidos: IdsConhecidos, entidade: E, linhas: readonly LinhasCarga[E][]): void {
  for (const l of linhas) for (const [alvo, id] of idsCriados(entidade, l)) conhecidos[alvo].add(id);
}

/** D13: referências conferidas contra o banco e o lote; sem destino, `CARGA_REFERENCIA` (sem o valor). Se o arquivo da dependência não está em `arquivosDoLote` (4º parâmetro), o erro é `CARGA_DEPENDENCIA`. */
export function conferirReferencias<E extends EntidadeCarga>(entidade: E, linhas: readonly LinhasCarga[E][], conhecidos: IdsConhecidos, arquivosDoLote?: ReadonlySet<EntidadeCarga>): { validas: LinhasCarga[E][]; erros: ErroLinha[] } {
  const erros: ErroLinha[] = [];
  const validas: LinhasCarga[E][] = [];
  const mapa = REFS_CARGA[entidade];
  for (const l of linhas) {
    const refs = ('refs' in l ? l.refs : {}) as Record<string, string | undefined>;
    const ruins = Object.entries(mapa).filter(([campo, alvo]) => refs[campo] !== undefined && !conhecidos[alvo].has(refs[campo] as string));
    for (const [campo, alvo] of ruins) {
      const arquivo = ARQUIVO_DO_ALVO[alvo];
      // RF-CAD-11: sem o arquivo da dependência no lote, o aviso diz qual carregar antes; com ele, vale o erro de referência.
      if (arquivosDoLote && !arquivosDoLote.has(arquivo)) erros.push({ ...erroLinha(l.linha, `${campo}_external_id`, 'CARGA_DEPENDENCIA', motivoDependencia(arquivo)), entidade_faltante: arquivo });
      else erros.push(erroLinha(l.linha, `${campo}_external_id`, 'CARGA_REFERENCIA', 'Referência não encontrada no banco nem neste lote'));
    }
    if (ruins.length === 0) validas.push(l);
  }
  return { validas, erros };
}

/** RN-CORE-05: `external_id` repetido no arquivo; a 2ª ocorrência em diante é recusada (`CARGA_DUPLICADO`). */
export function separarDuplicados<L extends { linha: number; external_id: string }>(linhas: readonly L[]): { unicas: L[]; erros: ErroLinha[] } {
  const vistos = new Set<string>();
  const unicas: L[] = [];
  const erros: ErroLinha[] = [];
  for (const l of linhas) {
    if (vistos.has(l.external_id)) erros.push(erroLinha(l.linha, 'external_id', 'CARGA_DUPLICADO', 'external_id repetido no arquivo'));
    else {
      vistos.add(l.external_id);
      unicas.push(l);
    }
  }
  return { unicas, erros };
}
