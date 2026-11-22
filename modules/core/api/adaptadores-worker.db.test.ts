/**
 * Adaptadores SQL do core para o worker contra o PostgreSQL real (T-0035 e T-0040): `macuxierp_worker` com RLS, banco
 * efêmero de `@macuxierp/platform-sdk/pg-testes`. Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 * O core não importa `apps/worker`: a rodada do alerta é montada aqui com os adaptadores e o `domain` (mesma lógica
 * de `criarRotinaAlertaA1`: limite exclusivo de agora + 31 dias e conferência com `alertaVencimento`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIAS_ALERTA_A1 } from '../contracts';
import { alertaVencimento, diasParaVencer } from '../domain/certificado';
import { cifrarA1 } from './cifra';
import { lerA1DecifradoDaFilial } from './leitura-a1';
import { avisosA1MaisRecentes, destinoAvisosSql, exportadorCore, fonteCertificadosSql, fonteTenantsSql, registroExportacoesSql } from './adaptadores-worker';

const DIA_MS = 86_400_000;
const AGORA = new Date('2026-11-21T11:00:00Z');
const DEPOIS = new Date('2026-11-22T12:00:00Z');
const dias = (n: number) => new Date(AGORA.getTime() + n * DIA_MS);

/** Uma rodada do alerta, como `criarRotinaAlertaA1`: devolve avisos novos e repetidos. */
async function rodada(banco: Banco, agora: Date) {
  const r = { avisos: 0, repetidos: 0 };
  const dia = agora.toISOString().slice(0, 10);
  const limite = new Date(agora.getTime() + (DIAS_ALERTA_A1 + 1) * DIA_MS);
  for (const tenant of await banco.semTenant((tx) => fonteTenantsSql.ativos(tx))) {
    await banco.comTenant(tenant, async (tx: Transacao) => {
      for (const c of await fonteCertificadosSql.vencendoAte(tx, limite)) {
        if (!alertaVencimento(c.valido_ate, agora)) continue;
        const novo = await destinoAvisosSql.registrarA1(tx, { certificado_id: c.id, filial_id: c.filial_id, valido_ate: c.valido_ate, dias: diasParaVencer(c.valido_ate, agora), dia });
        if (novo) r.avisos++;
        else r.repetidos++;
      }
    });
  }
  return r;
}

describe.skipIf(!PG_DISPONIVEL)('adaptadores do core para o worker (PostgreSQL real, papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let worker: Banco;
  let app: Banco;
  let T: string;
  let T2: string;
  const F30 = randomUUID(); // 30,5 dias: avisa
  const F31 = randomUUID(); // 31 dias: não avisa
  const FVENCIDO = randomUUID();
  const FOUTRO = randomUUID();
  const SENHA_A1 = 'senha-secreta-do-a1';
  const HASH = '$argon2id$hash-secreto-do-usuario';
  let certificado30: string;

  async function certificado(tenant: string, filial: string, validoAte: Date, ativo = true): Promise<string> {
    const id = randomUUID();
    await b.admin.query(
      `INSERT INTO core.certificado (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, ativo)
       VALUES ($1, $2, $3, 'Titular Teste', '11222333000181', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, tenant, filial, new Date(validoAte.getTime() - 365 * DIA_MS), validoAte, 'ab'.repeat(32), Buffer.from('PFX-CIFRADO-SECRETO'), Buffer.alloc(12, 1), Buffer.from(SENHA_A1), Buffer.alloc(12, 2), ativo],
    );
    return id;
  }

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    app = b.banco('macuxierp_app');
    T = await criarTenant(b.admin, 'empresa-a1');
    T2 = await criarTenant(b.admin, 'outra-a1');
    certificado30 = await certificado(T, F30, dias(30.5));
    await certificado(T, F31, dias(31));
    await certificado(T, FVENCIDO, dias(-3));
    await certificado(T2, FOUTRO, dias(10));
    await b.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa A1 LTDA', '11222333000181')", [T]);
    await b.admin.query("INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil) VALUES ($1, 'a@a1.test', 'Admin A1', $2, 'administrador')", [T, HASH]);
    await b.admin.query("INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil) VALUES ($1, 'o@a1.test', 'Outro Tenant', $2, 'administrador')", [T2, HASH]);
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  it('T-0035: o worker lista os tenants sem tenant na sessão', async () => {
    const ids = await worker.semTenant((tx) => fonteTenantsSql.ativos(tx));
    expect(ids).toEqual(expect.arrayContaining([T, T2]));
  });

  it('RN-CORE-06: vencendoAte usa valido_ate < limite (exclusivo): 30,5 dias entra, 31 dias não; vencido entra', async () => {
    const limite = dias(DIAS_ALERTA_A1 + 1);
    const achados = await worker.comTenant(T, (tx) => fonteCertificadosSql.vencendoAte(tx, limite));
    const filiais = achados.map((c) => c.filial_id);
    expect(filiais).toContain(F30);
    expect(filiais).toContain(FVENCIDO);
    expect(filiais).not.toContain(F31);
    expect(achados[0]?.valido_ate).toBeInstanceOf(Date);
  });

  it('RF-CORE-04: a rodada avisa o de 30,5 dias e o vencido, não o de 31 dias; a segunda rodada do dia não duplica', async () => {
    const primeira = await rodada(worker, AGORA);
    expect(primeira).toEqual({ avisos: 3, repetidos: 0 }); // T: 30,5 d e vencido; T2: 10 d
    const segunda = await rodada(worker, AGORA);
    expect(segunda).toEqual({ avisos: 0, repetidos: 3 });
    const { rows } = await b.admin.query('SELECT filial_id, dias, dia::text AS dia FROM core.aviso_a1 WHERE tenant_id = $1 ORDER BY dias DESC', [T]);
    expect(rows).toEqual([
      { filial_id: F30, dias: 30, dia: '2026-11-21' },
      { filial_id: FVENCIDO, dias: -3, dia: '2026-11-21' },
    ]);
    // outro dia, novo aviso do mesmo certificado; o de 31 dias hoje, amanhã tem 30 e entra
    const amanha = new Date(AGORA.getTime() + DIA_MS);
    expect((await rodada(worker, amanha)).avisos).toBe(4);
  });

  it('RLS: o worker só vê e só grava avisos do tenant da sessão; o app lê os do próprio tenant (selo do /eu)', async () => {
    const doT = await app.comTenant(T, (tx) => avisosA1MaisRecentes(tx, DEPOIS));
    expect(doT.map((a) => a.filial_id).sort()).toEqual([F30, F31, FVENCIDO].sort());
    expect(doT.every((a) => a.dia === '2026-11-22')).toBe(true); // o mais recente de cada filial
    const doT2 = await app.comTenant(T2, (tx) => avisosA1MaisRecentes(tx, DEPOIS));
    expect(doT2.map((a) => a.filial_id)).toEqual([FOUTRO]);
    // só certificado ativo e não excluído: o A1 trocado não acende o selo
    await b.admin.query("UPDATE core.certificado SET ativo = false WHERE id = $1", [certificado30]);
    const semTrocado = await app.comTenant(T, (tx) => avisosA1MaisRecentes(tx, DEPOIS));
    expect(semTrocado.map((a) => a.filial_id)).not.toContain(F30);
    await b.admin.query("UPDATE core.certificado SET ativo = true WHERE id = $1", [certificado30]);
    const certsT2 = await worker.comTenant(T2, (tx) => fonteCertificadosSql.vencendoAte(tx, dias(400)));
    expect(certsT2.map((c) => c.filial_id)).toEqual([FOUTRO]);
  });

  it('RF-CORE-04, RN-CORE-06: às 05h UTC o aviso de ontem ainda vale (dias recalculado); de anteontem não; certificado desativado não', async () => {
    const T3 = await criarTenant(b.admin, 'selo-a1');
    const D = new Date('2026-12-10T05:00:00Z');
    const validoAte = new Date('2026-12-25T10:00:00Z'); // 15,2 dias de D; ontem às 11h eram 15 dias e 23 h
    const fOntem = randomUUID();
    const fAnteontem = randomUUID();
    const fOff = randomUUID();
    const cOntem = await certificado(T3, fOntem, validoAte);
    const cAnte = await certificado(T3, fAnteontem, validoAte);
    const cOff = await certificado(T3, fOff, validoAte, false);
    const aviso = (c: string, f: string, dia: string, d: number) =>
      b.admin.query('INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia) VALUES ($1, $2, $3, $4, $5, $6::date)', [T3, c, f, validoAte, d, dia]);
    await aviso(cOntem, fOntem, '2026-12-09', 16);
    await aviso(cAnte, fAnteontem, '2026-12-08', 17);
    await aviso(cOff, fOff, '2026-12-09', 16);
    const selo = await app.comTenant(T3, (tx) => avisosA1MaisRecentes(tx, D));
    expect(selo.map((a) => a.filial_id)).toEqual([fOntem]);
    expect(selo[0]?.dias).toBe(diasParaVencer(validoAte, D)); // 15, não os 16 gravados ontem
    expect(selo[0]?.dias).toBe(15);
    expect(selo[0]?.dia).toBe('2026-12-09');
  });

  it('RF-CORE-06: estados da exportação: pendente vira pronta com o arquivo; pronta não volta; falhar só sai de pendente ou gerando', async () => {
    const e1 = randomUUID();
    const e2 = randomUUID();
    const e3 = randomUUID();
    for (const id of [e1, e2, e3]) await b.admin.query('INSERT INTO core.exportacao (id, tenant_id, pedido_por) VALUES ($1, $2, $3)', [id, T, randomUUID()]);
    const arquivo = randomUUID();
    await worker.comTenant(T, async (tx) => {
      expect(await registroExportacoesSql.estado(tx, e1)).toBe('pendente');
      expect(await registroExportacoesSql.estado(tx, randomUUID())).toBeNull();
      await registroExportacoesSql.concluir(tx, e1, arquivo, AGORA);
      expect(await registroExportacoesSql.estado(tx, e1)).toBe('pronta');
      await registroExportacoesSql.falhar(tx, e1, AGORA); // pronta não vira falhou
      expect(await registroExportacoesSql.estado(tx, e1)).toBe('pronta');
      await registroExportacoesSql.falhar(tx, e2, AGORA);
      expect(await registroExportacoesSql.estado(tx, e2)).toBe('falhou');
      await registroExportacoesSql.concluir(tx, e2, arquivo, AGORA); // falhou não vira pronta por aqui
      expect(await registroExportacoesSql.estado(tx, e2)).toBe('falhou');
    });
    const { rows } = await b.admin.query('SELECT arquivo_id, concluida_em FROM core.exportacao WHERE id = $1', [e1]);
    expect(rows[0]).toMatchObject({ arquivo_id: arquivo });
    expect(new Date(rows[0].concluida_em).toISOString()).toBe(AGORA.toISOString());
    // RLS: o outro tenant não enxerga a exportação
    expect(await worker.comTenant(T2, (tx) => registroExportacoesSql.estado(tx, e3))).toBeNull();
  });

  it('regras 8 e 9: o exportador leva as tabelas do tenant e nenhum segredo (hash de senha, A1 cifrado, senha do A1)', async () => {
    const tabelas = await worker.comTenant(T, (tx) => exportadorCore.exportar(tx));
    expect(Object.keys(tabelas).sort()).toEqual(['auditoria', 'aviso_a1', 'ambiente_fiscal', 'certificado', 'empresa', 'exportacao', 'licenca', 'parametro', 'usuario'].sort());
    expect(tabelas.empresa).toHaveLength(1);
    expect(tabelas.certificado).toHaveLength(3); // só os do tenant T
    expect(tabelas.usuario).toHaveLength(1);
    const json = JSON.stringify(tabelas);
    expect(json).not.toContain(HASH);
    expect(json).not.toContain(SENHA_A1);
    expect(json).not.toContain('PFX-CIFRADO-SECRETO');
    expect(json).not.toMatch(/senha_hash|pfx_cifrado|senha_cifrada|nonce|refresh/i);
    expect(json).not.toContain('Outro Tenant');
  });
});

describe.skipIf(!PG_DISPONIVEL)('T-0045/T-0021: leitura do A1 decifrado pelo worker (PostgreSQL real, RLS)', () => {
  let b: BancoEfemero;
  let worker: Banco;
  let A: string;
  let B: string;
  const chave = randomBytes(32);
  const FA = randomUUID();
  const FSEM = randomUUID();
  const FTROCADO = randomUUID();
  const PFX = Buffer.from('PFX-DB-SECRETO');
  const SENHA = 'senha-db-secreta';

  async function inserir(tenant: string, filial: string, ativo: boolean, pfx = PFX): Promise<string> {
    const id = randomUUID();
    const c = cifrarA1({ chave, tenantId: tenant, pfx, senha: SENHA });
    await b.admin.query(
      `INSERT INTO core.certificado (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, ativo)
       VALUES ($1, $2, $3, 'Titular', '11222333000181', now() - interval '1 day', now() + interval '300 days', $4, $5, $6, $7, $8, $9)`,
      [id, tenant, filial, 'cd'.repeat(32), c.pfx_cifrado, c.pfx_nonce, c.senha_cifrada, c.senha_nonce, ativo],
    );
    return id;
  }

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    A = await criarTenant(b.admin, 'leitura-a1-a');
    B = await criarTenant(b.admin, 'leitura-a1-b');
    await inserir(A, FA, true);
    await inserir(A, FTROCADO, false, Buffer.from('PFX-ANTIGO'));
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  it('RN-CORE-06: o worker lê o A1 da filial do próprio tenant, decifrado', async () => {
    const r = await worker.comTenant(A, (tx) => lerA1DecifradoDaFilial(tx, chave, FA));
    expect(r?.pfx.equals(PFX)).toBe(true);
    expect(r?.senha).toBe(SENHA);
  });

  it('RLS: no outro tenant, a mesma filial devolve null', async () => {
    expect(await worker.comTenant(B, (tx) => lerA1DecifradoDaFilial(tx, chave, FA))).toBeNull();
  });

  it('RN-CORE-06: filial sem A1 devolve null; certificado substituído (inativo) não é devolvido', async () => {
    expect(await worker.comTenant(A, (tx) => lerA1DecifradoDaFilial(tx, chave, FSEM))).toBeNull();
    expect(await worker.comTenant(A, (tx) => lerA1DecifradoDaFilial(tx, chave, FTROCADO))).toBeNull();
  });
});
