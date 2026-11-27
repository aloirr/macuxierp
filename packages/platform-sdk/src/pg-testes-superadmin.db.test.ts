/**
 * RD-2261 (era RD-2212 do faturamento): `semearSessaoSuperadmin` e `comoConfig` do pg-testes, a montagem única da sessão
 * de superadmin e da transação no papel `macuxierp_config` para os testes de banco. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoConfig, comoConfigTx, criarBancoEfemero, criarTenant, PG_DISPONIVEL, semearSessaoSuperadmin, type BancoEfemero } from './pg-testes';

describe.skipIf(!PG_DISPONIVEL)('pg-testes: sessão de superadmin e transação como macuxierp_config (RD-2261)', () => {
  let b: BancoEfemero;
  beforeAll(async () => {
    b = await criarBancoEfemero();
  });
  afterAll(async () => {
    await b?.remover();
  });

  it('semeia um superadmin ativo com sessão válida e devolve os ids', async () => {
    const s = await semearSessaoSuperadmin(b.admin);
    const [linha] = (await b.admin.query('SELECT a.ativo, x.expira_em > now() AS valida FROM plataforma.superadmin a JOIN plataforma.sessao_superadmin x ON x.superadmin_id = a.id WHERE x.id = $1', [s.sessao_id])).rows;
    expect(linha).toEqual({ ativo: true, valida: true });
    expect(s.superadmin_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('comoConfig roda no papel macuxierp_config com a sessão, e uma função do portal reconhece o superadmin', async () => {
    const s = await semearSessaoSuperadmin(b.admin);
    const t = await criarTenant(b.admin, 'rd2261-a', ['core']);
    const r = await comoConfig(b.admin, s.sessao_id, async (consultar) => {
      const [papel] = await consultar('SELECT current_user AS u');
      // uma função da lista fechada do portal (0071): ela confere a sessão (exigir_superadmin) e a empresa alvo
      const [l] = await consultar('SELECT cadastros.portal_entrada_ler($1::uuid) AS r', [t]);
      return { papel: papel!.u, leitura: l!.r };
    });
    expect(r).toEqual({ papel: 'macuxierp_config', leitura: { credenciais: [], ultimo_sinal: null, lotes: [] } });
    // sem a sessão, a mesma chamada é recusada (MXS01)
    await expect(comoConfig(b.admin, '00000000-0000-4000-8000-000000000000', (consultar) => consultar('SELECT cadastros.portal_entrada_ler($1::uuid) AS r', [t]))).rejects.toMatchObject({ code: 'MXS01' });
  });

  it('comoConfig desfaz a transação no erro e repassa a exceção', async () => {
    const s = await semearSessaoSuperadmin(b.admin);
    await expect(comoConfig(b.admin, s.sessao_id, (consultar) => consultar('SELECT 1/0'))).rejects.toThrow(/division by zero/);
  });

  it('RD-2349: comoConfigTx entrega uma Transacao do SDK (para os repositórios que pedem tx)', async () => {
    const s = await semearSessaoSuperadmin(b.admin);
    const t = await criarTenant(b.admin, 'rd2349-a', ['core']);
    const r = await comoConfigTx(b.admin, s.sessao_id, async (tx) => (await tx.consultar<{ r: unknown }>('SELECT cadastros.portal_entrada_ler($1::uuid) AS r', [t]))[0]!.r);
    expect(r).toEqual({ credenciais: [], ultimo_sinal: null, lotes: [] });
  });
});
