/**
 * Faturamento no worker (T-0045 lote A): os trabalhos e rotinas registrados, as duas barreiras do simulador no nível do worker e o A1 só em
 * memória. (a) filial em produção fiscal: `SimuladorEmProducaoErro` e o simulador nunca é chamado; o trabalho desiste na hora (422).
 * (b) o seletor do worker não tem a fábrica da SEFAZ real: nenhuma configuração leva a homologação à SEFAZ real (R-20261122-022626).
 * O ponta a ponta (API → fila → worker → simulador) está em `faturamento.db.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRABALHO_CONSULTAR_NOTA,
  TRABALHO_PROCESSAR_EVENTO,
  TRABALHO_PROCESSAR_INUTILIZACAO,
  TRABALHO_TRANSMITIR_NOTA,
} from '@macuxierp/faturamento/contracts';
import { ErroCertificadoA1 } from '@macuxierp/nfe-emissor';
import { ErroSefaz, SimuladorEmProducaoErro, type DestinoSimulador, type FilialEmissoraSefaz } from '@macuxierp/nfe-sefaz';
import { criarFabricaSimulador, ErroEstadoSimuladorPg, SequenciaSimuladorEsgotadaErro } from '@macuxierp/sefaz-simulador';
import { ArmazenamentoMemoria, ErroApi, type Banco, type Licenca, type Transacao } from '@macuxierp/platform-sdk';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import {
  criarAlertaNumeradasNaoEnviadas,
  criarLerA1DoWorker,
  criarSefazDoWorker,
  inicioDoMesEmManaus,
  LIMITE_VARREDURA_TITULOS,
  logFaturamentoDoWorker,
  montarFaturamentoWorker,
  prazoInutilizacao,
  TITULOS_PARADOS_HA_MINUTOS,
  TRANSPORTE_HOMOLOGACAO_DO_WORKER,
} from './faturamento';
import { montarExecutores, montarPeriodicas, montarRotinas } from './modulos';

const leitura = vi.hoisted(() => ({ pfx: Buffer.alloc(0), senha: '', ultimo: undefined as unknown }));
vi.mock('@macuxierp/core/api', async (original) => ({
  ...(await original<typeof import('@macuxierp/core/api')>()),
  lerA1DecifradoDaFilial: async () => (leitura.ultimo = { certificado_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', pfx: leitura.pfx, senha: leitura.senha }),
}));

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d';
const FILIAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const NOTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const log = pino({ level: 'silent' });
const AGORA = new Date('2026-11-05T11:00:00Z'); // 05/11, 7 h em Manaus

/** Banco sem dados: toda consulta devolve vazio (as fábricas só montam; a varredura não acha nada). */
function bancoVazio(): { banco: Banco; tenants: string[] } {
  const tenants: string[] = [];
  const tx = { consultar: async () => [] } as unknown as Transacao;
  return {
    tenants,
    banco: {
      comTenant: async (t, fn) => {
        tenants.push(t);
        return fn(tx);
      },
      semTenant: async (fn) => fn(tx),
      ping: async () => true,
    },
  };
}
const licencas = (porTenant: Record<string, Licenca[]>) => ({ ler: async (_tx: Transacao, t: string) => porTenant[t] ?? [] });
const fonteTenants = (ids: string[]) => ({ ativos: async () => ids });
const homologacao: FilialEmissoraSefaz = { filial_id: FILIAL, ambiente: 'homologacao', uf: 'AM', modo: 'normal' };
const producao: FilialEmissoraSefaz = { ...homologacao, ambiente: 'producao' };
const credencial = { pfx: new Uint8Array(4), senha: 'x' };

function montar() {
  const { banco } = bancoVazio();
  return montarFaturamentoWorker({ banco, chaveA1: Buffer.alloc(32, 7), log, tenants: fonteTenants([T1]), licencas: licencas({}), agora: () => AGORA });
}

/** Variáveis que alguém poderia achar que ligam a SEFAZ real: nenhuma deve mudar o destino. */
const AMBIENTE_TENTADOR = { MACUXIERP_SEFAZ_HOMOLOGACAO: 'sefaz', MACUXIERP_SEFAZ_TRANSPORTE: 'sefaz', MACUXIERP_SEFAZ_SIMULADOR: '0', NODE_ENV: 'production', MACUXI_GUARDA: 'off' };
let ambienteAntes: NodeJS.ProcessEnv;
beforeEach(() => {
  ambienteAntes = { ...process.env };
  Object.assign(process.env, AMBIENTE_TENTADOR);
});
afterEach(() => {
  process.env = ambienteAntes;
});

describe('faturamento montado no worker', () => {
  it('registra os quatro trabalhos da SEFAZ, a varredura e o alerta das numeradas não enviadas', () => {
    const fat = montar();
    const { banco } = bancoVazio();
    const executores = montarExecutores({ banco, log, armazenamento: new ArmazenamentoMemoria(), catalogo: { registrar: async () => ({ id: 'x' }) } as never, agora: () => AGORA, faturamento: fat });
    expect(executores.map((e) => e.tipo)).toEqual(expect.arrayContaining([TRABALHO_TRANSMITIR_NOTA, TRABALHO_PROCESSAR_EVENTO, TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_CONSULTAR_NOTA]));
    expect(fat.executores.map((e) => e.tipo)).toEqual([TRABALHO_TRANSMITIR_NOTA, TRABALHO_PROCESSAR_EVENTO, TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_CONSULTAR_NOTA]);
    expect(montarRotinas({ banco, log, faturamento: fat }).map((r) => r.id)).toEqual(expect.arrayContaining(['faturamento.alerta_inutilizacao']));
    expect(montarPeriodicas({ faturamento: fat }).map((r) => r.id)).toEqual(['faturamento.varredura']);
  });

  it('sem a chave do A1 (faturamento ausente): nenhum trabalho da SEFAZ, mas o consumidor do pedido aprovado continua', () => {
    const { banco } = bancoVazio();
    const executores = montarExecutores({ banco, log, armazenamento: new ArmazenamentoMemoria(), catalogo: {} as never, agora: () => AGORA });
    expect(executores.map((e) => e.tipo).filter((t) => t.startsWith('faturamento.'))).toEqual([]);
    expect(montarPeriodicas({})).toEqual([]);
    expect(montarRotinas({ banco, log }).map((r) => r.id).filter((id) => id.startsWith('faturamento.'))).toEqual([]);
  });

  it('o executor valida o payload pelo contrato: sem nota_id desiste (ZodError), sem tocar a SEFAZ', async () => {
    const fat = montar();
    const transmitir = fat.executores.find((e) => e.tipo === TRABALHO_TRANSMITIR_NOTA)!;
    await expect(transmitir.executar({ id: 'x', tipo: TRABALHO_TRANSMITIR_NOTA, tenant_id: T1, payload: {}, tentativas: 0 }, {} as Transacao)).rejects.toThrow(/nota_id/);
  });

  it('a varredura só entra nos tenants com a licença do faturamento', async () => {
    const { banco, tenants } = bancoVazio();
    const fat = montarFaturamentoWorker({
      banco, chaveA1: Buffer.alloc(32, 7), log, tenants: fonteTenants([T1, T2]),
      licencas: licencas({ [T1]: [{ modulo: 'faturamento', ativo: true, valido_ate: null }], [T2]: [{ modulo: 'pedido', ativo: true, valido_ate: null }] }),
    });
    expect(await fat.periodicas[0]!.executar(AGORA)).toEqual({ tenants: 1, notas: 0, eventos: 0, titulos: 0, titulos_pendentes: 0, falhas: 0 });
    expect(new Set(tenants)).toEqual(new Set([T1, T2])); // T2 só é aberto para ler a licença
  });

  it('RN-FAT-03: a varredura também procura notas de boleto sem título (há 5 min, até 50), só no tenant licenciado; a falha dela não para as notas', async () => {
    const buscas: { tenant: string; params: unknown[] }[] = [];
    let atual = '';
    const tx = {
      consultar: async (sql: string, params: unknown[] = []) => {
        if (/NOT EXISTS \(SELECT 1 FROM faturamento\.titulo/.test(sql)) {
          buscas.push({ tenant: atual, params });
          if (atual === T2) throw new Error('falha simulada');
        }
        return [];
      },
    } as unknown as Transacao;
    const banco: Banco = { comTenant: async (t, fn) => ((atual = t), fn(tx)), semTenant: async (fn) => fn(tx), ping: async () => true };
    const lic = [{ modulo: 'faturamento' as const, ativo: true, valido_ate: null }];
    const fat = montarFaturamentoWorker({ banco, chaveA1: Buffer.alloc(32, 7), log, tenants: fonteTenants([T1, T2, 'sem-licenca']), licencas: licencas({ [T1]: lic, [T2]: lic }) });
    const r = await fat.periodicas[0]!.executar(AGORA);
    expect(buscas).toEqual([
      { tenant: T1, params: [TITULOS_PARADOS_HA_MINUTOS, LIMITE_VARREDURA_TITULOS, []] },
      { tenant: T2, params: [TITULOS_PARADOS_HA_MINUTOS, LIMITE_VARREDURA_TITULOS, []] },
    ]);
    expect([TITULOS_PARADOS_HA_MINUTOS, LIMITE_VARREDURA_TITULOS]).toEqual([5, 50]);
    expect(r).toMatchObject({ tenants: 2, falhas: 1, titulos: 0 });
  });

  it('logFaturamentoDoWorker: uma linha warn com modulo e só os campos do faturamento', () => {
    const linhas: unknown[][] = [];
    logFaturamentoDoWorker({ warn: (...a: unknown[]) => linhas.push(a) } as never)({ evento: 'faturamento.titulo.geracao_pendente', tenant_id: T1, nota_id: NOTA, motivo: 'RN-FAT-06@prazos' });
    expect(linhas).toEqual([[{ modulo: 'faturamento', evento: 'faturamento.titulo.geracao_pendente', tenant_id: T1, nota_id: NOTA, motivo: 'RN-FAT-06@prazos' }, 'faturamento.titulo.geracao_pendente']]);
  });
});

describe('barreira (a): filial em produção fiscal nunca chega ao simulador (regra 7)', () => {
  it('o seletor do worker lança SimuladorEmProducaoErro e a fábrica do simulador não é chamada, mesmo com o ambiente "tentador"', () => {
    const chamadas: DestinoSimulador[] = [];
    const real = criarFabricaSimulador();
    const sefaz = criarSefazDoWorker({ simulador: (d) => (chamadas.push(d), real(d)) });
    expect(() => sefaz(producao, credencial)).toThrow(SimuladorEmProducaoErro);
    expect(chamadas).toEqual([]);
    expect(sefaz(homologacao, credencial).destino).toMatchObject({ tipo: 'simulador', ambiente: 'homologacao', tpAmb: 2 });
    expect(chamadas).toHaveLength(1);
  });

  it('o trabalho faturamento.transmitir_nota desiste na hora (ErroApi 422 SEFAZ_SIMULADOR_EM_PRODUCAO); falha de rede segue no backoff', async () => {
    const emProducao = await erroDoTransmissor(new SimuladorEmProducaoErro(FILIAL));
    expect(emProducao).toBeInstanceOf(ErroApi);
    expect(emProducao).toMatchObject({ status: 422, codigo: 'SEFAZ_SIMULADOR_EM_PRODUCAO' });
    const rede = await erroDoTransmissor(new ErroSefaz('SEFAZ_FALHA_TRANSPORTE', 'autorizar: tempo esgotado'));
    expect(rede).not.toBeInstanceOf(ErroApi);
    expect(rede).toMatchObject({ codigo: 'SEFAZ_FALHA_TRANSPORTE' });
  });
});

describe('erros do estado do simulador no Postgres (T-0045 §9)', () => {
  it('SEFAZ_SIMULADOR_ESGOTADO é configuração: ErroApi 422, o trabalho desiste na hora', async () => {
    const e = await erroDoTransmissor(new SequenciaSimuladorEsgotadaErro('nProt'));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 422, codigo: 'SEFAZ_SIMULADOR_ESGOTADO' });
  });

  it('ErroEstadoSimuladorPg (falha do banco do simulador) sobe como está: retentável, segue o backoff', async () => {
    const e = await erroDoTransmissor(new ErroEstadoSimuladorPg('gravarNota', '40001'));
    expect(e).not.toBeInstanceOf(ErroApi);
    expect(e).toBeInstanceOf(ErroEstadoSimuladorPg);
  });
});

/** O que sobe do executor `faturamento.transmitir_nota` quando o transmissor lança `erro` (aqui, pelo banco; no db test, pelo seletor). */
async function erroDoTransmissor(erro: Error): Promise<unknown> {
  const fat = montarFaturamentoWorker({
    banco: { comTenant: async () => Promise.reject(erro), semTenant: async () => Promise.reject(erro), ping: async () => true },
    chaveA1: Buffer.alloc(32, 7), log, tenants: fonteTenants([]), licencas: licencas({}),
  });
  const transmitir = fat.executores.find((e) => e.tipo === TRABALHO_TRANSMITIR_NOTA)!;
  return transmitir.executar({ id: 'x', tipo: TRABALHO_TRANSMITIR_NOTA, tenant_id: T1, payload: { nota_id: NOTA }, tentativas: 0 }, {} as Transacao).then(
    () => null,
    (e: unknown) => e,
  );
}

describe('barreira (b): o worker não tem a fábrica da SEFAZ real', () => {
  it('o transporte da homologação é constante (simulador) e o ambiente não o muda', () => {
    expect(TRANSPORTE_HOMOLOGACAO_DO_WORKER).toBe('simulador');
    const t = criarSefazDoWorker()(homologacao, credencial);
    expect(t.destino.tipo).toBe('simulador');
    expect(t.destino).not.toHaveProperty('urls');
  });

  it('o código do worker (sem os comentários) não importa o transporte SOAP real, não lê variável da SEFAZ e não pede o transporte "sefaz"', () => {
    const pasta = dirname(fileURLToPath(import.meta.url));
    const fontes = readdirSync(pasta).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
    expect(fontes).toContain('faturamento.ts');
    for (const nome of fontes) {
      // Só o código (os comentários podem citar a T-0046 e a fábrica SOAP).
      const src = readFileSync(join(pasta, nome), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(src, nome).not.toMatch(/criarFabricaTransporteSoap|OpcoesTransporteSoap/);
      expect(src, nome).not.toMatch(/MACUXIERP_SEFAZ/);
      expect(src, nome).not.toMatch(/transporte:\s*['"]sefaz['"]/);
    }
  });
});

describe('A1 só em memória no worker (ADR 0005 item 4, regras 8 e 9)', () => {
  it('abrirA1 que lança (A1 ilegível): o ErroCertificadoA1 sobe e o pfx decifrado é zerado', async () => {
    leitura.pfx = Buffer.from('nao-e-um-pkcs12-de-verdade');
    leitura.senha = 'senha-secreta-de-teste';
    const lerA1 = criarLerA1DoWorker(Buffer.alloc(32, 7));
    await expect(lerA1({} as Transacao, FILIAL)).rejects.toBeInstanceOf(ErroCertificadoA1);
    expect(leitura.pfx.every((b) => b === 0)).toBe(true);
  });

  it('a credencial do mTLS é o próprio objeto do core (a ocultação de pfx e senha é testada no leitura-a1 do core)', async () => {
    const { gerarA1DeTeste } = await import('@macuxierp/nfe-sefaz/teste');
    const a1 = gerarA1DeTeste();
    leitura.pfx = Buffer.from(a1.pfx);
    leitura.senha = a1.senha;
    const aberto = await criarLerA1DoWorker(Buffer.alloc(32, 7))({} as Transacao, FILIAL);
    expect(aberto?.credencial).toBe(leitura.ultimo);
    expect(aberto?.credencial.pfx).toBe(leitura.pfx);
  });
});

describe('RN-FAT-01: alerta das numeradas não enviadas (antes do dia 10)', () => {
  it('o corte é a 0 h do dia 1 em Manaus; o prazo é o dia 10 do mês seguinte ao da emissão (data civil de Manaus)', () => {
    expect(inicioDoMesEmManaus(AGORA).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(inicioDoMesEmManaus(new Date('2026-12-01T03:59:00Z')).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // ainda 30/11 em Manaus
    expect(prazoInutilizacao(new Date('2026-11-01T03:30:00Z'))).toBe('2026-11-10'); // 31/10 23h30 em Manaus
    expect(prazoInutilizacao(new Date('2026-12-15T12:00:00Z'))).toBe('2027-01-10');
  });

  it('avisa cada nota no log (só ids, série, número e prazo) e conta as atrasadas; tenant sem licença fica de fora', async () => {
    const { log: pinoLog, registros } = pinoEmMemoria();
    const cortes: string[] = [];
    const { banco } = bancoVazio();
    const rotina = criarAlertaNumeradasNaoEnviadas({
      banco,
      log: pinoLog,
      tenantsLicenciados: async () => [T1],
      notas: {
        numeradasNaoEnviadas: async (_tx, antesDe) => {
          cortes.push(antesDe.toISOString());
          return [
            { id: NOTA, filial_id: FILIAL, ambiente: 'homologacao', serie: 1, numero: 7, status: 'rejeitada', emitida_em: '2026-10-20T15:00:00.000Z' },
            { id: NOTA.replace(/a/g, 'b'), filial_id: FILIAL, ambiente: 'homologacao', serie: 1, numero: 3, status: 'rascunho', emitida_em: '2026-09-02T15:00:00.000Z' },
          ];
        },
      },
    });
    expect(rotina).toMatchObject({ id: 'faturamento.alerta_inutilizacao', horaUtc: 11 });
    expect(await rotina.executar(AGORA)).toEqual({ tenants: 1, notas: 2, atrasadas: 1, falhas: 0 });
    expect(cortes).toEqual(['2026-11-01T04:00:00.000Z']);
    const avisos = registros().filter((r) => r.rotina === 'faturamento.alerta_inutilizacao');
    expect(avisos.map((a) => [a.numero, a.prazo, a.atrasada])).toEqual([[7, '2026-11-10', false], [3, '2026-10-10', true]]);
    expect(avisos[0]).toMatchObject({ modulo: 'faturamento', tenant_id: T1, nota_id: NOTA, serie: 1, status: 'rejeitada' });
  });
});
