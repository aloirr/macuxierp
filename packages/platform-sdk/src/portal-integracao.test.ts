import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACOES_PLATAFORMA } from './plataforma-rotas';
import {
  ACAO_SUGERIDA_POR_MOTIVO_FDV,
  ACOES_FDV_SO_DO_PORTAL,
  AmbienteIntegracaoFdv,
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA,
  CadastroIntegracaoFdv,
  CadastroIntegracaoFdvPlataforma,
  ConfigurarIntegracaoPlataformaEntrada,
  DefinirCredencialPlataformaEntrada,
  ENTIDADES_ENVIO_FDV,
  FalhaEnvioFdv,
  IntegracaoFdvPlataforma,
  MOTIVOS_FALHA_ENVIO_FDV,
  MOTIVOS_PAUSA_FDV,
  LIMITE_REGISTROS_LOTE_FDV,
  PADRAO_CONECTOR_FDV,
  RespostaAceitoFdv,
  RespostaRetomadaFdv,
  RespostaTestarPlataforma,
  StatusIntegracaoFdvTenant,
  UltimoSinalFdv,
  falhaEnvioFdv,
  integracaoFdvLigada,
} from './portal-integracao';
import * as sdk from './index';

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const CRED = '22222222-2222-4222-8222-222222222222';
const AGORA = '2026-11-23T12:00:00.000Z';
const CHAVE = 'k'.repeat(40);

const cadastros = (ligadas: readonly string[]) =>
  ENTIDADES_ENVIO_FDV.map((entidade) => ({ entidade, ligada: ligadas.includes(entidade), ultimo_envio_em: null, falha: null }));
/** Cadastros do portal: os do BKO mais `lote_em_voo`. */
const cadastrosPortal = (ligadas: readonly string[], emVoo: readonly string[] = []) =>
  cadastros(ligadas).map((c) => ({ ...c, lote_em_voo: emVoo.includes(c.entidade) }));

const semCredencial = {
  empresa_id: EMPRESA,
  modulo_licenciado: true,
  credencial_id: null,
  conector_id: null,
  ambiente: null,
  chave_prefixo: null,
  criada_em: null,
  entidades_habilitadas: [],
  limite_registros_lote: null,
  cadastros: cadastrosPortal([]),
  ultimo_sinal: null,
};
const comCredencial = {
  ...semCredencial,
  credencial_id: CRED,
  conector_id: 'erp-am2808',
  ambiente: 'teste',
  chave_prefixo: 'kkkkkkkk',
  criada_em: AGORA,
  entidades_habilitadas: ['filial', 'produto'],
  limite_registros_lote: 500,
  cadastros: cadastrosPortal(['filial', 'produto'], ['produto']).map((c) =>
    c.entidade === 'produto' ? { ...c, ultimo_envio_em: AGORA, falha: { motivo: 'erros_por_linha', acao: 'corrigir_cadastros' } } : c,
  ),
  ultimo_sinal: { ultimo_envio_em: AGORA, ultimo_aceito_em: AGORA, ultimo_http: 200, parado_por_versao: false },
};

describe('contratos da Integração FDV no portal /config (ADR 0013, T-0056)', () => {
  it('as entidades e o teto do lote são os do Hub na F2 (RN-INF-02): 10 cadastros, 5.000 por lote', () => {
    expect(ENTIDADES_ENVIO_FDV).toHaveLength(10);
    expect(ENTIDADES_ENVIO_FDV).not.toContain('titulo');
    expect(ENTIDADES_ENVIO_FDV).not.toContain('nota');
    expect(LIMITE_REGISTROS_LOTE_FDV).toBe(5000);
  });

  it('o ambiente do contrato é o mesmo conjunto da porta do Hub', () => {
    expect(AmbienteIntegracaoFdv.safeParse('homologacao').success).toBe(false);
  });

  const sql0007 = readFileSync(new URL('../../../db/migrations/0007_integracao_fdv.sql', import.meta.url), 'utf8');

  it('PADRAO_CONECTOR_FDV é a mesma regex do CHECK de integracao_fdv.credencial.conector_id (0007)', () => {
    const m = /conector_id text NOT NULL CHECK \(conector_id ~ '([^']+)'\)/.exec(sql0007);
    expect(m, 'CHECK do conector_id não encontrado em 0007_integracao_fdv.sql').not.toBeNull();
    expect(PADRAO_CONECTOR_FDV.source).toBe(m?.[1]);
  });

  it('MOTIVOS_PAUSA_FDV são os do CHECK de integracao_fdv.cursor_entidade.pausada_motivo (0007)', () => {
    const m = /pausada_motivo text CHECK \(pausada_motivo IN \(([^)]+)\)\)/.exec(sql0007);
    expect(m, 'CHECK do pausada_motivo não encontrado em 0007_integracao_fdv.sql').not.toBeNull();
    const doBanco = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(doBanco).toEqual([...MOTIVOS_PAUSA_FDV]);
  });

  describe('DefinirCredencialPlataformaEntrada (RF-INF-05)', () => {
    it('aceita conector, chave de 32 a 512 sem espaço e ambiente', () => {
      expect(DefinirCredencialPlataformaEntrada.parse({ conector_id: 'erp_1-a', chave: CHAVE, ambiente: 'producao' })).toEqual({ conector_id: 'erp_1-a', chave: CHAVE, ambiente: 'producao' });
    });
    it('recusa chave curta, longa ou com espaço e conector fora do padrão', () => {
      for (const corpo of [
        { conector_id: 'erp', chave: 'k'.repeat(31), ambiente: 'teste' },
        { conector_id: 'erp', chave: 'k'.repeat(513), ambiente: 'teste' },
        { conector_id: 'erp', chave: `${'k'.repeat(20)} ${'k'.repeat(20)}`, ambiente: 'teste' },
        { conector_id: 'erp com espaço', chave: CHAVE, ambiente: 'teste' },
        { conector_id: 'x'.repeat(65), chave: CHAVE, ambiente: 'teste' },
        { conector_id: 'erp', chave: CHAVE, ambiente: 'homologacao' },
      ]) {
        expect(DefinirCredencialPlataformaEntrada.safeParse(corpo).success).toBe(false);
      }
    });
    it('o erro de validação nunca ecoa a chave', () => {
      const segredo = `segredo-${'z'.repeat(20)} fim`;
      const r = DefinirCredencialPlataformaEntrada.safeParse({ conector_id: 'erp', chave: segredo, ambiente: 'teste' });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).not.toContain('segredo');
    });
  });

  describe('ConfigurarIntegracaoPlataformaEntrada (RN-INF-02)', () => {
    it('liga e desliga por cadastro; lista vazia desliga tudo', () => {
      expect(ConfigurarIntegracaoPlataformaEntrada.parse({ entidades_habilitadas: ['cliente', 'preco'], limite_registros_lote: 1 }).entidades_habilitadas).toEqual(['cliente', 'preco']);
      expect(ConfigurarIntegracaoPlataformaEntrada.parse({ entidades_habilitadas: [], limite_registros_lote: 5000 }).entidades_habilitadas).toEqual([]);
    });
    it('recusa cadastro fora da F2, repetido e limite fora de 1 a 5.000', () => {
      for (const corpo of [
        { entidades_habilitadas: ['titulo'], limite_registros_lote: 10 },
        { entidades_habilitadas: ['filial', 'filial'], limite_registros_lote: 10 },
        { entidades_habilitadas: ['filial'], limite_registros_lote: 0 },
        { entidades_habilitadas: ['filial'], limite_registros_lote: 5001 },
        { entidades_habilitadas: ['filial'], limite_registros_lote: 10.5 },
      ]) {
        expect(ConfigurarIntegracaoPlataformaEntrada.safeParse(corpo).success).toBe(false);
      }
    });
  });

  describe('IntegracaoFdvPlataforma', () => {
    it('aceita a empresa sem credencial e a com credencial; ligada é por cadastro', () => {
      expect(IntegracaoFdvPlataforma.parse(semCredencial).cadastros.every((c) => !c.ligada)).toBe(true);
      const r = IntegracaoFdvPlataforma.parse(comCredencial);
      expect(r.cadastros.filter((c) => c.ligada).map((c) => c.entidade)).toEqual(['filial', 'produto']);
      expect(r).not.toHaveProperty('ligado');
    });
    it('nunca leva a chave: campo a mais some no parse', () => {
      const r = IntegracaoFdvPlataforma.parse({ ...comCredencial, chave: CHAVE, chave_cifrada: 'x' });
      expect(r).not.toHaveProperty('chave');
      expect(r).not.toHaveProperty('chave_cifrada');
    });
    it('prefixo da chave com no máximo 8 caracteres', () => {
      expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, chave_prefixo: 'k'.repeat(9) }).success).toBe(false);
    });
    it('credencial pela metade, limite ou cadastros sem credencial são recusados', () => {
      expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, conector_id: null }).success).toBe(false);
      expect(IntegracaoFdvPlataforma.safeParse({ ...semCredencial, limite_registros_lote: 500 }).success).toBe(false);
      expect(IntegracaoFdvPlataforma.safeParse({ ...semCredencial, entidades_habilitadas: ['filial'] }).success).toBe(false);
    });
    it('ligada é por cadastro (PO, 23/11 12h43): credencial ativa e o cadastro habilitado', () => {
      expect(integracaoFdvLigada({ credencial_id: CRED, entidades_habilitadas: ['filial'] }, 'filial')).toBe(true);
      expect(integracaoFdvLigada({ credencial_id: CRED, entidades_habilitadas: ['filial'] }, 'produto')).toBe(false);
      expect(integracaoFdvLigada({ credencial_id: null, entidades_habilitadas: [] }, 'filial')).toBe(false);
      // ligada que não bate com a credencial e a lista de habilitados é recusada
      expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, entidades_habilitadas: ['filial'] }).success).toBe(false);
    });
    it('lote_em_voo por cadastro (do portal_ler): obrigatório e booleano', () => {
      const r = IntegracaoFdvPlataforma.parse(comCredencial);
      expect(r.cadastros.filter((c) => c.lote_em_voo).map((c) => c.entidade)).toEqual(['produto']);
      expect(IntegracaoFdvPlataforma.safeParse({ ...semCredencial, cadastros: cadastros([]) }).success).toBe(false);
      const errado = comCredencial.cadastros.map((c, i) => (i === 0 ? { ...c, lote_em_voo: 'sim' } : c));
      expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, cadastros: errado }).success).toBe(false);
    });
    it('cadastros: os 10 da F2, um por linha, na ordem de carga', () => {
      expect(IntegracaoFdvPlataforma.safeParse({ ...semCredencial, cadastros: cadastrosPortal([]).slice(1) }).success).toBe(false);
      expect(IntegracaoFdvPlataforma.safeParse({ ...semCredencial, cadastros: cadastrosPortal([]).reverse() }).success).toBe(false);
    });
    it('último sinal só com datas, HTTP e parada por versão', () => {
      expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, ultimo_sinal: { ...comCredencial.ultimo_sinal, ultimo_http: 42 } }).success).toBe(false);
      const r = IntegracaoFdvPlataforma.parse({ ...comCredencial, ultimo_sinal: { ...comCredencial.ultimo_sinal, politica_versao: { a: 1 } } });
      expect(r.ultimo_sinal).not.toHaveProperty('politica_versao');
    });
  });

  describe('falha do cadastro: motivo e ação sugerida', () => {
    it('todo motivo tem ação; as pausas são motivos', () => {
      for (const m of MOTIVOS_FALHA_ENVIO_FDV) expect(ACAO_SUGERIDA_POR_MOTIVO_FDV[m]).toBeDefined();
      for (const m of MOTIVOS_PAUSA_FDV) expect(MOTIVOS_FALHA_ENVIO_FDV).toContain(m);
    });
    it('o que o tenant resolve no BKO é só corrigir os cadastros; o resto é do portal ou espera', () => {
      expect(ACOES_FDV_SO_DO_PORTAL).not.toContain('corrigir_cadastros');
      expect(ACOES_FDV_SO_DO_PORTAL).not.toContain('aguardar_retentativa');
      expect(ACOES_FDV_SO_DO_PORTAL).toContain('retomar');
      expect(ACOES_FDV_SO_DO_PORTAL).toContain('corrigir_credencial');
    });
    it('ação que não é a do motivo é recusada', () => {
      expect(FalhaEnvioFdv.safeParse({ motivo: 'credencial', acao: 'corrigir_credencial' }).success).toBe(true);
      expect(FalhaEnvioFdv.safeParse({ motivo: 'credencial', acao: 'retomar' }).success).toBe(false);
    });
    it('precedência: pausa → lote recusado → lote falhou → erros por linha → nada', () => {
      expect(falhaEnvioFdv({ pausada_motivo: 'versao', ultimo_lote_estado: 'recusado', erros_abertos: 3 })).toEqual({ motivo: 'versao', acao: 'atualizar_conector' });
      expect(falhaEnvioFdv({ pausada_motivo: null, ultimo_lote_estado: 'recusado', erros_abertos: 3 })).toEqual({ motivo: 'lote_recusado', acao: 'acionar_suporte' });
      expect(falhaEnvioFdv({ pausada_motivo: null, ultimo_lote_estado: 'falhou', erros_abertos: 3 })).toEqual({ motivo: 'lote_falhou', acao: 'aguardar_retentativa' });
      expect(falhaEnvioFdv({ pausada_motivo: null, ultimo_lote_estado: 'concluido_com_erros', erros_abertos: 3 })).toEqual({ motivo: 'erros_por_linha', acao: 'corrigir_cadastros' });
      expect(falhaEnvioFdv({ pausada_motivo: null, ultimo_lote_estado: 'concluido', erros_abertos: 0 })).toBeNull();
      expect(falhaEnvioFdv({ pausada_motivo: null, ultimo_lote_estado: null, erros_abertos: 0 })).toBeNull();
    });
  });

  describe('StatusIntegracaoFdvTenant (vista só leitura do BKO)', () => {
    const status = {
      conector_id: 'erp-am2808',
      ambiente: 'producao',
      chave_prefixo: 'kkkkkkkk',
      cadastros: comCredencial.cadastros.map(({ lote_em_voo: _emVoo, ...c }) => c),
      ultimo_sinal: comCredencial.ultimo_sinal,
    };
    it('aceita com e sem credencial; sem credencial tudo desligado', () => {
      expect(StatusIntegracaoFdvTenant.parse(status).cadastros).toHaveLength(10);
      const sem = { conector_id: null, ambiente: null, chave_prefixo: null, cadastros: cadastros([]), ultimo_sinal: null };
      expect(StatusIntegracaoFdvTenant.safeParse(sem).success).toBe(true);
      expect(StatusIntegracaoFdvTenant.safeParse({ ...sem, cadastros: cadastros(['filial']) }).success).toBe(false);
    });
    it('não leva nada editável nem a chave: credencial, habilitados e limite somem no parse', () => {
      const r = StatusIntegracaoFdvTenant.parse({ ...status, credencial_id: CRED, entidades_habilitadas: ['filial'], limite_registros_lote: 500, chave: CHAVE });
      for (const campo of ['credencial_id', 'entidades_habilitadas', 'limite_registros_lote', 'chave']) expect(r).not.toHaveProperty(campo);
    });
    it('não leva lote_em_voo (só o portal): o campo some no parse', () => {
      const r = StatusIntegracaoFdvTenant.parse({ ...status, cadastros: comCredencial.cadastros });
      for (const c of r.cadastros) expect(c).not.toHaveProperty('lote_em_voo');
    });
    it('credencial pela metade e cadastro faltando são recusados', () => {
      expect(StatusIntegracaoFdvTenant.safeParse({ ...status, ambiente: null }).success).toBe(false);
      expect(StatusIntegracaoFdvTenant.safeParse({ ...status, cadastros: status.cadastros.slice(0, 9) }).success).toBe(false);
    });
  });

  it('respostas da operação: o mesmo formato do RespostaAceito e do RespostaRetomada do módulo', () => {
    expect(RespostaAceitoFdv.parse({ aceito: true })).toEqual({ aceito: true });
    expect(RespostaAceitoFdv.safeParse({ aceito: false }).success).toBe(false);
    expect(RespostaRetomadaFdv.parse({ retomada: false })).toEqual({ retomada: false });
  });

  it('RespostaTestarPlataforma: 202 com aceito e pedido_em ISO', () => {
    expect(RespostaTestarPlataforma.parse({ aceito: true, pedido_em: AGORA })).toEqual({ aceito: true, pedido_em: AGORA });
    expect(RespostaTestarPlataforma.safeParse({ aceito: false, pedido_em: AGORA }).success).toBe(false);
    expect(RespostaTestarPlataforma.safeParse({ aceito: true, pedido_em: 'ontem' }).success).toBe(false);
  });

  it('caminhos do portal ficam sob /empresas/:id, fora de /auth, e as ações são de plataforma', () => {
    for (const c of Object.values(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA)) expect(c.startsWith('/empresas/:id/integracao-fdv')).toBe(true);
    expect(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.cargaCompleta).toBe('/empresas/:id/integracao-fdv/entidades/:entidade/carga-completa');
    expect(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.retomar).toBe('/empresas/:id/integracao-fdv/entidades/:entidade/retomar');
    expect(ACOES_PLATAFORMA).toContain('plataforma.integracao_fdv.ver');
    expect(ACOES_PLATAFORMA).toContain('plataforma.integracao_fdv.configurar');
    expect(ACOES_PLATAFORMA).toContain('plataforma.integracao_fdv.operar');
  });

  it('é reexportado pelo índice do SDK', () => {
    expect(sdk.IntegracaoFdvPlataforma).toBe(IntegracaoFdvPlataforma);
    expect(sdk.DefinirCredencialPlataformaEntrada).toBe(DefinirCredencialPlataformaEntrada);
    expect(sdk.ConfigurarIntegracaoPlataformaEntrada).toBe(ConfigurarIntegracaoPlataformaEntrada);
    expect(sdk.RespostaTestarPlataforma).toBe(RespostaTestarPlataforma);
    expect(sdk.StatusIntegracaoFdvTenant).toBe(StatusIntegracaoFdvTenant);
    expect(sdk.CadastroIntegracaoFdvPlataforma).toBe(CadastroIntegracaoFdvPlataforma);
    expect(sdk.RespostaAceitoFdv).toBe(RespostaAceitoFdv);
    expect(sdk.RespostaRetomadaFdv).toBe(RespostaRetomadaFdv);
  });
});

describe('v0.3.18 (25 B, integração A2): último código do sinal e próxima tentativa da pausa', () => {
  it('UltimoSinalFdv aceita ultimo_codigo (código do Hub, lower_snake) ou null; sem ele, segue válido', () => {
    const sinal = { ultimo_envio_em: AGORA, ultimo_aceito_em: null, ultimo_http: 401, parado_por_versao: false };
    expect(UltimoSinalFdv.parse({ ...sinal, ultimo_codigo: 'credencial_invalida' })).toMatchObject({ ultimo_codigo: 'credencial_invalida' });
    expect(UltimoSinalFdv.parse({ ...sinal, ultimo_codigo: null }).ultimo_codigo).toBeNull();
    expect(UltimoSinalFdv.safeParse(sinal).success).toBe(true);
    expect(UltimoSinalFdv.safeParse({ ...sinal, ultimo_codigo: 'Mensagem do Hub' }).success).toBe(false);
  });

  it('proxima_tentativa_em só com a pausa credencial ou licenca_fdv (a sondagem de 30 min)', () => {
    const comTentativa = (motivo: 'licenca_fdv' | 'erros_por_linha') =>
      comCredencial.cadastros.map((c) =>
        c.entidade === 'filial' ? { ...c, falha: { motivo, acao: ACAO_SUGERIDA_POR_MOTIVO_FDV[motivo] }, proxima_tentativa_em: AGORA } : c,
      );
    expect(CadastroIntegracaoFdv.parse({ entidade: 'filial', ligada: true, ultimo_envio_em: AGORA, falha: { motivo: 'credencial', acao: 'corrigir_credencial' }, proxima_tentativa_em: AGORA })).toMatchObject({ proxima_tentativa_em: AGORA });
    expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, cadastros: comTentativa('licenca_fdv') }).success).toBe(true);
    expect(IntegracaoFdvPlataforma.safeParse({ ...comCredencial, cadastros: comTentativa('erros_por_linha') }).success).toBe(false);
  });
});

describe('RD-2319 (36 A): sem "último uso" na Integração do portal', () => {
  it('a leitura não tem ultimo_uso_em: o campo que vier a mais é descartado (a tela mostra o último sinal)', () => {
    const lido = IntegracaoFdvPlataforma.parse({ ...comCredencial, ultimo_uso_em: AGORA });
    expect(lido).not.toHaveProperty('ultimo_uso_em');
  });
});
