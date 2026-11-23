import { CABECALHOS_SENHA_PROVISORIA, ErroApi, type EmpresaPlataforma, type Licenca, type RotaPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MANIFESTOS_TESTE } from './manifestos-teste';
import { criarPluginPlataformaCore, type RepositorioPlataforma } from './plataforma';

const EMPRESA = '00000000-0000-4000-8000-0000000000e1';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const AGORA = new Date('2026-11-23T12:00:00Z');

/** Repositório em memória no lugar das funções da 0033; guarda as chamadas para conferir o que foi gravado. */
function repoMemoria(inicial: Partial<EmpresaPlataforma> = {}) {
  const chamadas: string[] = [];
  const hashes: string[] = [];
  let empresa: EmpresaPlataforma = {
    id: EMPRESA,
    slug: 'cafe-macuxi',
    nome: 'Café Macuxi',
    fuso: 'America/Manaus',
    situacao: 'ativo',
    modulos: [{ modulo: 'core', ativo: true, valido_ate: null }],
    primeiro_admin: null,
    created_at: AGORA.toISOString(),
    updated_at: AGORA.toISOString(),
    ...inicial,
  };
  const repo: RepositorioPlataforma = {
    async listarEmpresas() { chamadas.push('listar'); return [empresa]; },
    async lerEmpresa(_tx, id) { return id === empresa.id ? empresa : null; },
    async criarEmpresa(_tx, p) { chamadas.push('criar'); return p.slug === empresa.slug ? null : { ...empresa, slug: p.slug, nome: p.nome }; },
    async alterarSituacao(_tx, p) { chamadas.push(`situacao:${p.situacao}`); empresa = { ...empresa, situacao: p.situacao }; return empresa; },
    async alterarModulos(_tx, p: { modulos: Licenca[] }) {
      chamadas.push(`modulos:${p.modulos.map((m) => `${m.modulo}=${m.ativo}`).join(',')}`);
      const outros = empresa.modulos.filter((m) => !p.modulos.some((n) => n.modulo === m.modulo));
      empresa = { ...empresa, modulos: [...outros, ...p.modulos.map((m) => ({ modulo: m.modulo, ativo: m.ativo, valido_ate: null }))] };
      return empresa;
    },
    async criarPrimeiroAdmin(_tx, p) {
      chamadas.push('admin');
      hashes.push(p.senha_hash);
      empresa = { ...empresa, primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false } };
      return { usuario_id: ADMIN };
    },
    async redefinirSenhaPrimeiroAdmin(_tx, p) { chamadas.push('senha'); hashes.push(p.senha_hash); return { usuario_id: ADMIN }; },
  };
  return { repo, chamadas, hashes };
}

function montar(inicial?: Partial<EmpresaPlataforma>) {
  const m = repoMemoria(inicial);
  const plugin = criarPluginPlataformaCore({
    repo: m.repo,
    manifestos: MANIFESTOS_TESTE,
    hashSenha: async (s) => `$argon2id$teste$${s.length}`,
    aleatorios: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256),
  });
  const rota = (metodo: string, caminho: string): RotaPlataforma => {
    const r = plugin.rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho} não existe`);
    return r;
  };
  const auditadas: unknown[] = [];
  const contexto = {
    sessao: { superadmin_id: '00000000-0000-4000-8000-00000000005a', sessao_id: '00000000-0000-4000-8000-00000000005e' },
    tx: {} as Transacao,
    request_id: 'req-1',
    agora: AGORA,
    auditar: async (d: unknown) => { auditadas.push(d); },
  };
  const chamar = async (metodo: string, caminho: string, e: { corpo?: unknown; consulta?: unknown; params?: Record<string, string> } = {}) => {
    const r = rota(metodo, caminho);
    const corpo = r.corpo ? r.corpo.parse(e.corpo) : undefined;
    const consulta = r.consulta ? r.consulta.parse(e.consulta ?? {}) : undefined;
    return r.executar(contexto, { corpo, consulta, params: e.params ?? { id: EMPRESA } } as never);
  };
  const erro = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { if (e instanceof ErroApi) return e; throw e; }
    throw new Error('esperava ErroApi');
  };
  return { ...m, plugin, chamar, erro, auditadas };
}

const LIGADOS_ATE_PEDIDO = [
  { modulo: 'core', ativo: true, valido_ate: null },
  { modulo: 'cadastros', ativo: true, valido_ate: null },
  { modulo: 'pedido', ativo: true, valido_ate: null },
] as const;

describe('T-0050: plugin de plataforma do core (ADR 0012)', () => {
  it('monta as 7 rotas de empresa, nenhuma em /auth', () => {
    const { plugin } = montar();
    expect(plugin.rotas.map((r) => `${r.metodo} ${r.caminho}`).sort()).toEqual([
      'GET /empresas',
      'GET /empresas/:id',
      'POST /empresas',
      'POST /empresas/:id/primeiro-admin',
      'POST /empresas/:id/primeiro-admin/senha',
      'PUT /empresas/:id/modulos',
      'PUT /empresas/:id/situacao',
    ]);
  });

  it('cria a empresa (201) e recusa slug repetido (409)', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/empresas', { corpo: { slug: 'nova-empresa', nome: 'Nova' } });
    expect(r).toMatchObject({ status: 201, corpo: { slug: 'nova-empresa' } });
    expect((await t.erro(t.chamar('POST', '/empresas', { corpo: { slug: 'cafe-macuxi', nome: 'Outra' } }))).status).toBe(409);
  });

  it('lista com paginação e responde 404 para empresa que não existe', async () => {
    const t = montar();
    expect(await t.chamar('GET', '/empresas', { consulta: { limite: '10' } })).toMatchObject({ corpo: { itens: [{ id: EMPRESA }], proximo_cursor: null } });
    const e = await t.erro(t.chamar('GET', '/empresas/:id', { params: { id: '00000000-0000-4000-8000-0000000000ff' } }));
    expect(e.status).toBe(404);
    expect((await t.erro(t.chamar('GET', '/empresas/:id', { params: { id: 'x' } }))).status).toBe(400);
  });

  describe('RN-CORE-02: módulos com as dependências do manifesto', () => {
    it('RN-CORE-02: recusa ligar o faturamento sem o fiscal (422) e não grava', async () => {
      const t = montar({ modulos: [...LIGADOS_ATE_PEDIDO] });
      const e = await t.erro(t.chamar('PUT', '/empresas/:id/modulos', { corpo: { modulos: [{ modulo: 'faturamento', ativo: true }] } }));
      expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
      expect(t.chamadas).toEqual([]);
    });
    it('RN-CORE-02: liga fiscal e faturamento juntos', async () => {
      const t = montar({ modulos: [...LIGADOS_ATE_PEDIDO] });
      await t.chamar('PUT', '/empresas/:id/modulos', { corpo: { modulos: [{ modulo: 'fiscal', ativo: true }, { modulo: 'faturamento', ativo: true }] } });
      expect(t.chamadas).toEqual(['modulos:fiscal=true,faturamento=true']);
    });
    it('RN-CORE-02: recusa desligar o fiscal com o faturamento ligado', async () => {
      const t = montar({
        modulos: [...LIGADOS_ATE_PEDIDO, { modulo: 'fiscal', ativo: true, valido_ate: null }, { modulo: 'faturamento', ativo: true, valido_ate: null }],
      });
      const e = await t.erro(t.chamar('PUT', '/empresas/:id/modulos', { corpo: { modulos: [{ modulo: 'fiscal', ativo: false }] } }));
      expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
      expect(t.chamadas).toEqual([]);
    });
  });

  describe('1º administrador e a senha provisória mostrada uma vez', () => {
    it('RN-CORE-01: cria com a senha provisória só na resposta, com CABECALHOS_SENHA_PROVISORIA, e grava só o hash', async () => {
      const t = montar();
      const r = await t.chamar('POST', '/empresas/:id/primeiro-admin', { corpo: { email: ' Admin@Cafe.com.br ', nome: 'Ana' } });
      expect(r.status).toBe(201);
      expect(r.cabecalhos).toEqual({ ...CABECALHOS_SENHA_PROVISORIA });
      const senha = (r.corpo as { senha_provisoria: string }).senha_provisoria;
      expect(senha).toHaveLength(16);
      expect(t.hashes).toEqual(['$argon2id$teste$16']);
    });
    it('RN-CORE-01: o reenvio responde 409 e não gera senha nova', async () => {
      const t = montar();
      await t.chamar('POST', '/empresas/:id/primeiro-admin', { corpo: { email: 'admin@cafe.com.br' } });
      const e = await t.erro(t.chamar('POST', '/empresas/:id/primeiro-admin', { corpo: { email: 'admin@cafe.com.br' } }));
      expect(e.status).toBe(409);
      expect(t.chamadas).toEqual(['admin']);
    });
    it('as rotas de senha provisória exigem Idempotency-Key e respondem com no-store (a apps/api não guarda o corpo)', () => {
      const { plugin } = montar();
      const comSenha = plugin.rotas.filter((r) => r.caminho.startsWith('/empresas/:id/primeiro-admin'));
      expect(comSenha.map((r) => r.idempotencia)).toEqual(['obrigatoria', 'obrigatoria']);
      expect(CABECALHOS_SENHA_PROVISORIA['cache-control']).toBe('no-store');
    });
    it('RN-CORE-01: redefine a senha do 1º admin com CABECALHOS_SENHA_PROVISORIA e recusa sem admin', async () => {
      const sem = montar();
      expect((await sem.erro(sem.chamar('POST', '/empresas/:id/primeiro-admin/senha'))).status).toBe(422);
      const t = montar({ primeiro_admin: { id: ADMIN, ativo: true, bloqueado: true } });
      const r = await t.chamar('POST', '/empresas/:id/primeiro-admin/senha');
      expect(r).toMatchObject({ corpo: { usuario_id: ADMIN }, cabecalhos: { ...CABECALHOS_SENHA_PROVISORIA } });
      expect(t.chamadas).toEqual(['senha']);
    });
  });

  describe('suspender e reativar', () => {
    it('suspende, reativa e não grava de novo a situação atual', async () => {
      const t = montar();
      await t.chamar('PUT', '/empresas/:id/situacao', { corpo: { situacao: 'suspenso', motivo: 'inadimplência' } });
      await t.chamar('PUT', '/empresas/:id/situacao', { corpo: { situacao: 'suspenso', motivo: 'de novo' } });
      await t.chamar('PUT', '/empresas/:id/situacao', { corpo: { situacao: 'ativo', motivo: 'pagou' } });
      expect(t.chamadas).toEqual(['situacao:suspenso', 'situacao:ativo']);
    });
    it('empresa suspensa não ganha 1º admin', async () => {
      const t = montar({ situacao: 'suspenso' });
      expect((await t.erro(t.chamar('POST', '/empresas/:id/primeiro-admin', { corpo: { email: 'a@b.com.br' } }))).status).toBe(422);
    });
    it('empresa encerrada não muda pelo portal (409)', async () => {
      const t = montar({ situacao: 'encerrado' });
      expect((await t.erro(t.chamar('PUT', '/empresas/:id/situacao', { corpo: { situacao: 'ativo', motivo: 'voltar' } }))).status).toBe(409);
    });
  });

  it('nenhuma rota chama auditar: as funções da 0033 auditam com o superadmin_id na mesma transação', async () => {
    const t = montar();
    await t.chamar('POST', '/empresas', { corpo: { slug: 'outra', nome: 'Outra' } });
    await t.chamar('PUT', '/empresas/:id/situacao', { corpo: { situacao: 'suspenso', motivo: 'teste' } });
    expect(t.auditadas).toEqual([]);
  });
});
