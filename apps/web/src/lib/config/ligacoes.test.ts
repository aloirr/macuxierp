import { describe, expect, it } from 'vitest';
import type { IntegracaoFdvPlataforma, LoteEntradaResumo, MonitorConectorFdv, PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import {
  APOIO_INDISPONIVEL, LIGACAO_ENTRADA, LIGACAO_SAIDA, ROTULO_DESTINO_FDV, ROTULO_FORCA_VENDAS, SITUACAO_INDISPONIVEL, SITUACAO_RECEBENDO, SITUACAO_SEM_ENVIO,
  fichaEntrada, fichaSaida, ultimoLoteDoCadastro,
} from './ligacoes';

const FUSO = 'America/Manaus';
const AGORA = new Date('2026-11-27T14:00:00.000Z');
const ID = '00000000-0000-4000-8000-000000000001';
const lote = (entidade: string, recebido_em: string, recebidos = 10, com_erro = 0): LoteEntradaResumo =>
  ({ lote_id: ID, entidade, modo: 'delta', status: 'concluido', recebidos, com_erro, recebido_em, concluido_em: recebido_em }) as LoteEntradaResumo;
const cred = (conector_id: string, criada_em: string, revogada_em: string | null = null) =>
  ({ conector_id, prefixo: 'mxe_ab12', criada_em, revogada_em }) as PortalEntradaLeitura['credenciais'][number];

describe('v0.3.24: nomes das ligações dizem a direção (49 A)', () => {
  it('"Sistema do cliente → ERP" e "ERP → Macuxi FDV"; o leitor ouve "para o"', () => {
    expect([LIGACAO_ENTRADA.de.nome, LIGACAO_ENTRADA.para.nome, LIGACAO_ENTRADA.para.artigo]).toEqual(['Sistema do cliente', 'ERP', 'o']);
    expect([LIGACAO_SAIDA.de.nome, LIGACAO_SAIDA.para.artigo]).toEqual(['ERP', 'o']);
    expect(LIGACAO_SAIDA.para.nome).toBe(ROTULO_FORCA_VENDAS);
    expect(ROTULO_DESTINO_FDV).toBe('Macuxi FDV');
  });
});

describe('ficha da ligação Sistema do cliente → ERP', () => {
  it('sem chave viva não há ficha (só o formulário)', () => {
    expect(fichaEntrada(null, FUSO, AGORA)).toBeNull();
    expect(fichaEntrada({ credenciais: [cred('erp-1', '2026-11-20T10:00:00.000Z', '2026-11-21T10:00:00.000Z')], ultimo_sinal: null, lotes: [] }, FUSO, AGORA)).toBeNull();
  });
  it('Recebendo com lote nas últimas 24 h; Sem envio depois disso; Último contato é o mais novo entre sinal e lote', () => {
    const base = { credenciais: [cred('erp-1', '2026-11-20T10:00:00.000Z')], ultimo_sinal: { conector_id: 'erp-1', em: '2026-11-27T13:00:00.000Z', versao_conector: '1.0.0' } };
    const f = fichaEntrada({ ...base, lotes: [lote('cliente', '2026-11-27T12:00:00.000Z')] }, FUSO, AGORA)!;
    expect(f).toMatchObject({ situacao: SITUACAO_RECEBENDO, codigo: 'erp-1', chave: 'mxe_ab12…', ultimoContato: '27/11/2026 09:00' });
    expect(fichaEntrada({ ...base, lotes: [lote('cliente', '2026-11-25T12:00:00.000Z')] }, FUSO, AGORA)!.situacao).toEqual(SITUACAO_SEM_ENVIO);
    expect(fichaEntrada({ ...base, lotes: [] }, FUSO, AGORA)!.situacao).toEqual(SITUACAO_SEM_ENVIO);
  });
  it('várias credenciais: vale a viva mais recente; sinal de outro conector não conta', () => {
    const l = { credenciais: [cred('a', '2026-11-01T15:00:00.000Z'), cred('b', '2026-11-10T15:00:00.000Z'), cred('c', '2026-11-25T15:00:00.000Z', '2026-11-26T15:00:00.000Z')], ultimo_sinal: { conector_id: 'c', em: '2026-11-26T16:00:00.000Z', versao_conector: '1.0.0' }, lotes: [] };
    expect(fichaEntrada(l, FUSO, AGORA)).toMatchObject({ codigo: 'b', ultimoContato: '—' });
  });
});

describe('ficha da ligação ERP → Macuxi FDV (o Monitor vira a Situação)', () => {
  const d = { credencial_id: ID, conector_id: 'fdv-1', ambiente: 'producao', chave_prefixo: 'mxf_cd34', ultimo_sinal: { ultimo_envio_em: '2026-11-27T13:30:00.000Z', ultimo_aceito_em: null, ultimo_http: 200, parado_por_versao: false, ultimo_codigo: null } } as unknown as IntegracaoFdvPlataforma;
  const m = (situacao: string, lotes = 0) => ({ situacao, fila: { lotes, linhas: lotes * 10 }, ultimo_sinal_em: '2026-11-27T13:45:00.000Z' }) as unknown as MonitorConectorFdv;
  it('sem chave não há ficha', () => {
    expect(fichaSaida({ ...d, credencial_id: null } as IntegracaoFdvPlataforma, null, FUSO)).toBeNull();
  });
  it('Situação do Monitor, Ligado a Macuxi FDV, Ambiente; fila só com N > 0', () => {
    const f = fichaSaida(d, m('em_dia'), FUSO)!;
    expect(f).toMatchObject({ situacao: { texto: 'Em dia', tom: 'sucesso' }, codigo: 'fdv-1', chave: 'mxf_cd34…', ligadoA: 'Macuxi FDV', ultimoContato: '27/11/2026 09:45', apoio: [] });
    expect(f.ambiente).not.toBe('—');
    expect(fichaSaida(d, m('atrasado', 2), FUSO)!.apoio).toEqual(['Fila: 2 lotes']);
  });
  it('Monitor fora: selo Indisponível com o apoio; código da última recusa em apoio', () => {
    const f = fichaSaida({ ...d, ultimo_sinal: { ...d.ultimo_sinal!, ultimo_codigo: 'FDV401' } } as IntegracaoFdvPlataforma, null, FUSO)!;
    expect(f.situacao).toEqual(SITUACAO_INDISPONIVEL);
    expect(f.apoio).toEqual([APOIO_INDISPONIVEL, 'Código da última recusa: FDV401']);
    expect(f.ultimoContato).toBe('27/11/2026 09:30');
  });
});

describe('aba Dados: Cadastros recebidos (último lote por cadastro e origem)', () => {
  const lotes = [lote('forma_pagamento', '2026-11-27T10:00:00.000Z', 5, 1), lote('prazo_pagamento', '2026-11-27T11:00:00.000Z', 7, 0), lote('cliente_endereco', '2026-11-26T11:00:00.000Z', 3, 3)];
  it('condição junta forma e prazo; cliente junta o endereço; sem lote, null', () => {
    expect(ultimoLoteDoCadastro(lotes, 'condicao_pagamento')).toMatchObject({ entidade: 'prazo_pagamento', recebidos: 7 });
    expect(ultimoLoteDoCadastro(lotes, 'cliente')).toMatchObject({ entidade: 'cliente_endereco', com_erro: 3 });
    expect(ultimoLoteDoCadastro(lotes, 'produto')).toBeNull();
  });
});
