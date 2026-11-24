/**
 * Tabela de preço no BKO (RF-CAD-05, T-0088): lista pelo SDK e formulário de criação e edição. RN-CAD-06 (fim da vigência
 * não anterior ao início) roda aqui pela mesma função do `domain` que a API usa; a API revalida e devolve o 422 por campo
 * (`errosDaApi`). Os itens (preço por produto e filial) têm rota própria (`PUT /tabelas-preco/:id/itens`) e ficam fora deste formulário.
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { TabelaPreco, TabelaPrecoAtualizacao, TabelaPrecoDados } from '../contracts';
import { validarVigenciaTabela } from '../domain';
import { camposVisiveis, corpoDoPatch, faltandoObrigatorios, simNao, situacao, vazioParaNulo, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';

export const ROTA_TABELAS_PRECO = '/cadastros/tabelas-preco';
export const ROTA_TABELA_PRECO_NOVA = '/cadastros/tabelas-preco/novo';
export const ROTA_TABELA_PRECO = '/cadastros/tabelas-preco/:id';
export const API_TABELAS_PRECO = '/v1/cadastros/tabelas-preco';

export type TabelaPrecoResumo = TabelaPreco;

const MSG_DATA = 'Use a data no formato AAAA-MM-DD';

export const paginaTabelasPreco = definirPaginaLista({
  id: 'tabelas-preco', api: API_TABELAS_PRECO, item: TabelaPreco, busca: true, inativos: true,
  colunas: [
    { id: 'nome', titulo: 'Nome', valor: (t) => t.nome },
    { id: 'vigencia_inicio', titulo: 'Início', valor: (t) => t.vigencia_inicio },
    { id: 'vigencia_fim', titulo: 'Fim', valor: (t) => t.vigencia_fim ?? '' },
    { id: 'padrao', titulo: 'Padrão', valor: (t) => simNao(t.padrao) },
    { id: 'inativo', titulo: 'Situação', valor: (t) => situacao(t.inativo) },
  ],
  csv: { arquivo: 'tabelas-preco.csv' },
  vazio: { semFiltro: 'Nenhuma tabela de preço cadastrada.', comFiltro: 'Nenhuma tabela de preço com estes filtros.' },
});

export const CAMPOS_TABELA_PRECO: readonly CampoEdicao[] = [
  { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
  { nome: 'vigencia_inicio', rotulo: 'Início da vigência', tipo: 'texto', obrigatorio: true, ajuda: 'AAAA-MM-DD.' },
  { nome: 'vigencia_fim', rotulo: 'Fim da vigência', tipo: 'texto', ajuda: 'AAAA-MM-DD; vazio = sem fim.' },
  { nome: 'padrao', rotulo: 'Tabela padrão', tipo: 'booleano', ajuda: 'A padrão vale para o cliente sem tabela.' },
];

export const camposDaTabelaPreco = (perfil: Perfil, modo: Modo) => camposVisiveis(CAMPOS_TABELA_PRECO, perfil, modo);

export function valoresDaTabelaPreco(t: TabelaPrecoResumo): Valores {
  return { nome: t.nome, vigencia_inicio: t.vigencia_inicio, vigencia_fim: t.vigencia_fim ?? '', padrao: t.padrao ? 'true' : 'false' };
}

export function validarTabelaPreco(v: Valores, modo: Modo, perfil: Perfil): Erros {
  const e = faltandoObrigatorios(camposDaTabelaPreco(perfil, modo), v);
  const inicio = (v.vigencia_inicio ?? '').trim();
  const fim = vazioParaNulo(v.vigencia_fim);
  if (!e.vigencia_inicio && !TabelaPrecoDados.shape.vigencia_inicio.safeParse(inicio).success) e.vigencia_inicio = MSG_DATA;
  if (fim !== null && !TabelaPrecoDados.shape.vigencia_fim.safeParse(fim).success) e.vigencia_fim = MSG_DATA;
  if (!e.vigencia_inicio && !e.vigencia_fim) {
    const r = validarVigenciaTabela(inicio, fim);
    if (!r.ok) e.vigencia_fim = r.violacao.mensagem;
  }
  return e;
}

function corpoComum(v: Valores): Corpo {
  return { nome: (v.nome ?? '').trim(), vigencia_inicio: (v.vigencia_inicio ?? '').trim(), vigencia_fim: vazioParaNulo(v.vigencia_fim), padrao: v.padrao === 'true' };
}

/** Corpo do POST; `null` se o contrato recusar (a tela mostra os erros de `validarTabelaPreco`). */
export function corpoCriarTabelaPreco(v: Valores): TabelaPrecoDados | null {
  const r = TabelaPrecoDados.safeParse(corpoComum(v));
  return r.success ? r.data : null;
}

/** Corpo do PATCH com o que mudou; sem mudança, `null`. */
export function corpoAlterarTabelaPreco(v: Valores, original: TabelaPrecoResumo): Corpo | null {
  return corpoDoPatch(corpoComum(v), original, TabelaPrecoAtualizacao);
}
