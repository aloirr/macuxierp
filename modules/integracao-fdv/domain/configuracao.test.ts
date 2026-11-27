import { describe, expect, it } from 'vitest';
import { LIMITE_REGISTROS_LOTE } from '../contracts';
import { MENSAGEM_ENTIDADES_HABILITADAS, MENSAGEM_LIMITE_LOTE, decidirCargaCompleta, decidirRetomar, entidadesParaCargaInicial, planejarTrocaCredencial, validarConfiguracao } from './configuracao';

const atual = { conector_id: 'erp-1', ambiente: 'producao' as const };

describe('troca de credencial (RF-INF-05, T-0009 seção 6)', () => {
  it('RF-INF-05: primeira credencial do tenant não pede carga (cadastros ligados um por um) e não zera o espelho', () => {
    expect(planejarTrocaCredencial(null, atual)).toEqual({ primeira: true, zerarEspelho: false });
  });
  it('RF-INF-05: rotação só da chave (mesmo conector e ambiente) não zera nem pede carga', () => {
    expect(planejarTrocaCredencial(atual, { ...atual })).toEqual({ primeira: false, zerarEspelho: false });
  });
  it('RF-INF-05: outro conector_id ou outro ambiente = outro tenant do FDV: zera o espelho e pede a carga', () => {
    for (const nova of [{ ...atual, conector_id: 'erp-2' }, { ...atual, ambiente: 'teste' as const }]) {
      expect(planejarTrocaCredencial(atual, nova)).toEqual({ primeira: false, zerarEspelho: true });
    }
  });
});

describe('carga inicial ao ligar o cadastro (RF-INF-05; R-20261123-150400)', () => {
  it('RF-INF-05: só as recém-ligadas entram; as já ligadas e as desligadas ficam de fora (null = sem evento)', () => {
    expect(entidadesParaCargaInicial(['filial'], ['filial', 'vendedor'])).toEqual(['vendedor']);
    expect(entidadesParaCargaInicial(['filial', 'vendedor'], ['filial'])).toBeNull();
    expect(entidadesParaCargaInicial(['filial'], ['filial'])).toBeNull();
  });
  it('RF-INF-05: lista vazia nas duas pontas não gera evento', () => {
    expect(entidadesParaCargaInicial([], [])).toBeNull();
  });
  it('RF-INF-05: ligar preço leva a tabela_preco; forma e prazo de pagamento não levam dependência (o cadastros já mapeia)', () => {
    expect(entidadesParaCargaInicial([], ['preco'])).toEqual(['preco', 'tabela_preco']);
    expect(entidadesParaCargaInicial([], ['forma_pagamento', 'prazo_pagamento'])).toEqual(['forma_pagamento', 'prazo_pagamento']);
  });
  it('RF-INF-05: a ordem segue a da carga (referências antes de quem as usa)', () => {
    expect(entidadesParaCargaInicial([], ['cliente', 'filial'])).toEqual(['filial', 'cliente']);
  });
  it('RF-INF-05: religar sem mudança não gera evento', () => {
    expect(entidadesParaCargaInicial(['preco', 'filial'], ['filial', 'preco'])).toBeNull();
  });
});

describe('configuração do envio (RN-INF-02)', () => {
  it('RN-INF-02: limite de registros por lote vai de 1 a 5.000', () => {
    expect(LIMITE_REGISTROS_LOTE).toBe(5000);
    expect(validarConfiguracao({ entidades_habilitadas: [], limite_registros_lote: 0 })[0]).toMatchObject({ rn: 'RN-INF-02', mensagem: MENSAGEM_LIMITE_LOTE });
    expect(MENSAGEM_LIMITE_LOTE).toBe('Informe um número de 1 a 5.000.');
    expect(validarConfiguracao({ entidades_habilitadas: ['filial'], limite_registros_lote: 5000 })).toEqual([]);
    for (const n of [0, -1, 5001, 1.5]) expect(validarConfiguracao({ entidades_habilitadas: [], limite_registros_lote: n }).map((v) => v.campo)).toEqual(['limite_registros_lote']);
  });
  it('RN-INF-02: só entidades publicadas na F2 podem ser habilitadas, sem repetir', () => {
    expect(validarConfiguracao({ entidades_habilitadas: ['titulo'], limite_registros_lote: 10 }).map((v) => v.campo)).toEqual(['entidades_habilitadas']);
    expect(validarConfiguracao({ entidades_habilitadas: ['filial', 'filial'], limite_registros_lote: 10 }).map((v) => v.campo)).toEqual(['entidades_habilitadas']);
    expect(validarConfiguracao({ entidades_habilitadas: ['inventada'], limite_registros_lote: 10 })).toHaveLength(1);
    expect(validarConfiguracao({ entidades_habilitadas: ['filial', 'filial'], limite_registros_lote: 10 })[0]).toMatchObject({ mensagem: MENSAGEM_ENTIDADES_HABILITADAS });
    expect(MENSAGEM_ENTIDADES_HABILITADAS).toBe('Escolha só cadastros da lista, sem repetir');
  });
});

describe('ações do BKO sobre a entidade', () => {
  it('RN-INF-04: carga completa só de entidade habilitada e sem lote em voo', () => {
    expect(decidirCargaCompleta({ habilitada: true, loteEmVoo: false })).toEqual({ ok: true });
    expect(decidirCargaCompleta({ habilitada: false, loteEmVoo: false })).toMatchObject({ ok: false, codigo: 'entidade_desabilitada' });
    expect(decidirCargaCompleta({ habilitada: true, loteEmVoo: true })).toMatchObject({ ok: false, codigo: 'lote_em_voo' });
  });
  it('RN-INF-04: retomar só faz algo com pausa; sem pausa é idempotente', () => {
    expect(decidirRetomar('credencial')).toEqual({ acao: 'retomar' });
    expect(decidirRetomar(null)).toEqual({ acao: 'nada' });
  });
});
