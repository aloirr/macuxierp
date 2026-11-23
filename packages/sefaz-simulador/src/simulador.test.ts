/**
 * A suíte do simulador (`suite-simulador.ts`) com a porta de estado EM MEMÓRIA (o padrão), mais a porta em memória
 * sozinha: esgotamento da numeração, a API anterior (`registro` sem `estado`) e a nota já gravada.
 */
import { describe, expect, it } from 'vitest';
import { a1DeTeste, autorizarUma, destinoDe, nfeAssinada, novoSimulador } from './apoio-teste';
import { SequenciaSimuladorEsgotadaErro, criarEstadoSimuladorMemoria, criarRegistroSimulador } from './index';
import { registrarSuiteSimulador } from './suite-simulador';

registrarSuiteSimulador({
  nome: 'memória',
  novoEstado: () => criarEstadoSimuladorMemoria(),
  sequenciaGlobal: false,
  guardaEpec: true,
});

describe('porta em memória', () => {
  it('numeração esgotada (999.999.999) é erro permanente e não repete número', async () => {
    a1DeTeste();
    const { s } = novoSimulador({ estado: criarEstadoSimuladorMemoria({ ultimo: { nProt: 999_999_998 } }) });
    expect((await autorizarUma(s, nfeAssinada({ nNF: 1 }).xml)).nProt).toMatch(/999999999$/);
    const erro = await s
      .autorizar({ idLote: '2', sincrono: true, nfes: [nfeAssinada({ nNF: 2 }).xml] })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(SequenciaSimuladorEsgotadaErro);
    expect(erro).toMatchObject({ codigo: 'SEFAZ_SIMULADOR_ESGOTADO', retentavel: false });
  });

  it('sem `estado`, o registro guarda a memória da SEFAZ (API anterior): dois simuladores do mesmo registro se enxergam', async () => {
    const registro = criarRegistroSimulador();
    const n = nfeAssinada({ nNF: 3 });
    await autorizarUma(novoSimulador({ registro }).s, n.xml);
    expect((await novoSimulador({ registro }).s.consultarProtocolo({ chNFe: n.chave })).cStat).toBe('100');
    expect((await novoSimulador().s.consultarProtocolo({ chNFe: n.chave })).cStat).toBe('217');
    expect(registro.proximo('nProt')).toBe(2);
  });

  it('gravarNota da mesma chave ou do mesmo número não grava e devolve a nota que já estava (base do 204/539 concorrente)', async () => {
    const repo = criarEstadoSimuladorMemoria();
    const d = destinoDe();
    const p = await autorizarUma(novoSimulador({ estado: repo }).s, nfeAssinada({ nNF: 4 }).xml);
    const nota = (await repo.notaPorChave(d, p.chNFe))!;
    expect(await repo.gravarNota(d, { ...nota, situacao: 'denegada' })).toBe(nota);
    expect(await repo.gravarNota(d, { ...nota, chNFe: '1'.repeat(44) })).toBe(nota);
    expect(await repo.notaPorChave(d, '1'.repeat(44))).toBeNull();
    expect(await repo.notaPorChaveParaAtualizar(d, p.chNFe)).toBe(nota);
  });
});
