/**
 * Adaptador da lista "Envios ao FDV" (T-0011): a lista de lotes é o descritor do módulo (`paginaLotes`); aqui só viram os tipos
 * do renderizador genérico, com o horário no fuso da empresa. A tela principal (monitor) não é lista: tem componente próprio.
 */
import { EntidadeHub, EstadoLote } from '@macuxierp/integracao-fdv/contracts';
import { PAGINAS_INTEGRACAO_FDV, ROTULO_ENTIDADE, ROTULO_ESTADO_LOTE, paginaLotes } from '@macuxierp/integracao-fdv/web';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import type { FiltroTela, TelaDescrita, TelaLista } from '../descritor/tipos';

const ROTA_LOTES = PAGINAS_INTEGRACAO_FDV.find((p) => p.tipo === 'lotes')?.rota ?? '/integracao-fdv/integracao-fdv/lotes';
const INSTANTES = new Set(['enviado_em', 'concluido_em']);

const FILTROS: readonly FiltroTela[] = [
  { chave: 'entidade', rotulo: 'Cadastro', tipo: 'selecao', opcoes: EntidadeHub.options.map((e) => ({ valor: e, rotulo: ROTULO_ENTIDADE[e] })) },
  { chave: 'estado', rotulo: 'Situação', tipo: 'selecao', opcoes: EstadoLote.options.map((e) => ({ valor: e, rotulo: ROTULO_ESTADO_LOTE[e] })) },
];

export const LISTA_LOTES: TelaLista = {
  tipo: 'lista',
  pagina: paginaLotes as unknown as TelaLista['pagina'],
  filtrosTela: FILTROS,
  colunas: () => paginaLotes.colunas.map((c) => ({ id: c.id, rotulo: INSTANTES.has(c.id) ? c.titulo.replace(' (UTC)', '') : c.titulo })),
  linha: (item, fuso) =>
    Object.fromEntries(
      paginaLotes.colunas.map((c) => {
        const v = (c.valor as (l: unknown) => unknown)(item);
        const texto = v === null || v === undefined ? '' : INSTANTES.has(c.id) ? formatarDataHora(String(v), fuso) : String(v);
        return [c.id, texto];
      }),
    ),
};

export const TELAS_INTEGRACAO_FDV: Readonly<Record<string, TelaDescrita>> = { [ROTA_LOTES]: LISTA_LOTES };
