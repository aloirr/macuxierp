import { LogCadastroFdvPlataforma, LogCadastroFdvTenant, MonitorConectorFdv } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import {
  MARCA_REENVIO,
  corrigirHref,
  montarLogPlataforma,
  montarLogTenant,
  montarMonitor,
  nomeCurto,
  origemDoLote,
  planejarReprocessar,
  situacaoDoEnvio,
  situacaoRegistro,
  type EnvioBruto,
  type ErroBruto,
} from './operacao';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const AGORA = new Date('2026-11-24T20:00:00.000Z');

describe('situacaoRegistro (T-0086 §3)', () => {
  it('RN-INF-03: erro por linha aberto = falha, mesmo com o hash confirmado', () => {
    expect(situacaoRegistro({ pendente: false, hash: H1, hash_confirmado: H1, erro_aberto: true })).toBe('falha');
  });
  it('RN-INF-03: pendente = true ou hash confirmado diferente do atual = pendente', () => {
    expect(situacaoRegistro({ pendente: true, hash: H1, hash_confirmado: H1, erro_aberto: false })).toBe('pendente');
    expect(situacaoRegistro({ pendente: false, hash: H2, hash_confirmado: H1, erro_aberto: false })).toBe('pendente');
    expect(situacaoRegistro({ pendente: false, hash: H1, hash_confirmado: null, erro_aberto: false })).toBe('pendente');
  });
  it('RN-INF-03: o Hub confirmou o hash atual e não há erro aberto = integrado', () => {
    expect(situacaoRegistro({ pendente: false, hash: H1, hash_confirmado: H1, erro_aberto: false })).toBe('integrado');
  });
});

describe('planejarReprocessar (R-20261124-090216)', () => {
  const reg = (id: string, p: Partial<Parameters<typeof situacaoRegistro>[0]> = {}) => ({
    id, pendente: false, hash: H1, hash_confirmado: H1, erro_aberto: false, ...p,
  });

  it('o Reprocessar nunca reenvia o integrado: só falha e pendente entram', () => {
    const plano = planejarReprocessar([
      reg('integrado'),
      reg('falha', { erro_aberto: true }),
      reg('pendente', { pendente: true }),
      reg('mudou', { hash_confirmado: H2 }),
    ]);
    expect(plano.ids.sort()).toEqual(['falha', 'mudou', 'pendente']);
    expect(plano.ids).not.toContain('integrado');
    expect(plano).toMatchObject({ falhas: 1, pendentes: 2 });
  });
  it('só integrados: nada a reprocessar, contagens zero', () => {
    expect(planejarReprocessar([reg('a'), reg('b')])).toEqual({ ids: [], falhas: 0, pendentes: 0 });
  });
  it('a falha conta uma vez, mesmo pendente e com erro', () => {
    expect(planejarReprocessar([reg('x', { pendente: true, erro_aberto: true })])).toEqual({ ids: ['x'], falhas: 1, pendentes: 0 });
  });
});

describe('origemDoLote (T-0086 §4 e §5)', () => {
  it('lote só com inativações do Zerar = zerar', () => {
    expect(origemDoLote([{ [MARCA_REENVIO.zerar.chave]: MARCA_REENVIO.zerar.valor }, { [MARCA_REENVIO.zerar.chave]: MARCA_REENVIO.zerar.valor }])).toBe('zerar');
  });
  it('lote com registro marcado pelo Reprocessar (e sem o Zerar) = reprocessar', () => {
    expect(origemDoLote([{ [MARCA_REENVIO.reprocessar.chave]: MARCA_REENVIO.reprocessar.valor }, {}])).toBe('reprocessar');
  });
  it('misturado ou sem marca = ciclo; o Zerar misturado com o ciclo não vira zerar', () => {
    expect(origemDoLote([{}, {}])).toBe('ciclo');
    expect(origemDoLote([{ [MARCA_REENVIO.zerar.chave]: MARCA_REENVIO.zerar.valor }, {}])).toBe('ciclo');
    expect(origemDoLote([])).toBe('ciclo');
  });
  it('zerar e reprocessar juntos: o Reprocessar de uma inativação do Zerar segue zerar', () => {
    const z = { [MARCA_REENVIO.zerar.chave]: MARCA_REENVIO.zerar.valor, [MARCA_REENVIO.reprocessar.chave]: MARCA_REENVIO.reprocessar.valor };
    expect(origemDoLote([z, z])).toBe('zerar');
  });
});

describe('situacaoDoEnvio', () => {
  it('estados em voo = enviando; concluido_com_erros = com_erros; falhou e recusado = falhou', () => {
    expect(['montado', 'enviando', 'aceito'].map(situacaoDoEnvio)).toEqual(['enviando', 'enviando', 'enviando']);
    expect(situacaoDoEnvio('concluido')).toBe('concluido');
    expect(situacaoDoEnvio('concluido_com_erros')).toBe('com_erros');
    expect(situacaoDoEnvio('falhou')).toBe('falhou');
    expect(situacaoDoEnvio('recusado')).toBe('falhou');
  });
});

describe('nomeCurto e corrigirHref', () => {
  it('o nome sai do nome, da razão social ou da descrição, cortado em 120', () => {
    expect(nomeCurto({ nome: 'Ana' })).toBe('Ana');
    expect(nomeCurto({ razao_social: 'Empresa LTDA' })).toBe('Empresa LTDA');
    expect(nomeCurto({ descricao: 'Arroz' })).toBe('Arroz');
    expect(nomeCurto({ nome: 'x'.repeat(300) })).toHaveLength(120);
    expect(nomeCurto({ cnpj: '1' })).toBeNull();
    expect(nomeCurto(null)).toBeNull();
  });
  it('corrigir_href é a lista do cadastro no BKO; nulo se o registro foi apagado (Zerar)', () => {
    expect(corrigirHref('produto', 'SKU 1', {})).toBe('/cadastros/produtos?busca=SKU%201');
    expect(corrigirHref('prazo_pagamento', 'P1', {})).toBe('/cadastros/condicoes-pagamento?busca=P1');
    expect(corrigirHref('produto', 'SKU1', { [MARCA_REENVIO.zerar.chave]: MARCA_REENVIO.zerar.valor })).toBeNull();
  });
});

describe('Log (T-0086 §4; ADR 0013)', () => {
  const envio = (o: Partial<EnvioBruto> = {}): EnvioBruto => ({
    em: new Date('2026-11-24T19:00:00.000Z'), estado: 'concluido_com_erros', registros: 3, com_erro: 2, origem: 'ciclo', ...o,
  });
  const erro = (o: Partial<ErroBruto> = {}): ErroBruto => ({
    registro_external_id: 'C000123', entidade: 'cliente', codigo: 'campo_invalido', campo: 'cnpj', payload: { razao_social: 'Mercado Silva LTDA', cnpj: '12345678000195' }, fonte_refs: {}, ...o,
  });
  const base = { entidade: 'cliente' as const, lidoEm: AGORA, motivo: null };

  it('ADR 0013: o log do /config traz só código, campo e contagem, nunca nome, documento nem external_id', () => {
    const log = montarLogPlataforma({
      ...base,
      envios: [envio()],
      erros: [erro(), erro({ registro_external_id: 'C000124', payload: { razao_social: 'Outro', cpf: '12345678909' } })],
    });
    const texto = JSON.stringify(log);
    for (const proibido of ['Mercado Silva', 'Outro', '12345678000195', '12345678909', 'C000123', 'C000124', 'registro_external_id', 'nome_curto']) {
      expect(texto, proibido).not.toContain(proibido);
    }
    expect(log.erros).toEqual([{ codigo: 'campo_invalido', campo: 'cnpj', quantidade: 2 }]);
    expect(log.total_erros).toBe(2);
    expect(LogCadastroFdvPlataforma.safeParse(log).success).toBe(true);
  });

  it('o log do /config agrupa por código e campo e conta', () => {
    const log = montarLogPlataforma({
      ...base,
      envios: [],
      erros: [erro(), erro({ registro_external_id: 'C2' }), erro({ registro_external_id: 'C3', campo: null, codigo: 'referencia_ausente' })],
    });
    expect(log.erros).toEqual([
      { codigo: 'campo_invalido', campo: 'cnpj', quantidade: 2 },
      { codigo: 'referencia_ausente', campo: null, quantidade: 1 },
    ]);
  });

  it('o log do BKO traz o registro, o nome curto, o motivo e a ação do catálogo, e o corrigir_href', () => {
    const log = montarLogTenant({ ...base, envios: [envio({ origem: 'zerar' })], erros: [erro()] });
    expect(log.erros[0]).toMatchObject({
      registro_external_id: 'C000123', nome_curto: 'Mercado Silva LTDA', campo: 'cnpj', codigo: 'campo_invalido', corrigir_href: '/cadastros/clientes?busca=C000123',
    });
    expect(log.erros[0]!.motivo_texto.length).toBeGreaterThan(5);
    expect(log.erros[0]!.acao_texto.length).toBeGreaterThan(5);
    expect(log.envios[0]).toMatchObject({ origem: 'zerar', situacao: 'com_erros', registros: 3, com_erro: 2, em: '2026-11-24T19:00:00.000Z' });
    expect(LogCadastroFdvTenant.safeParse(log).success).toBe(true);
  });

  it('o texto vem do catálogo pelo código: código desconhecido cai na mensagem genérica, nunca em texto do Hub', () => {
    const log = montarLogTenant({ ...base, envios: [], erros: [erro({ codigo: 'qualquer_coisa_do_hub' })] });
    expect(log.erros[0]!.motivo_texto).toContain('não catalogado');
  });

  it('com_erro nunca passa dos registros, e o log do BKO corta em 200 itens mantendo o total', () => {
    const muitos = Array.from({ length: 250 }, (_, i) => erro({ registro_external_id: `C${i}` }));
    const log = montarLogTenant({ ...base, envios: [envio({ registros: 1, com_erro: 5 })], erros: muitos });
    expect(log.erros).toHaveLength(200);
    expect(log.total_erros).toBe(250);
    expect(log.envios[0]!.com_erro).toBe(1);
  });

  it('os 20 envios mais recentes', () => {
    const envios = Array.from({ length: 30 }, (_, i) => envio({ em: new Date(AGORA.getTime() - i * 1000) }));
    expect(montarLogPlataforma({ ...base, envios, erros: [] }).envios).toHaveLength(20);
  });
});

describe('montarMonitor (T-0086 §2)', () => {
  const entrada = { credencial_ativa: true, conector_id: 'erp-1', habilitadas: 2, ultimo_sinal_aceito_em: new Date(AGORA.getTime() - 60_000), fila: { lotes: 1, linhas: 40 }, agora: AGORA };
  it('em dia: sinal aceito há menos de 5 min', () => {
    const m = montarMonitor(entrada);
    expect(m).toMatchObject({ identificador: 'erp-1', situacao: 'em_dia', fila: { lotes: 1, linhas: 40 } });
    expect(m.versao).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MonitorConectorFdv.safeParse(m).success).toBe(true);
  });
  it('sem credencial: nulos e fila zerada', () => {
    const sem = montarMonitor({ ...entrada, credencial_ativa: false, conector_id: null, ultimo_sinal_aceito_em: null, fila: { lotes: 9, linhas: 9 } });
    expect(sem).toMatchObject({ identificador: null, situacao: 'desativado', versao: null, ultimo_sinal_em: null, fila: { lotes: 0, linhas: 0 } });
    expect(MonitorConectorFdv.safeParse(sem).success).toBe(true);
  });
});
