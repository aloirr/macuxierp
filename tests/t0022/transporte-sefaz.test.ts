// T-0022 (F4): o que o arnês das notas acrescenta ao contrato da T-0045 (desenho docs/desenho/T-0045.md §3.2): as
// FILIAIS da matriz no seletor, o contador por filial em volta da fábrica do simulador e o A1 fora do repositório.
// Os cStat, protocolos e eventos do simulador são do pacote (packages/sefaz-simulador/src/simulador.test.ts).
// O A1 de teste é gerado em tempo de execução (só na memória): nunca vai a arquivo do repositório nem a log.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SimuladorEmProducaoErro, type CredencialA1EmMemoria } from '../../packages/nfe-sefaz/src/index';
import {
  INSTANTE_DE_TESTE,
  VALIDADE_DE_TESTE,
  assinarXmlDeTeste,
  gerarA1DeTeste,
  montarNFeDeTeste,
  type A1DeTeste,
} from '../../packages/nfe-sefaz/src/teste/index';
import { FILIAIS, MATRIZ } from './apoio/matriz';
import { UUID_FILIAL, filialEmissora, montarSeletorDoLote } from './apoio/transporte';

const filiaisEm = (ambiente: 'homologacao' | 'producao') =>
  Object.entries(FILIAIS)
    .filter(([, f]) => f.ambiente === ambiente)
    .map(([id]) => id);

let a1: A1DeTeste;
let credencial: CredencialA1EmMemoria;
const espioes: MockInstance[] = [];

beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) espioes.push(vi.spyOn(console, m));
  a1 = gerarA1DeTeste({ ...VALIDADE_DE_TESTE });
  credencial = { pfx: a1.pfx, senha: a1.senha };
});

afterAll(() => {
  for (const e of espioes) e.mockRestore();
});

describe('T-0022/T-0045: FILIAIS da matriz no seletor, com o contador da fábrica (RN-CORE-08, RN-FAT-04, CLAUDE-7)', () => {
  it('filial em produção nunca alcança o simulador: SimuladorEmProducaoErro e 0 chamadas no contador', () => {
    const { seletor, contador } = montarSeletorDoLote();
    const emProducao = filiaisEm('producao');
    expect(emProducao.length).toBeGreaterThan(0);
    for (const id of emProducao) {
      expect(() => seletor(filialEmissora(id), credencial), id).toThrow(SimuladorEmProducaoErro);
      expect(contador.total(UUID_FILIAL[id]!), id).toBe(0);
    }
    expect(contador.fabricadas.size).toBe(0);
  });

  it('filiais em homologação: destino do simulador congelado, com o filial_id da própria filial', () => {
    const { seletor } = montarSeletorDoLote();
    for (const id of filiaisEm('homologacao')) {
      const { destino } = seletor(filialEmissora(id), credencial);
      expect(destino, id).toMatchObject({ tipo: 'simulador', filial_id: UUID_FILIAL[id] });
      expect(Object.isFrozen(destino), id).toBe(true);
    }
  });

  it('o contador registra a chamada só na filial que chamou; nenhuma resposta nem log traz o PFX, a senha ou a chave', async () => {
    const { seletor, contador } = montarSeletorDoLote({ agora: () => INSTANTE_DE_TESTE });
    const nota = MATRIZ[0]!;
    const filialId = UUID_FILIAL[nota.filial]!;
    const n = montarNFeDeTeste({ nNF: nota.numero, serie: nota.serie, dhEmi: new Date(INSTANTE_DE_TESTE.getTime() - 60_000) });
    const xml = assinarXmlDeTeste(n.xml, { elemento: 'infNFe', a1 });
    const r = await seletor(filialEmissora(nota.filial), credencial).autorizar({ idLote: '1', sincrono: true, nfes: [xml] });
    expect(r.protocolos).toHaveLength(1);

    expect([...contador.fabricadas.keys()]).toEqual([filialId]);
    expect([...contador.operacoes]).toEqual([[filialId, ['autorizar']]]);

    const linhaDaChave = a1.chavePrivadaPem.split('\n')[3]!;
    const segredos = [a1.senha, a1.pfx.toString('base64').slice(100, 160), a1.pfx.toString('hex').slice(200, 264), linhaDaChave];
    const logs = espioes.flatMap((e) => e.mock.calls.map((c) => c.map(String).join(' ')));
    for (const s of segredos) {
      for (const x of [r.xml, ...logs]) expect(x.includes(s)).toBe(false);
    }
  });
});

describe('T-0022: o A1 de teste nunca vai a arquivo do repositório', () => {
  it('nenhum .pfx/.p12 rastreado nem pendente no git', () => {
    let saida: string;
    try {
      saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.pfx', '*.p12', '*.PFX', '*.P12'], {
        encoding: 'utf8',
      });
    } catch {
      return; // fora de um checkout git (pacote publicado): nada a conferir
    }
    expect(saida.trim()).toBe('');
  });
});
