/**
 * Adaptador do core (T-0087, T-0088): usuários, licenças e auditoria (listas do módulo, com CSV), o formulário de usuário novo, as ações
 * por linha (editar, inativar, reativar e redefinir senha) e os quadros de perfis e de ambiente fiscal. Nenhuma regra de negócio aqui:
 * colunas, filtros, rótulos, validação e o aviso da senha provisória (RN-CORE-10) vêm de `@macuxierp/core/web` e `contracts`; a API revalida
 * perfil, tenant e licença (RN-CORE-02, RN-CORE-09). Sem dado pessoal em log. A senha provisória só passa pela resposta da escrita.
 */
import { AVISO_USUARIO, tomAmarelo } from '../usuarios-textos';
import {
  AVISO_SENHA_PROVISORIA, COLUNAS_USUARIOS, PAGINAS_CORE, ROTULO_MODULO, ROTULO_SITUACAO_LICENCA, situacaoDaLicenca, tomDaLicenca, TOM_SITUACAO_USUARIO, linhaAuditoria, linhaLicenca, linhaUsuario, opcoesDePerfil, paginaAuditoria, paginaLicencas, paginaUsuarios, quadroEmpresaFiscal,
} from '@macuxierp/core/web';
import { AuditoriaItemLista, Licenca, ROTULOS_SITUACAO_USUARIO, Usuario, UsuarioCriar, UsuarioEditar, type PerfilComAcoes } from '@macuxierp/core/contracts';
import { PERFIS, ROTULOS_PERFIL, pode, type Perfil } from '@macuxierp/platform-sdk';
import { ERRO_CAMPOS } from '../textos';
import type { AcaoVista, EntradaAcao, ErrosFormulario, Linha, ResultadoAcao, TelaDescrita, TelaFormulario, TelaLista, ValoresFormulario } from '../descritor/tipos';
import { colunasDoModulo, novaChave } from './comum';

const rotaDe = (id: string): string => PAGINAS_CORE.find((p) => p.id === id)?.rota ?? `/core/${id}`;
export const ROTA_USUARIOS = rotaDe('usuarios');
export const ROTA_USUARIO_NOVO = `${ROTA_USUARIOS}/novo`;
export const ROTA_PERFIS = rotaDe('perfis');
export const ROTA_LICENCAS = rotaDe('licencas');
export const ROTA_AUDITORIA = rotaDe('auditoria');
export const ROTA_AMBIENTE_FISCAL = rotaDe('ambiente');

const USUARIOS = '/v1/core/usuarios';
const GERIR = 'core.usuario.gerir' as const;
const OPCOES_PERFIL = opcoesDePerfil(PERFIS);

// ---- Usuários ----

/** Mensagem em português para o campo que a regra do contrato recusou (o texto do Zod é em inglês). */
const MENSAGEM: Readonly<Record<string, string>> = {
  nome: 'Informe o nome, de 2 a 80 caracteres.',
  email: 'Informe um e-mail válido.',
  perfil: 'Escolha o perfil.',
  filial_ids: 'Escolha a filial.',
};

function errosDe(erro: { issues: readonly { path: readonly (string | number)[] }[] }): ErrosFormulario {
  const saida: Record<string, string> = {};
  for (const i of erro.issues) {
    const campo = String(i.path[0] ?? 'nome');
    saida[campo === 'filial_ids' ? 'filial_id' : campo] = MENSAGEM[campo] ?? 'Confira este campo.';
  }
  return saida;
}

const corpoDoNovo = (v: ValoresFormulario) => ({ nome: v.nome ?? '', email: (v.email ?? '').trim(), perfil: v.perfil ?? '', filial_ids: v.filial_id ? [v.filial_id] : [] });

/** Novo usuário (RF-CORE-02): a API cria com senha provisória, que aparece uma única vez (RN-CORE-10). */
export const NOVO_USUARIO: TelaFormulario = {
  tipo: 'formulario',
  campos: [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
    { nome: 'email', rotulo: 'E-mail', tipo: 'texto', obrigatorio: true },
    { nome: 'perfil', rotulo: 'Perfil', tipo: 'selecao', obrigatorio: true, opcoes: OPCOES_PERFIL },
    { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais', obrigatorio: true },
  ],
  validar: (v) => {
    const r = UsuarioCriar.safeParse(corpoDoNovo(v));
    return r.success ? {} : errosDe(r.error);
  },
  montar: (v) => {
    const r = UsuarioCriar.safeParse(corpoDoNovo(v));
    if (!r.success) throw new Error('formulário inválido');
    return r.data;
  },
  api: USUARIOS,
  segredo: 'senha_provisoria',
  avisoSegredo: AVISO_SENHA_PROVISORIA,
  depois: () => ROTA_USUARIOS,
  voltar: ROTA_USUARIOS,
  enviar: 'Criar usuário',
  novaChave,
};

const POR_ID = `${USUARIOS}/:id`;
const ESCRITAS_USUARIO = [
  { metodo: 'PATCH', caminho: POR_ID },
  { metodo: 'POST', caminho: `${POR_ID}/inativar` },
  { metodo: 'POST', caminho: `${POR_ID}/reativar` },
  { metodo: 'POST', caminho: `${POR_ID}/excluir` },
  { metodo: 'POST', caminho: `${POR_ID}/redefinir-senha`, segredo: 'senha_provisoria' },
] as const;

/** Ações da linha do usuário (só quem gerencia usuários; a API revalida). Inativo ganha "Reativar" no lugar de inativar e redefinir. */
export function acoesDoUsuario(l: Linha, perfil: Perfil): readonly AcaoVista[] {
  if (!pode(perfil, GERIR)) return [];
  const u = l as unknown as Usuario;
  const caminho = `${USUARIOS}/${u.id}`;
  const dados = { nome: u.nome, perfil: u.perfil, updated_at: u.updated_at };
  const editar: AcaoVista = {
    id: 'editar', rotulo: 'Editar', metodo: 'PATCH', caminho, entrada: 'campos', tituloDialogo: 'Editar usuário', rotuloConfirmar: 'Salvar', textoCarregando: 'Salvando…', dados,
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', valor: u.nome },
      { nome: 'perfil', rotulo: 'Perfil', tipo: 'selecao', valor: u.perfil, opcoes: OPCOES_PERFIL },
    ],
  };
  // RN-CORE-17: Inativar é reversível (Reativar) e Excluir é definitivo (some da lista e libera o e-mail); Excluir fica por último, em vermelho.
  const excluir: AcaoVista = {
    id: 'excluir', rotulo: 'Excluir', metodo: 'POST', caminho: `${caminho}/excluir`, entrada: 'confirmar', destrutivo: true, tituloDialogo: 'Excluir este usuário?',
    aviso: AVISO_USUARIO.excluir, rotuloConfirmar: 'Excluir', textoCarregando: 'Excluindo…', dados,
  };
  if (!u.ativo) {
    return [{ id: 'reativar', rotulo: 'Reativar', metodo: 'POST', caminho: `${caminho}/reativar`, entrada: 'confirmar', tituloDialogo: 'Reativar este usuário?', aviso: AVISO_USUARIO.reativar, rotuloConfirmar: 'Reativar', textoCarregando: 'Reativando…', dados }, editar, excluir];
  }
  return [
    editar,
    {
      id: 'redefinir-senha', rotulo: 'Redefinir senha', metodo: 'POST', caminho: `${caminho}/redefinir-senha`, entrada: 'confirmar', tituloDialogo: 'Redefinir a senha?',
      aviso: 'A senha atual deixa de valer.', rotuloConfirmar: 'Redefinir senha', textoCarregando: 'Redefinindo…', avisoSegredo: AVISO_SENHA_PROVISORIA, dados,
    },
    {
      id: 'inativar', rotulo: 'Inativar', metodo: 'POST', caminho: `${caminho}/inativar`, entrada: 'confirmar', tituloDialogo: 'Inativar este usuário?',
      aviso: AVISO_USUARIO.inativar, rotuloConfirmar: 'Inativar', textoCarregando: 'Inativando…', dados,
    },
    excluir,
  ];
}

/** Validação do diálogo pela regra do contrato `UsuarioEditar`; só os campos que mudaram vão no PATCH (com o token `updated_at`). */
export function validarAcaoUsuario(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  if (a.id === 'editar') {
    const novo = { nome: (e.campos?.nome ?? '').trim(), perfil: e.campos?.perfil ?? '' };
    const mudou = { ...(novo.nome !== a.dados?.nome ? { nome: novo.nome } : {}), ...(novo.perfil !== a.dados?.perfil ? { perfil: novo.perfil } : {}) };
    if (Object.keys(mudou).length === 0) return { ok: false, erro: 'Nada foi alterado.' };
    const r = UsuarioEditar.safeParse({ ...mudou, updated_at: a.dados?.updated_at });
    return r.success ? { ok: true, corpo: r.data } : { ok: false, erro: Object.values(errosDe(r.error))[0] ?? ERRO_CAMPOS };
  }
  return { ok: true };
}

const FILTROS_USUARIOS = [
  { chave: 'inativos', rotulo: 'Situação', tipo: 'selecao', vazio: 'Só ativos', opcoes: [{ valor: 'true', rotulo: 'Ativos e inativos' }] },
] as const;


export const LISTA_USUARIOS: TelaLista = {
  tipo: 'lista',
  pagina: paginaUsuarios as unknown as TelaLista['pagina'],
  rotuloBusca: 'Nome ou e-mail',
  filtrosTela: FILTROS_USUARIOS,
  colunas: () => colunasDoModulo(COLUNAS_USUARIOS),
  linha: (item, fuso) => linhaUsuario(item as unknown as Usuario, fuso),
  selos: (item) => {
    const u = item as unknown as Usuario;
    return { situacao: [{ texto: ROTULOS_SITUACAO_USUARIO[u.situacao], tom: tomAmarelo(TOM_SITUACAO_USUARIO[u.situacao]) }] };
  },
  novo: { rota: ROTA_USUARIO_NOVO, rotulo: 'Novo usuário', criar: GERIR },
  acaoDaLinha: {
    // Um botão só por linha: o "Ações ▾" leva todas as ações, o Editar entre elas (T-0135, regra 12).
    acao: () => null,
    maisAcoes: (l, perfil) => acoesDoUsuario(l, perfil),
    validarAcao: validarAcaoUsuario,
    escritas: ESCRITAS_USUARIO,
    novaChave,
  },
};

// ---- Licenças e auditoria (só leitura, com CSV) ----

export const LISTA_LICENCAS: TelaLista = {
  tipo: 'lista',
  pagina: paginaLicencas as unknown as TelaLista['pagina'],
  filtrosTela: [],
  colunas: () => colunasDoModulo(paginaLicencas.colunas, { ativo: 'status' }),
  linha: (item, fuso) => linhaLicenca(item as unknown as Licenca, fuso),
  // Ativa, Inativa ou Vencida (RN-CORE-02), com o vocabulário do core; "Vencida" é o único em âmbar.
  selos: (item) => {
    const s = situacaoDaLicenca(item as unknown as Licenca, new Date());
    return { ativo: [{ texto: ROTULO_SITUACAO_LICENCA[s], tom: tomAmarelo(tomDaLicenca(s)) }] };
  },
};

/** Entidades que o core audita, em português (mapa só do core; entidade de outro módulo aparece como veio). */
const ROTULO_ENTIDADE: Readonly<Record<string, string>> = {
  usuario: 'Usuário',
  empresa: 'Empresa',
  certificado: 'Certificado A1',
  ambiente_fiscal: 'Ambiente fiscal',
  exportacao: 'Exportação',
};

/** `de` e `ate` chegam à API como datetime ISO completo (início e fim do dia no fuso da empresa); a tela guarda só o dia na URL. */
export const LISTA_AUDITORIA: TelaLista = {
  tipo: 'lista',
  pagina: paginaAuditoria as unknown as TelaLista['pagina'],
  filtrosTela: [
    { chave: 'entidade', rotulo: 'Entidade', tipo: 'selecao', vazio: 'Todas', opcoes: Object.entries(ROTULO_ENTIDADE).map(([valor, rotulo]) => ({ valor, rotulo })) },
    { chave: 'usuario_id', rotulo: 'Usuário', tipo: 'texto' },
    { chave: 'de', rotulo: 'De', tipo: 'data', instante: 'inicio' },
    { chave: 'ate', rotulo: 'Até', tipo: 'data', instante: 'fim' },
  ],
  colunas: () => colunasDoModulo(paginaAuditoria.colunas, { ocorrido_em: 'data' }),
  linha: (item, fuso) => {
    const l = linhaAuditoria(item as unknown as AuditoriaItemLista, fuso);
    return { ...l, entidade: ROTULO_ENTIDADE[l.entidade ?? ''] ?? l.entidade ?? '' };
  },
};

export const TELAS_CORE: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_USUARIOS]: LISTA_USUARIOS,
  [ROTA_USUARIO_NOVO]: NOVO_USUARIO,
  [ROTA_LICENCAS]: LISTA_LICENCAS,
  [ROTA_AUDITORIA]: LISTA_AUDITORIA,
};

// ---- Perfis e permissões (quadro só de leitura) ----

export interface MatrizDePerfis {
  perfis: readonly { perfil: Perfil; rotulo: string }[];
  grupos: readonly { modulo: string; rotulo: string; linhas: readonly { acao: string; por_perfil: readonly boolean[] }[] }[];
}

/** Permissões por perfil, agrupadas por módulo (prefixo da ação) e em ordem alfabética: uma linha por ação, uma coluna por perfil. */
export function matrizDePerfis(itens: readonly PerfilComAcoes[]): MatrizDePerfis {
  const perfis = itens.map((i) => ({ perfil: i.perfil, rotulo: ROTULOS_PERFIL[i.perfil] ?? i.perfil }));
  const acoes = [...new Set(itens.flatMap((i) => i.acoes))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const porModulo = new Map<string, { acao: string; por_perfil: boolean[] }[]>();
  for (const acao of acoes) {
    const modulo = acao.split('.')[0] ?? acao;
    const linhas = porModulo.get(modulo) ?? [];
    linhas.push({ acao, por_perfil: itens.map((i) => i.acoes.includes(acao)) });
    porModulo.set(modulo, linhas);
  }
  return { perfis, grupos: [...porModulo].map(([modulo, linhas]) => ({ modulo, rotulo: ROTULO_MODULO[modulo] ?? modulo, linhas })) };
}

// ---- Ambiente fiscal (só exibição: a troca para produção NÃO tem botão no BKO, RN-CORE-08) ----

export { quadroEmpresaFiscal };
