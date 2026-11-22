/**
 * T-0008 (c), RN-CORE-02: TODA rota de core e cadastros, montada na API real (`criarApp`), checa sessão (401), perfil
 * (403 PERFIL_SEM_PERMISSAO), tenant (transação aberta no tenant do token) e licença do módulo (403 MODULO_INATIVO),
 * nesta ordem. As rotas são enumeradas do próprio plugin: rota nova entra no teste sem ninguém lembrar.
 * Os plugins vêm do `montarModulos` de produção (tests/apoio/api-memoria.ts), o mesmo que o main.ts monta.
 * O core é a base do tenant (MODULOS_BASE do SDK): sempre licenciado, por isso a licença só derruba rotas de cadastros.
 */
import { PERFIS, PERMISSOES, type Licenca, type RotaModulo } from '../../../packages/platform-sdk/src/index';
import { describe, expect, it } from 'vitest';
import { montarApiMemoria, SEGREDO_JWT, TENANT_A, TENANT_B, usarApiMemoria } from '../../apoio/api-memoria';
import { emitirTokenAcesso } from '../../../apps/api/src/auth/jwt';

const montar = usarApiMemoria();
const api = (licencas?: Licenca[]) => montar({ licencas });

const VALOR_PARAM: Record<string, string> = { tabela: 'ncm', cnpj: '11222333000181', cep: '69050010', chave: 'fuso' };
const url = (modulo: string, r: RotaModulo) =>
  `/v1/${modulo}${r.caminho.replace(/:([a-z_]+)/g, (_, p: string) => VALOR_PARAM[p] ?? '9f000000-0000-4000-8000-000000000001')}`;

/** As rotas reais dos plugins (montados uma vez só para listar). */
const referencia = await montarApiMemoria();
const ROTAS = (['core', 'cadastros'] as const).flatMap((modulo) => referencia.plugins[modulo].rotas.map((r) => ({ modulo, r, nome: `${r.metodo} /v1/${modulo}${r.caminho}` })));
await referencia.app.close();

const semPermissao = (r: RotaModulo) => PERFIS.find((p) => !(PERMISSOES[r.acao] as readonly string[]).includes(p));
const comPermissao = (r: RotaModulo) => PERFIS.find((p) => (PERMISSOES[r.acao] as readonly string[]).includes(p))!;

describe('enumeração das rotas (RN-CORE-02)', () => {
  it('core e cadastros têm o mínimo de rotas (o registro no Fastify é conferido pelo printRoutes, abaixo)', () => {
    expect(ROTAS.filter((x) => x.modulo === 'core').length).toBeGreaterThanOrEqual(19);
    expect(ROTAS.filter((x) => x.modulo === 'cadastros').length).toBeGreaterThanOrEqual(40);
  });
  it('toda rota declara uma ação da matriz de permissões do próprio módulo', () => {
    for (const { modulo, r } of ROTAS) {
      expect(Object.keys(PERMISSOES)).toContain(r.acao);
      expect(r.acao.startsWith(`${modulo}.`)).toBe(true);
    }
  });
});

describe.each(ROTAS)('$nome', ({ modulo, r }) => {
  it('RN-CORE-02: sem sessão = 401 NAO_AUTENTICADO, sem abrir transação', async () => {
    const a = await api();
    const res = await a.app.inject({ method: r.metodo, url: url(modulo, r), payload: r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
    expect(a.banco.aberturas).toEqual([]);
  });

  it('RN-CORE-02: token adulterado ou vencido = 401', async () => {
    const a = await api();
    const s = { usuario_id: '9f000000-0000-4000-8000-000000000002', tenant_id: TENANT_A, perfil: 'administrador' as const, filial_ids: [] };
    const outroSegredo = emitirTokenAcesso(s, 'outro-segredo-qualquer-com-mais-de-32-caracteres', a.relogio.agora(), 900).token;
    const vencido = emitirTokenAcesso(s, SEGREDO_JWT, new Date(a.relogio.agora().getTime() - 3_600_000), 900).token;
    for (const t of [outroSegredo, vencido]) {
      const res = await a.app.inject({ method: r.metodo, url: url(modulo, r), headers: { authorization: `Bearer ${t}` } });
      expect(res.statusCode).toBe(401);
    }
    expect(a.banco.aberturas).toEqual([]);
  });

  // Ação liberada a todos os perfis (só leitura, conferido no fim do arquivo): não há perfil que leve 403.
  const perfil = semPermissao(r);
  if (perfil !== undefined) it(`RN-CORE-02: perfil sem a ação ${r.acao} = 403 PERFIL_SEM_PERMISSAO, antes do tenant`, async () => {
    const a = await api();
    const res = await a.app.inject({ method: r.metodo, url: url(modulo, r), headers: a.auth(perfil!) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERFIL_SEM_PERMISSAO' });
    expect(a.banco.aberturas).toEqual([]);
  });

  it('RN-CORE-02: o tenant da transação é o do token (A abre A, B abre B)', async () => {
    const a = await api();
    const p = comPermissao(r);
    await a.app.inject({ method: r.metodo, url: url(modulo, r), headers: a.auth(p, TENANT_A) });
    await a.app.inject({ method: r.metodo, url: url(modulo, r), headers: a.auth(p, TENANT_B) });
    expect(a.banco.aberturas).toEqual([TENANT_A, TENANT_B]);
  });

  if (modulo === 'cadastros') {
    it.each([
      ['sem linha de licença', [] as Licenca[]],
      ['licença inativa', [{ modulo: 'cadastros', ativo: false, valido_ate: null }] as Licenca[]],
      ['licença vencida', [{ modulo: 'cadastros', ativo: true, valido_ate: new Date('2026-11-20T00:00:00Z') }] as Licenca[]],
      ['licença de outro módulo', [{ modulo: 'pedido', ativo: true, valido_ate: null }] as Licenca[]],
    ])('RN-CORE-02: %s = 403 MODULO_INATIVO, sem executar a rota', async (_n, licencas) => {
      const a = await api(licencas);
      const res = await a.app.inject({ method: r.metodo, url: url(modulo, r), headers: a.auth(comPermissao(r)) });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
      expect(a.outbox.eventos).toEqual([]);
      expect(a.auditoria.registros).toEqual([]);
    });
  } else {
    it('RN-CORE-02: core é módulo base (sempre licenciado): sem nenhuma licença não dá MODULO_INATIVO', async () => {
      const a = await api([]);
      const res = await a.app.inject({ method: r.metodo, url: url(modulo, r), headers: a.auth(comPermissao(r)) });
      expect(res.json()?.codigo).not.toBe('MODULO_INATIVO');
    });
  }
});

/** Rotas registradas no Fastify, lidas da árvore do `printRoutes` (método e caminho completo; HEAD é o espelho do GET). */
function rotasRegistradas(arvore: string): string[] {
  const pilha: string[] = [];
  const saida: string[] = [];
  for (const linha of arvore.split('\n')) {
    const m = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(linha);
    if (!m) continue;
    const nivel = m[1]!.length / 4;
    pilha[nivel] = `${nivel ? pilha[nivel - 1] : ''}${m[2]}`;
    for (const metodo of m[3]?.split(', ') ?? []) if (metodo !== 'HEAD') saida.push(`${metodo} ${pilha[nivel]}`);
  }
  return saida.sort();
}

describe('montarModulos de produção (apps/api/src/modulos.ts, o do main.ts) na API real (RN-CORE-02)', () => {
  it('nenhuma rota escapa da checagem: o Fastify tem só /v1/saude, /v1/auth/* e as rotas declaradas nos plugins', async () => {
    const a = await api();
    const declaradas = a.modulos.flatMap((p) => p.rotas.map((r) => `${r.metodo} /v1/${p.manifesto.id}${r.caminho}`));
    const fora = ['GET /v1/saude', 'POST /v1/auth/login', 'POST /v1/auth/refresh', 'POST /v1/auth/sair', 'GET /v1/auth/eu'];
    expect(rotasRegistradas(a.app.printRoutes({ commonPrefix: false }))).toEqual([...declaradas, ...fora].sort());
    expect(declaradas.length).toBe(ROTAS.length);
  });

  it('módulos montados só com o manifesto (pedido, faturamento, fiscal, integração FDV): nenhuma rota, 404 mesmo com sessão', async () => {
    const a = await api([{ modulo: 'pedido', ativo: true, valido_ate: null }, { modulo: 'fiscal', ativo: true, valido_ate: null }]);
    for (const m of ['pedido', 'faturamento', 'fiscal', 'integracao-fdv']) {
      const r = await a.app.inject({ url: `/v1/${m}/qualquer`, headers: a.auth() });
      expect(r.statusCode, m).toBe(404);
    }
    expect(a.banco.aberturas).toEqual([]);
  });

  /*
   * Multipart (#19): o `@fastify/multipart` está registrado na API, mas nenhuma rota real é multipart ainda — o
   * POST /v1/core/certificados segue em JSON (`arquivo_base64`, provisório pelo desenho T-0002; achado A-05). O que vale
   * hoje para um multipart na rota real: sessão e perfil antes de tudo, e o corpo cai na validação (400), nunca em 500.
   */
  it('multipart na rota real do A1: sem sessão 401, vendedor 403 PERFIL_SEM_PERMISSAO, administrador 400 VALIDACAO (rota em JSON, A-05)', async () => {
    const a = await api();
    expect(a.plugins.core.rotas.filter((r) => r.multipart)).toEqual([]);
    const limite = 't0008';
    const payload = Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="senha"\r\n\r\nx\r\n--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="a.pfx"\r\nContent-Type: application/x-pkcs12\r\n\r\nPPPP\r\n--${limite}--\r\n`,
    );
    const enviar = (h: Record<string, string> = {}) =>
      a.app.inject({ method: 'POST', url: '/v1/core/certificados', payload, headers: { 'content-type': `multipart/form-data; boundary=${limite}`, ...h } });
    expect([(await enviar()).statusCode]).toEqual([401]);
    expect((await enviar(a.auth('vendedor'))).json()).toMatchObject({ codigo: 'PERFIL_SEM_PERMISSAO' });
    const adm = await enviar(a.auth('administrador'));
    expect([adm.statusCode, adm.json().codigo]).toEqual([400, 'VALIDACAO']);
    expect(a.outbox.eventos).toEqual([]);
  });
});

describe('perfis da matriz (RN-CORE-01 e RN-CORE-02)', () => {
  it('só ações de leitura são liberadas a todos os perfis (as demais têm perfil que leva 403)', () => {
    const livres = [...new Set(ROTAS.filter((x) => semPermissao(x.r) === undefined).map((x) => x.r.acao))].sort();
    expect(livres).toEqual(['cadastros.ver', 'core.empresa.ver', 'core.perfil.ver']);
  });
});
