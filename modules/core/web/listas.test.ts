import { describe, expect, it } from 'vitest';
import { paraCsv } from '@macuxierp/platform-sdk/listas';
import { PERFIS, ROTULOS_PERFIL, type Perfil } from '@macuxierp/platform-sdk';
import { COLUNAS_AUDITORIA, COLUNAS_USUARIOS, TOM_SITUACAO_USUARIO, linhaAuditoria, linhaLicenca, linhaUsuario, opcoesDePerfil, paginaAuditoria, rotuloAcaoAuditoria, rotuloEntidadeAuditoria, paginaLicencas } from './listas';
import { PAGINAS_CORE, paginasVisiveis } from './paginas';

const ID = '11111111-1111-4111-8111-111111111111';

describe('T-0087: telas do core no BKO (RF-CORE-02/03/05)', () => {
  it('RN-CORE-09: só o administrador vê Usuários, Perfis, Licenças e Auditoria; o menu some para os outros perfis', () => {
    const gestao = ['usuarios', 'perfis', 'licencas', 'auditoria'];
    for (const perfil of PERFIS.filter((p) => p !== 'administrador')) {
      const ids = paginasVisiveis(perfil as Perfil).map((p) => p.id);
      for (const g of gestao) expect(ids, `${perfil} não vê ${g}`).not.toContain(g);
    }
    expect(paginasVisiveis('administrador').map((p) => p.id)).toEqual(expect.arrayContaining(gestao));
  });

  it('RF-CORE-02: os filtros da URL das páginas vêm do descritor do SDK (busca, inativos, período, usuário, cursor e limite)', () => {
    const pagina = (id: string) => PAGINAS_CORE.find((p) => p.id === id);
    expect(pagina('usuarios')?.filtros).toEqual(['busca', 'cursor', 'inativos', 'limite']);
    expect(pagina('auditoria')?.filtros).toEqual(['ate', 'cursor', 'de', 'entidade', 'limite', 'usuario', 'usuario_id']);
    expect(pagina('usuarios')?.exportaCsv && pagina('auditoria')?.exportaCsv && pagina('licencas')?.exportaCsv).toBe(true);
  });

  it('RF-CORE-05: a auditoria filtra por período e por usuário (UUID) e recusa filtro inválido', () => {
    expect(paginaAuditoria.consulta.safeParse({ usuario_id: ID, de: '2026-11-01T00:00:00Z', ate: '2026-11-30T23:59:59Z' }).success).toBe(true);
    expect(paginaAuditoria.consulta.safeParse({ usuario_id: 'fulano@x.test' }).success).toBe(false);
    expect(paginaAuditoria.consulta.safeParse({ de: 'ontem' }).success).toBe(false);
  });

  it('RD-2419 e LGPD: a auditoria mostra o nome do autor (nunca o id nem e-mail), com o Registro (entidade_id) e sem antes/depois', () => {
    const ids = paginaAuditoria.colunas.map((c) => c.id);
    expect(ids).toEqual(['ocorrido_em', 'usuario_nome', 'acao', 'entidade', 'entidade_id']);
    const csv = paraCsv(paginaAuditoria.colunas, [{ id: ID, usuario_id: ID, usuario_nome: 'Maria Teste', acao: 'core.usuario.criado', entidade: 'usuario', entidade_id: ID, ocorrido_em: '2026-11-10T12:00:00.000Z' }]);
    expect(csv).toContain('Maria Teste');
    expect(csv).toContain('Registro');
    expect(csv).toContain('Usuário criado');
    const campos = (paginaAuditoria.item as unknown as { shape: Record<string, unknown> }).shape;
    expect(campos).not.toHaveProperty('antes');
    expect(campos).not.toHaveProperty('depois');
  });

  it("MC-0201 e RN-CORE-17: último acesso e 'Quando' são data (fuso do tenant); Situação é status, uma coluna só", () => {
    const tipados = [...COLUNAS_USUARIOS, ...COLUNAS_AUDITORIA].filter((c) => c.tipo).map((c) => [c.id, c.tipo]);
    expect(tipados).toEqual([['situacao', 'status'], ['ultimo_acesso_em', 'data'], ['ocorrido_em', 'data']]);
    expect(COLUNAS_USUARIOS.map((c) => c.id)).not.toContain('ativo');
    expect(Object.values(TOM_SITUACAO_USUARIO)).toEqual(['ok', 'alerta', 'neutro']);
  });

  it('linhas da tela: perfil por extenso, data no fuso do tenant, "Nunca entrou" e licença sem prazo', () => {
    const u = { id: ID, nome: 'Maria Teste', email: 'maria@exemplo.test', perfil: 'gerente' as const, filial_ids: [ID], ativo: true, situacao: 'ativo' as const, external_id: null, ultimo_acesso_em: '2026-11-20T16:00:00.000Z', updated_at: '2026-11-20T16:00:00.000Z' };
    expect(linhaUsuario(u, 'America/Manaus')).toMatchObject({ perfil: 'Gerente', situacao: 'Ativo' });
    expect(linhaUsuario(u, 'America/Manaus').ultimo_acesso_em).toContain('12:00');
    expect(linhaUsuario({ ...u, ultimo_acesso_em: null, ativo: false, situacao: 'inativo' as const }, 'America/Manaus')).toMatchObject({ ultimo_acesso_em: 'Nunca entrou', situacao: 'Inativo' });    expect(linhaLicenca({ modulo: 'cadastros', ativo: true, valido_ate: null }, 'America/Manaus')).toEqual({ modulo: 'Cadastros', ativo: 'sim', valido_ate: 'Sem prazo' });
    expect(linhaAuditoria({ id: ID, usuario_id: null, usuario_nome: null, acao: 'core.usuario.senha_redefinida', entidade: 'usuario', entidade_id: null, ocorrido_em: '2026-11-20T16:00:00.000Z' }, 'America/Manaus')).toMatchObject({ usuario_nome: 'Sistema', acao: 'Senha redefinida', entidade: 'Usuário' });
  });

  it('RD-2419: ação e entidade de auditoria saem em português; o desconhecido vira texto genérico, nunca o código', () => {
    expect(rotuloAcaoAuditoria('cadastros.carga.iniciar')).toBe('Carga de dados iniciada');
    expect(rotuloEntidadeAuditoria('carga_portal')).toBe('Carga de dados');
    expect(rotuloAcaoAuditoria('xpto.coisa.nova')).toBe('Alteração registrada');
    expect(rotuloEntidadeAuditoria('xpto_nova')).toBe('Outro registro');
    expect(paginaAuditoria.consulta.safeParse({ usuario: 'Maria' }).success).toBe(true);
  });

  it('RN-CORE-10: o seletor de perfil lista todos os perfis conhecidos com rótulo; licenças não têm busca nem inativos', () => {
    expect(opcoesDePerfil(PERFIS).map((o) => o.valor)).toEqual([...PERFIS]);
    for (const p of PERFIS) expect(ROTULOS_PERFIL[p]).toBeTruthy();
    expect(paginaLicencas.busca || paginaLicencas.inativos).toBe(false);
  });
});
