import type { EntidadeCarga, LinhasCarga } from '../../contracts';
import { ARQUIVO_DO_ALVO, motivoDependencia, type AlvoReferencia } from './dependencias';
import { erroLinha, type ErroLinha } from './erros';

/** Ordem de carga (D13) e a dependência de cada arquivo. */
export { ENTIDADES_CARGA as ORDEM_CARGA } from '../../contracts';

/** Campo `refs.<campo>` → entidade onde o `external_id` precisa existir. */
export const REFS_CARGA: Readonly<Record<EntidadeCarga, Readonly<Record<string, AlvoReferencia>>>> = {
  filial: {},
  vendedor: { filial: 'filial' },
  forma_pagamento: {},
  prazo_pagamento: { forma: 'forma' },
  produto: {},
  produto_unidade: { produto: 'produto' },
  preco: { produto: 'produto', filial: 'filial' },
  estoque: { produto: 'produto', filial: 'filial' },
  cliente: { filial: 'filial', vendedor: 'vendedor', tabela_preco: 'tabela_preco', condicao_pagamento: 'condicao_pagamento' },
  cliente_endereco: { cliente: 'cliente' },
};

/** Cadastro que o `external_id` da linha identifica em cada arquivo (o preço cria a tabela pelo `tabela_external_id`). */
const ALVO_CRIADO: Readonly<Partial<Record<EntidadeCarga, AlvoReferencia>>> = {
  filial: 'filial', vendedor: 'vendedor', forma_pagamento: 'forma', prazo_pagamento: 'condicao_pagamento', produto: 'produto', cliente: 'cliente',
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
  filial: new Set(), vendedor: new Set(), forma: new Set(), condicao_pagamento: new Set(), produto: new Set(), tabela_preco: new Set(), cliente: new Set(),
});

/** Soma ao conjunto os `external_id` das linhas VÁLIDAS do lote (linha ou arquivo recusado não conta). */
export function acrescentarIdsDoLote<E extends EntidadeCarga>(conhecidos: IdsConhecidos, entidade: E, linhas: readonly LinhasCarga[E][]): void {
  for (const l of linhas) for (const [alvo, id] of idsCriados(entidade, l)) conhecidos[alvo].add(id);
}

/** Nome do cadastro da linha, no início da mensagem A0. */
const CADASTRO_DA_LINHA: Readonly<Record<EntidadeCarga, string>> = {
  filial: 'Filial', vendedor: 'Vendedor', forma_pagamento: 'Forma de pagamento', prazo_pagamento: 'Condição de pagamento', produto: 'Produto',
  produto_unidade: 'Unidade do produto', preco: 'Preço', estoque: 'Estoque', cliente: 'Cliente', cliente_endereco: 'Endereço de cliente',
};

/**
 * D13, RF-CAD-11 (decisão de 23/11): nenhuma carga depende de outra. O `*_external_id` que não está no banco nem no lote é ERRO DA LINHA
 * (`CARGA_DEPENDENCIA`, com motivo e ação, sem o valor, e `entidade_faltante` para o atalho do shell); nunca bloqueia o arquivo.
 */
export function conferirReferencias<E extends EntidadeCarga>(entidade: E, linhas: readonly LinhasCarga[E][], conhecidos: IdsConhecidos): { validas: LinhasCarga[E][]; erros: ErroLinha[] } {
  const erros: ErroLinha[] = [];
  const validas: LinhasCarga[E][] = [];
  const mapa = REFS_CARGA[entidade];
  for (const l of linhas) {
    const refs = ('refs' in l ? l.refs : {}) as Record<string, string | undefined>;
    const ruins = Object.entries(mapa).filter(([campo, alvo]) => refs[campo] !== undefined && !conhecidos[alvo].has(refs[campo] as string));
    for (const [campo, alvo] of ruins) {
      const arquivo = ARQUIVO_DO_ALVO[alvo];
      erros.push({ ...erroLinha(l.linha, `${campo}_external_id`, 'CARGA_DEPENDENCIA', motivoDependencia(CADASTRO_DA_LINHA[entidade], `${campo}_external_id`, arquivo)), entidade_faltante: arquivo });
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
