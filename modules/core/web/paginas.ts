/**
 * Páginas do BKO do core, em dados (rota, menu, ação que libera, colunas, filtros na URL e botões). O shell do BKO
 * (T-0005) renderiza; a proteção real é da API: aqui só se esconde o que o perfil não pode (`pode` do SDK).
 */
import { pode, type Acao, type Perfil } from '@macuxierp/platform-sdk';
import type { AuditoriaItem, CertificadoResumo, Licenca, Usuario } from '../contracts';
import type { ColunaCsv } from './csv';

export interface Coluna<L> extends ColunaCsv<L> {
  id: string;
}

export interface Botao {
  id: string;
  rotulo: string;
  acao: Acao;
  /** Pede confirmação antes (inativar, trocar ambiente, redefinir senha). */
  confirma?: boolean;
}

export interface PaginaCore {
  id: string;
  rota: string;
  titulo: string;
  menu: 'Empresa' | 'Usuários e perfis';
  rf: string;
  /** Ação que libera a página inteira; sem ela o perfil nem vê o item de menu. */
  ver: Acao;
  /** Filtros que vivem na URL (`?busca=...`), para a tela ser compartilhável e recarregável. */
  filtros: readonly string[];
  exportaCsv: boolean;
  botoes: readonly Botao[];
}

export const PAGINAS_CORE: readonly PaginaCore[] = [
  { id: 'empresa', rota: '/core/empresa', titulo: 'Empresa', menu: 'Empresa', rf: 'RF-CORE-01', ver: 'core.empresa.ver', filtros: [], exportaCsv: false, botoes: [{ id: 'editar', rotulo: 'Salvar', acao: 'core.empresa.editar' }] },
  {
    id: 'certificado',
    rota: '/core/empresa/certificado',
    titulo: 'Certificado A1',
    menu: 'Empresa',
    rf: 'RF-CORE-04',
    ver: 'core.certificado.gerir',
    filtros: ['filial_id'],
    exportaCsv: false,
    botoes: [{ id: 'enviar', rotulo: 'Enviar certificado', acao: 'core.certificado.gerir' }],
  },
  {
    id: 'ambiente',
    rota: '/core/empresa/ambiente-fiscal',
    titulo: 'Ambiente fiscal',
    menu: 'Empresa',
    rf: 'RN-CORE-08',
    ver: 'core.ambiente.ver',
    filtros: ['filial_id'],
    exportaCsv: false,
    botoes: [{ id: 'trocar', rotulo: 'Trocar ambiente', acao: 'core.ambiente.trocar', confirma: true }],
  },
  {
    id: 'exportacao',
    rota: '/core/empresa/exportacao',
    titulo: 'Exportar meus dados',
    menu: 'Empresa',
    rf: 'RF-CORE-06',
    ver: 'core.exportacao.pedir',
    filtros: [],
    exportaCsv: false,
    botoes: [{ id: 'pedir', rotulo: 'Gerar exportação', acao: 'core.exportacao.pedir' }],
  },
  {
    id: 'usuarios',
    rota: '/core/usuarios',
    titulo: 'Usuários',
    menu: 'Usuários e perfis',
    rf: 'RF-CORE-02',
    ver: 'core.usuario.gerir',
    filtros: ['busca', 'inativos', 'cursor', 'limite'],
    exportaCsv: true,
    botoes: [
      { id: 'novo', rotulo: 'Novo usuário', acao: 'core.usuario.gerir' },
      { id: 'inativar', rotulo: 'Inativar', acao: 'core.usuario.gerir', confirma: true },
      { id: 'redefinir-senha', rotulo: 'Redefinir senha', acao: 'core.usuario.gerir', confirma: true },
    ],
  },
  { id: 'perfis', rota: '/core/perfis', titulo: 'Perfis e permissões', menu: 'Usuários e perfis', rf: 'RF-CORE-03', ver: 'core.perfil.ver', filtros: [], exportaCsv: false, botoes: [] },
  { id: 'licencas', rota: '/core/licencas', titulo: 'Licenças', menu: 'Usuários e perfis', rf: 'RF-CORE-03', ver: 'core.licenca.ver', filtros: [], exportaCsv: true, botoes: [] },
  { id: 'auditoria', rota: '/core/auditoria', titulo: 'Auditoria', menu: 'Usuários e perfis', rf: 'RF-CORE-05', ver: 'core.auditoria.ver', filtros: ['entidade', 'de', 'ate', 'cursor', 'limite'], exportaCsv: true, botoes: [] },
];

/** Páginas que o perfil enxerga (esconde, não protege: a API checa de novo). */
export function paginasVisiveis(perfil: Perfil): PaginaCore[] {
  return PAGINAS_CORE.filter((p) => pode(perfil, p.ver));
}

/** Botões que o perfil pode usar na página. */
export function botoesVisiveis(perfil: Perfil, pagina: PaginaCore): Botao[] {
  return pagina.botoes.filter((b) => pode(perfil, b.acao));
}

export const COLUNAS_USUARIOS: readonly Coluna<Usuario>[] = [
  { id: 'nome', titulo: 'Nome', valor: (u) => u.nome },
  { id: 'email', titulo: 'E-mail', valor: (u) => u.email },
  { id: 'perfil', titulo: 'Perfil', valor: (u) => u.perfil },
  { id: 'ativo', titulo: 'Ativo', valor: (u) => (u.ativo ? 'sim' : 'não') },
  { id: 'ultimo_acesso_em', titulo: 'Último acesso', valor: (u) => u.ultimo_acesso_em },
];

export const COLUNAS_LICENCAS: readonly Coluna<Licenca>[] = [
  { id: 'modulo', titulo: 'Módulo', valor: (l) => l.modulo },
  { id: 'ativo', titulo: 'Ativo', valor: (l) => (l.ativo ? 'sim' : 'não') },
  { id: 'valido_ate', titulo: 'Válido até', valor: (l) => l.valido_ate },
];

export const COLUNAS_AUDITORIA: readonly Coluna<AuditoriaItem>[] = [
  { id: 'ocorrido_em', titulo: 'Quando (UTC)', valor: (a) => a.ocorrido_em },
  { id: 'usuario_id', titulo: 'Usuário', valor: (a) => a.usuario_id },
  { id: 'acao', titulo: 'Ação', valor: (a) => a.acao },
  { id: 'entidade', titulo: 'Entidade', valor: (a) => a.entidade },
  { id: 'entidade_id', titulo: 'Registro', valor: (a) => a.entidade_id },
];

/** Selo do alerta de vencimento do A1 (RF-CORE-04): texto da faixa no topo do BKO. */
export function avisoCertificado(c: Pick<CertificadoResumo, 'dias_para_vencer' | 'alerta_vencimento'>): string | null {
  if (!c.alerta_vencimento) return null;
  if (c.dias_para_vencer < 0) return 'Certificado vencido: envie o novo para voltar a emitir';
  if (c.dias_para_vencer === 0) return 'O certificado vence hoje';
  return `O certificado vence em ${c.dias_para_vencer} ${c.dias_para_vencer === 1 ? 'dia' : 'dias'}`;
}
