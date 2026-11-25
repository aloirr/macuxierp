import { CABECALHOS_SENHA_PROVISORIA, ErroApi, type EmpresaPlataforma, type Licenca, type RotaPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MANIFESTOS_TESTE } from './manifestos-teste';
import type { FichaReceitaPlana, FichaReceitaPlanaMascarada } from '../contracts';
import { criarPluginPlataformaCore, type ConsultaReceita, type RepositorioPlataforma } from './plataforma';

const CNPJ = '11222333000181';
const FICHA_ANTES: FichaReceitaPlanaMascarada = {
  nome_fantasia: 'ANTIGA', ie: null, logradouro: null, numero: null, complemento: null, bairro: null, cep: null, municipio_ibge: null, uf: 'AM',
  email_mascarado: 'co****@teste.com.br', telefone_mascarado: '(92) ****-1234', cnae_principal: '4711302', regime_receita: 'simples',
  situacao_cadastral: 'ATIVA', situacao_cadastral_data: null, data_abertura: null, natureza_juridica: null, porte: null,
  cnae_secundarios: [], receita_fonte: 'brasilapi', receita_consultada_em: '2026-11-01T00:00:00.000Z',
};
const SUGESTAO_OK = {
  ok: true as const,
  fonte: 'brasilapi',
  consultado_em: '2026-11-25T12:00:00.000Z',
  sugestao: { cnpj: CNPJ, razao_social: 'EMPRESA NOVA LTDA', nome_fantasia: 'NOVA', situacao_cadastral: 'ATIVA', cnae_fiscal: '4711302', endereco: { uf: 'AM' }, email: 'contato@nova.com.br', telefone: '9232221234', opcao_simples: true, opcao_mei: false },
};
interface OpcoesFicha {
  ficha?: FichaReceitaPlanaMascarada | null;
  consulta?: ConsultaReceita;
  valor?: string;
}

const EMPRESA = '00000000-0000-4000-8000-0000000000e1';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const AGORA = new Date('2026-11-23T12:00:00Z');

/** Repositório em memória no lugar das funções da 0033; guarda as chamadas para conferir o que foi gravado. */
function repoMemoria(inicial: Partial<EmpresaPlataforma> = {}, op: OpcoesFicha = {}) {
  const chamadas: string[] = [];
  const gravadas: FichaReceitaPlana[] = [];
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
    async criarEmpresa(_tx, p) { chamadas.push('criar'); if (p.slug === empresa.slug) return null; return { ...empresa, slug: p.slug ?? 'am0001', nome: p.nome }; },
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
    async revelarEmailPrimeiroAdmin() { chamadas.push('email'); return 'admin@cafe.com.br'; },
    async redefinirSenhaPrimeiroAdmin(_tx, p) { chamadas.push('senha'); hashes.push(p.senha_hash); return { usuario_id: ADMIN }; },
    async lerEmpresaComFicha(_tx, id) {
      return id === empresa.id ? { empresa, ficha: op.ficha === undefined ? FICHA_ANTES : op.ficha } : null;
    },
    async gravarReceita(_tx, p) {
      chamadas.push('gravar');
      gravadas.push(p.ficha);
      return { ficha: { ...FICHA_ANTES, nome_fantasia: p.ficha.nome_fantasia }, alterados: ['nome_fantasia'] };
    },
    async revelarContato(_tx, p) {
      chamadas.push(`revelar:${p.campo}`);
      return op.valor ?? 'contato@teste.com.br';
    },
  };
  return { repo, chamadas, hashes, gravadas };
}

function montar(inicial?: Partial<EmpresaPlataforma>, op: OpcoesFicha = {}) {
  const m = repoMemoria({ cnpj: CNPJ, ...inicial }, op);
  const plugin = criarPluginPlataformaCore({
    repo: m.repo,
    consultaReceita: op.consulta,
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
  it('monta as 10 rotas de empresa, nenhuma em /auth', () => {
    const { plugin } = montar();
    expect(plugin.rotas.map((r) => `${r.metodo} ${r.caminho}`).sort()).toEqual([
      'GET /empresas',
      'GET /empresas/:id',
      'POST /empresas',
      'POST /empresas/:id/contato/:campo',
      'POST /empresas/:id/primeiro-admin',
      'POST /empresas/:id/primeiro-admin/email',
      'POST /empresas/:id/primeiro-admin/senha',
      'POST /empresas/:id/receita',
      'PUT /empresas/:id/modulos',
      'PUT /empresas/:id/situacao',
    ]);
  });

  it('RN-CORE-11: cria pelo código do FDV', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/empresas', { corpo: { codigo: 'am2808', nome: 'Xis' } });
    expect(r).toMatchObject({ status: 201, corpo: { slug: 'am2808', codigo: 'AM2808' } });
  });

  it('a lista e o detalhe trazem o codigo derivado do slug', async () => {
    const t = montar();
    const l = (await t.chamar('GET', '/empresas')) as { corpo: { itens: unknown[] } };
    expect(l.corpo.itens[0]).toMatchObject({ slug: 'cafe-macuxi', codigo: null });
    const d = (await t.chamar('GET', '/empresas/:id', { params: { id: EMPRESA } })) as { corpo: { codigo: string | null } };
    expect(d.corpo.codigo).toBeNull();
  });

  it('cria a empresa (201) e recusa slug repetido (409)', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/empresas', { corpo: { slug: 'nova-empresa', nome: 'Nova' } });
    expect(r).toMatchObject({ status: 201, corpo: { slug: 'nova-empresa' } });
    const e = await t.erro(t.chamar('POST', '/empresas', { corpo: { slug: 'cafe-macuxi', nome: 'Outra' } }));
    expect(e.status).toBe(409);
    expect(e.message).toBe('Já existe empresa com este código');
  });

  it("RN-CORE-11: o Zod do SDK recusa criar empresa com o código reservado 'macuxi' (e 'MACUXI') antes do banco", async () => {
    const t = montar();
    await expect(t.chamar('POST', '/empresas', { corpo: { slug: 'macuxi', nome: 'Nova' } })).rejects.toThrow('Slug reservado');
    await expect(t.chamar('POST', '/empresas', { corpo: { slug: 'MACUXI', nome: 'Nova' } })).rejects.toThrow();
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
    it('as rotas de senha provisória exigem Idempotency-Key e respondem com no-store (a apps/api não guarda o corpo; a rota /email, sem senha, fica de fora: no-store sem chave)', () => {
      const { plugin } = montar();
      const comSenha = plugin.rotas.filter((r) => r.caminho.startsWith('/empresas/:id/primeiro-admin') && !r.caminho.endsWith('/email'));
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
    it('revela o e-mail do 1º admin com no-store, sem idempotência, e responde 404 sem admin', async () => {
      const sem = montar();
      expect((await sem.erro(sem.chamar('POST', '/empresas/:id/primeiro-admin/email'))).status).toBe(404);
      expect(sem.chamadas).toEqual([]);
      const t = montar({ primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false } });
      const r = await t.chamar('POST', '/empresas/:id/primeiro-admin/email');
      expect(r).toEqual({ corpo: { email: 'admin@cafe.com.br' }, cabecalhos: { ...CABECALHOS_SENHA_PROVISORIA } });
      expect(t.chamadas).toEqual(['email']);
      expect(t.plugin.rotas.find((x) => x.caminho === '/empresas/:id/primeiro-admin/email')?.idempotencia).toBeUndefined();
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

  it('nenhuma rota chama auditar: as funções da 0033 e da 0035 auditam com o superadmin_id na mesma transação', async () => {
    const t = montar();
    await t.chamar('POST', '/empresas', { corpo: { slug: 'outra', nome: 'Outra' } });
    await t.chamar('PUT', '/empresas/:id/situacao', { corpo: { situacao: 'suspenso', motivo: 'teste' } });
    expect(t.auditadas).toEqual([]);
  });
});

describe('T-0101: ficha da Receita e Revelar contato (ADR 0012, emenda da ficha)', () => {
  const consultaOk: ConsultaReceita = { consultar: async () => SUGESTAO_OK };
  const SEM_CACHE = { 'cache-control': 'no-store', pragma: 'no-cache' };
  const outroId = '00000000-0000-4000-8000-0000000000ff';

  describe('POST /empresas/:id/receita', () => {
    it('RF-CAD-02: consulta pelo CNPJ da empresa, grava a ficha mapeada e devolve só nomes de campo e a ficha mascarada, com no-store', async () => {
      const visto: string[] = [];
      const t = montar(undefined, { consulta: { consultar: async (_tx, tenant, cnpj) => { visto.push(tenant, cnpj); return SUGESTAO_OK; } } });
      const r = (await t.chamar('POST', '/empresas/:id/receita')) as { corpo: unknown; cabecalhos: unknown };
      expect(visto).toEqual([EMPRESA, CNPJ]);
      expect(t.gravadas[0]).toMatchObject({ razao_social: 'EMPRESA NOVA LTDA', cnae_principal: '4711302', regime_receita: 'simples', email: 'contato@nova.com.br', telefone: '9232221234', fonte: 'brasilapi' });
      expect(r.corpo).toMatchObject({ estado: 'ok', campos_alterados: ['nome_fantasia'], ficha: { email_mascarado: 'co****@teste.com.br' } });
      expect(r.cabecalhos).toEqual(SEM_CACHE);
      expect(JSON.stringify(r.corpo)).not.toContain('contato@nova.com.br');
      expect(t.plugin.rotas.find((x) => x.caminho === '/empresas/:id/receita')?.idempotencia).toBeUndefined();
    });

    it('RF-CAD-02: a falha da fonte volta como erro tratado, não grava e devolve a ficha anterior', async () => {
      const t = montar(undefined, { consulta: { consultar: async () => ({ ok: false, motivo: 'fonte_indisponivel' }) } });
      const r = (await t.chamar('POST', '/empresas/:id/receita')) as { corpo: unknown; cabecalhos: unknown };
      expect(r.corpo).toMatchObject({ estado: 'erro', motivo: 'fonte_indisponivel', ficha: FICHA_ANTES });
      expect(r.cabecalhos).toEqual(SEM_CACHE);
      expect(t.chamadas).not.toContain('gravar');
    });

    it('RF-CAD-02: CNPJ da empresa inválido para a fonte volta como cnpj_invalido, com texto de ação, sem gravar', async () => {
      const t = montar(undefined, { consulta: { consultar: async () => ({ ok: false, motivo: 'cnpj_invalido' }) } });
      const r = (await t.chamar('POST', '/empresas/:id/receita')) as { corpo: { motivo: string; mensagem: string } };
      expect(r.corpo).toMatchObject({ estado: 'erro', motivo: 'cnpj_invalido', mensagem: 'O CNPJ desta empresa é inválido. Ele veio da filial padrão: corrija o CNPJ da empresa pelo operador antes de atualizar pela Receita.' });
      expect(t.chamadas).not.toContain('gravar');
    });

    it('RF-CAD-02: resposta de outro CNPJ não grava', async () => {
      const t = montar(undefined, { consulta: { consultar: async () => ({ ...SUGESTAO_OK, sugestao: { ...SUGESTAO_OK.sugestao, cnpj: '04252011000110' } }) } });
      expect((await t.chamar('POST', '/empresas/:id/receita')) as { corpo: unknown }).toMatchObject({ corpo: { estado: 'erro', motivo: 'cnpj_divergente' } });
      expect(t.chamadas).not.toContain('gravar');
    });

    it('RN-CORE-14: razão social de 151 caracteres responde 422, não grava e a mensagem não leva o valor', async () => {
      const longa = 'R'.repeat(151);
      const t = montar(undefined, { consulta: { consultar: async () => ({ ...SUGESTAO_OK, sugestao: { ...SUGESTAO_OK.sugestao, razao_social: longa } }) } });
      const e = await t.erro(t.chamar('POST', '/empresas/:id/receita'));
      expect(e.status).toBe(422);
      expect(JSON.stringify([e.message, e.campos])).not.toContain('RRRR');
      expect(t.chamadas).not.toContain('gravar');
    });

    it('erro de banco relançado pela porta é erro interno: não vira falha da fonte e nada é gravado', async () => {
      const t = montar(undefined, { consulta: { consultar: async () => { throw Object.assign(new Error('banco'), { code: '25P02' }); } } });
      const e = await t.chamar('POST', '/empresas/:id/receita').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(ErroApi);
      expect(t.chamadas).not.toContain('gravar');
    });

    it('404 para empresa inexistente e 400 para id que não é UUID', async () => {
      const t = montar(undefined, { consulta: consultaOk });
      expect((await t.erro(t.chamar('POST', '/empresas/:id/receita', { params: { id: outroId } }))).status).toBe(404);
      expect((await t.erro(t.chamar('POST', '/empresas/:id/receita', { params: { id: 'x' } }))).status).toBe(400);
    });

    it('409 quando a empresa não tem core.empresa (sem ficha) e 503 sem a porta de consulta', async () => {
      const sem = montar(undefined, { consulta: consultaOk, ficha: null });
      expect((await sem.erro(sem.chamar('POST', '/empresas/:id/receita'))).status).toBe(409);
      expect(sem.chamadas).not.toContain('gravar');
      const semPorta = montar();
      expect((await semPorta.erro(semPorta.chamar('POST', '/empresas/:id/receita'))).status).toBe(503);
    });

    it('LGPD: a rota não chama auditar (o banco audita só nomes de campo) e a mensagem de erro não leva valor', async () => {
      const t = montar(undefined, { consulta: { consultar: async () => ({ ok: false, motivo: 'nao_encontrado' }) } });
      const r = (await t.chamar('POST', '/empresas/:id/receita')) as { corpo: { mensagem: string } };
      expect(t.auditadas).toEqual([]);
      expect(r.corpo.mensagem).not.toContain(CNPJ);
    });
  });

  describe('POST /empresas/:id/contato/:campo', () => {
    it.each(['email', 'telefone'] as const)('revela o %s com no-store e sem idempotência', async (campo) => {
      const t = montar(undefined, { valor: campo === 'email' ? 'contato@teste.com.br' : '9232221234' });
      const r = await t.chamar('POST', '/empresas/:id/contato/:campo', { params: { id: EMPRESA, campo } });
      expect(r).toEqual({ corpo: { valor: campo === 'email' ? 'contato@teste.com.br' : '9232221234' }, cabecalhos: SEM_CACHE });
      expect(t.chamadas).toEqual([`revelar:${campo}`]);
      expect(t.auditadas).toEqual([]);
      expect(t.plugin.rotas.find((x) => x.caminho === '/empresas/:id/contato/:campo')?.idempotencia).toBeUndefined();
    });

    it('só email ou telefone: outro campo é 400 e nada é revelado', async () => {
      const t = montar();
      const e = await t.erro(t.chamar('POST', '/empresas/:id/contato/:campo', { params: { id: EMPRESA, campo: 'razao_social' } }));
      expect(e.status).toBe(400);
      expect(t.chamadas).toEqual([]);
    });

    it('sem o dado na ficha responde valor nulo sem chamar o banco (nada revelado, nada auditado)', async () => {
      const t = montar(undefined, { ficha: { ...FICHA_ANTES, email_mascarado: null } });
      const r = await t.chamar('POST', '/empresas/:id/contato/:campo', { params: { id: EMPRESA, campo: 'email' } });
      expect(r).toMatchObject({ corpo: { valor: null } });
      expect(t.chamadas).toEqual([]);
    });

    it('404 para empresa inexistente e 409 sem core.empresa', async () => {
      const t = montar();
      expect((await t.erro(t.chamar('POST', '/empresas/:id/contato/:campo', { params: { id: outroId, campo: 'email' } }))).status).toBe(404);
      const sem = montar(undefined, { ficha: null });
      expect((await sem.erro(sem.chamar('POST', '/empresas/:id/contato/:campo', { params: { id: EMPRESA, campo: 'email' } }))).status).toBe(409);
    });
  });
});
