import { describe, expect, it } from 'vitest';
import { paraCsv } from '@macuxierp/platform-sdk/listas';
import { PERFIS, ROTULOS_PERFIL, type Perfil } from '@macuxierp/platform-sdk';
import { linhaAuditoria, linhaLicenca, linhaUsuario, opcoesDePerfil, paginaAuditoria, paginaLicencas } from './listas';
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
    expect(pagina('auditoria')?.filtros).toEqual(['ate', 'cursor', 'de', 'entidade', 'limite', 'usuario_id']);
    expect(pagina('usuarios')?.exportaCsv && pagina('auditoria')?.exportaCsv && pagina('licencas')?.exportaCsv).toBe(true);
  });

  it('RF-CORE-05: a auditoria filtra por período e por usuário (UUID) e recusa filtro inválido', () => {
    expect(paginaAuditoria.consulta.safeParse({ usuario_id: ID, de: '2026-11-01T00:00:00Z', ate: '2026-11-30T23:59:59Z' }).success).toBe(true);
    expect(paginaAuditoria.consulta.safeParse({ usuario_id: 'fulano@x.test' }).success).toBe(false);
    expect(paginaAuditoria.consulta.safeParse({ de: 'ontem' }).success).toBe(false);
  });

  it('LGPD: a auditoria da tela e do CSV não tem antes/depois nem nome ou e-mail, só o id do autor', () => {
    const ids = paginaAuditoria.colunas.map((c) => c.id);
    expect(ids).toEqual(['ocorrido_em', 'usuario_id', 'acao', 'entidade', 'entidade_id']);
    const csv = paraCsv(paginaAuditoria.colunas, [{ id: ID, usuario_id: ID, acao: 'core.usuario.criado', entidade: 'usuario', entidade_id: null, ocorrido_em: '2026-11-10T12:00:00.000Z' }]);
    expect(csv).toContain(ID);
    expect(csv).toContain('Usuário criado');
    const campos = (paginaAuditoria.item as unknown as { shape: Record<string, unknown> }).shape;
    expect(campos).not.toHaveProperty('antes');
    expect(campos).not.toHaveProperty('depois');
  });

  it('linhas da tela: perfil por extenso, data no fuso do tenant, "Nunca entrou" e licença sem prazo', () => {
    const u = { id: ID, nome: 'Maria Teste', email: 'maria@exemplo.test', perfil: 'gerente' as const, filial_ids: [ID], ativo: true, external_id: null, ultimo_acesso_em: '2026-11-20T16:00:00.000Z', updated_at: '2026-11-20T16:00:00.000Z' };
    expect(linhaUsuario(u, 'America/Manaus')).toMatchObject({ perfil: 'Gerente', ativo: 'sim' });
    expect(linhaUsuario(u, 'America/Manaus').ultimo_acesso_em).toContain('12:00');
    expect(linhaUsuario({ ...u, ultimo_acesso_em: null, ativo: false }, 'America/Manaus')).toMatchObject({ ultimo_acesso_em: 'Nunca entrou', ativo: 'não' });    expect(linhaLicenca({ modulo: 'cadastros', ativo: true, valido_ate: null }, 'America/Manaus')).toEqual({ modulo: 'Cadastros', ativo: 'sim', valido_ate: 'Sem prazo' });
    expect(linhaAuditoria({ id: ID, usuario_id: null, acao: 'core.usuario.senha_redefinida', entidade: 'usuario', entidade_id: null, ocorrido_em: '2026-11-20T16:00:00.000Z' }, 'America/Manaus')).toMatchObject({ usuario_id: 'Sistema', acao: 'Senha redefinida' });
  });

  it('RN-CORE-10: o seletor de perfil lista todos os perfis conhecidos com rótulo; licenças não têm busca nem inativos', () => {
    expect(opcoesDePerfil(PERFIS).map((o) => o.valor)).toEqual([...PERFIS]);
    for (const p of PERFIS) expect(ROTULOS_PERFIL[p]).toBeTruthy();
    expect(paginaLicencas.busca || paginaLicencas.inativos).toBe(false);
  });
});
