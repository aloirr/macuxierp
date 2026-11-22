/**
 * Massa de teste de um tenant: uma linha válida em cada tabela (o teste de vazamento confere que toda tabela tem
 * linha). Gravada pelo admin (dono das tabelas, fora da RLS). Dados fictícios, sem dado pessoal real.
 */
import { randomUUID } from 'node:crypto';

export interface Tenant {
  id: string;
  slug: string;
  usuario: string;
  evento: string;
  filial: string;
  cliente: string;
  produto: string;
}

export function novoTenant(slug: string): Tenant {
  return {
    id: randomUUID(),
    slug,
    usuario: randomUUID(),
    evento: randomUUID(),
    filial: randomUUID(),
    cliente: randomUUID(),
    produto: randomUUID(),
  };
}

const HASH_FICTICIO = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

export function fixturePlataforma(t: Tenant): string {
  const id = t.id;
  return `
INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ('${id}', '${id}', '${t.slug}', 'Empresa ${t.slug}');
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${id}', 'core'), ('${id}', 'cadastros');
INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil)
  VALUES ('${t.usuario}', '${id}', 'adm@${t.slug}.teste', 'Administrador', '${HASH_FICTICIO}', 'administrador');
INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em)
  VALUES ('${id}', '${t.usuario}', gen_random_uuid(), encode(sha256(convert_to('${id}', 'UTF8')), 'hex'),
    now() + interval '1 day');
INSERT INTO plataforma.evento (id, tenant_id, nome, agregado_id, versao, payload)
  VALUES ('${t.evento}', '${id}', 'cadastros.cliente.alterado@1', '${t.cliente}', 1, '{"inativo": false}');
INSERT INTO plataforma.evento_consumido (tenant_id, consumidor, evento_id) VALUES ('${id}', 'integracao-fdv', '${t.evento}');
INSERT INTO plataforma.trabalho (tenant_id, tipo) VALUES ('${id}', 'cadastros.consulta_ie');
INSERT INTO plataforma.idempotencia (tenant_id, chave, rota, hash_corpo)
  VALUES ('${id}', 'chave-0001', 'POST /v1/cadastros/clientes', repeat('a', 64));
INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade) VALUES ('${id}', '${t.usuario}', 'criar', 'cliente');
INSERT INTO plataforma.arquivo (tenant_id, chave_s3, tipo, sha256, tamanho)
  VALUES ('${id}', 'macuxierp/${id}/exportacoes/x.zip', 'exportacao', repeat('b', 64), 10);
`;
}

export function fixtureModulos(t: Tenant): string {
  const id = t.id;
  return `
INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ('${id}', 'Empresa ${t.slug}', '12345678000195');
INSERT INTO core.certificado (tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital,
  pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce)
  VALUES ('${id}', '${t.filial}', 'TITULAR FICTICIO', '12345678000195', now(), now() + interval '1 year',
    repeat('c', 64), '\\x00', decode(repeat('01', 12), 'hex'), '\\x00', decode(repeat('02', 12), 'hex'));
INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia)
  SELECT tenant_id, id, filial_id, valido_ate, 30, '2026-01-01' FROM core.certificado WHERE tenant_id = '${id}';
INSERT INTO core.ambiente_fiscal (tenant_id, filial_id) VALUES ('${id}', '${t.filial}');
INSERT INTO core.parametro (tenant_id, chave, valor) VALUES ('${id}', 'fuso', '"America/Manaus"');
INSERT INTO core.exportacao (tenant_id, pedido_por) VALUES ('${id}', '${t.usuario}');
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf,
  cep, padrao, emissora, nfe_serie, nfe_numero_inicial)
  VALUES ('${t.filial}', '${id}', '12345678000195', 'Filial ${t.slug}', '3', 'Rua A', '1', 'Centro', '1302603', 'AM',
    '69000000', true, true, 1, 1);
WITH cp AS (
  INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias)
  VALUES ('${id}', 'AV', 'À vista', '01', '{0}') RETURNING id
), tp AS (
  INSERT INTO cadastros.tabela_preco (tenant_id, nome, vigencia_inicio, padrao)
  VALUES ('${id}', 'Padrão', '2026-01-01', true) RETURNING id
), v AS (
  INSERT INTO cadastros.vendedor (tenant_id, codigo, nome, filial_id, usuario_id)
  VALUES ('${id}', 'V1', 'Vendedor', '${t.filial}', '${t.usuario}') RETURNING id
), c AS (
  INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social,
    condicao_pagamento_id, tabela_preco_id, filial_id, vendedor_id, limite_credito_centavos)
  SELECT '${t.cliente}', '${id}', 'PJ', '11222333000181', '9', 'Cliente ${t.slug}', cp.id, tp.id, '${t.filial}', v.id, 150000
  FROM cp, tp, v RETURNING id
), p AS (
  INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel,
    grupo_tributacao, custo_centavos)
  VALUES ('${t.produto}', '${id}', 'P1', 'Refrigerante 2 L', '22021000', 'UN', 'UN', 'padrao', 499) RETURNING id
)
INSERT INTO cadastros.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos)
  SELECT '${id}', tp.id, '${t.filial}', p.id, 1990 FROM tp, p, c;
INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
  VALUES ('${id}', '${t.cliente}', 'principal', 'Rua B', '2', 'Centro', '1302603', 'AM', '69000001');
INSERT INTO cadastros.cliente_contato (tenant_id, cliente_id, nome) VALUES ('${id}', '${t.cliente}', 'Compras');
INSERT INTO cadastros.produto_unidade (tenant_id, produto_id, unidade, fator) VALUES ('${id}', '${t.produto}', 'CX', 120000);
INSERT INTO cadastros.estoque_saldo (tenant_id, filial_id, produto_id, quantidade)
  VALUES ('${id}', '${t.filial}', '${t.produto}', 100000);
INSERT INTO cadastros.estoque_movimento (tenant_id, filial_id, produto_id, tipo, quantidade, motivo)
  VALUES ('${id}', '${t.filial}', '${t.produto}', 'entrada', 100000, 'carga inicial');
INSERT INTO cadastros.consulta_externa (tenant_id, tipo, chave, resposta, fonte)
  VALUES ('${id}', 'cep', '69000000', '{}', 'viacep');
`;
}
