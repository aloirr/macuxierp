/**
 * Perfil × ação (desenho T-0002, D3): a matriz do doc 03 ("Permissões, matriz da v1") numa fonte só.
 * Cada rota declara a `acao`; a API confere aqui antes do tenant e da licença (RN-CORE-02).
 * Ação nova = linha aqui + teste da matriz, pedida por recado ao engenheiro-software.
 */
import { PERFIS, PERFIS_V1, type ModuloId, type Perfil } from './modulo';

/**
 * Os 6 perfis da empresa na v1, em lista EXPLÍCITA (RN-CORE-09): um perfil novo em `PERFIS` não herda nenhum `.ver`
 * por padrão; cada ação dele entra aqui linha a linha. O analista de implantação fica fora (só consulta os cadastros).
 */
const TODOS = PERFIS_V1;
const ADM = ['administrador'] as const;
const ADM_GERENTE = ['administrador', 'gerente'] as const;
const CADASTRO = ['administrador', 'gerente', 'faturista'] as const;
/** "Ver tudo" do doc 03: o vendedor vê só a própria carteira (filtro no módulo, testado lá). */
const VER = TODOS;
/** Consulta dos cadastros: "ver tudo" mais o analista de implantação (RN-CORE-09, "só os cadastros"). */
const VER_CADASTROS = PERFIS;

export const PERMISSOES = {
  // core (T-0006)
  'core.empresa.ver': TODOS,
  'core.empresa.editar': ADM,
  'core.usuario.gerir': ADM,
  'core.perfil.ver': TODOS,
  'core.licenca.ver': ADM, // D12: o tenant só lê; muda pelo scripts/plataforma/licenca.mjs
  'core.certificado.gerir': ADM,
  'core.ambiente.ver': ['administrador', 'fiscal', 'faturista'],
  'core.ambiente.trocar': ADM, // só volta para homologação; produção é do operador, ADR 0006 (RN-CORE-08)
  'core.auditoria.ver': ADM,
  'core.exportacao.pedir': ADM,
  'core.parametro.gerir': ADM,
  // cadastros (T-0007)
  'cadastros.ver': VER_CADASTROS,
  'cadastros.filial.editar': ADM,
  'cadastros.cliente.editar': CADASTRO,
  'cadastros.cliente.credito': ADM_GERENTE,
  'cadastros.produto.editar': CADASTRO,
  'cadastros.preco.editar': ADM_GERENTE,
  'cadastros.estoque.movimentar': CADASTRO,
  'cadastros.estoque.negativo': ADM_GERENTE, // RN-CAD-07
  'cadastros.condicao_pagamento.editar': ADM_GERENTE,
  'cadastros.condicao_pagamento.desativar_recusadas': ADM, // RN-CAD-09
  'cadastros.vendedor.editar': ADM_GERENTE,
  'cadastros.carteira.transferir': ADM_GERENTE,
  'cadastros.consulta.externa': CADASTRO,
  // ADR 0010, item 3 (RN-CORE-05): troca controlada do external_id
  'cadastros.external_id.trocar': ADM,
  // T-0026 (D8): carga de CSV; cada arquivo ainda confere a ação de edição da entidade (filial só o administrador).
  // RN-CORE-09: o analista de implantação carrega todas as entidades do RF-CAD-11 (inclusive preço) sem a edição de cada
  // uma; filial e limite de crédito continuam só com o administrador. A exceção por linha é do domain do cadastros.
  'cadastros.carga.executar': ['administrador', 'gerente', 'analista_implantacao'],
  // pedido, fiscal, faturamento e integração (F2 a F4; a matriz do doc 03 já fixa)
  'pedido.ver': VER,
  'pedido.pedido.aprovar': ADM_GERENTE,
  'pedido.pedido.lancar': CADASTRO, // T-0013 §4.1: criar, editar e revalidar o pedido manual
  'pedido.pedido.cancelar': ADM_GERENTE, // T-0013 §4.1
  'fiscal.ver': VER,
  'fiscal.regra.editar': ['administrador', 'fiscal'],
  'faturamento.ver': VER,
  'faturamento.nota.emitir': ['administrador', 'faturista', 'fiscal'], // emitir, cancelar, CC-e, inutilizar
  'faturamento.titulo.baixar': CADASTRO, // doc 03, matriz: administrador, gerente e faturista (RN-FAT-06)
  'faturamento.configurar': ADM, // bandeira da filial "faturamento real com NF-e simulada" (PUT /filiais/:id/configuracao; titulos.md): só o administrador
  'integracao-fdv.ver': ['administrador', 'gerente', 'leitura'], // T-0011: os perfis do manifesto do módulo; o monitor não é "ver tudo"
  'integracao-fdv.configurar': ADM, // Sem rota desde a T-0056 (ADR 0013); sai quando o BKO do módulo e do apps ficar só de leitura.
} as const satisfies Record<string, readonly Perfil[]>;

export type Acao = keyof typeof PERMISSOES;

/** O perfil pode executar a ação? (D3) */
export function pode(perfil: Perfil, acao: Acao): boolean {
  return (PERMISSOES[acao] as readonly Perfil[]).includes(perfil);
}

/** Módulo dono da ação (prefixo antes do primeiro ponto): a licença conferida é a dele. */
export function moduloDaAcao(acao: Acao): ModuloId {
  return acao.slice(0, acao.indexOf('.')) as ModuloId;
}
