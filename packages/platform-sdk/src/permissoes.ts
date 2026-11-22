/**
 * Perfil × ação (desenho T-0002, D3): a matriz do doc 03 ("Permissões, matriz da v1") numa fonte só.
 * Cada rota declara a `acao`; a API confere aqui antes do tenant e da licença (RN-CORE-02).
 * Ação nova = linha aqui + teste da matriz, pedida por recado ao engenheiro-software.
 */
import { PERFIS, type ModuloId, type Perfil } from './modulo';

const TODOS = PERFIS;
const ADM = ['administrador'] as const;
const ADM_GERENTE = ['administrador', 'gerente'] as const;
const CADASTRO = ['administrador', 'gerente', 'faturista'] as const;
/** "Ver tudo" do doc 03: o vendedor vê só a própria carteira (filtro no módulo, testado lá). */
const VER = TODOS;

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
  'cadastros.ver': VER,
  'cadastros.filial.editar': ADM,
  'cadastros.cliente.editar': CADASTRO,
  'cadastros.cliente.credito': ADM_GERENTE,
  'cadastros.produto.editar': CADASTRO,
  'cadastros.preco.editar': ADM_GERENTE,
  'cadastros.estoque.movimentar': CADASTRO,
  'cadastros.estoque.negativo': ADM_GERENTE, // RN-CAD-07
  'cadastros.condicao_pagamento.editar': ADM_GERENTE,
  'cadastros.vendedor.editar': ADM_GERENTE,
  'cadastros.carteira.transferir': ADM_GERENTE,
  'cadastros.consulta.externa': CADASTRO,
  // T-0026 (D8): carga de CSV; cada arquivo ainda confere a ação de edição da entidade (filial só o administrador)
  'cadastros.carga.executar': ADM_GERENTE,
  // pedido, fiscal, faturamento e integração (F2 a F4; a matriz do doc 03 já fixa)
  'pedido.ver': VER,
  'pedido.pedido.aprovar': ADM_GERENTE,
  'fiscal.ver': VER,
  'fiscal.regra.editar': ['administrador', 'fiscal'],
  'faturamento.ver': VER,
  'faturamento.nota.emitir': ['administrador', 'faturista', 'fiscal'], // emitir, cancelar, CC-e, inutilizar
  'integracao-fdv.ver': VER,
  'integracao-fdv.configurar': ADM,
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
