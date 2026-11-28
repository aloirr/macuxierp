/**
 * Plugin de plataforma da Integração FDV (ADR 0013; T-0056) com o repositório dublê: as regras do domain, a cifra com a
 * empresa alvo no AAD, os erros do banco e a chave que nunca sai. O banco de verdade fica em `plataforma.db.test.ts`.
 */
import { CAMINHOS_INTEGRACAO_FDV_PLATAFORMA, MENSAGEM_SEM_CREDENCIAL_FDV, ENTIDADES_ENVIO_FDV, decifrarCampo, type ContextoPlataforma, type PluginPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MSG_SEM_LICENCA } from '../contracts';
import { criarPluginPlataformaIntegracaoFdv, type EstadoPortal, type InsumosLigacoesPortal, type InsumosLogPortal, type InsumosMonitorPortal, type RepositorioPortalIntegracaoFdv } from './plataforma';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CRED = '22222222-2222-4222-8222-222222222222';
const MESTRA = Buffer.alloc(32, 5);
const CHAVE = 'chave-do-conector-0123456789abcdef-NAO-VAZAR';
const AGORA = '2026-11-23T10:00:00.000Z';

const estado = (o: Partial<EstadoPortal> = {}, comCredencial = true, habilitadas: string[] = ['filial', 'produto']): EstadoPortal => ({
  empresa_id: TENANT,
  modulo_licenciado: true,
  credencial: comCredencial ? { id: CRED, conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'chave-do', criada_em: AGORA } : null,
  entidades_habilitadas: comCredencial ? (habilitadas as EstadoPortal['entidades_habilitadas']) : [],
  limite_registros_lote: comCredencial ? 5000 : null,
  sinal: null,
  cadastros: ENTIDADES_ENVIO_FDV.map((entidade) => ({
    entidade,
    pausada_motivo: null, pausada_em: null, lote_em_voo: false, ultimo_envio_em: null, ultimo_lote: null, erros_abertos: 0,
  })),
  ...o,
});

const monitorBruto: InsumosMonitorPortal = { credencial_ativa: true, conector_id: 'erp-1', habilitadas: 2, ultimo_sinal_aceito_em: AGORA, fila: { lotes: 1, linhas: 40 } };
const ligacoesBruto = (o: Partial<InsumosLigacoesPortal['contato']> = {}): InsumosLigacoesPortal => ({
  contato: { credencial_ativa: true, conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'chave-do', habilitadas: 2, ultimo_contato_em: AGORA, ...o },
  contadores: { enviados: 150, aceitos: 145 },
  envios: [{ id: CRED, entidade: 'produto', estado: 'concluido_com_erros', registros: 50, aceitos: 45, com_erro: 5, enviado_em: AGORA, concluido_em: AGORA }],
  envios_cortados: false,
});
let ligacoesLido: InsumosLigacoesPortal = ligacoesBruto();
let logBruto: InsumosLogPortal = { envios: [], erros: [], total_erros: 0, pausada_motivo: null };

function dubleDoRepo(lido: EstadoPortal) {
  const chamadas: { fn: string; p: Record<string, unknown> }[] = [];
  const repo: RepositorioPortalIntegracaoFdv = {
    async ler() { chamadas.push({ fn: 'ler', p: {} }); return lido; },
    async definirCredencial(_tx, p) { chamadas.push({ fn: 'definirCredencial', p }); return estado(); },
    async configurar(_tx, p) { chamadas.push({ fn: 'configurar', p }); return estado(); },
    async testar(_tx, p) { chamadas.push({ fn: 'testar', p }); return new Date(AGORA); },
    async cargaCompleta(_tx, p) { chamadas.push({ fn: 'cargaCompleta', p }); },
    async retomar(_tx, p) { chamadas.push({ fn: 'retomar', p }); return { retomada: true }; },
    async monitor() { chamadas.push({ fn: 'monitor', p: {} }); return monitorBruto; },
    async ligacoes(_tx, tenant) { chamadas.push({ fn: 'ligacoes', p: { tenant } }); return ligacoesLido; },
    async log(_tx, p) { chamadas.push({ fn: 'log', p }); return logBruto; },
    async reprocessar(_tx, p) { chamadas.push({ fn: 'reprocessar', p }); return { falhas: 2, pendentes: 3, pedido_em: new Date(AGORA) }; },
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
const LIGACOES = '/empresas/:id/integracao-fdv/ligacoes';
const ENTRADA = { conector_id: 'erp-1', chave: CHAVE, ambiente: 'teste' };

describe('plugin de plataforma da Integração FDV (T-0056)', () => {
  it('ADR 0013 seção 2: declara as 10 rotas com as ações ver, configurar e operar (T-0086: monitor, log, reprocessar e ligações)', () => {
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(estado()).repo });
    expect(p.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.idempotencia ?? '-'}`).sort()).toEqual([
      `GET ${C.ler} plataforma.integracao_fdv.ver -`,
      `PUT ${C.credencial} plataforma.integracao_fdv.configurar -`,
      `POST ${C.testar} plataforma.integracao_fdv.configurar opcional`,
      `PUT ${C.configuracao} plataforma.integracao_fdv.configurar opcional`,
      `POST ${C.cargaCompleta} plataforma.integracao_fdv.operar obrigatoria`,
      `POST ${C.retomar} plataforma.integracao_fdv.operar opcional`,
      `GET ${C.monitor} plataforma.integracao_fdv.ver -`,
      `GET ${C.log} plataforma.integracao_fdv.ver -`,
      `POST ${C.reprocessar} plataforma.integracao_fdv.operar obrigatoria`,
      `GET ${LIGACOES} plataforma.integracao_fdv.ver -`,
    ].sort());
  });

  it('a chave mestra é validada na montagem (32 bytes) e o erro não cita o valor', () => {
    expect(() => criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: Buffer.alloc(31, 9) })).toThrow('32 bytes');
    expect(() => criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: null }).rotas).not.toThrow();
  });

  it('GET: devolve o portal_ler no formato IntegracaoFdvPlataforma, com a falha pela precedência do SDK e o sinal em ultimo_sinal', async () => {
    const lido = estado({ sinal: { ultimo_envio_em: AGORA, ultimo_aceito_em: AGORA, ultimo_http: 200, parado_por_versao: false, ultimo_codigo: 'credencial_invalida' } });
    lido.cadastros[0] = { ...lido.cadastros[0]!, pausada_motivo: 'credencial', pausada_em: AGORA, ultimo_envio_em: AGORA };
    lido.cadastros[4] = { ...lido.cadastros[4]!, ultimo_lote: { estado: 'falhou', erro_codigo: 'rede', em: AGORA } };
    const r = await chamar(criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: dubleDoRepo(lido).repo }), 'GET', C.ler);
    const corpo = r.corpo as { credencial_id: string; cadastros: { entidade: string; ligada: boolean; falha: unknown; lote_em_voo: boolean }[]; ultimo_sinal: unknown };
    expect(corpo).toMatchObject({ credencial_id: CRED, conector_id: 'erp-1', chave_prefixo: 'chave-do', ultimo_sinal: { ultimo_http: 200, ultimo_codigo: 'credencial_invalida' } });
    expect(corpo.cadastros[0]).toMatchObject({ entidade: 'filial', ligada: true, proxima_tentativa_em: '2026-11-23T10:30:00.000Z', falha: { motivo: 'credencial', acao: 'corrigir_credencial' }, lote_em_voo: false });
    expect(corpo.cadastros[4]).toMatchObject({ entidade: 'produto', falha: { motivo: 'lote_falhou', acao: 'aguardar_retentativa' }, proxima_tentativa_em: null });
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
    for (const t of tentativas) await expect(t).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-02', message: MSG_SEM_LICENCA, detalhes: { codigo: 'modulo_desligado' } });
    expect(d.escritas()).toHaveLength(0);
  });

  it('RF-INF-05: a primeira credencial dá 201, cifra com o AAD da empresa alvo, manda só o prefixo, nasce sem cadastros ligados e sem carga inicial', async () => {
    const d = dubleDoRepo(estado({}, false));
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, chaveVersao: 3, repo: d.repo });
    const r = await chamar(p, 'PUT', C.credencial, { corpo: ENTRADA });
    expect(r.status).toBe(201);
    const [w] = d.escritas();
    const par = w!.p as { anterior_id: null; chave_cifrada: Buffer; chave_prefixo: string; chave_mestra_versao: number; zerar_espelho: boolean; evento_carga_inicial: unknown; entidades: string[] };
    expect(par).toMatchObject({ anterior_id: null, chave_prefixo: 'chave-do', chave_mestra_versao: 3, zerar_espelho: false });
    expect(par.entidades).toEqual([]);
    expect(par.evento_carga_inicial).toBeNull();
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
    // a troca copia a lista da ativa (lista explícita) e o evento chega ao repo
    expect(d.escritas()[1]!.p).toMatchObject({ entidades: ['filial', 'produto'], evento_carga_inicial: expect.anything() });
  });

  it('RF-INF-05: outro conector sem nenhum cadastro ligado zera o espelho e não publica evento', async () => {
    const d = dubleDoRepo(estado({}, true, []));
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    await chamar(p, 'PUT', C.credencial, { corpo: { ...ENTRADA, ambiente: 'producao' } });
    expect(d.escritas()[0]!.p).toMatchObject({ zerar_espelho: true, evento_carga_inicial: null });
  });

  it('RF-INF-05: ligar um cadastro manda o evento ao repo; sem novas ligadas, sem evento', async () => {
    const d = dubleDoRepo(estado());
    const p = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo });
    await chamar(p, 'PUT', C.configuracao, { corpo: { entidades_habilitadas: ['filial', 'produto', 'preco'], limite_registros_lote: 10 } });
    await chamar(p, 'PUT', C.configuracao, { corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 10 } });
    expect(d.escritas()[0]!.p).toMatchObject({ evento_carga_inicial: expect.anything() });
    expect(d.escritas()[1]!.p).toMatchObject({ evento_carga_inicial: null });
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
    expect(d.escritas()[0]!.p).toMatchObject({ entidades: ['filial'], limite: 10, request_id: 'req-1', antes: estado().entidades_habilitadas });
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
    await expect(chamar(c.p, 'POST', C.cargaCompleta, { params: { entidade: 'filial' } })).rejects.toMatchObject({ status: 409, message: MENSAGEM_SEM_CREDENCIAL_FDV });
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

  describe('T-0086: Monitor, Log e Reprocessar', () => {
    const plugin = (lido = estado()) => {
      const d = dubleDoRepo(lido);
      return { d, p: criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo }) };
    };

    it('licença: sem o módulo, as três rotas dão 422 RN-CORE-02 e nada é lido nem gravado', async () => {
      const { d, p } = plugin(estado({ modulo_licenciado: false }));
      for (const t of [chamar(p, 'GET', C.monitor), chamar(p, 'GET', C.log, { params: { entidade: 'produto' } }), chamar(p, 'POST', C.reprocessar, { params: { entidade: 'produto' } })]) {
        await expect(t).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-02', detalhes: { codigo: 'modulo_desligado' } });
      }
      expect(d.chamadas.map((c) => c.fn)).toEqual(['ler', 'ler', 'ler']);
    });

    it('tenant: as funções do portal recebem a empresa ALVO da rota (:id), e o :id inválido é 400 sem ler nada', async () => {
      const { d, p } = plugin();
      await chamar(p, 'GET', C.log, { params: { entidade: 'produto' } });
      await chamar(p, 'POST', C.reprocessar, { params: { entidade: 'produto' } });
      expect(d.chamadas.filter((c) => c.fn === 'log' || c.fn === 'reprocessar').map((c) => c.p.tenant)).toEqual([TENANT, TENANT]);
      for (const t of [chamar(p, 'GET', C.monitor, { params: { id: 'nao-e-uuid' } }), chamar(p, 'GET', C.log, { params: { id: 'x', entidade: 'produto' } })]) {
        await expect(t).rejects.toMatchObject({ status: 400 });
      }
      await expect(chamar(p, 'GET', C.log, { params: { entidade: 'titulo' } })).rejects.toMatchObject({ status: 400 });
    });

    it('perfil: Monitor e Log pedem `ver`, o Reprocessar pede `operar` com Idempotency-Key obrigatória', () => {
      const { p } = plugin();
      const r = (c: string) => p.rotas.find((x) => x.caminho === c)!;
      expect([r(C.monitor).acao, r(C.log).acao, r(C.reprocessar).acao]).toEqual(['plataforma.integracao_fdv.ver', 'plataforma.integracao_fdv.ver', 'plataforma.integracao_fdv.operar']);
      expect(r(C.reprocessar).idempotencia).toBe('obrigatoria');
    });

    it('Monitor: monta identificador, situação, versão e fila a partir dos insumos', async () => {
      const { p } = plugin();
      const r = await chamar(p, 'GET', C.monitor);
      expect(r.corpo).toMatchObject({ identificador: 'erp-1', situacao: 'em_dia', ultimo_sinal_em: AGORA, fila: { lotes: 1, linhas: 40 }, lido_em: AGORA });
    });

    it('ADR 0013: o Log do /config FALHA se trouxer nome, documento ou external_id, mesmo que o repositório os devolva', async () => {
      logBruto = {
        envios: [{ em: AGORA, estado: 'concluido_com_erros', registros: 2, com_erro: 2, origem: 'zerar' }],
        // um repositório mal feito (ou uma função do banco com defeito) que vaza o registro: o parse descarta
        erros: [
          { codigo: 'campo_invalido', campo: 'cnpj', quantidade: 2, registro_external_id: 'C000123', nome_curto: 'Mercado Silva LTDA', payload: { cnpj: '12345678000195', cpf: '12345678909' } },
        ] as never,
        total_erros: 2,
        pausada_motivo: null,
      };
      const { p } = plugin();
      const r = await chamar(p, 'GET', C.log, { params: { entidade: 'cliente' } });
      const texto = JSON.stringify(r.corpo);
      for (const proibido of ['Mercado Silva', '12345678000195', '12345678909', 'C000123', 'registro_external_id', 'nome_curto', 'payload']) expect(texto, proibido).not.toContain(proibido);
      expect(texto).not.toMatch(/\b\d{11}\b|\b\d{14}\b|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
      expect(r.corpo).toMatchObject({
        entidade: 'cliente', total_erros: 2, motivo: 'erros_por_linha',
        erros: [{ codigo: 'campo_invalido', campo: 'cnpj', quantidade: 2 }],
        envios: [{ origem: 'zerar', situacao: 'com_erros', registros: 2, com_erro: 2 }],
      });
      logBruto = { envios: [], erros: [], total_erros: 0, pausada_motivo: null };
    });

    it('Log: a pausa do conector e o último lote definem o motivo (precedência do SDK)', async () => {
      logBruto = { envios: [{ em: AGORA, estado: 'falhou', registros: 1, com_erro: 0, origem: 'ciclo' }], erros: [], total_erros: 0, pausada_motivo: 'versao' };
      const { p } = plugin();
      expect((await chamar(p, 'GET', C.log, { params: { entidade: 'produto' } })).corpo).toMatchObject({ motivo: 'versao', envios: [{ situacao: 'falhou' }] });
      logBruto = { envios: [], erros: [], total_erros: 0, pausada_motivo: null };
    });

    it('Reprocessar: sem lote em voo chama a função e devolve as contagens; com lote em voo é 409 e nada é gravado; sem credencial é 409', async () => {
      const { d, p } = plugin();
      const r = await chamar(p, 'POST', C.reprocessar, { params: { entidade: 'produto' } });
      expect(r.corpo).toEqual({ entidade: 'produto', falhas: 2, pendentes: 3, pedido_em: AGORA });
      expect(d.escritas().map((c) => c.fn)).toEqual(['reprocessar']);

      const emVoo = estado();
      emVoo.cadastros = emVoo.cadastros.map((k) => (k.entidade === 'produto' ? { ...k, lote_em_voo: true } : k));
      const v = plugin(emVoo);
      await expect(chamar(v.p, 'POST', C.reprocessar, { params: { entidade: 'produto' } })).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO' });
      expect(v.d.escritas()).toHaveLength(0);

      const sem = plugin(estado({}, false));
      await expect(chamar(sem.p, 'POST', C.reprocessar, { params: { entidade: 'produto' } })).rejects.toMatchObject({ status: 409 });
      expect(sem.d.escritas()).toHaveLength(0);
    });
  });

  describe('T-0131: Ligação ERP → Macuxi FDV no /config', () => {
    const plugin = (lido = estado()) => {
      const d = dubleDoRepo(lido);
      return { d, p: criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, repo: d.repo }) };
    };

    it('RN-INF-13: devolve a saída no contrato, com a situação do Contato pelo SDK (em dia, atrasada e desativada)', async () => {
      const { p } = plugin();
      ligacoesLido = ligacoesBruto();
      expect((await chamar(p, 'GET', LIGACOES)).corpo).toEqual({
        saida: {
          contato: { conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'chave-do', situacao: 'em_dia', ultimo_contato_em: AGORA },
          contadores: { enviados: 150, aceitos: 145 },
          envios: ligacoesLido.envios,
          envios_cortados: false,
        },
      });
      ligacoesLido = ligacoesBruto({ ultimo_contato_em: null });
      expect(((await chamar(p, 'GET', LIGACOES)).corpo as { saida: { contato: { situacao: string } } }).saida.contato.situacao).toBe('atrasado');
      ligacoesLido = ligacoesBruto({ credencial_ativa: false, conector_id: null, ambiente: null, chave_prefixo: null, habilitadas: 0, ultimo_contato_em: null });
      expect(((await chamar(p, 'GET', LIGACOES)).corpo as { saida: { contato: unknown } }).saida.contato).toEqual({ conector_id: null, ambiente: null, chave_prefixo: null, situacao: 'desativado', ultimo_contato_em: null });
    });

    it('perfil, tenant e licença: pede `ver`, lê a empresa ALVO, :id inválido é 400 e sem o módulo é 422 RN-CORE-02', async () => {
      ligacoesLido = ligacoesBruto();
      const { d, p } = plugin();
      expect(p.rotas.find((x) => x.caminho === LIGACOES)!.acao).toBe('plataforma.integracao_fdv.ver');
      await chamar(p, 'GET', LIGACOES);
      expect(d.chamadas.find((c) => c.fn === 'ligacoes')!.p.tenant).toBe(TENANT);
      await expect(chamar(p, 'GET', LIGACOES, { params: { id: 'x' } })).rejects.toMatchObject({ status: 400 });
      const sem = plugin(estado({ modulo_licenciado: false }));
      await expect(chamar(sem.p, 'GET', LIGACOES)).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
      expect(sem.d.chamadas.map((c) => c.fn)).toEqual(['ler']);
    });
  });
});
