/**
 * `operador.sh a1-teste` no PostgreSQL migrado (T-0080, ADR 0005 e 0008): a entrada `executarA1Teste` DE VERDADE no
 * papel `macuxierp_app` (o da API, com RLS), o leitor do upload (`LeitorPfxTls`) e o repositório do core. O A1 gravado
 * é aberto pelo caminho do worker (`lerA1DecifradoDaFilial` no `macuxierp_worker` + `abrirA1` do emissor): prova que a
 * cifra e o formato das colunas são os do core. Dados fictícios (CNPJ de exemplo com DV válido).
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { lerA1DecifradoDaFilial } from '@macuxierp/core/api';
import { abrirA1 } from '@macuxierp/nfe-emissor';
import type { Banco } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, PRAZO_HOOK_BANCO_MS, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executarA1Teste, lerArgsA1Teste, linhasA1Teste, RecusaA1Teste } from './a1-teste';

const AGORA = new Date('2026-11-24T02:00:00Z');
const DIA_MS = 86_400_000;
const CNPJ = '11222333000181';
const CNPJ_2 = '11444777000161';
const RAZAO = 'Comércio Fictício de Teste Ltda';
const RECADO_APROVACAO = 'R-20261121-120000-alexandre';

describe.skipIf(!PG_DISPONIVEL)('operador a1-teste no PostgreSQL migrado (macuxierp_app, RLS)', () => {
  let b: BancoEfemero;
  let app: Banco;
  let worker: Banco;
  let T: string;
  let TV: string;
  const chaveA1 = randomBytes(32);
  const F = { unica: randomUUID(), producao: randomUUID(), naoEmissora: randomUUID(), comUpload: randomUUID(), outraEmissora: randomUUID() };

  async function filial(tenant: string, id: string, o: { cnpj: string; emissora?: boolean; padrao?: boolean; inativa?: boolean }) {
    await b.admin.query(
      `INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao, emissora, nfe_serie, nfe_numero_inicial, deleted_at)
       VALUES ($1, $2, $3, $4, '1', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', $5, $6, 1, 1, $7)`,
      [id, tenant, o.cnpj, RAZAO, o.padrao ?? false, o.emissora ?? true, o.inativa ? AGORA : null],
    );
  }
  const um = async <L>(sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as L[];
  const certificados = (filialId: string) =>
    um<{ id: string; ativo: boolean; titular: string; cnpj: string; valido_de: Date; valido_ate: Date }>(
      'SELECT id, ativo, titular, cnpj::text AS cnpj, valido_de, valido_ate FROM core.certificado WHERE filial_id = $1 ORDER BY created_at',
      [filialId],
    );
  const auditorias = () => um<{ acao: string; entidade_id: string; antes: unknown; depois: Record<string, unknown> }>("SELECT acao, entidade_id, antes, depois FROM plataforma.auditoria WHERE acao = 'core.certificado.teste_gerado' ORDER BY ocorrido_em, id");
  const roda = (argv: string[], agora = AGORA) => executarA1Teste({ banco: app, chaveA1, agora: () => agora }, lerArgsA1Teste(['--operador', 'op.teste', ...argv]));

  beforeAll(async () => {
    b = await criarBancoEfemero();
    app = b.banco('macuxierp_app');
    worker = b.banco('macuxierp_worker');
    T = await criarTenant(b.admin, 'am2808', ['core', 'cadastros']);
    TV = await criarTenant(b.admin, 'rr1234', ['core', 'cadastros']); // várias filiais emissoras
    await b.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa AM', $2), ($3, 'Empresa RR', $4)", [T, CNPJ, TV, CNPJ_2]);
    await filial(T, F.unica, { cnpj: CNPJ, padrao: true });
    await filial(T, randomUUID(), { cnpj: '11222333000262', inativa: true }); // emissora inativa: não conta
    await filial(T, F.naoEmissora, { cnpj: '11222333000343', emissora: false });
    await filial(TV, F.producao, { cnpj: CNPJ_2 });
    await filial(TV, F.comUpload, { cnpj: '11444777000242' });
    await filial(TV, F.outraEmissora, { cnpj: '11444777000323' });
    await b.admin.query("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', $3)", [TV, F.producao, RECADO_APROVACAO]);
    // A1 do cliente ainda válido (upload), com colunas cifradas fictícias
    await b.admin.query(
      `INSERT INTO core.certificado (tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce)
       VALUES ($1, $2, 'Titular Cliente', '11444777000242', $3, $4, $5, '\\x00', $6, '\\x00', $7)`,
      [TV, F.comUpload, new Date(AGORA.getTime() - 10 * DIA_MS), new Date(AGORA.getTime() + 200 * DIA_MS), 'ab'.repeat(32), Buffer.alloc(12, 1), Buffer.alloc(12, 2)],
    );
  }, PRAZO_HOOK_BANCO_MS);
  afterAll(async () => {
    await b?.remover();
  });

  it('sem --confirmar: só o plano, numa transação só de leitura; nada gravado nem auditado', async () => {
    const r = await roda(['--empresa', 'AM2808']);
    expect(r).toMatchObject({ estado: 'simulacao', acao: 'gerar', tenant_id: T, filial_id: F.unica, ambiente: 'homologacao', anterior: null, certificado_id: null });
    expect(await certificados(F.unica)).toEqual([]);
    expect(await auditorias()).toEqual([]);
  });

  it('com --confirmar: A1 de teste ativo da única filial emissora, com o CNPJ e a razão social da filial, auditado e publicado', async () => {
    const r = await roda(['--empresa', 'am2808', '--confirmar']);
    expect(r).toMatchObject({ estado: 'gerado', acao: 'gerar', filial_id: F.unica, anterior: null });
    const [c] = await certificados(F.unica);
    expect(c).toMatchObject({ id: r.certificado_id, ativo: true, titular: 'COMERCIO FICTICIO DE TESTE LTDA', cnpj: CNPJ });
    expect(c!.valido_de.getTime()).toBe(AGORA.getTime() - DIA_MS);
    expect(c!.valido_ate.getTime()).toBe(AGORA.getTime() + 365 * DIA_MS);

    // o caminho do worker abre o A1: a cifra e as colunas são as do core
    const a1 = await worker.comTenant(T, (tx) => lerA1DecifradoDaFilial(tx, chaveA1, F.unica));
    expect(a1?.certificado_id).toBe(r.certificado_id);
    const aberto = abrirA1(a1!.pfx, a1!.senha, AGORA);
    expect(aberto.cnpj).toBe(CNPJ);

    const [aud] = await auditorias();
    expect(aud).toMatchObject({ entidade_id: r.certificado_id, antes: null });
    expect(aud!.depois).toMatchObject({ filial_id: F.unica, origem: 'teste', ambiente: 'homologacao', operador: 'op.teste', motivo: 'operador.sh a1-teste' });
    const [ev] = await um<{ nome: string; agregado_id: string }>("SELECT nome, agregado_id FROM plataforma.evento WHERE nome = 'core.certificado.alterado@1'");
    expect(ev).toEqual({ nome: 'core.certificado.alterado@1', agregado_id: r.certificado_id });

    // saída e auditoria sem CNPJ, razão social, senha nem PFX (regras 8 e 9)
    const texto = `${linhasA1Teste(r).join('\n')}\n${JSON.stringify(aud)}`;
    for (const proibido of [CNPJ, RAZAO, 'COMERCIO', a1!.senha]) expect(texto).not.toContain(proibido);
  });

  it('RN-CORE-08: filial em produção fiscal recusa o A1 de teste; nada gravado', async () => {
    await expect(roda(['--empresa', 'RR1234', '--filial', F.producao, '--confirmar'])).rejects.toThrow(RecusaA1Teste);
    await expect(roda(['--empresa', 'RR1234', '--filial', F.producao])).rejects.toThrow(/produção fiscal/);
    expect(await certificados(F.producao)).toEqual([]);
  });

  it('A1 do cliente válido: recusa sem --substituir; com --substituir o de teste o substitui', async () => {
    await expect(roda(['--empresa', 'RR1234', '--filial', F.comUpload, '--confirmar'])).rejects.toThrow(/--substituir/);
    const r = await roda(['--empresa', 'RR1234', '--filial', F.comUpload, '--substituir', '--confirmar']);
    expect(r.estado).toBe('gerado');
    expect(r.anterior?.origem).toBe('upload');
    const linhas = await certificados(F.comUpload);
    expect(linhas.map((l) => l.ativo)).toEqual([false, true]);
  });

  it.each([
    ['empresa inexistente', ['--empresa', 'AC9999'], /empresa não encontrada/],
    ['várias emissoras sem --filial', ['--empresa', 'RR1234'], /mais de uma filial emissora/],
    ['filial não emissora', ['--empresa', 'AM2808', '--filial', F.naoEmissora], /não é emissora/],
    ['filial de outra empresa (RLS)', ['--empresa', 'AM2808', '--filial', F.outraEmissora], /não encontrada ou inativa/],
  ])('%s: recusa sem gravar', async (_n, argv, msg) => {
    await expect(roda([...argv, '--confirmar'])).rejects.toThrow(msg);
  });

  it('0047: a linha nasce com origem teste', async () => {
    const [l] = await um<{ origem: string }>('SELECT origem FROM core.certificado WHERE filial_id = $1 AND ativo', [F.unica]);
    expect(l?.origem).toBe('teste');
  });

  it('0047 + core: repetir não gera outro (idempotente); perto do vencimento (RF-CORE-04) gera um novo', async () => {
    const antes = await certificados(F.unica);
    const r = await roda(['--empresa', 'AM2808', '--confirmar']);
    expect(r).toMatchObject({ estado: 'sem-mudanca', acao: 'manter', certificado_id: antes.at(-1)!.id });
    expect(await certificados(F.unica)).toHaveLength(antes.length);
    const perto = await roda(['--empresa', 'AM2808', '--confirmar'], new Date(AGORA.getTime() + 340 * DIA_MS));
    expect(perto.estado).toBe('gerado');
  });

  it('0047: o banco recusa levar a produção a filial com A1 de teste ativo', async () => {
    await expect(
      b.admin.query("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', $3)", [T, F.unica, RECADO_APROVACAO]),
    ).rejects.toThrow();
  });
});
