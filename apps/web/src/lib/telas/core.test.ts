import { describe, expect, it } from 'vitest';
import { PerfilComAcoes } from '@macuxierp/core/contracts';
import { ROTULO_MODULO } from '@macuxierp/core/web';
import type { Perfil } from '@macuxierp/platform-sdk';
import { PERFIS, PERMISSOES } from '@macuxierp/platform-sdk';
import { montarMenu, resolverPagina } from '../menu';
import { MANIFESTOS } from '../manifestos';
import { PAGINAS_REGISTRADAS, paginasDoMenu } from '../paginas';
import { escritaDeclarada, segredoDeclarado, telaDaRota, telaFormulario } from '../telas';
import { resultadoDaResposta } from '../descritor/escrita';
import { filtrosParaApi, instanteDoDia } from '../descritor/lista';
import type { AcaoVista, TelaLista } from '../descritor/tipos';
import {
  LISTA_AUDITORIA, LISTA_LICENCAS, LISTA_USUARIOS, NOVO_USUARIO, ROTA_AUDITORIA, ROTA_LICENCAS, ROTA_PERFIS, ROTA_USUARIOS, ROTA_USUARIO_NOVO, acoesDoUsuario, matrizDePerfis, validarAcaoUsuario,
} from './core';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const FILIAL = '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d';
const usuario = (extra: Record<string, unknown> = {}) => ({
  id: ID, nome: 'Maria Souza', email: 'maria@exemplo.com.br', perfil: 'faturista', filial_ids: [FILIAL], ativo: true, situacao: 'ativo', external_id: null, ultimo_acesso_em: '2026-11-24T14:05:00.000Z', updated_at: '2026-11-24T12:00:00.000Z', ...extra,
});
const ids = (as: readonly AcaoVista[]) => as.map((a) => a.id);
const MODULOS = [{ id: 'core' as const, menus: ['Empresa', 'Usuários e perfis'] }];

describe('registro das telas do core (T-0087)', () => {
  it('usuários, licenças e auditoria saem do "Disponível em breve": têm descritor de lista; usuário novo é formulário', () => {
    expect(telaDaRota(ROTA_USUARIOS)).toBe(LISTA_USUARIOS);
    expect(telaDaRota(ROTA_LICENCAS)).toBe(LISTA_LICENCAS);
    expect(telaDaRota(ROTA_AUDITORIA)).toBe(LISTA_AUDITORIA);
    expect(telaFormulario(ROTA_USUARIO_NOVO)).toBe(NOVO_USUARIO);
  });
  it('o formulário novo é página registrada, fora do menu; perfis é página do módulo com componente próprio', () => {
    const novo = PAGINAS_REGISTRADAS.find((p) => p.rota === ROTA_USUARIO_NOVO);
    expect(novo).toMatchObject({ modulo: 'core', menu: 'Usuários e perfis', ocultaNoMenu: true, ver: 'core.usuario.gerir' });
    expect(paginasDoMenu('core', 'Usuários e perfis', 'administrador').map((p) => p.rota)).toEqual([ROTA_USUARIOS, ROTA_PERFIS, ROTA_LICENCAS, ROTA_AUDITORIA]);
  });
  it('menu oculto e rota 404 para quem não é administrador (a API ainda responde 403)', () => {
    for (const perfil of PERFIS.filter((p): p is Perfil => p !== 'administrador')) {
      const menu = montarMenu(MODULOS, MANIFESTOS, perfil);
      const itens = menu.find((g) => g.modulo === 'core')?.itens.map((i) => i.rotulo) ?? [];
      expect(itens, perfil).not.toContain('Usuários e perfis');
      for (const rota of [ROTA_USUARIOS, ROTA_USUARIO_NOVO, ROTA_PERFIS, ROTA_LICENCAS, ROTA_AUDITORIA]) expect(resolverPagina(menu, rota, perfil), `${perfil} ${rota}`).toBeUndefined();
    }
    const adm = montarMenu(MODULOS, MANIFESTOS, 'administrador');
    expect(adm.find((g) => g.modulo === 'core')?.itens.map((i) => i.rotulo)).toContain('Usuários e perfis');
    expect(resolverPagina(adm, ROTA_USUARIO_NOVO, 'administrador')?.pagina?.rota).toBe(ROTA_USUARIO_NOVO);
  });
  it('só o administrador recebe ações e botão "Novo usuário"', () => {
    for (const perfil of PERFIS.filter((p): p is Perfil => p !== 'administrador')) expect(acoesDoUsuario(usuario(), perfil), perfil).toEqual([]);
    expect(LISTA_USUARIOS.novo).toMatchObject({ rota: ROTA_USUARIO_NOVO, criar: 'core.usuario.gerir' });
  });
});

describe('usuários: um botão por linha e filtro da auditoria (T-0135)', () => {
  it('sem botão solto: todas as ações da linha, o Editar entre elas, ficam no "Ações ▾"', () => {
    const a = LISTA_USUARIOS.acaoDaLinha!;
    expect(a.acao(usuario() as never, 'administrador')).toBeNull();
    expect(a.maisAcoes?.(usuario() as never, 'administrador').map((x) => x.id)).toEqual(['editar', 'redefinir-senha', 'inativar', 'excluir']);
  });
  it('o filtro da auditoria se chama "Usuário"', () => {
    expect(LISTA_AUDITORIA.filtrosTela.find((f) => f.chave === 'usuario_id')?.rotulo).toBe('Usuário');
  });
});

describe('usuários: colunas, filtros e CSV', () => {
  it('colunas e linha pelo módulo, último acesso no fuso da empresa e Ativo em selo', () => {
    const l = LISTA_USUARIOS as TelaLista;
    expect(l.colunas('administrador', 'America/Manaus').map((c) => c.rotulo)).toEqual(['Nome', 'E-mail', 'Perfil', 'Situação', 'Último acesso']);
    expect(l.linha(usuario(), 'America/Manaus')).toMatchObject({ nome: 'Maria Souza', perfil: 'Faturista', ultimo_acesso_em: '24/11/2026 10:05' });
    expect(l.selos?.(usuario(), 'America/Manaus').situacao?.[0]).toEqual({ texto: 'Ativo', tom: 'ok' });
    expect(l.selos?.(usuario({ ativo: false, situacao: 'inativo' }), 'America/Manaus').situacao?.[0]).toEqual({ texto: 'Inativo', tom: 'neutro' });
    expect(l.selos?.(usuario({ situacao: 'bloqueado' }), 'America/Manaus').situacao?.[0]).toEqual({ texto: 'Bloqueado', tom: 'aviso' });
    expect(l.colunas('administrador', 'America/Manaus').find((c) => c.rotulo === 'Situação')).toMatchObject({ id: 'situacao', tipo: 'status' });
  });
  it('a lista aceita busca e o filtro de inativos (só ativos por padrão); as três listas têm CSV', () => {
    expect(LISTA_USUARIOS.pagina.busca).toBe(true);
    expect(LISTA_USUARIOS.filtrosTela[0]).toMatchObject({ chave: 'inativos', vazio: 'Só ativos' });
    for (const l of [LISTA_USUARIOS, LISTA_LICENCAS, LISTA_AUDITORIA]) expect(l.pagina.csv && l.pagina.csv.arquivo, l.pagina.api).toMatch(/\.csv$/);
  });
});

describe('usuários: ações por linha (RN-CORE-10)', () => {
  it('ativo: editar, redefinir senha, inativar e excluir (no fim, em perigo), cada um na sua rota; a senha provisória é segredo de uso único', () => {
    const as = acoesDoUsuario(usuario(), 'administrador');
    expect(ids(as)).toEqual(['editar', 'redefinir-senha', 'inativar', 'excluir']);
    expect(as.map((a) => [a.metodo, a.caminho])).toEqual([
      ['PATCH', `/v1/core/usuarios/${ID}`], ['POST', `/v1/core/usuarios/${ID}/redefinir-senha`], ['POST', `/v1/core/usuarios/${ID}/inativar`], ['POST', `/v1/core/usuarios/${ID}/excluir`],
    ]);
    expect(as.map((a) => Boolean(a.destrutivo))).toEqual([false, false, false, true]);
    for (const a of as) expect(escritaDeclarada(a.metodo, a.caminho), a.id).toBe(true);
    expect(segredoDeclarado('POST', `/v1/core/usuarios/${ID}/redefinir-senha`)).toBe('senha_provisoria');
    expect(segredoDeclarado('PATCH', `/v1/core/usuarios/${ID}`)).toBeUndefined();
    expect(as[1]?.avisoSegredo).toBe('Anote esta senha agora: ela aparece uma única vez. A pessoa troca no primeiro acesso.');
  });
  it('inativo: reativar (POST /reativar), editar e excluir; sem inativar nem redefinir; o DELETE antigo não é mais usado', () => {
    const as = acoesDoUsuario(usuario({ ativo: false, situacao: 'inativo' }), 'administrador');
    expect(ids(as)).toEqual(['reativar', 'editar', 'excluir']);
    expect(as[0]).toMatchObject({ metodo: 'POST', caminho: `/v1/core/usuarios/${ID}/reativar` });
    expect(validarAcaoUsuario(as[0] as AcaoVista, { texto: '' })).toEqual({ ok: true });
    expect(escritaDeclarada('DELETE', `/v1/core/usuarios/${ID}`)).toBe(false);
  });
  it('editar: manda só o que mudou e o token updated_at; sem mudança recusa; nome curto recusa em português', () => {
    const editar = acoesDoUsuario(usuario(), 'administrador')[0] as AcaoVista;
    expect(editar.campos?.map((c) => [c.nome, c.valor])).toEqual([['nome', 'Maria Souza'], ['perfil', 'faturista']]);
    expect(editar.campos?.[1]?.opcoes?.map((o) => o.rotulo)).toContain('Gerente');
    expect(validarAcaoUsuario(editar, { texto: '', campos: { nome: 'Maria Souza', perfil: 'faturista' } })).toEqual({ ok: false, erro: 'Nada foi alterado.' });
    expect(validarAcaoUsuario(editar, { texto: '', campos: { nome: 'Maria Souza', perfil: 'gerente' } })).toEqual({ ok: true, corpo: { perfil: 'gerente', updated_at: '2026-11-24T12:00:00.000Z' } });
    expect(validarAcaoUsuario(editar, { texto: '', campos: { nome: '  Maria S.  ', perfil: 'faturista' } })).toEqual({ ok: true, corpo: { nome: 'Maria S.', updated_at: '2026-11-24T12:00:00.000Z' } });
    expect(validarAcaoUsuario(editar, { texto: '', campos: { nome: 'M', perfil: 'faturista' } })).toEqual({ ok: false, erro: 'Informe o nome, de 2 a 80 caracteres.' });
  });
  it('inativar, excluir e redefinir senha confirmam sem corpo; só o excluir é destrutivo', () => {
    const [, redefinir, inativar, excluir] = acoesDoUsuario(usuario(), 'administrador') as [AcaoVista, AcaoVista, AcaoVista, AcaoVista];
    expect(validarAcaoUsuario(redefinir, { texto: '' })).toEqual({ ok: true });
    expect(validarAcaoUsuario(inativar, { texto: '' })).toEqual({ ok: true });
    expect(validarAcaoUsuario(excluir, { texto: '' })).toEqual({ ok: true });
    expect([Boolean(inativar.destrutivo), excluir.destrutivo]).toEqual([false, true]);
  });
  it('só as escritas declaradas passam: nada de PUT nem de outras rotas do core', () => {
    expect(escritaDeclarada('PUT', `/v1/core/usuarios/${ID}`)).toBe(false);
    expect(escritaDeclarada('PUT', `/v1/core/ambientes-fiscais/${FILIAL}`)).toBe(false);
    expect(escritaDeclarada('POST', '/v1/core/exportacoes')).toBe(false);
  });
});

describe('usuário novo (RF-CORE-02, RN-CORE-10)', () => {
  const ok = { nome: 'João Lima', email: 'joao@exemplo.com.br', perfil: 'gerente', filial_id: FILIAL };
  it('valida em português, por campo, e monta o corpo do contrato com a filial escolhida', () => {
    expect(NOVO_USUARIO.validar(ok, [])).toEqual({});
    expect(NOVO_USUARIO.validar({}, [])).toEqual({ nome: 'Informe o nome, de 2 a 80 caracteres.', email: 'Informe um e-mail válido.', perfil: 'Escolha o perfil.', filial_id: 'Escolha a filial.' });
    expect(NOVO_USUARIO.validar({ ...ok, email: 'sem-arroba' }, [])).toEqual({ email: 'Informe um e-mail válido.' });
    expect(NOVO_USUARIO.montar(ok, [])).toEqual({ nome: 'João Lima', email: 'joao@exemplo.com.br', perfil: 'gerente', filial_ids: [FILIAL] });
    expect(() => NOVO_USUARIO.montar({}, [])).toThrow();
  });
  it('POST em /v1/core/usuarios com a senha provisória como segredo de uso único e o aviso do módulo', () => {
    expect(NOVO_USUARIO.api).toBe('/v1/core/usuarios');
    expect(escritaDeclarada('POST', '/v1/core/usuarios')).toBe(true);
    expect(segredoDeclarado('POST', '/v1/core/usuarios')).toBe('senha_provisoria');
    expect(NOVO_USUARIO.avisoSegredo).toContain('aparece uma única vez');
    expect(NOVO_USUARIO.campos.find((c) => c.nome === 'filial_id')).toMatchObject({ tipo: 'cadastro', fonte: '/v1/cadastros/filiais' });
    expect(new Set([NOVO_USUARIO.novaChave(), NOVO_USUARIO.novaChave()]).size).toBe(2);
  });
  it('a resposta da escrita leva a senha só quando a escrita a declara; erro nunca a leva', () => {
    expect(resultadoDaResposta(201, true, { id: ID, senha_provisoria: 'Abc-1234' }, 'senha_provisoria')).toEqual({ ok: true, mensagem: 'Feito.', id: ID, segredo: 'Abc-1234' });
    expect(resultadoDaResposta(200, true, { id: ID, senha_provisoria: 'Abc-1234' })).toEqual({ ok: true, mensagem: 'Feito.', id: ID });
    expect(resultadoDaResposta(409, false, { senha_provisoria: 'x', mensagem: 'Já existe usuário com este e-mail' }, 'senha_provisoria').segredo).toBeUndefined();
  });
});

describe('auditoria: filtros de data viram datetime ISO completo', () => {
  it('início e fim do dia no fuso da empresa (Manaus = UTC−4)', () => {
    expect(instanteDoDia('2026-11-24', 'America/Manaus', 'inicio')).toBe('2026-11-24T04:00:00.000Z');
    expect(instanteDoDia('2026-11-24', 'America/Manaus', 'fim')).toBe('2026-11-25T03:59:59.999Z');
    expect(instanteDoDia('2026-12-31', 'America/Manaus', 'fim')).toBe('2027-01-01T03:59:59.999Z');
    expect(instanteDoDia('2026-11-24', 'UTC', 'inicio')).toBe('2026-11-24T00:00:00.000Z');
  });
  it('acompanha o horário de verão do fuso (Nova York em julho = UTC−4, em janeiro = UTC−5)', () => {
    expect(instanteDoDia('2026-07-01', 'America/New_York', 'inicio')).toBe('2026-07-01T04:00:00.000Z');
    expect(instanteDoDia('2026-01-15', 'America/New_York', 'inicio')).toBe('2026-01-15T05:00:00.000Z');
  });
  it('data inválida volta como veio (a API responde 400 e a lista recomeça)', () => {
    expect(instanteDoDia('2026-02-30', 'America/Manaus', 'inicio')).toBe('2026-02-30');
    expect(instanteDoDia('24/11/2026', 'America/Manaus', 'fim')).toBe('24/11/2026');
  });
  it('a auditoria converte só de/ate; os outros filtros e a paginação passam como vieram', () => {
    expect(LISTA_AUDITORIA.filtrosTela.filter((f) => f.instante).map((f) => [f.chave, f.instante])).toEqual([['de', 'inicio'], ['ate', 'fim']]);
    expect(filtrosParaApi(LISTA_AUDITORIA.filtrosTela, { de: '2026-11-01', ate: '2026-11-24', entidade: 'usuario', limite: '50' }, 'America/Manaus')).toEqual({
      de: '2026-11-01T04:00:00.000Z', ate: '2026-11-25T03:59:59.999Z', entidade: 'usuario', limite: '50',
    });
    expect(filtrosParaApi(LISTA_AUDITORIA.filtrosTela, { entidade: 'usuario' }, 'America/Manaus')).toEqual({ entidade: 'usuario' });
    // O resultado serve ao contrato da página (datetime ISO completo).
    const f = filtrosParaApi(LISTA_AUDITORIA.filtrosTela, { de: '2026-11-01', ate: '2026-11-24' }, 'America/Manaus');
    expect(LISTA_AUDITORIA.pagina.consulta.safeParse({ ...f, limite: 50 }).success).toBe(true);
    expect(LISTA_AUDITORIA.pagina.consulta.safeParse({ de: '2026-11-01' }).success).toBe(false);
  });
  it('a linha da auditoria mostra a ação em português e o horário no fuso da empresa', () => {
    const l = LISTA_AUDITORIA.linha({ id: ID, usuario_id: null, acao: 'core.usuario.senha_redefinida', entidade: 'usuario', entidade_id: ID, ocorrido_em: '2026-11-24T14:05:00.000Z' }, 'America/Manaus');
    expect(l).toMatchObject({ ocorrido_em: '24/11/2026 10:05', usuario_id: 'Sistema', acao: 'Senha redefinida' });
  });
});

describe('perfis e permissões (RF-CORE-02)', () => {
  const itens = PerfilComAcoes.array().parse(PERFIS.map((perfil) => ({ perfil, acoes: Object.entries(PERMISSOES).filter(([, ps]) => (ps as readonly string[]).includes(perfil)).map(([a]) => a) })));
  it('uma coluna por perfil (rótulo em português) e uma linha por ação, agrupadas por módulo', () => {
    const m = matrizDePerfis(itens);
    expect(m.perfis.map((p) => p.rotulo)).toContain('Administrador');
    expect(m.grupos[0]?.modulo).toBe('cadastros'); // ordem alfabética
    expect(m.grupos.find((g) => g.modulo === 'core')?.rotulo).toBe(ROTULO_MODULO.core);
    const gerir = m.grupos.flatMap((g) => g.linhas).find((l) => l.acao === 'core.usuario.gerir');
    expect(gerir?.por_perfil).toEqual(m.perfis.map((p) => p.perfil === 'administrador'));
    for (const g of m.grupos) for (const l of g.linhas) expect(l.por_perfil).toHaveLength(m.perfis.length);
  });
  it('sem perfis, matriz vazia', () => expect(matrizDePerfis([])).toEqual({ perfis: [], grupos: [] }));
});

describe('auditoria: entidade com rótulo em português', () => {
  const item = (entidade: string) => ({ id: '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d', ocorrido_em: '2026-11-24T14:00:00.000Z', usuario_id: null, acao: 'core.usuario.criado', entidade, entidade_id: null });
  it('entidade do core vira rótulo; a de outro módulo aparece como veio; o filtro lista as do core', () => {
    expect(LISTA_AUDITORIA.linha(item('ambiente_fiscal') as never, 'America/Manaus').entidade).toBe('Ambiente fiscal');
    expect(LISTA_AUDITORIA.linha(item('preco') as never, 'America/Manaus').entidade).toBe('preco');
    expect(LISTA_AUDITORIA.filtrosTela.find((f) => f.chave === 'entidade')).toMatchObject({ tipo: 'selecao', opcoes: expect.arrayContaining([{ valor: 'usuario', rotulo: 'Usuário' }]) });
  });
});
