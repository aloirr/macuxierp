/**
 * Plugin de plataforma da Integração FDV (ADR 0013; T-0056) com o repositório dublê: as regras do domain, a cifra com a
 * empresa alvo no AAD, os erros do banco e a chave que nunca sai. O banco de verdade fica em `plataforma.db.test.ts`.
 */
import { CAMINHOS_INTEGRACAO_FDV_PLATAFORMA, ENTIDADES_ENVIO_FDV, decifrarCampo, type ContextoPlataforma, type PluginPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarPluginPlataformaIntegracaoFdv, type EstadoPortal, type RepositorioPortalIntegracaoFdv } from './plataforma';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CRED = '22222222-2222-4222-8222-222222222222';
const MESTRA = Buffer.alloc(32, 5);
const CHAVE = 'chave-do-conector-0123456789abcdef-NAO-VAZAR';
const AGORA = '2026-11-23T10:00:00.000Z';

const estado = (o: Partial<EstadoPortal> = {}, comCredencial = true, habilitadas: string[] = ['filial', 'produto']): EstadoPortal => ({
  empresa_id: TENANT,
  modulo_licenciado: true,
  credencial: comCredencial ? { id: CRED, conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'chave-do', criada_em: AGORA, ultimo_uso_em: null } : null,
  entidades_habilitadas: comCredencial ? (habilitadas as EstadoPortal['entidades_habilitadas']) : [],
  limite_registros_lote: comCredencial ? 5000 : null,
  sinal: null,
  cadastros: ENTIDADES_ENVIO_FDV.map((entidade) => ({
    entidade,
    pausada_motivo: null, lote_em_voo: false, ultimo_envio_em: null, ultimo_lote: null, erros_abertos: 0,
  })),
  ...o,
});

function dubleDoRepo(lido: EstadoPortal) {
  const chamadas: { fn: string; p: Record<string, unknown> }[] = [];
  const repo: RepositorioPortalIntegracaoFdv = {
    async ler() { chamadas.push({ fn: 'ler', p: {} }); return lido; },
    async definirCredencial(_tx, p) { chamadas.push({ fn: 'definirCredencial', p }); return estado(); },
    async configurar(_tx, p) { chamadas.push({ fn: 'configurar', p }); return estado(); },
    async testar(_tx, p) { chamadas.push({ fn: 'testar', p }); return new Date(AGORA); },
    async cargaCompleta(_tx, p) { chamadas.push({ fn: 'cargaCompleta', p }); },
    async retomar(_tx, p) { chamadas.push({ fn: 'retomar', p }); return { retomada: true }; },
  };
  return { repo, chamadas, escritas: () => chamadas.filter((c) => c.fn !== 'ler') };
}

const ctx = (): ContextoPlataforma => ({
  sessao: { superadmin_id: 'a', sessao_id: 'b' }, tx: { consultar: async () => [] } as Transacao, request_id: 'req-1', agora: new Date(AGORA), auditar: async () => {},
});
const chamar = (plugin: PluginPlataforma, metodo: string, modelo: string, o: { corpo?: unknown; params?: Record<string, string> } = {}) => {
  const r = plugin.rotas.find((x) => x.metodo === metodo && x.caminho === modelo);
  if (!r) throw new Error(`sem rota ${metodo} ${modelo}`);
  const corpo = r.corpo ? r.corpo.parse(o.corpo) : undefined;
  return r.executar(ctx(), { corpo, params: { id: TENANT, ...o.params } } as never);
};
const C = CAMINHOS_INTEGRACAO_FDV_PLATAFORMA;
const ENTRADA = { conector_id: 'erp-1', chave: CHAVE, ambiente: 'teste' };

describe('plugin de plataforma da Integração FDV (T-0056)', () => {
  it('ADR 0013 seção 2: declara as 6 rotas com as ações ver, configurar e operar', () => {
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(estado()).repo });
    expect(p.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.idempotencia ?? '-'}`).sort()).toEqual([
      `GET ${C.ler} plataforma.integracao_fdv.ver -`,
      `PUT ${C.credencial} plataforma.integracao_fdv.configurar -`,
      `POST ${C.testar} plataforma.integracao_fdv.configurar opcional`,
      `PUT ${C.configuracao} plataforma.integracao_fdv.configurar opcional`,
      `POST ${C.cargaCompleta} plataforma.integracao_fdv.operar obrigatoria`,
      `POST ${C.retomar} plataforma.integracao_fdv.operar opcional`,
    ].sort());
  });

  it('a chave mestra é validada na montagem (32 bytes) e o erro não cita o valor', () => {
    expect(() => criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: Buffer.alloc(31, 9) })).toThrow('32 bytes');
    expect(() => criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: null }).rotas).not.toThrow();
  });

  it('GET: devolve o portal_ler no formato IntegracaoFdvPlataforma, com a falha pela precedência do SDK e o sinal em ultimo_sinal', async () => {
    const lido = estado({ sinal: { ultimo_envio_em: AGORA, ultimo_aceito_em: AGORA, ultimo_http: 200, parado_por_versao: false } });
    lido.cadastros[0] = { ...lido.cadastros[0]!, pausada_motivo: 'credencial', ultimo_envio_em: AGORA };
    lido.cadastros[4] = { ...lido.cadastros[4]!, ultimo_lote: { estado: 'falhou', erro_codigo: 'rede', em: AGORA } };
    const r = await chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(lido).repo }), 'GET', C.ler);
    const corpo = r.corpo as { credencial_id: string; cadastros: { entidade: string; ligada: boolean; falha: unknown; lote_em_voo: boolean }[]; ultimo_sinal: unknown };
    expect(corpo).toMatchObject({ credencial_id: CRED, conector_id: 'erp-1', chave_prefixo: 'chave-do', ultimo_sinal: { ultimo_http: 200 } });
    expect(corpo.cadastros[0]).toMatchObject({ entidade: 'filial', ligada: true, falha: { motivo: 'credencial', acao: 'corrigir_credencial' }, lote_em_voo: false });
    expect(corpo.cadastros[4]).toMatchObject({ entidade: 'produto', falha: { motivo: 'lote_falhou', acao: 'aguardar_retentativa' } });
    expect(JSON.stringify(corpo)).not.toContain('politica_versao');
  });

  it('RF-INF-05: sem a chave mestra, o PUT /credencial é 503 CHAVE_INTEGRACAO_AUSENTE e nada é chamado; o GET segue', async () => {
    const d = dubleDoRepo(estado());
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: null, repo: d.repo });
    await expect(chamar(p, 'PUT', C.credencial, { corpo: ENTRADA })).rejects.toMatchObject({ status: 503, codigo: 'CHAVE_INTEGRACAO_AUSENTE' });
    expect(d.chamadas).toHaveLength(0);
    await expect(chamar(p, 'GET', C.ler)).resolves.toBeDefined();
  });

  it('RN-CORE-02: módulo não licenciado dá 422 em toda escrita e nada é gravado', async () => {
    const d = dubleDoRepo(estado({ modulo_licenciado: false }));
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    const tentativas = [
      chamar(p, 'PUT', C.credencial, { corpo: ENTRADA }),
      chamar(p, 'POST', C.testar),
      chamar(p, 'PUT', C.configuracao, { corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 10 } }),
      chamar(p, 'POST', C.cargaCompleta, { params: { entidade: 'filial' } }),
      chamar(p, 'POST', C.retomar, { params: { entidade: 'filial' } }),
    ];
    for (const t of tentativas) await expect(t).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-02', message: 'Ligue o módulo Integração FDV na empresa antes de configurar', detalhes: { codigo: 'modulo_desligado' } });
    expect(d.escritas()).toHaveLength(0);
  });

  it('RF-INF-05: a primeira credencial dá 201, cifra com o AAD da empresa alvo, manda só o prefixo e pede a carga inicial', async () => {
    const d = dubleDoRepo(estado({}, false));
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, chaveVersao: 3, repo: d.repo });
    const r = await chamar(p, 'PUT', C.credencial, { corpo: ENTRADA });
    expect(r.status).toBe(201);
    const [w] = d.escritas();
    const par = w!.p as { anterior_id: null; chave_cifrada: Buffer; chave_prefixo: string; chave_mestra_versao: number; zerar_espelho: boolean; evento_carga_inicial: { entidades: string[] } };
    expect(par).toMatchObject({ anterior_id: null, chave_prefixo: 'chave-do', chave_mestra_versao: 3, zerar_espelho: false });
    expect(par.evento_carga_inicial.entidades).toHaveLength(12);
    expect(decifrarCampo({ chave: MESTRA, tenantId: TENANT, cifrado: par.chave_cifrada }).toString('utf8')).toBe(CHAVE);
    expect(() => decifrarCampo({ chave: MESTRA, tenantId: '33333333-3333-4333-8333-333333333333', cifrado: par.chave_cifrada })).toThrow();
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('RF-INF-05: trocar só a chave dá 200, sem zerar o espelho nem pedir carga; outro conector zera e pede', async () => {
    const d = dubleDoRepo(estado());
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    expect((await chamar(p, 'PUT', C.credencial, { corpo: ENTRADA })).status).toBe(200);
    expect(d.escritas()[0]!.p).toMatchObject({ anterior_id: CRED, zerar_espelho: false, evento_carga_inicial: null });
    expect((await chamar(p, 'PUT', C.credencial, { corpo: { ...ENTRADA, conector_id: 'outro' } })).status).toBe(200);
    expect(d.escritas()[1]!.p).toMatchObject({ anterior_id: CRED, zerar_espelho: true });
    expect((d.escritas()[1]!.p as { evento_carga_inicial: unknown }).evento_carga_inicial).not.toBeNull();
  });

  it('RF-INF-05: o erro de validação da chave não devolve o valor (campo e mensagem fixa)', () => {
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(estado()).repo });
    try {
      void chamar(p, 'PUT', C.credencial, { corpo: { ...ENTRADA, chave: 'curta com espaco' } });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('curta com espaco');
    }
  });

  it('RF-INF-05: testar responde 202 com pedido_em; sem credencial é 409', async () => {
    const d = dubleDoRepo(estado());
    const r = await chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo }), 'POST', C.testar);
    expect(r).toMatchObject({ status: 202, corpo: { aceito: true, pedido_em: AGORA } });
    await expect(chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(estado({}, false)).repo }), 'POST', C.testar)).rejects.toMatchObject({ status: 409 });
  });

  it('RN-INF-02: a configuração é validada pelo domain antes da função (repetido e limite fora são recusados, a função não é chamada)', async () => {
    const d = dubleDoRepo(estado());
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    expect(() => chamar(p, 'PUT', C.configuracao, { corpo: { entidades_habilitadas: ['filial', 'filial'], limite_registros_lote: 10 } })).toThrow();
    expect(() => chamar(p, 'PUT', C.configuracao, { corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 5001 } })).toThrow();
    expect(d.chamadas).toHaveLength(0);
    const r = await chamar(p, 'PUT', C.configuracao, { corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 10 } });
    expect(r.status).toBeUndefined();
    expect(d.escritas()[0]!.p).toMatchObject({ entidades: ['filial'], limite: 10, request_id: 'req-1' });
  });

  it('RN-INF-02: carga completa recusa entidade desabilitada (422 RN-INF-02), lote em voo (409), sem credencial (409) e entidade desconhecida (400)', async () => {
    const mk = (e: EstadoPortal) => {
      const d = dubleDoRepo(e);
      return { d, p: criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo }) };
    };
    const a = mk(estado());
    await expect(chamar(a.p, 'POST', C.cargaCompleta, { params: { entidade: 'cliente' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-INF-02', detalhes: { codigo: 'entidade_desabilitada' } });
    const emVoo = estado();
    emVoo.cadastros[0] = { ...emVoo.cadastros[0]!, lote_em_voo: true };
    const b = mk(emVoo);
    await expect(chamar(b.p, 'POST', C.cargaCompleta, { params: { entidade: 'filial' } })).rejects.toMatchObject({ status: 409 });
    const c = mk(estado({}, false));
    await expect(chamar(c.p, 'POST', C.cargaCompleta, { params: { entidade: 'filial' } })).rejects.toMatchObject({ status: 409, message: 'Cadastre a credencial do FDV antes' });
    await expect(chamar(a.p, 'POST', C.cargaCompleta, { params: { entidade: 'tabela_preco' } })).rejects.toMatchObject({ status: 400 });
    for (const x of [a, b, c]) expect(x.d.escritas()).toHaveLength(0);
  });

  it('RN-INF-02: carga completa de cadastro habilitado, sem lote em voo, responde 202 e chama a função', async () => {
    const d = dubleDoRepo(estado());
    const r = await chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo }), 'POST', C.cargaCompleta, { params: { entidade: 'produto' } });
    expect(r).toMatchObject({ status: 202, corpo: { aceito: true } });
    expect(d.escritas()).toEqual([{ fn: 'cargaCompleta', p: { tenant: TENANT, entidade: 'produto', request_id: 'req-1' } }]);
  });

  it('RN-INF-04: retomar sem pausa responde 200 { retomada: false } sem chamar a função; com pausa chama portal_retomar', async () => {
    const d = dubleDoRepo(estado());
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    expect(await chamar(p, 'POST', C.retomar, { params: { entidade: 'filial' } })).toEqual({ corpo: { retomada: false } });
    expect(d.escritas()).toHaveLength(0);
    const pausada = estado();
    pausada.cadastros[0] = { ...pausada.cadastros[0]!, pausada_motivo: 'envelope' };
    const d2 = dubleDoRepo(pausada);
    const r = await chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d2.repo }), 'POST', C.retomar, { params: { entidade: 'filial' } });
    expect(r).toEqual({ corpo: { retomada: true } });
    expect(d2.escritas()).toHaveLength(1);
  });

  it('erros do banco sobem crus (o mapa 404/422/409 é do erroDaPlataforma da apps/api); ligada é derivada do SDK', async () => {
    const com = (e: unknown) => {
      const d = dubleDoRepo(estado());
      d.repo.cargaCompleta = async () => { throw e; };
      return criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    };
    const erroPg = (code: string, message: string) => Object.assign(new Error(message), { code });
    const args = { params: { entidade: 'filial' } };
    for (const e of [erroPg('P0002', 'empresa não encontrada'), erroPg('23514', 'empresa fora de ativo'), erroPg('MXI03', 'o estado mudou; recarregue')]) {
      await expect(chamar(com(e), 'POST', C.cargaCompleta, args)).rejects.toBe(e);
    }
    const naoLido = dubleDoRepo(estado());
    const p0002 = erroPg('P0002', 'empresa não encontrada');
    naoLido.repo.ler = async () => { throw p0002; };
    await expect(chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: naoLido.repo }), 'GET', C.ler)).rejects.toBe(p0002);
  });

  it('o :id inválido é 400', async () => {
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(estado()).repo });
    await expect(chamar(p, 'GET', C.ler, { params: { id: 'nao-uuid' } })).rejects.toMatchObject({ status: 400 });
  });
});
