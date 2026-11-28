/**
 * Condições de pagamento e Equipe e carteira no BKO (T-0123, v0.3.32, lote B): lista, novo e edição de cada uma, e a transferência de carteira.
 * Nenhuma regra de negócio aqui: campos, validação (RN-CAD-15, D7) e corpo do POST e do PATCH vêm de `@macuxierp/cadastros/web`; a API revalida
 * (regra 6). As parcelas da condição entram num campo só ("30/60/90"), que vira a lista de parcelas do módulo.
 */
import {
  API_CONDICOES, API_TRANSFERIR_CARTEIRA, API_VENDEDORES, CAMPOS_CONDICAO, ROTA_CONDICOES, ROTA_EQUIPE, camposDaCondicao, camposDaTransferencia, camposDoVendedor,
  corpoAlterarCondicao, corpoAlterarVendedor, corpoCriarCondicao, corpoCriarVendedor, corpoTransferencia, formularioDoPrazo, paginaCondicoes, paginaEquipe,
  validarCondicao, validarTransferencia, validarVendedor, valoresDoVendedor, type CampoEdicao, type Modo,
} from '@macuxierp/cadastros/web';
import type { Perfil } from '@macuxierp/platform-sdk';
import type { FiltroTela, TelaFormulario } from '../../descritor/tipos';
import { FILTRO_INATIVOS, formularios, listaDe } from '../cadastros';
import { novaChave } from '../comum';

export const ROTA_CONDICAO_NOVA = `${ROTA_CONDICOES}/novo`;
export const ROTA_CONDICAO = `${ROTA_CONDICOES}/:id`;
export const ROTA_VENDEDOR_NOVO = `${ROTA_EQUIPE}/novo`;
export const ROTA_TRANSFERIR_CARTEIRA = `${ROTA_EQUIPE}/transferir`;
export const ROTA_VENDEDOR = `${ROTA_EQUIPE}/:id`;
export { ROTA_CONDICOES, ROTA_EQUIPE };

type Valores = Readonly<Record<string, string>>;
const MENOS_PRIVILEGIADO: Perfil = 'vendedor';

// ---- Condições de pagamento ----

const PARCELAS: CampoEdicao = { nome: 'parcelas', rotulo: 'Dias das parcelas', tipo: 'texto', obrigatorio: true, colunas: 2, ajuda: 'Separe por /, ex.: 30/60/90.' };
/** Campos do módulo na grade de 12 colunas, com as parcelas num campo só depois da forma. */
const larguras: Readonly<Record<string, CampoEdicao['colunas']>> = { codigo: 2, descricao: 3, forma_tpag: 3, prazo_medio_dias: 2 };
const camposCondicao = (perfil: Perfil, modo: Modo): CampoEdicao[] =>
  camposDaCondicao(perfil, modo).flatMap((c) => {
    const campo = { ...c, ...(larguras[c.nome] ? { colunas: larguras[c.nome] } : {}) } as CampoEdicao;
    return c.nome === 'forma_tpag' ? [campo, PARCELAS] : [campo];
  });

/** Texto "30/60/90" (ou separado por vírgula, ponto e vírgula ou espaço) nas parcelas do formulário do módulo. */
export const parcelasDoTexto = (t: string | undefined): string[] => (t ?? '').split(/[/,;\s]+/).filter((x) => x !== '');
const formularioDe = (v: Valores) => ({
  codigo: v.codigo ?? '', descricao: v.descricao ?? '', forma_tpag: v.forma_tpag ?? '', parcelas: parcelasDoTexto(v.parcelas),
  prazo_medio_dias: v.prazo_medio_dias ?? '', prazo_medio_sugerido: '',
});

const CONDICAO = formularios({
  api: API_CONDICOES, voltar: ROTA_CONDICOES, salvar: 'Salvar condição', campos: camposCondicao,
  validar: (v) => {
    const { prazos_dias, ...resto } = validarCondicao(formularioDe(v));
    return { ...resto, ...(prazos_dias ? { parcelas: prazos_dias } : {}) } as Valores;
  },
  criar: (v) => corpoCriarCondicao(formularioDe(v)),
  abrir: (c) => {
    const x = paginaCondicoes.item.parse(c);
    const f = formularioDoPrazo(x);
    return { valores: { codigo: f.codigo, descricao: f.descricao, forma_tpag: f.forma_tpag, parcelas: f.parcelas.join('/'), prazo_medio_dias: f.prazo_medio_dias }, original: x };
  },
  patch: (v, original) => {
    const corpo = corpoAlterarCondicao(formularioDe(v), original).corpo;
    return corpo && Object.keys(corpo).length > 0 ? corpo : null;
  },
});

export const LISTA_CONDICOES = listaDe(paginaCondicoes, {
  rotuloBusca: 'Código ou descrição', tipos: { inativo: 'status', prazo_medio_dias: 'numero' }, rota: ROTA_CONDICAO, rotuloLinha: 'Abrir condição', campoRotulo: 'descricao',
  novo: { rota: ROTA_CONDICAO_NOVA, rotulo: 'Nova condição', criar: 'cadastros.condicao_pagamento.editar' },
});
export const NOVA_CONDICAO = CONDICAO.novo;
export const EDITAR_CONDICAO = CONDICAO.editar;
export { CAMPOS_CONDICAO };

// ---- Equipe e carteira ----

const FILTROS_EQUIPE: readonly FiltroTela[] = [{ chave: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais', colunas: 3 }, FILTRO_INATIVOS];

const VENDEDOR = formularios({
  api: API_VENDEDORES, voltar: ROTA_EQUIPE, salvar: 'Salvar vendedor', campos: camposDoVendedor,
  validar: (v, modo, perfil) => validarVendedor(v, modo, perfil),
  criar: (v) => corpoCriarVendedor(v),
  abrir: (c) => { const x = paginaEquipe.item.parse(c); return { valores: valoresDoVendedor(x), original: x }; },
  patch: (v, original) => {
    const corpo = corpoAlterarVendedor(v, original);
    return corpo && Object.keys(corpo).length > 0 ? corpo : null;
  },
});

export const LISTA_EQUIPE = listaDe(paginaEquipe, {
  rotuloBusca: 'Código ou nome', filtros: FILTROS_EQUIPE, tipos: { inativo: 'status' }, rota: ROTA_VENDEDOR, rotuloLinha: 'Abrir vendedor', campoRotulo: 'nome',
  novo: { rota: ROTA_VENDEDOR_NOVO, rotulo: 'Novo vendedor', criar: 'cadastros.vendedor.editar' },
});
export const NOVO_VENDEDOR = VENDEDOR.novo;
export const EDITAR_VENDEDOR = VENDEDOR.editar;

/** Transferência da carteira inteira de um vendedor para outro (D7); a escolha de clientes soltos fica para a tela do cliente. */
export const TRANSFERIR_CARTEIRA: TelaFormulario = {
  tipo: 'formulario', api: API_TRANSFERIR_CARTEIRA, depois: () => ROTA_EQUIPE, voltar: ROTA_EQUIPE, novaChave, enviar: 'Transferir carteira',
  campos: camposDaTransferencia(MENOS_PRIVILEGIADO).map((c) => ({ nome: c.nome, rotulo: c.rotulo, tipo: c.tipo === 'booleano' || c.tipo === 'dinheiro' ? 'texto' : c.tipo, obrigatorio: true, ...(c.fonte ? { fonte: c.fonte } : {}), ...(c.colunas ? { colunas: c.colunas } : {}) })),
  camposDoPerfil: (perfil) => camposDaTransferencia(perfil).map((c) => ({ nome: c.nome, rotulo: c.rotulo, tipo: c.tipo === 'booleano' || c.tipo === 'dinheiro' ? 'texto' : c.tipo, obrigatorio: true, ...(c.fonte ? { fonte: c.fonte } : {}), ...(c.colunas ? { colunas: c.colunas } : {}) })),
  validar: (v, _i, perfil) => ({ ...validarTransferencia(v, perfil ?? MENOS_PRIVILEGIADO) }),
  montar: (v) => {
    const corpo = corpoTransferencia(v);
    if (!corpo) throw new Error('formulário inválido');
    return corpo;
  },
};
