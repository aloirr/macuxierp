/**
 * Worker da F1 (T-0029): exportação LGPD (RF-CORE-06), alerta diário do A1 (RF-CORE-04, RN-CORE-06), rotinas diárias
 * e a fila com um executor dublê da consulta de IE (D5). Sem dado pessoal no log nem no resultado do trabalho.
 */
import { Writable } from 'node:stream';
import { inflateRawSync, crc32 } from 'node:zlib';
import { TRABALHO_EXPORTAR } from '@macuxierp/core/contracts';
import { ArmazenamentoMemoria, ErroApi, erros, type StatusErroApi, type CatalogoArquivos, type ExecutorTrabalho, type RegistroArquivo, type Transacao } from '@macuxierp/platform-sdk';
import { BancoMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { criarRotinaAlertaA1, diasParaVencer, precisaAlertaA1, type AvisoA1, type CertificadoVencendo } from './alerta-a1';
import { criarExecutorExportacao, type RegistroExportacoes } from './exportacao-lgpd';
import { ReservaTrabalhosMemoria } from './memoria';
import { RegistroExecutoresInvalido, registrarExecutores } from './modulos';
import { rodarRotinas, type EstadoRotinas, type RotinaDiaria } from './rotinas';
import { processarTrabalhos } from './trabalhos';
import { criarZip } from './zip';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const EXP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FILIAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const AGORA = new Date('2026-11-21T15:00:00Z');
const DIA = 86_400_000;
const silencioso = pino({ level: 'silent' });

function logEm(linhas: string[]) {
  return pino({ level: 'info' }, new Writable({ write: (c, _e, cb) => (linhas.push(String(c)), cb()) }));
}

/** Lê o .zip pelo diretório central e confere o CRC de cada entrada. */
function lerZip(zip: Buffer): Record<string, string> {
  const fim = zip.length - 22;
  expect(zip.readUInt32LE(fim)).toBe(0x06054b50);
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const saida: Record<string, string> = {};
  for (let i = 0; i < total; i++) {
    const [crc, comp, tam, nlen, off] = [zip.readUInt32LE(p + 16), zip.readUInt32LE(p + 20), zip.readUInt32LE(p + 24), zip.readUInt16LE(p + 28), zip.readUInt32LE(p + 42)];
    const nome = zip.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const ini = off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28);
    const dados = inflateRawSync(zip.subarray(ini, ini + comp));
    expect([dados.length, crc32(dados)]).toEqual([tam, crc]);
    saida[nome] = dados.toString('utf8');
    p += 46 + nlen;
  }
  return saida;
}

describe('zip mínimo', () => {
  it('gera um zip legível com nome UTF-8 e recusa nome perigoso ou repetido', () => {
    const z = criarZip([{ nome: 'a.json', conteudo: Buffer.from('{"x":1}') }, { nome: 'ção.json', conteudo: Buffer.alloc(5000, 'a') }], AGORA);
    expect(lerZip(z)).toEqual({ 'a.json': '{"x":1}', 'ção.json': 'a'.repeat(5000) });
    expect(() => criarZip([{ nome: '../x', conteudo: Buffer.alloc(1) }], AGORA)).toThrow(RangeError);
    expect(() => criarZip([{ nome: 'a', conteudo: Buffer.alloc(1) }, { nome: 'a', conteudo: Buffer.alloc(1) }], AGORA)).toThrow(RangeError);
  });
});

class RegistroExportacoesMemoria implements RegistroExportacoes {
  readonly linhas = new Map<string, { estado: 'pendente' | 'gerando' | 'pronta' | 'falhou' | 'expirada'; arquivo_id?: string; tenant: string | null }>();
  async estado(tx: Transacao, id: string) {
    const l = this.linhas.get(id);
    return l && l.tenant === tenantDaTx(tx) ? l.estado : null; // RLS: outro tenant não enxerga
  }
  async concluir(_tx: Transacao, id: string, arquivoId: string) {
    Object.assign(this.linhas.get(id)!, { estado: 'pronta', arquivo_id: arquivoId });
  }
  async falhar(_tx: Transacao, id: string) {
    this.linhas.get(id)!.estado = 'falhou';
  }
}

class CatalogoMemoria implements CatalogoArquivos {
  readonly registros: RegistroArquivo[] = [];
  async inserir(_tx: Transacao, r: RegistroArquivo) {
    this.registros.push(r);
  }
}

function cenarioExportacao(exportar: (tx: Transacao) => Promise<Record<string, readonly unknown[]>>) {
  const registro = new RegistroExportacoesMemoria();
  registro.linhas.set(EXP, { estado: 'pendente', tenant: T1 });
  const armazenamento = new ArmazenamentoMemoria();
  const catalogo = new CatalogoMemoria();
  const banco = new BancoMemoria();
  const fila = new ReservaTrabalhosMemoria();
  const relogio = new RelogioFixo(AGORA);
  const executor = criarExecutorExportacao({ registro, exportadores: [{ modulo: 'cadastros', exportar }], armazenamento, catalogo, agora: () => relogio.agora() });
  fila.adicionar('10000000-0000-4000-8000-000000000001', { tipo: TRABALHO_EXPORTAR, tenant_id: T1, payload: { exportacao_id: EXP } }, AGORA);
  const logs: string[] = [];
  const d = { banco, fila, executores: registrarExecutores([executor]), relogio, log: logEm(logs) };
  return { registro, armazenamento, catalogo, fila, relogio, d, logs, executor };
}

describe('exportação LGPD (RF-CORE-06, RN-CORE-07)', () => {
  const CLIENTE = { id: 'c1', razao_social: 'Fulano da Silva ME', documento: '12345678909' };

  it('gera o zip com o manifesto e o JSON de cada módulo na transação do tenant, cataloga e marca pronta', async () => {
    const c = cenarioExportacao(async (tx) => ({ clientes: tenantDaTx(tx) === T1 ? [CLIENTE] : [] }));
    expect(await processarTrabalhos(c.d)).toMatchObject({ concluidos: 1 });
    const chave = `macuxierp/${T1}/exportacoes/${EXP}.zip`;
    const arquivos = lerZip(Buffer.from(c.armazenamento.objetos.get(chave)!.corpo));
    expect(JSON.parse(arquivos['cadastros.json']!)).toEqual({ modulo: 'cadastros', tabelas: { clientes: [CLIENTE] } });
    expect(JSON.parse(arquivos['manifesto.json']!)).toMatchObject({ tenant_id: T1, exportacao_id: EXP, modulos: ['cadastros'], linhas: { cadastros: 1 } });
    expect(c.catalogo.registros[0]).toMatchObject({ chave_s3: chave, tipo: 'application/zip', imutavel: false, guarda_ate: null });
    expect(c.registro.linhas.get(EXP)).toMatchObject({ estado: 'pronta', arquivo_id: c.catalogo.registros[0]!.id });
    // dado pessoal só no arquivo: nem no resultado do trabalho nem no log
    const fora = JSON.stringify(c.fila.linhas[0]!.resultado) + c.logs.join('');
    for (const proibido of ['Fulano', '12345678909']) expect(fora).not.toContain(proibido);
  });

  it('idempotente: exportação já pronta não gera de novo; exportação de outro tenant (RLS) não é tocada', async () => {
    const c = cenarioExportacao(async () => ({}));
    c.registro.linhas.get(EXP)!.estado = 'pronta';
    c.fila.adicionar('10000000-0000-4000-8000-000000000002', { tipo: TRABALHO_EXPORTAR, tenant_id: T2, payload: { exportacao_id: EXP } }, AGORA);
    expect(await processarTrabalhos(c.d)).toMatchObject({ concluidos: 2 });
    expect(c.fila.linhas.map((l) => l.resultado?.estado)).toEqual(['pronta', 'ausente']);
    expect(c.armazenamento.objetos.size).toBe(0);
  });

  it('depois da última tentativa a exportação vira falhou (aoDesistir), sem o texto do erro no log', async () => {
    const c = cenarioExportacao(async () => {
      throw new Error('falha lendo Fulano da Silva');
    });
    for (let i = 0; i < 3; i++) {
      await processarTrabalhos(c.d);
      c.relogio.avancar(3_600_000);
    }
    expect(c.fila.linhas[0]).toMatchObject({ estado: 'falhou', tentativas: 3 });
    expect(c.registro.linhas.get(EXP)!.estado).toBe('falhou');
    expect(c.logs.join('')).not.toContain('Fulano');
  });
});

describe('alerta diário do A1 (RF-CORE-04)', () => {
  it('dias para vencer e a regra dos 30 dias, inclusive o vencido (RN-CORE-06)', () => {
    expect(diasParaVencer(new Date(AGORA.getTime() + 30 * DIA), AGORA)).toBe(30);
    expect(diasParaVencer(new Date(AGORA.getTime() + 29.5 * DIA), AGORA)).toBe(30);
    expect(precisaAlertaA1(new Date(AGORA.getTime() + 30 * DIA), AGORA)).toBe(true);
    expect(precisaAlertaA1(new Date(AGORA.getTime() + 30 * DIA + 1), AGORA)).toBe(false);
    expect(precisaAlertaA1(new Date(AGORA.getTime() - DIA), AGORA)).toBe(true);
  });

  function cenarioA1() {
    const banco = new BancoMemoria();
    const certs: Record<string, CertificadoVencendo[]> = {
      [T1]: [
        { id: 'a1-vence-10', filial_id: FILIAL, valido_ate: new Date(AGORA.getTime() + 10 * DIA) },
        { id: 'a1-vence-31', filial_id: FILIAL, valido_ate: new Date(AGORA.getTime() + 31 * DIA) },
      ],
      [T2]: [{ id: 'a1-vencido', filial_id: FILIAL, valido_ate: new Date(AGORA.getTime() - DIA) }],
    };
    const avisos = new Map<string, AvisoA1 & { tenant: string | null }>();
    const logs: string[] = [];
    const rotina = criarRotinaAlertaA1({
      banco,
      tenants: { ativos: async (tx) => (tenantDaTx(tx) === null ? [T1, T2] : []) },
      // a fonte filtra por limite, mas a rotina confere de novo a regra (o 31 não passa)
      certificados: { vencendoAte: async (tx) => certs[tenantDaTx(tx)!] ?? [] },
      avisos: {
        registrarA1: async (tx, a) => {
          const chave = `${a.certificado_id}|${a.dia}`;
          if (avisos.has(chave)) return false;
          avisos.set(chave, { ...a, tenant: tenantDaTx(tx) });
          return true;
        },
      },
      log: logEm(logs),
    });
    return { banco, avisos, rotina, logs };
  }

  it('avisa por tenant, na RLS dele, uma vez por certificado e por dia', async () => {
    const c = cenarioA1();
    expect(await c.rotina.executar(AGORA)).toEqual({ tenants: 2, avisos: 2, repetidos: 0, falhas: 0 });
    expect([...c.avisos.values()].map((a) => [a.tenant, a.certificado_id, a.dias, a.dia])).toEqual([
      [T1, 'a1-vence-10', 10, '2026-11-21'],
      [T2, 'a1-vencido', -1, '2026-11-21'],
    ]);
    expect(c.banco.aberturas).toEqual([null, T1, T2]);
    expect(await c.rotina.executar(AGORA)).toMatchObject({ avisos: 0, repetidos: 2 });
  });

  it('um tenant com erro não segura os outros e o log leva só o nome do erro', async () => {
    const c = cenarioA1();
    const original = c.banco.comTenant.bind(c.banco);
    c.banco.comTenant = async (t, fn) => {
      if (t === T1) throw new Error('certificado de Fulano 12345678909');
      return original(t, fn);
    };
    expect(await c.rotina.executar(AGORA)).toMatchObject({ tenants: 2, avisos: 1, falhas: 1 });
    expect(c.logs.join('')).toContain('"tenant_id":"' + T1);
    expect(c.logs.join('')).not.toContain('Fulano');
  });
});

describe('rotinas diárias', () => {
  it('rodam uma vez por dia a partir da hora UTC; falha espera 15 min', async () => {
    let n = 0;
    let quebrar = true;
    const r: RotinaDiaria = { id: 'core.alerta_a1', horaUtc: 11, executar: async () => { n++; if (quebrar) throw new Error('banco fora'); return { avisos: 0 }; } };
    const estado: EstadoRotinas = new Map();
    const em = (iso: string) => rodarRotinas([r], estado, new Date(iso), silencioso);
    expect(await em('2026-11-21T10:59:00Z')).toBe(0);
    expect(await em('2026-11-21T11:00:00Z')).toBe(0); // falhou
    expect(await em('2026-11-21T11:10:00Z')).toBe(0); // ainda na espera
    quebrar = false;
    expect(await em('2026-11-21T11:15:00Z')).toBe(1);
    expect(await em('2026-11-21T23:00:00Z')).toBe(0); // já rodou hoje
    expect(await em('2026-11-22T11:00:00Z')).toBe(1);
    expect(n).toBe(3);
  });
});

describe('fila de trabalhos com o executor da consulta de IE (dublê do cadastros, D5)', () => {
  function cenarioIe(sefaz: () => Promise<{ situacao: string }>) {
    const gravados: { tenant: string | null; chave: string }[] = [];
    const executor: ExecutorTrabalho = {
      tipo: 'cadastros.consultar_ie',
      async executar(t, tx) {
        const r = await sefaz();
        const chave = `${String(t.payload.uf)}:${String(t.payload.documento)}`;
        if (!gravados.some((g) => g.chave === chave && g.tenant === tenantDaTx(tx))) gravados.push({ tenant: tenantDaTx(tx), chave });
        return { situacao: r.situacao };
      },
    };
    const fila = new ReservaTrabalhosMemoria();
    fila.adicionar('20000000-0000-4000-8000-000000000001', { tipo: 'cadastros.consultar_ie', tenant_id: T1, payload: { filial_id: FILIAL, uf: 'AM', documento: '11222333000181' } }, AGORA);
    const relogio = new RelogioFixo(AGORA);
    return { fila, gravados, relogio, d: { banco: new BancoMemoria(), fila, executores: registrarExecutores([executor]), relogio, log: silencioso } };
  }

  it('SEFAZ fora (503) segue o backoff; depois conclui na transação do tenant', async () => {
    let fora = true;
    const c = cenarioIe(async () => {
      if (fora) throw erros.indisponivel('SEFAZ');
      return { situacao: 'habilitada' };
    });
    expect(await processarTrabalhos(c.d)).toMatchObject({ falhas: 1 });
    fora = false;
    c.relogio.avancar(10_000);
    expect(await processarTrabalhos(c.d)).toMatchObject({ concluidos: 1 });
    expect(c.fila.linhas[0]).toMatchObject({ estado: 'concluido', resultado: { situacao: 'habilitada' } });
    expect(c.gravados).toEqual([{ tenant: T1, chave: 'AM:11222333000181' }]);
  });

  it('erro de negócio (422 RN) desiste na hora, sem gastar tentativas', async () => {
    const c = cenarioIe(async () => {
      throw erros.regra('RN-CORE-06', 'Certificado vencido');
    });
    expect(await processarTrabalhos(c.d)).toMatchObject({ desistidos: 1 });
    expect(c.fila.linhas[0]).toMatchObject({ estado: 'falhou', tentativas: 1 });
  });

  it('desiste na hora só em 400, 403, 404 e 422; 409 e 429 seguem o backoff', async () => {
    const desfecho = async (status: StatusErroApi) => {
      const c = cenarioIe(async () => {
        throw new ErroApi(status, 'TESTE', 'erro de teste');
      });
      const resumo = await processarTrabalhos(c.d);
      return [status, resumo.desistidos === 1 ? 'desiste' : 'backoff', c.fila.linhas[0]?.estado];
    };
    const casos = [];
    for (const s of [400, 403, 404, 422, 409, 429] as const) casos.push(await desfecho(s));
    expect(casos).toEqual([
      [400, 'desiste', 'falhou'],
      [403, 'desiste', 'falhou'],
      [404, 'desiste', 'falhou'],
      [422, 'desiste', 'falhou'],
      [409, 'backoff', 'pendente'],
      [429, 'backoff', 'pendente'],
    ]);
  });

  it('registro recusa tipo fora do padrão e executor repetido', () => {
    const ex = (tipo: string): ExecutorTrabalho => ({ tipo, executar: async () => null });
    expect(() => registrarExecutores([ex('consultar_ie')])).toThrow(RegistroExecutoresInvalido);
    expect(() => registrarExecutores([ex('cadastros.consultar_ie'), ex('cadastros.consultar_ie')])).toThrow(RegistroExecutoresInvalido);
    expect(registrarExecutores([ex('cadastros.consultar_ie'), ex(TRABALHO_EXPORTAR)])).toHaveLength(2);
  });
});
