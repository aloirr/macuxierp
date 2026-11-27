/**
 * RD-2313, teste da corrida do espelho: a escrita do payload normalizado é condicionada ao hash lido (`gravarNormalizados`).
 * Duas gravações concorrentes com o mesmo hash lido não duplicam (uma linha, uma só vence) e a atualização do evento novo
 * nunca se perde. Contra o PostgreSQL real (papel macuxierp_worker, RLS); sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRegistro, type RegistroEspelho } from '../domain';
import { TEMPO_PREPARO_MS, admSql } from './apoio-conector-teste';
import { gravarNormalizados } from './envio-lote';
import { gravarRegistro } from './espelho';

const EM = new Date('2026-11-27T09:00:00.000Z');
const registro = (chave: string, nome: string): RegistroEspelho => {
  const payload = { external_id: chave, ativo: true, sku: `SKU-${chave}`, nome, unidade: 'UN' };
  return { entidade: 'produto', external_id: chave, alterado_em: EM.toISOString(), ativo: true, payload, hash: hashRegistro(payload), erp_id: null, fonte_refs: {}, };
};
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const portao = () => {
  let abrir!: () => void;
  const aberto = new Promise<void>((r) => { abrir = r; });
  return { aberto, abrir };
};

describe.skipIf(!PG_DISPONIVEL)('RD-2313: corrida do espelho pelo hash lido', { timeout: 30_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  let T: string;
  const linhas = (chave: string) =>
    adm("SELECT payload, hash, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'produto' AND registro_external_id = $2 AND deleted_at IS NULL", [T, chave]);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    banco = efemero.banco('macuxierp_worker', 4);
    adm = admSql(efemero);
    T = await criarTenant(efemero.admin, 'corrida-a', ['integracao-fdv']);
  }, TEMPO_PREPARO_MS);
  afterAll(async () => {
    await efemero?.remover();
  }, TEMPO_PREPARO_MS);

  it('RN-INF-03: duas normalizações concorrentes com o mesmo hash lido gravam uma vez só, sem duplicar a linha', async () => {
    const bruto = registro('CORRIDA-1', 'Bruto');
    await banco.comTenant(T, (tx) => gravarRegistro(tx, T, bruto, EM));
    const normalizado = registro('CORRIDA-1', 'Normalizado');
    const mudou = [{ n: normalizado, b: bruto }];
    const g = portao();
    // A grava e segura a transação aberta; B (mesmo hash lido) espera o lock da linha e, ao liberar, reavalia a condição
    const a = banco.comTenant(T, async (tx) => {
      const r = await gravarNormalizados(tx, T, 'produto', mudou, [normalizado.hash]);
      await g.aberto;
      return r;
    });
    await esperar(150);
    const b = banco.comTenant(T, (tx) => gravarNormalizados(tx, T, 'produto', mudou, [normalizado.hash]));
    await esperar(300);
    g.abrir();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.size, rb.size].sort()).toEqual([0, 1]);
    const l = await linhas('CORRIDA-1');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ hash: normalizado.hash, payload: { nome: 'Normalizado' } });
  });

  it.each([
    { primeiro: 'evento', gravaNormalizado: false, nome: 'evento novo no meio não se perde: a normalização com o hash lido velho não grava e a linha fica com o evento, pendente' },
    { primeiro: 'normalizacao', gravaNormalizado: true, nome: 'normalização que grava primeiro e evento depois: o evento prevalece (a atualização não se perde)' },
  ] as const)('RN-INF-03: $nome', async ({ primeiro, gravaNormalizado }) => {
    const chave = `CORRIDA-${primeiro}`;
    const bruto = registro(chave, 'Bruto');
    await banco.comTenant(T, (tx) => gravarRegistro(tx, T, bruto, EM));
    const normalizado = registro(chave, 'Normalizado');
    const evento = registro(chave, 'Evento novo');
    type Operacao = (tx: Parameters<typeof gravarRegistro>[0]) => Promise<unknown>;
    const gravarEvento = (tx: Parameters<typeof gravarRegistro>[0]) => gravarRegistro(tx, T, evento, new Date(EM.getTime() + 60_000));
    const normalizar = (tx: Parameters<typeof gravarRegistro>[0]) => gravarNormalizados(tx, T, 'produto', [{ n: normalizado, b: bruto }], [normalizado.hash]);
    const g = portao();
    const [primeira, segunda]: [Operacao, Operacao] = primeiro === 'evento' ? [gravarEvento, normalizar] : [normalizar, gravarEvento];
    const a = banco.comTenant(T, async (tx) => {
      const r = await primeira(tx);
      await g.aberto;
      return r;
    });
    await esperar(150);
    const b = banco.comTenant(T, (tx) => segunda(tx));
    await esperar(300);
    g.abrir();
    const [ra, rb] = await Promise.all([a, b]);
    const gravadas = primeiro === 'evento' ? rb : ra;
    expect((gravadas as { size: number }).size).toBe(gravaNormalizado ? 1 : 0);
    expect(((primeiro === 'evento' ? ra : rb) as { resultado: string }).resultado).toBe('gravado');
    const l = await linhas(chave);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ hash: evento.hash, payload: { nome: 'Evento novo' }, pendente: true });
  });
});
