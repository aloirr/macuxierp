/**
 * T-0052 (RN-CORE-10) na API real em memória (tests/apoio/api-memoria.ts): com a flag `dts` no JWT, toda rota de módulo
 * enumerada dos plugins é 403 TROCAR_SENHA sem abrir transação; ficam fora /v1/auth/{eu,sair,senha}, saúde, login, refresh e 404.
 * NÃO se repete: o guard puro (apps/api/src/auth/troca-senha.test.ts), a regra (packages/platform-sdk/src/senha.test.ts),
 * o gerador (modules/core/domain/regras.test.ts) e o fluxo no PostgreSQL (troca-senha.db.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CODIGO_TROCAR_SENHA, PERFIS, type Licenca, type Perfil, type RotaModulo } from '../../../packages/platform-sdk/src/index';
import { emitirTokenAcesso } from '../../../apps/api/src/auth/jwt';
import { ADM_A, type ApiMemoria, FILIAL_A, INICIO, montarApiMemoria, SEGREDO_JWT, TENANT_A, usarApiMemoria } from '../../apoio/api-memoria';
import { preencherCaminho } from '../../apoio/caminhos';
import { conferir403TrocarSenha } from '../../apoio/troca-senha';

const montar = usarApiMemoria();

/** As rotas reais de todos os plugins montados (montados uma vez só para listar). */
const referencia = await montarApiMemoria();
const ROTAS = referencia.modulos.flatMap((m) => m.rotas.map((r) => ({ modulo: m.manifesto.id, r, nome: `${r.metodo} /v1/${m.manifesto.id}${r.caminho}` })));
const COM_ROTAS = [...new Set(ROTAS.map((x) => x.modulo))];
await referencia.app.close();

/** Todas as licenças dos módulos com rota ativas: o 403 não pode vir da licença. */
const TODAS: Licenca[] = COM_ROTAS.filter((m) => m !== 'core').map((modulo) => ({ modulo, ativo: true, valido_ate: null }) as Licenca);

const VALOR_PARAM: Record<string, string> = { tabela: 'ncm', cnpj: '11222333000181', cep: '69050010', chave: 'fuso', entidade: 'cliente' };
const url = (modulo: string, r: RotaModulo) =>
  `/v1/${modulo}${preencherCaminho(r.caminho, VALOR_PARAM)}`;

/** Authorization com o JWT de acesso real (`emitirTokenAcesso`), com ou sem a senha provisória. */
const token = (o: { deveTrocar: boolean; perfil?: Perfil }) => {
  const s = { usuario_id: ADM_A, tenant_id: TENANT_A, perfil: o.perfil ?? 'administrador', filial_ids: [FILIAL_A], ...(o.deveTrocar ? { deve_trocar_senha: true as const } : {}) };
  return { authorization: `Bearer ${emitirTokenAcesso(s, SEGREDO_JWT, INICIO, 900).token}` };
};

describe('T-0052 (RN-CORE-10): toda rota de módulo é 403 TROCAR_SENHA com a senha provisória', () => {
  it('a enumeração pega os plugins com rota (core, cadastros, pedido, integracao-fdv e faturamento, no mínimo)', () => {
    for (const m of ['core', 'cadastros', 'pedido', 'integracao-fdv', 'faturamento']) expect(COM_ROTAS).toContain(m);
    expect(ROTAS.length).toBeGreaterThanOrEqual(80);
  });

  const comFlag = (modulo: string, r: RotaModulo, perfil: Perfil, a: ApiMemoria) =>
    a.app.inject({ method: r.metodo, url: url(modulo, r), headers: token({ deveTrocar: true, perfil }), ...(r.metodo === 'GET' || r.metodo === 'DELETE' ? {} : { payload: {} }) });

  it.each(ROTAS)('$nome: 403 TROCAR_SENHA (administrador), sem abrir transação', async ({ modulo, r }) => {
    const a = await montar({ licencas: TODAS });
    const res = await comFlag(modulo, r, 'administrador', a);
    expect(res.statusCode).toBe(403);
    conferir403TrocarSenha(res.json(), 'provisoria');
    expect(a.banco.aberturas).toEqual([]);
  });

  it('todos os perfis: o bloqueio não depende do perfil (uma rota de módulo)', async () => {
    const { modulo, r } = ROTAS.find((x) => x.modulo === 'core' && x.r.metodo === 'GET')!;
    const a = await montar({ licencas: TODAS });
    for (const perfil of PERFIS) {
      const res = await comFlag(modulo, r, perfil, a);
      expect(res.statusCode, perfil).toBe(403);
      conferir403TrocarSenha(res.json(), 'provisoria', perfil);
    }
    expect(a.banco.aberturas).toEqual([]);
  });
});

describe('T-0052 (RN-CORE-10): o que fica liberado com a senha provisória', () => {
  const chamar = async (method: 'GET' | 'HEAD' | 'POST', u: string, payload?: object) => {
    const a = await montar({ licencas: TODAS });
    return a.app.inject({ method, url: u, headers: token({ deveTrocar: true }), ...(payload ? { payload } : {}) });
  };

  it('GET e HEAD /v1/auth/eu: 200 com o usuário da senha provisória (deve_trocar_senha: true), não 403', async () => {
    for (const m of ['GET', 'HEAD'] as const) {
      const a = await montar({ licencas: TODAS });
      a.repoAuth.usuarios.push({
        id: ADM_A, tenant_id: TENANT_A, nome: 'Administração A', email: 'adm@loja-a.teste', senha_hash: 'h', perfil: 'administrador',
        filial_ids: [FILIAL_A], ativo: true, falhas_login: 0, bloqueado_ate: null, deve_trocar_senha: true,
      });
      const r = await a.app.inject({ method: m, url: '/v1/auth/eu', headers: token({ deveTrocar: true }) });
      expect(r.statusCode, m).toBe(200);
      if (m === 'GET') expect(r.json()).toMatchObject({ usuario: { id: ADM_A, deve_trocar_senha: true }, empresa: { id: TENANT_A } });
    }
  });

  it('POST /v1/auth/sair: 204', async () => {
    expect((await chamar('POST', '/v1/auth/sair')).statusCode).toBe(204);
  });

  it('POST /v1/auth/senha chega à validação do corpo (400 VALIDACAO, não 403)', async () => {
    const r = await chamar('POST', '/v1/auth/senha', {});
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'VALIDACAO' });
  });

  it('rotas sem a sessão do tenant: saúde 200, refresh sem cookie 401, login 400/401, rota inexistente 404', async () => {
    expect((await chamar('GET', '/v1/saude')).statusCode).toBe(200);
    const refresh = await chamar('POST', '/v1/auth/refresh');
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json()).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
    const login = await chamar('POST', '/v1/auth/login', { email: 'adm@loja-a.teste', senha: 'x' });
    expect([400, 401]).toContain(login.statusCode);
    expect(login.body).not.toContain(CODIGO_TROCAR_SENHA);
    const inexistente = await chamar('GET', '/v1/core/rota-que-nao-existe');
    expect(inexistente.statusCode).toBe(404);
    expect(inexistente.json()).toMatchObject({ codigo: 'NAO_ENCONTRADO' });
  });
});
