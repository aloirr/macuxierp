/**
 * Trava do simulador (regra 7 do CLAUDE.md, RN-CORE-08): filial em produção fiscal nunca recebe o simulador,
 * nem por opção, nem por variável de ambiente, nem por destino montado à mão.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENDERECOS_SEFAZ,
  ErroSefaz,
  SimuladorEmProducaoErro,
  criarSeletorTransporte,
  escolherDestinoSefaz,
  garantirDestinoSimulador,
  type DestinoSimulador,
  type FilialEmissoraSefaz,
  type SefazTransporte,
} from './index';

const FILIAL = '7f1c2a50-3b8e-4c1d-9a2f-0e6b5d4c3a21';
const homologacao: FilialEmissoraSefaz = { filial_id: FILIAL, ambiente: 'homologacao', uf: 'AM' };
const producao: FilialEmissoraSefaz = { filial_id: FILIAL, ambiente: 'producao', uf: 'AM' };
const credencial = { pfx: new Uint8Array([1, 2, 3]), senha: 'falsa-de-teste' };

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroSefaz ? e.codigo : 'ERRO_NAO_TIPADO';
  }
  return undefined;
}

describe('escolherDestinoSefaz — filial em homologação', () => {
  it('com transporte "simulador" devolve o destino do simulador, tpAmb 2, congelado', () => {
    const d = escolherDestinoSefaz(homologacao, { transporte: 'simulador' });
    expect(d).toMatchObject({ tipo: 'simulador', ambiente: 'homologacao', tpAmb: 2, uf: 'AM', cUF: 13, modo: 'normal', tpEmis: 1 });
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('com transporte "sefaz" devolve o autorizador do AM em homologação, marcado "a conferir"', () => {
    const d = escolherDestinoSefaz(homologacao, { transporte: 'sefaz' });
    expect(d.tipo).toBe('sefaz');
    if (d.tipo !== 'sefaz') return;
    expect(d).toMatchObject({ autorizador: 'AM', tpAmb: 2, conferido: false });
    expect(d.urls.autorizacao).toBe('https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4');
  });

  it('contingência SVC-RS vai à SVC-RS, sem inutilização; SVC-AN não é a SVC do AM', () => {
    const d = escolherDestinoSefaz({ ...homologacao, modo: 'svc-rs' }, { transporte: 'sefaz' });
    expect(d).toMatchObject({ tipo: 'sefaz', autorizador: 'SVC-RS', tpEmis: 7 });
    if (d.tipo === 'sefaz') expect(d.urls.inutilizacao).toBeNull();
    expect(codigo(() => escolherDestinoSefaz({ ...homologacao, modo: 'svc-an' }, { transporte: 'sefaz' }))).toBe(
      'SEFAZ_CONTINGENCIA_INVALIDA',
    );
  });

  it('UF sem autorizador mapeado é recusada', () => {
    expect(codigo(() => escolherDestinoSefaz({ ...homologacao, uf: 'SP' }, { transporte: 'simulador' }))).toBe(
      'SEFAZ_UF_SEM_AUTORIZADOR',
    );
  });
});

describe('escolherDestinoSefaz — filial em produção (regra 7)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('pedir o simulador lança SimuladorEmProducaoErro', () => {
    expect(() => escolherDestinoSefaz(producao, { transporte: 'simulador' })).toThrow(SimuladorEmProducaoErro);
    expect(codigo(() => escolherDestinoSefaz(producao, { transporte: 'simulador' }))).toBe('SEFAZ_SIMULADOR_EM_PRODUCAO');
  });

  it('nenhuma variável de ambiente liga o simulador em produção', () => {
    for (const [k, v] of [
      ['MACUXIERP_SEFAZ_HOMOLOGACAO', 'simulador'],
      ['MACUXIERP_SEFAZ_SIMULADOR', '1'],
      ['MACUXIERP_SEFAZ_TRANSPORTE', 'simulador'],
      ['NODE_ENV', 'test'],
      ['MACUXI_GUARDA', 'off'],
    ] as const) {
      vi.stubEnv(k, v);
    }
    expect(() => escolherDestinoSefaz(producao, { transporte: 'simulador' })).toThrow(SimuladorEmProducaoErro);
    // Com "sefaz", produção nunca vira simulador; hoje para no endereço "a conferir" (T-0046).
    expect(codigo(() => escolherDestinoSefaz(producao, { transporte: 'sefaz' }))).toBe('SEFAZ_ENDERECO_NAO_CONFERIDO');
  });

  it('enquanto os endereços de produção estiverem "a conferir", produção é bloqueada', () => {
    expect(ENDERECOS_SEFAZ.AM.producao.conferido).toBe(false);
    expect(codigo(() => escolherDestinoSefaz(producao, { transporte: 'sefaz' }))).toBe('SEFAZ_ENDERECO_NAO_CONFERIDO');
  });

  it('a tabela de endereços é imutável (não dá para "conferir" em tempo de execução)', () => {
    expect(() => {
      (ENDERECOS_SEFAZ.AM.producao as { conferido: boolean }).conferido = true;
    }).toThrow(TypeError);
    expect(ENDERECOS_SEFAZ.AM.producao.conferido).toBe(false);
  });

  it('ambiente ou transporte fora do enum é recusado, sem cair no simulador', () => {
    const forjada = { ...producao, ambiente: 'Homologacao' } as unknown as FilialEmissoraSefaz;
    expect(codigo(() => escolherDestinoSefaz(forjada, { transporte: 'simulador' }))).toBe('SEFAZ_FILIAL_INVALIDA');
    const extra = { ...producao, simulador: true } as unknown as FilialEmissoraSefaz;
    expect(codigo(() => escolherDestinoSefaz(extra, { transporte: 'simulador' }))).toBe('SEFAZ_FILIAL_INVALIDA');
    const t = { transporte: 'SIMULADOR' } as unknown as { transporte: 'simulador' };
    expect(codigo(() => escolherDestinoSefaz(homologacao, t))).toBe('SEFAZ_TRANSPORTE_NAO_CONFIGURADO');
  });
});

describe('garantirDestinoSimulador — destino montado à mão', () => {
  const valido = escolherDestinoSefaz(homologacao, { transporte: 'simulador' });

  it('aceita o destino do seletor', () => {
    expect(garantirDestinoSimulador(valido)).toBe(valido);
  });

  it('o destino devolvido não pode ser alterado para produção', () => {
    expect(() => {
      (valido as { ambiente: string }).ambiente = 'producao';
    }).toThrow(TypeError);
  });

  it.each([
    ['cópia em produção', { ...valido, ambiente: 'producao' }],
    ['cópia com tpAmb 1', { ...valido, tpAmb: 1 }],
    ['destino real de homologação', { ...valido, tipo: 'sefaz' }],
    ['objeto vazio', {}],
    ['nulo', null],
  ])('recusa %s', (_nome, destino) => {
    expect(() => garantirDestinoSimulador(destino)).toThrow(SimuladorEmProducaoErro);
  });
});

describe('criarSeletorTransporte', () => {
  const falso = (destino: SefazTransporte['destino']) => ({ destino }) as unknown as SefazTransporte;

  it('homologação com "simulador" chama só a fábrica do simulador', () => {
    const simulador = vi.fn((d: DestinoSimulador) => falso(d));
    const sefaz = vi.fn();
    const t = criarSeletorTransporte({ transporte: 'simulador', simulador, sefaz })(homologacao, credencial);
    expect(t.destino.tipo).toBe('simulador');
    expect(simulador).toHaveBeenCalledOnce();
    expect(sefaz).not.toHaveBeenCalled();
  });

  it('produção nunca chama a fábrica do simulador', () => {
    const simulador = vi.fn((d: DestinoSimulador) => falso(d));
    const sefaz = vi.fn((d: SefazTransporte['destino']) => falso(d));
    expect(() => criarSeletorTransporte({ transporte: 'simulador', simulador, sefaz })(producao, credencial)).toThrow(
      SimuladorEmProducaoErro,
    );
    expect(() => criarSeletorTransporte({ transporte: 'sefaz', simulador, sefaz })(producao, credencial)).toThrow(ErroSefaz);
    expect(simulador).not.toHaveBeenCalled();
  });

  it('homologação com "sefaz" passa o destino real e a credencial à fábrica real', () => {
    const sefaz = vi.fn((d: SefazTransporte['destino']) => falso(d));
    criarSeletorTransporte({ transporte: 'sefaz', sefaz })(homologacao, credencial);
    expect(sefaz).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'sefaz', ambiente: 'homologacao' }), credencial);
  });

  it('fábrica ausente é erro de configuração', () => {
    expect(codigo(() => criarSeletorTransporte({ transporte: 'simulador' })(homologacao, credencial))).toBe(
      'SEFAZ_TRANSPORTE_NAO_CONFIGURADO',
    );
    expect(codigo(() => criarSeletorTransporte({ transporte: 'sefaz' })(homologacao, credencial))).toBe(
      'SEFAZ_TRANSPORTE_NAO_CONFIGURADO',
    );
  });
});
