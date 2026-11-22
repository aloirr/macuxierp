/**
 * Worker montado como no `main.ts` (T-0035, T-0040), no PostgreSQL migrado com o papel `macuxierp_worker` (RLS):
 * o alerta do A1 grava o aviso e, na segunda rodada do dia, não duplica; a exportação LGPD fecha com o catálogo real.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { randomUUID } from 'node:crypto';
import { TRABALHO_EXPORTAR } from '@macuxierp/core/contracts';
import { ArmazenamentoMemoria } from '@macuxierp/platform-sdk';
import { CatalogoArquivosPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarExecutores, montarRotinas } from './modulos';

const DIA_MS = 86_400_000;
const log = pino({ level: 'silent' });

describe.skipIf(!PG_DISPONIVEL)('worker montado com os adaptadores do core (PostgreSQL, papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let worker: BancoPg;
  let T: string;
  const filial = randomUUID();
  const agora = new Date();
  agora.setUTCHours(11, 0, 0, 0);

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    T = await criarTenant(b.admin, 'worker-a1');
    await b.admin.query(
      `INSERT INTO core.certificado (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, ativo)
       VALUES ($1, $2, $3, 'Titular Teste', '11222333000181', $4, $5, $6, $7, $8, $7, $9, true)`,
      [randomUUID(), T, filial, new Date(agora.getTime() - 300 * DIA_MS), new Date(agora.getTime() + 12 * DIA_MS), 'ef'.repeat(32), Buffer.from('PFX-CIFRADO'), Buffer.alloc(12, 1), Buffer.alloc(12, 2)],
    );
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  it('RF-CORE-04: a rotina montada grava o aviso do A1 e não duplica na segunda rodada do dia', async () => {
    const [alerta] = montarRotinas({ banco: worker, log });
    expect(await alerta!.executar(agora)).toMatchObject({ avisos: 1, repetidos: 0, falhas: 0 });
    expect(await alerta!.executar(agora)).toMatchObject({ avisos: 0, repetidos: 1, falhas: 0 });
    const { rows } = await b.admin.query('SELECT filial_id, dias, dia::text AS dia FROM core.aviso_a1 WHERE tenant_id = $1', [T]);
    expect(rows).toEqual([{ filial_id: filial, dias: 12, dia: agora.toISOString().slice(0, 10) }]);
  });

  it('RF-CORE-06: a exportação LGPD fica pronta, com o arquivo no catálogo', async () => {
    const id = randomUUID();
    await b.admin.query('INSERT INTO core.exportacao (id, tenant_id, pedido_por) VALUES ($1, $2, $3)', [id, T, randomUUID()]);
    const armazenamento = new ArmazenamentoMemoria();
    const [exportar] = montarExecutores({ banco: worker, log, armazenamento, catalogo: new CatalogoArquivosPg(), agora: () => agora });
    const r = await worker.comTenant(T, (tx) => exportar!.executar({ id: randomUUID(), tipo: TRABALHO_EXPORTAR, tenant_id: T, payload: { exportacao_id: id }, tentativas: 0 }, tx));
    expect(r).toMatchObject({ exportacao_id: id, estado: 'pronta' });
    const { rows } = await b.admin.query<{ estado: string; chave_s3: string }>(
      'SELECT e.estado, a.chave_s3 FROM core.exportacao e JOIN plataforma.arquivo a ON a.id = e.arquivo_id WHERE e.id = $1',
      [id],
    );
    expect(rows).toEqual([{ estado: 'pronta', chave_s3: `macuxierp/${T}/exportacoes/${id}.zip` }]);
    const zip = Buffer.from(armazenamento.objetos.get(rows[0]!.chave_s3)!.corpo).toString('latin1');
    expect(zip).toContain('core.json');
    expect(zip).toContain('pedido.json'); // T-0016: o exportador do pedido roda com o papel do worker
  });
});
