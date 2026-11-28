import { MENSAGEM_ULTIMO_ADMIN, type FilialConfig, type UsuarioConfig } from '@macuxierp/core/contracts';
import { CODIGO_EMAIL_EM_USO, MENSAGEM_EMAIL_EM_USO } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ErroPlataforma, SENHA_JA_EXIBIDA, USUARIO_CONFLITO, USUARIO_NAO_ENCONTRADO, mensagemDoErro } from './erros';
import { MENSAGEM_ESCOLHA_FILIAL, alternarFilial, montarEnvioUsuario, etiquetaUltimoAdmin, filiaisIniciais, filtrarUsuarios, mesmasFiliais, itensDoMenuUsuario, seloDoUsuario, textoUltimoAcesso } from './usuarios';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const u = (extra: Partial<UsuarioConfig> = {}): UsuarioConfig => ({
  id: ID, nome: 'Ana Exemplo', email_mascarado: 'an****@exemplo.com', perfil: 'administrador', filial_ids: [], situacao: 'ativo', ultimo_acesso_em: '2026-11-27T20:42:00.000Z',
  deve_trocar_senha: false, ultimo_admin_ativo: false, acoes: ['editar', 'redefinir_senha', 'inativar', 'excluir'], ...extra,
});

describe('Usuários da Config: a tela usa acoes[] e ultimo_admin_ativo, sem recalcular regra (RN-CORE-01, RN-CORE-17)', () => {
  it('o menu é acoes[] na ordem da API, com rótulos do contrato; só o Excluir é perigo', () => {
    expect(itensDoMenuUsuario(u()).map((i) => [i.chave, i.rotulo, i.perigo])).toEqual([
      ['editar', 'Editar', false], ['redefinir_senha', 'Redefinir senha', false], ['inativar', 'Inativar', false], ['excluir', 'Excluir', true],
    ]);
    expect(itensDoMenuUsuario(u({ situacao: 'inativo', acoes: ['editar', 'reativar', 'excluir'] })).map((i) => i.rotulo)).toEqual(['Editar', 'Reativar', 'Excluir']);
  });
  it('último administrador: a API não manda Excluir e o menu não o inventa; a etiqueta sai do campo', () => {
    const ultimo = u({ ultimo_admin_ativo: true, acoes: ['editar', 'redefinir_senha'] });
    expect(itensDoMenuUsuario(ultimo).map((i) => i.chave)).not.toContain('excluir');
    expect(itensDoMenuUsuario(ultimo).map((i) => i.chave)).not.toContain('inativar');
    expect(etiquetaUltimoAdmin(ultimo)).toBe('último administrador');
    expect(etiquetaUltimoAdmin(u())).toBeNull();
    expect(itensDoMenuUsuario(u({ acoes: [] }))).toEqual([]);
  });
  it('selo: rótulo e tom do contrato', () => {
    expect(seloDoUsuario(u())).toEqual({ texto: 'Ativo', tom: 'sucesso' });
    expect(seloDoUsuario(u({ situacao: 'bloqueado' }))).toEqual({ texto: 'Bloqueado', tom: 'aviso' });
    expect(seloDoUsuario(u({ situacao: 'inativo' }))).toEqual({ texto: 'Inativo', tom: 'neutro' });
  });
  it('último acesso no fuso da empresa; sem acesso e com troca pendente, "Ainda não entrou"', () => {
    expect(textoUltimoAcesso(u(), 'America/Manaus')).toContain('16:42');
    expect(textoUltimoAcesso(u({ ultimo_acesso_em: null, deve_trocar_senha: true }), 'America/Manaus')).toBe('Ainda não entrou');
    expect(textoUltimoAcesso(u({ ultimo_acesso_em: null }), 'America/Manaus')).toBe('—');
  });
  it('busca por nome ou e-mail mascarado, sem acento nem caixa', () => {
    const lista = [u(), u({ id: '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d', nome: 'José Ação', email_mascarado: 'jo****@x.com' })];
    expect(filtrarUsuarios(lista, 'jose').map((x) => x.nome)).toEqual(['José Ação']);
    expect(filtrarUsuarios(lista, 'AN****').map((x) => x.nome)).toEqual(['Ana Exemplo']);
    expect(filtrarUsuarios(lista, '  ')).toHaveLength(2);
  });
});

describe('Usuários da Config: mensagens de erro (ctx "usuario")', () => {
  const erro = (status: number, codigo: string, mensagem = '', campos: Record<string, string> = {}) => mensagemDoErro(new ErroPlataforma(status, codigo, campos, mensagem), 'usuario');
  it('422 RN-CORE-01 → a mensagem do contrato, qualquer que seja o texto da API', () => {
    expect(erro(422, 'RN-CORE-01', 'texto qualquer')).toMatchObject({ texto: MENSAGEM_ULTIMO_ADMIN, chaveNova: true });
  });
  it('422 RN-CORE-17 (dado recusado) → a mensagem curta da API; sem ela, texto genérico', () => {
    expect(erro(422, 'RN-CORE-17', 'Dado recusado pelo cadastro')).toMatchObject({ texto: 'Dado recusado pelo cadastro' });
    expect(erro(422, 'RN-CORE-17').texto).toBe('Confira os dados e tente de novo.');
  });
  it('409 email_em_uso (ADR 0021) → o texto do SDK no campo e-mail; outro 409 (chave repetida) → senha já exibida, com chave nova', () => {
    expect(mensagemDoErro(new ErroPlataforma(409, 'CONFLITO', {}, 'outro texto', { codigo: CODIGO_EMAIL_EM_USO }), 'usuario')).toMatchObject({ texto: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO } });
    // "a senha já foi exibida" só no Redefinir senha; no Criar e nas outras ações, o conflito genérico
    expect(mensagemDoErro(new ErroPlataforma(409, 'CONFLITO', {}, 'Requisição já concluída'), 'usuario_senha')).toMatchObject({ texto: SENHA_JA_EXIBIDA, chaveNova: true });
    expect(erro(409, 'CONFLITO', 'Requisição já concluída')).toMatchObject({ texto: USUARIO_CONFLITO, chaveNova: true });
  });
  it('404 → usuário fora da empresa; 400 → campos', () => {
    expect(erro(404, 'NAO_ENCONTRADO').texto).toBe(USUARIO_NAO_ENCONTRADO);
    expect(erro(400, 'VALIDACAO', '', { nome: 'curto' })).toMatchObject({ campos: { nome: 'curto' } });
  });
});

describe('Filiais do usuário (T-0130)', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const filiais: FilialConfig[] = [{ id: A, nome: 'Matriz', padrao: true }, { id: B, nome: 'Filial Norte', padrao: false }];
  it('usuário novo começa com a filial padrão marcada; sem padrão, nada marcado', () => {
    expect(filiaisIniciais(filiais, null)).toEqual([A]);
    expect(filiaisIniciais([{ id: B, nome: 'Filial Norte', padrao: false }], null)).toEqual([]);
  });
  it('edição parte das filiais do usuário, sem ids que a empresa não lista', () => {
    expect(filiaisIniciais(filiais, [B, '33333333-3333-4333-8333-333333333333'])).toEqual([B]);
  });
  it('alternar marca e desmarca, na ordem da lista', () => {
    expect(alternarFilial(filiais, [A], B, true)).toEqual([A, B]);
    expect(alternarFilial(filiais, [B], A, true)).toEqual([A, B]);
    expect(alternarFilial(filiais, [A, B], A, false)).toEqual([B]);
  });
  it('mesmasFiliais ignora a ordem', () => {
    expect(mesmasFiliais([A, B], [B, A])).toBe(true);
    expect(mesmasFiliais([A], [A, B])).toBe(false);
  });
});

describe('Ao menos uma filial (T-0130)', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const filiais: FilialConfig[] = [{ id: A, nome: 'Matriz', padrao: true }, { id: B, nome: 'Filial Norte', padrao: false }];
  const dados = { nome: 'Diego Exemplo', email: 'diego@exemplo.com', perfil: 'leitura' };
  const edicao = { nome: 'Diego Exemplo', perfil: 'leitura' as const, filial_ids: [B] };
  it('criar sem nenhuma filial marcada: recusa com o texto exato e não envia', () => {
    expect(MENSAGEM_ESCOLHA_FILIAL).toBe('Escolha ao menos uma filial.');
    expect(montarEnvioUsuario({ ...dados, marcadas: [] }, filiais, null)).toEqual({ tipo: 'recusado', campos: { filial_ids: 'Escolha ao menos uma filial.' } });
  });
  it('criar com uma filial: envia a escolha', () => {
    expect(montarEnvioUsuario({ ...dados, marcadas: [A] }, filiais, null)).toEqual({ tipo: 'criar', corpo: { ...dados, filial_ids: [A] } });
  });
  it('editar desmarcando todas: recusa com o texto exato e não envia', () => {
    expect(montarEnvioUsuario({ ...dados, marcadas: [] }, filiais, edicao)).toEqual({ tipo: 'recusado', campos: { filial_ids: 'Escolha ao menos uma filial.' } });
  });
  it('editar trocando de filial: envia só o que mudou', () => {
    expect(montarEnvioUsuario({ ...dados, marcadas: [A] }, filiais, edicao)).toEqual({ tipo: 'editar', corpo: { filial_ids: [A] } });
  });
  it('sem lista de filiais (falha ou empresa sem filial) a regra não barra', () => {
    expect(montarEnvioUsuario({ ...dados, marcadas: [] }, null, null).tipo).toBe('criar');
    expect(montarEnvioUsuario({ ...dados, marcadas: [] }, [], null).tipo).toBe('criar');
  });
});
