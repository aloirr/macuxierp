/**
 * "Zerar dados" do portal `/config` na API de produção (RN-CAD-10, T-0058, v0.3.6): o `montarDependenciasProducao` monta o
 * plugin do cadastros com as portas da apps/api (`plataforma/portas-zeragem.ts`), que só chamam as `portal_*` da 0043.
 * Ponta a ponta no PostgreSQL migrado: sessão de superadmin, CSRF, prévia, frase, efeito, mantidos (pedido e fiscal) e o
 * bloqueio pela integração FDV ligada. Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import {
  CABECALHO_CSRF_CONFIG,
  CAMINHOS_CARGAS_PLATAFORMA as C,
  CODIGO_ZERAGEM_BLOQUEADA,
  COOKIE_CONFIG,
  FRASE_ZERAR_DADOS,
  PREFIXO_PLATAFORMA,
} from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARGON2_RAPIDO, appPgDeTeste } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';

const EMAIL_SA = 'sa-zerar-portal@exemplo.invalid';
const SENHA_SA = 'senha-do-superadmin-de-teste';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
const RETRATO = '{"tipo_pessoa": "PJ", "endereco": {"municipio_ibge": "1302603", "uf": "AM"}}';
const ESCOLHIDOS = ['filial', 'produto', 'cliente'] as const;

interface Resposta {
  simulado: boolean;
  efetivos: string[];
  apagados: { tabela: string; quantidade: number }[];
  anulados: { tabela: string; coluna: string; quantidade: number }[];
  mantidos: { cadastro: string; motivo: string; quantidade: number }[];
  bloqueios: { cadastro: string; motivo: string }[];
}

describe.skipIf(!PG_DISPONIVEL)('"Zerar dados" no portal /config pela API de produção (RN-CAD-10, T-0058)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let T: string;
  let token: string;
  const id = {
    filialFiscal: randomUUID(),
    filialPedido: randomUUID(),
    filialLivre: randomUUID(),
    vendedor: randomUUID(),
    cond: randomUUID(),
    produto: randomUUID(),
    clienteLivre: randomUUID(),
    clientePedido: randomUUID(),
  };
  const n = async (tabela: string) => (await b.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM cadastros.${tabela} WHERE tenant_id = $1`, [T])).rows[0]!.n;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    T = await criarTenant(b.admin, `zerar-portal-${randomUUID().slice(0, 8)}`, ['core', 'cadastros', 'pedido', 'faturamento', 'integracao-fdv']);
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO),
    ]);
    await b.admin.query(`
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, external_id) VALUES
  ('${id.filialFiscal}', '${T}', '12345678000195', 'Filial com A1', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', 'F1'),
  ('${id.filialPedido}', '${T}', '99000001000101', 'Filial com pedido', '3', 'Rua C', '3', 'Centro', '1302603', 'AM', '69000002', 'F2'),
  ('${id.filialLivre}', '${T}', '11222333000181', 'Filial livre', '3', 'Rua B', '2', 'Centro', '1302603', 'AM', '69000001', 'F3');
INSERT INTO cadastros.vendedor (id, tenant_id, codigo, nome, filial_id, external_id) VALUES ('${id.vendedor}', '${T}', 'V1', 'Vendedor', '${id.filialPedido}', 'V1');
INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias, prazo_medio_dias) VALUES ('${id.cond}', '${T}', 'AV', 'À vista', '01', '{0}', 0);
INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao, custo_centavos, external_id)
  VALUES ('${id.produto}', '${T}', 'P1', 'Refrigerante 2 L', '22021000', 'UN', 'UN', 'padrao', 499, 'P1');
INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id, filial_id, vendedor_id, limite_credito_centavos) VALUES
  ('${id.clienteLivre}', '${T}', 'PJ', '11444777000161', '9', 'Cliente livre', '${id.cond}', '${id.filialLivre}', '${id.vendedor}', 0),
  ('${id.clientePedido}', '${T}', 'PJ', '11444777000242', '9', 'Cliente com pedido', '${id.cond}', '${id.filialPedido}', '${id.vendedor}', 0);
INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, vendedor_id, condicao_pagamento_id, cliente_retrato, emitido_em, total_centavos)
  VALUES (gen_random_uuid(), '${T}', 1, 'bko', '${id.filialPedido}', '${id.clientePedido}', '${id.vendedor}', '${id.cond}', '${RETRATO}', now(), 1000);
INSERT INTO core.certificado (tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, ativo)
  VALUES ('${T}', '${id.filialFiscal}', 'TITULAR FICTICIO', '12345678000195', now(), now() + interval '1 year', repeat('d', 64),
    '\\x00', decode(repeat('01', 12), 'hex'), '\\x00', decode(repeat('02', 12), 'hex'), true);`);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao' }));
    const r = await app.inject({ method: 'POST', url: `${PREFIXO_PLATAFORMA}/auth/entrar`, headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const url = (caminho: string) => `${PREFIXO_PLATAFORMA}${caminho.replace(':id', T)}`;
  const previa = (cadastros: readonly string[] = ESCOLHIDOS, o: { csrf?: boolean } = {}) =>
    app.inject({ method: 'POST', url: url(C.previa), headers: o.csrf === false ? {} : CSRF, cookies: { [COOKIE_CONFIG]: token }, payload: { cadastros } });
  const zerar = (frase: string, cadastros: readonly string[] = ESCOLHIDOS) =>
    app.inject({
      method: 'POST',
      url: url(C.zerar),
      headers: { ...CSRF, 'idempotency-key': randomUUID() },
      cookies: { [COOKIE_CONFIG]: token },
      payload: { cadastros, frase },
    });
  const porTabela = (r: Resposta) => Object.fromEntries(r.apagados.map((a) => [a.tabela, a.quantidade]));

  it('sem o cabeçalho de CSRF é 403', async () => {
    expect((await previa(ESCOLHIDOS, { csrf: false })).statusCode).toBe(403);
  });

  it('RN-CAD-10: a prévia devolve as contagens; cliente com pedido fica (pedido) e filial com A1 fica (fiscal); nada muda', async () => {
    const r = await previa();
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json<Resposta>();
    expect(p.simulado).toBe(true);
    expect(p.bloqueios).toEqual([]);
    expect(porTabela(p)).toMatchObject({ filial: 1, produto: 1, cliente: 1 });
    expect(p.mantidos).toEqual(
      expect.arrayContaining([
        { cadastro: 'cliente', motivo: 'pedido', quantidade: 1 },
        { cadastro: 'filial', motivo: 'pedido', quantidade: 1 },
        { cadastro: 'filial', motivo: 'fiscal', quantidade: 1 },
      ]),
    );
    expect([await n('filial'), await n('produto'), await n('cliente')]).toEqual([3, 1, 2]);
  });

  it('RN-CAD-10: o zerar com a frase certa apaga o resto, mantém o que está em uso e devolve as contagens', async () => {
    const r = await zerar(FRASE_ZERAR_DADOS);
    expect(r.statusCode, r.body).toBe(200);
    const z = r.json<Resposta>();
    expect(z.simulado).toBe(false);
    expect(porTabela(z)).toMatchObject({ filial: 1, produto: 1, cliente: 1 });
    expect(z.mantidos).toEqual(expect.arrayContaining([{ cadastro: 'cliente', motivo: 'pedido', quantidade: 1 }, { cadastro: 'filial', motivo: 'fiscal', quantidade: 1 }]));
    const filiais = await b.admin.query<{ id: string }>('SELECT id FROM cadastros.filial WHERE tenant_id = $1', [T]);
    expect(filiais.rows.map((f) => f.id).sort()).toEqual([id.filialFiscal, id.filialPedido].sort());
    const clientes = await b.admin.query<{ id: string }>('SELECT id FROM cadastros.cliente WHERE tenant_id = $1', [T]);
    expect(clientes.rows.map((c) => c.id)).toEqual([id.clientePedido]);
    expect(await n('produto')).toBe(0);
  });

  it('RN-CAD-10: com a integração FDV ligada no cadastro, o zerar é 422 zeragem_bloqueada e nada muda', async () => {
    await b.admin.query(
      `INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo, entidades_habilitadas)
       VALUES ($1, 'conector-zerar', 'teste', decode(repeat('aa', 40), 'hex'), 'mxf_abcd', ARRAY['cliente']::integracao_fdv.entidade_hub[])`,
      [T],
    );
    const p = await previa(['cliente']);
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json<Resposta>().bloqueios).toEqual([{ cadastro: 'cliente', motivo: 'integracao_ligada' }]);
    const r = await zerar(FRASE_ZERAR_DADOS, ['cliente']);
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'RN-CAD-10', detalhes: { codigo: CODIGO_ZERAGEM_BLOQUEADA } });
    expect(await n('cliente')).toBe(1);
  });
});
