/**
 * T-0008 (c), RN-CORE-02: TODA rota de core, cadastros e pedido (T-0016), montada na API real (`criarApp`), checa sessão (401), perfil
 * (403 PERFIL_SEM_PERMISSAO), tenant (transação aberta no tenant do token) e licença do módulo (403 MODULO_INATIVO),
 * nesta ordem. As rotas são enumeradas do próprio plugin: rota nova entra no teste sem ninguém lembrar.
 * Os plugins vêm do `montarModulos` de produção (tests/apoio/api-memoria.ts), o mesmo que o main.ts monta.
 * O core é a base do tenant (MODULOS_BASE do SDK): sempre licenciado, por isso a licença só derruba rotas de cadastros e
 * de pedido; cada módulo licenciado responde só à própria licença.
 */
import { MODULOS_BASE, PERFIS, PERMISSOES, type Licenca, type RotaModulo } from '../../../packages/platform-sdk/src/index';
import { describe, expect, it } from 'vitest';
import { CNPJ_EMPRESA, FILIAL_A, montarApiMemoria, SEGREDO_JWT, TENANT_A, TENANT_B, usarApiMemoria } from '../../apoio/api-memoria';
import { formulario } from '../../apoio/multipart';
import { emitirTokenAcesso } from '../../../apps/api/src/auth/jwt';

const montar = usarApiMemoria();
const api = (licencas?: Licenca[]) => montar({ licencas });
/** Módulos com licença (o core é base). O padrão do apoio licencia só o cadastros; o pedido pede a própria linha. */
const LICENCIADOS = ['cadastros', 'pedido', 'integracao-fdv'] as const;
type Licenciado = (typeof LICENCIADOS)[number];
const ehLicenciado = (m: string): m is Licenciado => (LICENCIADOS as readonly string[]).includes(m);
const ativa = (modulo: Licenca['modulo']): Licenca => ({ modulo, ativo: true, valido_ate: null });
/** Licenças em que todos os módulos com rota estão ativos (o caminho feliz até a rota). */
const TODAS = LICENCIADOS.map(ativa);

const VALOR_PARAM: Record<string, string> = { tabela: 'ncm', cnpj: '11222333000181', cep: '69050010', chave: 'fuso', entidade: 'cliente' };
const url = (modulo: string, r: RotaModulo) =>
  `/v1/${modulo}${r.caminho.replace(/:([a-z_]+)/g, (_, p: string) => VALOR_PARAM[p] ?? '9f000000-0000-4000-8000-000000000001')}`;

/** As rotas reais dos plugins (montados uma vez só para listar). */
const referencia = await montarApiMemoria();
const plugin = (id: string) => referencia.modulos.find((m) => m.manifesto.id === id)!;
const ROTAS = [...MODULOS_BASE, ...LICENCIADOS].flatMap((modulo) => plugin(modulo).rotas.map((r) => ({ modulo, r, nome: `${r.metodo} /v1/${modulo}${r.caminho}` })));
await referencia.app.close();

/**
 * Campos de texto do formulário de cada rota multipart. O arquivo é lido antes da transação (apps/api/src/app.ts): sem
 * um formulário completo, 400 VALIDACAO antes do tenant e da licença. POST /v1/core/certificados desde o #42 (T-0040);
 * POST /v1/cadastros/cargas com o PR do cadastros da T-0026 (sem ele, a rota não existe e a entrada não é usada).
 */
const CAMPOS_MULTIPART: Record<string, Record<string, string>> = {
  'POST /v1/core/certificados': { filial_id: FILIAL_A, senha: 'x' },
  'POST /v1/cadastros/cargas': { modo: 'validar' },
};
/** Pedido de `app.inject` da rota: JSON sem corpo ou, na rota multipart, o formulário completo (um arquivo por campo). */
function pedido(modulo: string, r: RotaModulo, headers: Record<string, string>) {
  if (!r.multipart) return { method: r.metodo, url: url(modulo, r), headers };
  const nome = `${r.metodo} /v1/${modulo}${r.caminho}`;
  const campos = CAMPOS_MULTIPART[nome];
  if (!campos) throw new Error(`${nome}: rota multipart nova sem campos em CAMPOS_MULTIPART`);
  const f = formulario(campos, Object.fromEntries(r.multipart.arquivos.map((x) => [x.campo, Buffer.from('PPPP')])));
  return { method: r.metodo, url: url(modulo, r), payload: f.payload, headers: { ...f.headers, ...headers } };
}

const semPermissao = (r: RotaModulo) => PERFIS.find((p) => !(PERMISSOES[r.acao] as readonly string[]).includes(p));
const comPermissao = (r: RotaModulo) => PERFIS.find((p) => (PERMISSOES[r.acao] as readonly string[]).includes(p))!;

describe('enumeração das rotas (RN-CORE-02)', () => {
  it('core, cadastros e pedido têm o mínimo de rotas (o registro no Fastify é conferido pelo printRoutes, abaixo)', () => {
    expect(ROTAS.filter((x) => x.modulo === 'core').length).toBeGreaterThanOrEqual(19);
    expect(ROTAS.filter((x) => x.modulo === 'cadastros').length).toBeGreaterThanOrEqual(40);
    expect(ROTAS.filter((x) => x.modulo === 'pedido').length).toBeGreaterThanOrEqual(10);
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
    const a = await api(TODAS);
    const p = comPermissao(r);
    await a.app.inject(pedido(modulo, r, a.auth(p, TENANT_A)));
    await a.app.inject(pedido(modulo, r, a.auth(p, TENANT_B)));
    expect(a.banco.aberturas).toEqual([TENANT_A, TENANT_B]);
  });

  if (ehLicenciado(modulo)) {
    const outros = TODAS.filter((l) => l.modulo !== modulo);
    it.each([
      ['sem linha de licença', [] as Licenca[]],
      ['licença inativa', [...outros, { modulo, ativo: false, valido_ate: null }]],
      ['licença vencida', [...outros, { modulo, ativo: true, valido_ate: new Date('2026-11-20T00:00:00Z') }]],
      ['só a licença dos outros módulos', outros],
    ])('RN-CORE-02: %s = 403 MODULO_INATIVO, sem executar a rota', async (_n, licencas) => {
      const a = await api(licencas);
      const res = await a.app.inject(pedido(modulo, r, a.auth(comPermissao(r))));
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

  it('módulos montados só com o manifesto (faturamento, fiscal): nenhuma rota, 404 mesmo com sessão', async () => {
    const a = await api([...TODAS, ativa('faturamento'), ativa('fiscal')]);
    const semRotas = a.modulos.filter((p) => p.rotas.length === 0).map((p) => p.manifesto.id);
    expect(semRotas).toEqual(['faturamento', 'fiscal']);
    for (const m of semRotas) {
      const r = await a.app.inject({ url: `/v1/${m}/qualquer`, headers: a.auth() });
      expect(r.statusCode, m).toBe(404);
    }
    expect(a.banco.aberturas).toEqual([]);
  });

  /*
   * Multipart (#19) na rota real do A1: desde o #42 (T-0040, 410e8a8) o POST /v1/core/certificados é multipart, com o
   * `.pfx` no campo `arquivo` (até 50 KB, PFX_TAMANHO_MAXIMO do contrato) e `filial_id`/`senha` em texto; o
   * `arquivo_base64` saiu do contrato (A-05 resolvido). Sessão e perfil antes de ler o arquivo; acima do limite, 413.
   */
  it('multipart na rota real do A1 (A-05, resolvido pelo #42): declaração, 401, 403 do vendedor, 413, JSON antigo 400 e .pfx aceito 201', async () => {
    const a = await api();
    const multiparts = a.plugins.core.rotas.filter((r) => r.multipart).map((r) => [`${r.metodo} ${r.caminho}`, r.multipart]);
    expect(multiparts).toEqual([['POST /certificados', { arquivos: [{ campo: 'arquivo', tamanhoMaximo: 51200 }] }]]);
    const enviar = (pfx: Buffer, h: Record<string, string> = {}) => {
      const f = formulario({ filial_id: FILIAL_A, senha: 'senha-ficticia' }, { arquivo: pfx });
      return a.app.inject({ method: 'POST', url: '/v1/core/certificados', payload: f.payload, headers: { ...f.headers, ...h } });
    };
    expect((await enviar(Buffer.from('PPPP'))).statusCode).toBe(401);
    const vendedor = await enviar(Buffer.from('PPPP'), a.auth('vendedor'));
    expect([vendedor.statusCode, vendedor.json().codigo]).toEqual([403, 'PERFIL_SEM_PERMISSAO']);
    const grande = await enviar(Buffer.alloc(51201, 'P'), a.auth('administrador'));
    expect([grande.statusCode, grande.json().codigo]).toEqual([413, 'ARQUIVO_GRANDE']);
    const antigo = await a.app.inject({ method: 'POST', url: '/v1/core/certificados', payload: { filial_id: FILIAL_A, senha: 'x', arquivo_base64: 'UFBQUA==' }, headers: a.auth('administrador') });
    expect([antigo.statusCode, antigo.json().codigo]).toEqual([400, 'VALIDACAO']);
    expect(a.banco.aberturas).toEqual([]);
    expect(a.outbox.eventos).toEqual([]);

    // .pfx que o leitor recusa (como senha errada): 422 RN-CORE-06, sem evento; aceito: 201 com o resumo, sem senha.
    const recusado = await enviar(Buffer.from('PPPP'), a.auth('administrador'));
    expect([recusado.statusCode, recusado.json().codigo]).toEqual([422, 'RN-CORE-06']);
    a.leitorPfx.dados = { titular: 'EMPRESA FICTICIA LTDA', cnpj: CNPJ_EMPRESA, valido_de: new Date('2026-01-01T00:00:00Z'), valido_ate: new Date('2027-01-01T00:00:00Z'), impressao_digital: 'ab'.repeat(32) };
    const ok = await enviar(Buffer.from('PPPP'), a.auth('administrador'));
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ filial_id: FILIAL_A, cnpj: CNPJ_EMPRESA, ativo: true });
    expect(ok.body).not.toContain('senha-ficticia');
    expect(a.outbox.eventos.map((e) => e.nome)).toEqual(['core.certificado.alterado@1']);
  });
});

describe('perfis da matriz (RN-CORE-01 e RN-CORE-02)', () => {
  it('só ações de leitura são liberadas a todos os perfis (as demais têm perfil que leva 403)', () => {
    const livres = [...new Set(ROTAS.filter((x) => semPermissao(x.r) === undefined).map((x) => x.r.acao))].sort();
    expect(livres).toEqual(['cadastros.ver', 'core.empresa.ver', 'core.perfil.ver', 'pedido.ver']);
  });
});
