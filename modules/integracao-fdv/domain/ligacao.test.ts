import { describe, expect, it } from 'vitest';
import { ESTADOS_ENVIADOS_AO_HUB, contarLigacao, loteContaComoEnviado, montarContatoSaida } from './ligacao';

const grupo = (estado: string, registros: number, aceitos: number, repetido = false) => ({ estado, repetido, registros, aceitos });

describe('contadores da ligação ERP → Macuxi FDV (RN-INF-13)', () => {
  it('RN-INF-13: só os lotes mandados ao Hub contam como enviados', () => {
    expect([...ESTADOS_ENVIADOS_AO_HUB]).toEqual(['enviando', 'aceito', 'concluido', 'concluido_com_erros']);
    for (const e of ['montado', 'falhou', 'recusado']) expect(loteContaComoEnviado({ estado: e, repetido: false }), e).toBe(false);
    for (const e of ESTADOS_ENVIADOS_AO_HUB) expect(loteContaComoEnviado({ estado: e, repetido: false }), e).toBe(true);
  });
  it('RN-INF-13: o lote repetido não conta duas vezes', () => {
    expect(loteContaComoEnviado({ estado: 'concluido', repetido: true })).toBe(false);
  });
  it('RN-INF-13: Enviados soma os registros e Aceitos soma os aceitos dos lotes contados', () => {
    const r = contarLigacao([
      grupo('concluido', 100, 100), grupo('concluido_com_erros', 50, 45), grupo('enviando', 20, 0), grupo('aceito', 10, 10),
      grupo('falhou', 99, 0), grupo('montado', 7, 0), grupo('recusado', 5, 0), grupo('concluido', 100, 100, true),
    ]);
    expect(r).toEqual({ enviados: 180, aceitos: 155 });
  });
  it('RN-INF-13: sem lote, os dois contadores são zero; o aceito nunca passa do enviado', () => {
    expect(contarLigacao([])).toEqual({ enviados: 0, aceitos: 0 });
    expect(contarLigacao([grupo('concluido', 10, 12)])).toEqual({ enviados: 10, aceitos: 10 });
  });
});

describe('cabeçalho do Contato, só leitura (RN-INF-13)', () => {
  const agora = new Date('2026-11-28T12:00:00.000Z');
  const cred = { conector_id: 'erp-1', ambiente: 'producao' as const, chave_prefixo: 'mxf_ab12', habilitadas: 3 };
  it('RN-INF-13: sem credencial, desativado e sem identificação', () => {
    expect(montarContatoSaida({ credencial: null, ultimo_aceito_em: null, agora })).toEqual({ conector_id: null, ambiente: null, chave_prefixo: null, situacao: 'desativado', ultimo_contato_em: null });
  });
  it('RN-INF-13: sinal aceito há menos de 5 min é "em_dia"; mais velho ou ausente é "atrasado"', () => {
    expect(montarContatoSaida({ credencial: cred, ultimo_aceito_em: '2026-11-28T11:58:00.000Z', agora })).toMatchObject({ conector_id: 'erp-1', situacao: 'em_dia', ultimo_contato_em: '2026-11-28T11:58:00.000Z' });
    expect(montarContatoSaida({ credencial: cred, ultimo_aceito_em: '2026-11-28T11:00:00.000Z', agora }).situacao).toBe('atrasado');
    expect(montarContatoSaida({ credencial: cred, ultimo_aceito_em: null, agora }).situacao).toBe('atrasado');
  });
  it('RN-INF-13: credencial sem cadastro habilitado fica desativada', () => {
    expect(montarContatoSaida({ credencial: { ...cred, habilitadas: 0 }, ultimo_aceito_em: '2026-11-28T11:59:00.000Z', agora }).situacao).toBe('desativado');
  });
});
