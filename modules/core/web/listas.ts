/**
 * Listas do BKO do core (T-0087, RF-CORE-02/03/05): usuários, licenças (só leitura) e auditoria, como descritores do SDK
 * (`definirPaginaLista`). A tela do BKO e as rotas `GET /v1/core/{usuarios,licencas,auditoria}[/exportar]` usam os mesmos:
 * filtros na URL, colunas na tabela e no CSV, cursor por `id` e limite até 200 (ADR 0019: a tela corta o código longo na
 * exibição, nunca no dado). Só o administrador da empresa gerencia; a proteção real é a da API (RN-CORE-02, RN-CORE-09).
 * Sem dado pessoal além do necessário: a auditoria mostra o nome de quem fez (o mesmo da tela de Usuários), nunca e-mail nem id, e não leva `antes`/`depois`.
 */
import { definirPaginaLista, type ColunaLista, type ValorCsv } from '@macuxierp/platform-sdk/listas';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { ROTULOS_PERFIL, type Perfil } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { TEXTO_SEM_PRAZO } from './textos-licenca';
import { AuditoriaItemLista, Id, Licenca, ROTULOS_SITUACAO_USUARIO, Usuario, type SituacaoUsuario } from '../contracts';

const Instante = z.string().datetime();

export const ROTULO_MODULO: Readonly<Record<string, string>> = {
  core: 'Empresa',
  cadastros: 'Cadastros',
  pedido: 'Pedidos',
  faturamento: 'Faturamento',
  fiscal: 'Fiscal',
  'integracao-fdv': 'Integração FDV',
};

/** Ações gravadas na auditoria, em português (RD-2419); a desconhecida vira o texto genérico, nunca o código. */
export const ROTULO_ACAO_AUDITORIA: Readonly<Record<string, string>> = {
  'core.usuario.criado': 'Usuário criado',
  'core.usuario.alterado': 'Usuário alterado',
  'core.usuario.inativado': 'Usuário inativado',
  'core.usuario.reativado': 'Usuário reativado',
  'core.usuario.excluido': 'Usuário excluído',
  'core.usuario.senha_redefinida': 'Senha redefinida',
  'core.usuario.senha_esquecida': 'Senha esquecida',
  'core.usuario.senha_trocada': 'Senha trocada',
  'core.empresa.criada': 'Empresa criada',
  'core.empresa.alterada': 'Empresa alterada',
  'core.certificado.enviado': 'Certificado A1 enviado',
  'core.certificado.alterado': 'Certificado A1 alterado',
  'core.certificado.teste_gerado': 'Teste do certificado A1',
  'core.ambiente_fiscal.alterado': 'Ambiente fiscal alterado',
  'core.ambiente.trocado': 'Ambiente fiscal trocado',
  'core.exportacao.pedida': 'Exportação pedida',
  'core.parametro.gravado': 'Parâmetro gravado',
  'cadastros.carga.iniciar': 'Carga de dados iniciada',
  'cadastros.carga.concluir': 'Carga de dados concluída',
  'cadastros.carga.executar': 'Carga de dados executada',
  'cadastros.carteira.transferir': 'Carteira de clientes transferida',
  'cadastros.cliente.editar': 'Cliente editado',
  'cadastros.entrada_lote.processar': 'Lote de entrada processado',
  'cadastros.entrada.credencial.revogar': 'Credencial de entrada revogada',
  'cadastros.estoque.movimentar': 'Estoque movimentado',
  'cadastros.external_id.trocar': 'Identificador externo trocado',
  'cadastros.preco.editar': 'Preço editado',
  'cliente.criar': 'Cliente criado',
  'cliente.external_id.trocar': 'Identificador externo do cliente trocado',
  'cliente.limite_credito_centavos.alterar': 'Limite de crédito alterado',
  'carteira.transferir': 'Carteira de clientes transferida',
  'condicao_pagamento.inativar': 'Condição de pagamento inativada',
  'condicao_pagamento.ajustar_prazo_medio': 'Prazo médio ajustado',
  'condicao_pagamento.completar_prazos_medios': 'Prazos médios completados',
  'condicao_pagamento.preencher_parcelas': 'Parcelas preenchidas',
  'filial.criar': 'Filial criada',
  'filial.alterar': 'Filial alterada',
  'filial.atualizar': 'Filial atualizada',
  'tabela_preco.itens_lote': 'Preços alterados em lote',
  'pedido.lancar': 'Pedido lançado',
  'pedido.aprovar': 'Pedido aprovado',
  'pedido.cancelar': 'Pedido cancelado',
  'pedido.receber': 'Pedido recebido',
  'pedido.recusar': 'Pedido recusado',
  'pedido.revalidar': 'Pedido revalidado',
  'faturamento.nota.emitir': 'Nota emitida',
  'faturamento.nota.cancelar': 'Nota cancelada',
  'faturamento.nota.carta_correcao': 'Carta de correção',
  'faturamento.nota.consultar': 'Nota consultada',
  'faturamento.nota.reenviar': 'Nota reenviada',
  'faturamento.inutilizacao.pedir': 'Inutilização pedida',
  'faturamento.contingencia.abrir': 'Contingência aberta',
  'faturamento.contingencia.encerrar': 'Contingência encerrada',
  'faturamento.epec.transmitir_pendentes': 'EPEC transmitido',
  'faturamento.filial.configurar': 'Filial configurada para emitir',
  'faturamento.titulo.baixar': 'Título baixado',
  'faturamento.titulo.estornar': 'Título estornado',
};
export const ROTULO_ACAO_AUDITORIA_GENERICO = 'Alteração registrada';
export const rotuloAcaoAuditoria = (acao: string): string => ROTULO_ACAO_AUDITORIA[acao] ?? ROTULO_ACAO_AUDITORIA_GENERICO;

/** Entidades auditadas, em português (RD-2419); a desconhecida vira o texto genérico, nunca o código. */
export const ROTULO_ENTIDADE_AUDITORIA: Readonly<Record<string, string>> = {
  usuario: 'Usuário',
  empresa: 'Empresa',
  filial: 'Filial',
  certificado: 'Certificado A1',
  ambiente_fiscal: 'Ambiente fiscal',
  exportacao: 'Exportação',
  parametro: 'Parâmetro',
  carga: 'Carga de dados',
  carga_portal: 'Carga de dados',
  cliente: 'Cliente',
  cliente_endereco: 'Endereço do cliente',
  produto: 'Produto',
  produto_unidade: 'Unidade do produto',
  preco: 'Preço',
  tabela_preco: 'Tabela de preço',
  estoque: 'Estoque',
  condicao_pagamento: 'Condição de pagamento',
  forma_pagamento: 'Forma de pagamento',
  prazo_pagamento: 'Prazo de pagamento',
  vendedor: 'Vendedor',
  rota: 'Rota',
  entrada_lote: 'Lote de entrada',
  pedido: 'Pedido',
  nota: 'Nota fiscal',
  inutilizacao: 'Inutilização',
  contingencia: 'Contingência',
  titulo: 'Título',
};
export const ROTULO_ENTIDADE_AUDITORIA_GENERICO = 'Outro registro';
export const rotuloEntidadeAuditoria = (entidade: string): string => ROTULO_ENTIDADE_AUDITORIA[entidade] ?? ROTULO_ENTIDADE_AUDITORIA_GENERICO;

const sim = (b: boolean) => (b ? 'sim' : 'não');

/**
 * Coluna do core com o tipo da `TabelaDensa` (o `ColunaLista` do sdk ainda não tem `tipo`). MC-0201: `data` = instante ISO
 * exibido no fuso do tenant (`linhaDe`); o texto fixo da coluna ("Nunca entrou") sai como veio.
 */
export type ColunaCore<L> = ColunaLista<L> & { tipo?: 'data' | 'status' };

export const COLUNAS_USUARIOS: readonly ColunaCore<Usuario>[] = [
  { id: 'nome', titulo: 'Nome', valor: (u) => u.nome },
  { id: 'email', titulo: 'E-mail', valor: (u) => u.email },
  { id: 'perfil', titulo: 'Perfil', valor: (u) => ROTULOS_PERFIL[u.perfil] ?? u.perfil },
  { id: 'situacao', titulo: 'Situação', tipo: 'status', valor: (u) => ROTULOS_SITUACAO_USUARIO[u.situacao] },
  { id: 'ultimo_acesso_em', titulo: 'Último acesso', tipo: 'data', valor: (u) => u.ultimo_acesso_em ?? 'Nunca entrou' },
];

export const COLUNAS_LICENCAS: readonly ColunaLista<Licenca>[] = [
  { id: 'modulo', titulo: 'Módulo', valor: (l) => ROTULO_MODULO[l.modulo] ?? l.modulo },
  { id: 'ativo', titulo: 'Ativo', valor: (l) => sim(l.ativo) },
  { id: 'valido_ate', titulo: 'Válido até', valor: (l) => l.valido_ate ?? TEXTO_SEM_PRAZO },
];

export const COLUNAS_AUDITORIA: readonly ColunaCore<AuditoriaItemLista>[] = [
  { id: 'ocorrido_em', titulo: 'Quando', tipo: 'data', valor: (a) => a.ocorrido_em },
  { id: 'usuario_nome', titulo: 'Usuário', valor: (a) => a.usuario_nome ?? 'Sistema' },
  { id: 'acao', titulo: 'Ação', valor: (a) => rotuloAcaoAuditoria(a.acao) },
  { id: 'entidade', titulo: 'Entidade', valor: (a) => rotuloEntidadeAuditoria(a.entidade) },
];

/** Tom do selo da coluna Situação (RN-CORE-17) na `TabelaDensa`; o texto é o de `ROTULOS_SITUACAO_USUARIO`. */
export const TOM_SITUACAO_USUARIO: Readonly<Record<SituacaoUsuario, 'ok' | 'alerta' | 'neutro'>> = {
  ativo: 'ok',
  bloqueado: 'alerta',
  inativo: 'neutro',
};

export const paginaUsuarios = definirPaginaLista({
  id: 'usuarios',
  api: '/v1/core/usuarios',
  item: Usuario,
  busca: true,
  inativos: true,
  colunas: COLUNAS_USUARIOS,
  csv: { arquivo: 'usuarios.csv' },
  vazio: { semFiltro: 'Nenhum usuário cadastrado.', comFiltro: 'Nenhum usuário com estes filtros.' },
});

export const paginaLicencas = definirPaginaLista({
  id: 'licencas',
  api: '/v1/core/licencas',
  item: Licenca,
  colunas: COLUNAS_LICENCAS,
  csv: { arquivo: 'licencas.csv' },
  vazio: { semFiltro: 'Nenhuma licença ativa. Fale com a Macuxi.', comFiltro: 'Nenhuma licença com estes filtros.' },
});

export const paginaAuditoria = definirPaginaLista({
  id: 'auditoria',
  api: '/v1/core/auditoria',
  item: AuditoriaItemLista,
  filtros: { entidade: z.string().max(60).optional(), usuario_id: Id.optional(), usuario: z.string().trim().min(1).max(80).optional(), de: Instante.optional(), ate: Instante.optional() },
  colunas: COLUNAS_AUDITORIA,
  csv: { arquivo: 'auditoria.csv' },
  vazio: { semFiltro: 'Nenhuma alteração registrada.', comFiltro: 'Nenhuma alteração neste período ou para este usuário.' },
});

/** Linha da tabela a partir das colunas (as mesmas do CSV): o instante ISO sai no fuso do tenant. */
function linhaDe<L>(colunas: readonly ColunaLista<L>[], item: L, fuso: string): Record<string, string> {
  const texto = (v: ValorCsv) => (typeof v === 'string' && Instante.safeParse(v).success ? formatarDataHora(v, fuso) : String(v ?? ''));
  return Object.fromEntries(colunas.map((c) => [c.id, texto(c.valor(item))]));
}

export const linhaUsuario = (u: Usuario, fuso: string) => linhaDe(COLUNAS_USUARIOS, u, fuso);
export const linhaLicenca = (l: Licenca, fuso: string) => linhaDe(COLUNAS_LICENCAS, l, fuso);
export const linhaAuditoria = (a: AuditoriaItemLista, fuso: string) => linhaDe(COLUNAS_AUDITORIA, a, fuso);

/** Opções do seletor de perfil do formulário de usuário (a validação é a do contrato `UsuarioCriar`/`UsuarioEditar`). */
export const opcoesDePerfil = (perfis: readonly Perfil[]): readonly { valor: Perfil; rotulo: string }[] =>
  perfis.map((valor) => ({ valor, rotulo: ROTULOS_PERFIL[valor] ?? valor }));

/** RN-CORE-10: a senha provisória (criar e redefinir) aparece uma única vez e obriga a troca no primeiro acesso. */
export const AVISO_SENHA_PROVISORIA = 'Anote esta senha agora: ela aparece uma única vez. A pessoa troca no primeiro acesso.';
