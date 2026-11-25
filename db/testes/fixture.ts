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
  /** pedido_uuid do FDV do pedido recebido (integracao_fdv); é também o external_id do pedido do schema pedido. */
  pedidoFdv: string;
  /** id do pedido do FDV da massa do schema pedido (T-0014). */
  pedido: string;
  /** id do pedido manual (bko) da massa do schema pedido (T-0017). */
  pedidoBko: string;
  /** Nota autorizada da massa do faturamento (número 1, série 1). */
  nota: string;
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
    pedidoFdv: randomUUID(),
    pedido: randomUUID(),
    pedidoBko: randomUUID(),
    nota: randomUUID(),
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
-- Massa comum de core: ver docs/banco/README.md (T-0043)
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

/**
 * Massa do schema integracao_fdv (T-0010): uma linha em cada tabela. Chave cifrada fictícia (bytes sem segredo:
 * nonce + texto + tag). O registro publicado é o próprio cliente da massa (registro_external_id = erp_id = id no ERP,
 * M2 e 0015).
 */
export function fixtureIntegracao(t: Tenant): string {
  const id = t.id;
  return `
INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo, criada_por)
  VALUES ('${id}', 'conector-${t.slug}', 'teste', decode(repeat('aa', 40), 'hex'), 'mxf_abcd', '${t.usuario}');
WITH l AS (
  INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, sessao_id, sessao_parte,
    sessao_ultimo, chave_idempotencia, hub_lote_id, estado, contagens, enviado_em, concluido_em)
  SELECT '${id}', 'cliente', c.id, 'completo', gen_random_uuid(), 1, true, repeat('d', 64), gen_random_uuid(),
    'concluido_com_erros', '{"aceitos": 1, "rejeitados": 1}', now(), now()
  FROM integracao_fdv.credencial c WHERE c.tenant_id = '${id}' RETURNING id
), e AS (
  INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id,
    codigo, campo, reprocessavel)
  SELECT '${id}', l.id, 1, 'hub', 'cliente', '${t.cliente}', 'campo_invalido', 'documento', false FROM l RETURNING 1
)
INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em,
  fonte_ocorrido_em, fonte_refs, ativo, pendente, hash_confirmado, confirmado_em, ultimo_lote_envio_id, erp_id)
  SELECT '${id}', 'cliente', '${t.cliente}', '{"razao_social": "Cliente ${t.slug}"}', repeat('1', 64),
    '2026-11-21T12:00:00.123Z', '2026-11-21T12:00:00.123Z', '{"condicao_pagamento_id": "${t.produto}"}', true, false,
    repeat('1', 64), now(), l.id, '${t.cliente}'
  FROM l, e;
INSERT INTO integracao_fdv.conflito_chave (tenant_id, entidade, erp_id, chave, codigo)
  VALUES ('${id}', 'produto', '${t.produto}', 'P-${t.slug}', 'chave_duplicada');
INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, dados, fonte_ocorrido_em)
  VALUES ('${id}', 'tabela_preco', gen_random_uuid(), '{"nome": "Padrão", "vigencia_inicio": "2026-01-01"}', now());
INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, credencial_id, cursor_alterado_em, cursor_external_id,
  ultimo_envio_em, ultimo_sucesso_em)
  SELECT '${id}', 'cliente', c.id, '2026-11-21T12:00:00.123Z', '${t.cliente}', now(), now()
  FROM integracao_fdv.credencial c WHERE c.tenant_id = '${id}';
INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash)
  VALUES ('${id}', '${t.pedidoFdv}', '{"itens": []}', repeat('e', 64));
INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, numero_erp, corpo, hash)
  VALUES ('${id}', '${t.pedidoFdv}', 'integrado', 'PED-1', '{"status": "integrado", "numero_erp": "PED-1"}',
    repeat('f', 64));
INSERT INTO integracao_fdv.sinal (tenant_id, ultimo_envio_em, ultimo_aceito_em, ultimo_http)
  VALUES ('${id}', now(), now(), 200);
INSERT INTO integracao_fdv.reconciliacao (tenant_id, entidade, data_referencia, contagem)
  VALUES ('${id}', 'cliente', '2026-11-21', 1);
WITH pre AS (
  INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, hash, codigo_fdv, razao_social, documento_mascarado,
    payload, recebido_em, situacao, motivo, erros, decidido_em, ultima_recusa_em)
  VALUES ('${id}', gen_random_uuid(), repeat('c', 64), '00001', 'Pré-cadastro ${t.slug}', '11.444.777/****-**',
    '{"razao_social": "Pré-cadastro ${t.slug}"}', '2026-11-21T12:00:00.123Z', 'recusado', 'Documento inválido.',
    '[{"campo": "documento", "codigo": "documento_invalido", "mensagem": "Documento inválido."}]', now(), now())
  RETURNING cliente_uuid, revisao
)
INSERT INTO integracao_fdv.cliente_retorno (tenant_id, cliente_uuid, revisao, status, corpo, hash)
  SELECT '${id}', pre.cliente_uuid, pre.revisao, 'rejeitado_erp', '{"status": "rejeitado_erp"}', repeat('b', 64) FROM pre;
`;
}

/**
 * Massa do schema pedido (T-0014, T-0017): uma linha por tabela, exceto pedido, pedido_item e pedido_evento (dois
 * pedidos). Os dois nascem recebidos e vão a aprovado pela transição da RN-PED-02 (o gatilho vale também para o dono):
 * - `pedido`: o do FDV da massa (número 1, external_id = pedidoFdv). Sem linha em pedido.aprovacao (T-0013, seção 7,
 *   D-A): a aprovação dele veio do FDV e fica em aprovado_origem_em.
 * - `pedidoBko`: o manual (número 2, origem bko, sem external_id, criado pelo usuário da massa). É ele que tem a
 *   linha de pedido.aprovacao (automática, sem decidido_por, como pedem os CHECKs aprovacao_automatica_*).
 * cliente_id, filial_id e produto_id são os UUIDs da massa de cadastros, opacos (sem FK entre schemas). Como na D-A
 * (0016), o retrato traz o endereço e as colunas da validação do manual ficam nulas.
 */
export function fixturePedido(t: Tenant): string {
  const id = t.id;
  const retrato = `{"tipo_pessoa": "PJ", "razao_social": "Cliente ${t.slug}", "ind_ie_dest": "9", "endereco": {"logradouro": "Rua A",
      "numero": "1", "bairro": "Centro", "municipio_ibge": "1302603", "uf": "AM", "cep": "69000000", "pais_bacen": "1058"}}`;
  const produto = '{"codigo": "P1", "descricao": "Refrigerante 2 L", "ncm": "22021000"}';
  return `
INSERT INTO pedido.numeracao (tenant_id, proximo) VALUES ('${id}', 3);
INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, cliente_retrato, emitido_em,
  aprovado_origem_em, total_centavos, total_informado_centavos, external_id)
  VALUES ('${t.pedido}', '${id}', 1, 'fdv', '${t.filial}', '${t.cliente}', '${retrato}', '2026-11-21T12:00:00.123Z',
    '2026-11-21T12:00:00.123Z', 3980, 3980, '${t.pedidoFdv}');
INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, cliente_retrato, emitido_em,
  total_centavos, criado_por)
  VALUES ('${t.pedidoBko}', '${id}', 2, 'bko', '${t.filial}', '${t.cliente}', '${retrato}', '2026-11-21T13:00:00.123Z',
    1990, '${t.usuario}');
INSERT INTO pedido.pedido_item (tenant_id, pedido_id, sequencia, produto_id, produto_retrato, quantidade,
  preco_unitario_centavos, total_centavos, total_informado_centavos)
  VALUES ('${id}', '${t.pedido}', 1, '${t.produto}', '${produto}', 20000, 1990, 3980, 3980),
    ('${id}', '${t.pedidoBko}', 1, '${t.produto}', '${produto}', 10000, 1990, 1990, NULL);
UPDATE pedido.pedido SET status = 'aprovado' WHERE id IN ('${t.pedido}', '${t.pedidoBko}');
INSERT INTO pedido.pedido_evento (tenant_id, pedido_id, de, para, ator_tipo, ator_id, pendencias)
  VALUES ('${id}', '${t.pedido}', NULL, 'recebido', 'sistema', NULL, '[]'),
    ('${id}', '${t.pedido}', 'recebido', 'aprovado', 'sistema', NULL, '[]'),
    ('${id}', '${t.pedidoBko}', NULL, 'recebido', 'usuario', '${t.usuario}', '[]'),
    ('${id}', '${t.pedidoBko}', 'recebido', 'aprovado', 'sistema', NULL, '[]');
INSERT INTO pedido.aprovacao (tenant_id, pedido_id, decisao, automatica)
  VALUES ('${id}', '${t.pedidoBko}', 'aprovado', true);
`;
}

/** Retrato mínimo que passa no pedido_retrato_endereco_objeto (0016); valores fictícios. */
export const RETRATO = '{"tipo_pessoa": "PJ", "endereco": {"municipio_ibge": "1302603", "uf": "AM"}}';

export interface NovoPedido {
  id?: string;
  tenant?: string;
  origem?: 'fdv' | 'bko';
  externalId?: string | null;
  status?: string;
  total?: number;
  pendencias?: string;
  retrato?: string;
}

/**
 * INSERTs de pedido e item do tenant (valores fictícios, sem dado pessoal real). O número do pedido começa em
 * `primeiroNumero` e avança a cada pedidoSql. Usado em pedido.db.test.ts e pedido-recuo-0027.db.test.ts.
 */
export function sqlDePedido(tenant: string, primeiroNumero: number) {
  let proximoNumero = primeiroNumero;
  const pedidoSql = (p: NovoPedido = {}): string => {
    const ext = p.externalId === undefined || p.externalId === null ? 'NULL' : `'${p.externalId}'`;
    const colStatus = p.status === undefined ? '' : ', status';
    const valStatus = p.status === undefined ? '' : `, '${p.status}'`;
    const colPend = p.pendencias === undefined ? '' : ', pendencias';
    const valPend = p.pendencias === undefined ? '' : `, '${p.pendencias}'`;
    return `INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, cliente_retrato, emitido_em,
      total_centavos, external_id${colStatus}${colPend})
    VALUES ('${p.id ?? randomUUID()}', '${p.tenant ?? tenant}', ${proximoNumero++}, '${p.origem ?? 'bko'}',
      gen_random_uuid(), gen_random_uuid(), '${p.retrato ?? RETRATO}', now(), ${p.total ?? 1000}, ${ext}${valStatus}${valPend});`;
  };
  const itemSql = (pedido: string, sequencia: number, extra: { retrato?: string; faturada?: number } = {}): string =>
    `INSERT INTO pedido.pedido_item (tenant_id, pedido_id, sequencia, produto_id, produto_retrato, quantidade,
      preco_unitario_centavos, total_centavos, quantidade_faturada)
    VALUES ('${tenant}', '${pedido}', ${sequencia}, gen_random_uuid(), '${extra.retrato ?? '{"codigo": "P1"}'}', 10000,
      100, 100, ${extra.faturada ?? 0});`;
  return { pedidoSql, itemSql };
}

/**
 * Chave de acesso fictícia coerente com a nota (cUF 13, AAMM 2611, CNPJ da massa, modelo 55); cnf (cNF, 8 dígitos)
 * diferencia notas de mesmo número em tenants, filiais ou ambientes diferentes (a chave é única no banco). DV fictício
 * (a API confere).
 */
export function chaveAcesso(serie: number, numero: number, cnf = 1, tipoEmissao = 1): string {
  return `1326111234567800019555${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}${tipoEmissao}${cnfDe(cnf)}0`;
}

/** cNF com 8 dígitos. */
export const cnfDe = (cnf: number): string => String(cnf % 100000000).padStart(8, '0');

/**
 * Abre a contingência na filial (app, pela tela do operador; tenant da sessão). `por` = ligada_por (null = sem, para
 * o teste da recusa); `ambiente` omitido = o da filial (0032).
 */
export function sqlAbrirContingencia(
  filial: string,
  modalidade = 'svc_an',
  por: string | null,
  ambiente?: string,
): string {
  const [colAmb, valAmb] = ambiente ? [', ambiente', `, '${ambiente}'`] : ['', ''];
  return `INSERT INTO faturamento.contingencia (tenant_id, filial_id, modalidade, motivo, ligada_por${colAmb})
   VALUES (plataforma.tenant_atual(), '${filial}', '${modalidade}', 'SEFAZ-AM sem resposta há 5 min',
     ${por ? `'${por}'` : 'NULL'}${valAmb});`;
}

/** cNF da massa do tenant (derivado do id, para A e B não repetirem a chave). */
export const cnfDoTenant = (t: Tenant): number => parseInt(t.id.slice(0, 7), 16);

/** SHA-256 hex do texto, como o banco confere (convert_to UTF8). */
export const hashSql = (texto: string): string => `encode(sha256(convert_to('${texto}', 'UTF8')), 'hex')`;

/**
 * Massa de fiscal e faturamento (T-0019, T-0020, T-0021): uma linha em cada tabela, pelo caminho real (reserva do
 * número, nota em rascunho, em autorização, autorizada com guarda pendente, XML guardado, CC-e pendente e registrada
 * pelo XML, título com baixa parcial, inutilização do número 2 registrada pelo XML, contingência encerrada,
 * transmissão e pedido a faturar). Mais uma linha geral (tenant de referência) da carga aproximada, se `geral`.
 * Gravada pelo admin, que passa pelas mesmas travas (as triggers valem para o dono); precisa da filial no
 * core.ambiente_fiscal da fixtureModulos (homologação). `antes0026`: título sem conta_como_real, para os testes que
 * migram só até antes da 0026 (depois dela a coluna é obrigatória no INSERT). `antes0032`: contingência sem
 * ligada_por e desligada_por (obrigatórias desde a 0032); antes da 0026 é também antes da 0032.
 */
export function fixtureFaturamento(t: Tenant, antes0026 = false, antes0032 = antes0026): string {
  const id = t.id;
  const [colReal, valReal] = antes0026 ? ['', ''] : [', conta_como_real', ', false'];
  const [colPor, valPor] = antes0032 ? ['', ''] : [', ligada_por, desligada_por', `, '${t.usuario}', '${t.usuario}'`];
  const cnf = cnfDoTenant(t);
  const chave = chaveAcesso(1, 1, cnf);
  const xml = `<nfeProc><NFe>massa ${t.slug}</NFe></nfeProc>`;
  const evento = `<procEventoNFe>cce ${t.slug}</procEventoNFe>`;
  const inut = `<procInutNFe>massa ${t.slug}</procInutNFe>`;
  return `
SELECT set_config('app.tenant_id', '${id}', true);
INSERT INTO fiscal.regra_tributaria (tenant_id, uf_origem, crt, cfop, codigo, aliquota_icms, cst_pis, aliquota_pis,
  cst_cofins, aliquota_cofins, cst_ibs_cbs, c_class_trib, p_cbs, p_ibs_uf, versao_nt_rtc, fonte_tipo, fonte_referencia,
  versao, vigencia_inicio)
  VALUES ('${id}', 'AM', 3, '5102', '00', 200000, '01', 16500, '01', 76000, '000', '000001', 9000, 1000,
    'NT 2025.002-RTC v1.30', 'lei', 'RICMS-AM', '2026.1', '2026-01-01');
INSERT INTO fiscal.carga_aproximada (tenant_id, ncm, uf, aliquota_federal_nacional, aliquota_estadual, vigencia_inicio,
  versao, fonte)
  VALUES ('${id}', '22021000', 'AM', 150000, 180000, '2026-01-01', '26.1.A', 'ajuste ${t.slug}');
INSERT INTO faturamento.pedido_a_faturar (tenant_id, pedido_id, filial_id, cliente_id, payload)
  VALUES ('${id}', '${t.pedido}', '${t.filial}', '${t.cliente}', '{"itens": []}');
INSERT INTO faturamento.contingencia (tenant_id, filial_id, modalidade, motivo, inicio_em, fim_em${colPor})
  VALUES ('${id}', '${t.filial}', 'svc_an', 'SEFAZ-AM fora do ar na massa', '2026-11-01T10:00:00Z',
    '2026-11-01T11:00:00Z'${valPor});
INSERT INTO faturamento.nota (id, tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
  natureza_operacao, produtos_centavos, total_nota_centavos)
  VALUES ('${t.nota}', '${id}', '${t.filial}', 1,
    faturamento.reservar_numero('${t.filial}', 'homologacao', 1::smallint, 1), 'massa-${t.slug}', '${t.cliente}',
    'Venda de mercadoria', 1990, 1990);
INSERT INTO faturamento.nota_item (tenant_id, nota_id, n_item, produto_id, produto_retrato, cfop, quantidade,
  valor_unitario_centavos, valor_produto_centavos, valor_total_centavos)
  VALUES ('${id}', '${t.nota}', 1, '${t.produto}', '{"codigo": "P1", "ncm": "22021000"}', '5102', 10000, 1990, 1990,
    1990);
UPDATE faturamento.nota SET status = 'em_autorizacao', chave_acesso = '${chave}', c_nf = '${cnfDe(cnf)}'
  WHERE id = '${t.nota}';
INSERT INTO faturamento.transmissao (tenant_id, nota_id, servico, destino, c_stat, x_motivo, respondida_em, duracao_ms)
  VALUES ('${id}', '${t.nota}', 'autorizacao', 'simulador', 100, 'Autorizado o uso da NF-e', now(), 120);
UPDATE faturamento.nota SET status = 'autorizada_guarda_pendente', protocolo = '113260000000001',
  autorizada_em = '2026-11-21T12:00:00Z', c_stat = 100 WHERE id = '${t.nota}';
INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256)
  VALUES ('${id}', 'nfe_autorizada', '${t.nota}', '${chave}', '113260000000001', '${xml}', ${hashSql(xml)});
INSERT INTO faturamento.nota_evento (tenant_id, nota_id, tipo, n_seq_evento, texto)
  VALUES ('${id}', '${t.nota}', 'cce', 1, 'Correção do complemento do endereço');
INSERT INTO faturamento.nota_xml (tenant_id, tipo, evento_id, protocolo, xml, sha256)
  SELECT '${id}', 'evento_cce', e.id, '113260000000002', '${evento}', ${hashSql(evento)}
  FROM faturamento.nota_evento e WHERE e.nota_id = '${t.nota}';
INSERT INTO faturamento.titulo (tenant_id, nota_id, parcela, total_parcelas, vencimento, valor_centavos${colReal})
  VALUES ('${id}', '${t.nota}', 1, 1, '2026-12-21', 1990${valReal});
INSERT INTO faturamento.titulo_baixa (tenant_id, titulo_id, valor_centavos, usuario_id, forma)
  SELECT '${id}', x.id, 990, '${t.usuario}', 'pix' FROM faturamento.titulo x WHERE x.nota_id = '${t.nota}';
INSERT INTO faturamento.inutilizacao (tenant_id, filial_id, serie, ano, numero_inicial, numero_final, justificativa)
  VALUES ('${id}', '${t.filial}', 1, 2026, 2, 2, 'Número pulado na massa de teste');
INSERT INTO faturamento.nota_xml (tenant_id, tipo, inutilizacao_id, protocolo, xml, sha256)
  SELECT '${id}', 'inutilizacao', i.id, '113260000000003', '${inut}', ${hashSql(inut)}
  FROM faturamento.inutilizacao i WHERE i.tenant_id = '${id}';
`;
}

/**
 * Massa do sefaz_simulador (T-0045, 0025): uma nota autorizada no destino (filial da massa, modo normal), uma CC-e
 * dela, uma inutilização (números 2 a 3) e um recibo. O nRec é global e vem do tenant, para A e B não repetirem.
 */
export function fixtureSefazSimulador(t: Tenant): string {
  const id = t.id;
  const cnf = cnfDoTenant(t);
  const chave = chaveAcesso(1, 1, cnf);
  const nRec = `1326${String(cnf).padStart(11, '0')}`;
  return `
INSERT INTO sefaz_simulador.nota (tenant_id, filial_id, modo, ch_nfe, cnpj, serie, nnf, dh_emi, autorizada_em, situacao,
  n_prot, dig_val, c_stat, dh_recbto, xml_prot)
  VALUES ('${id}', '${t.filial}', 'normal', '${chave}', '12345678000195', 1, 1, now(), now(), 'autorizada',
    '913260000000001', 'ZGlnVmFs', '100', '2026-11-22T10:00:00-04:00', '<protNFe/>');
INSERT INTO sefaz_simulador.evento (tenant_id, filial_id, modo, ch_nfe, tp_evento, n_seq_evento, n_prot, c_stat,
  dh_reg_evento, xml_ret, evento_xml)
  VALUES ('${id}', '${t.filial}', 'normal', '${chave}', '110110', 1, '913260000000002', '135',
    '2026-11-22T10:05:00-04:00', '<retEvento/>', '<evento/>');
INSERT INTO sefaz_simulador.inutilizacao (tenant_id, filial_id, modo, cnpj, serie, ano, nnf_ini, nnf_fin, n_prot)
  VALUES ('${id}', '${t.filial}', 'normal', '12345678000195', 1, '26', 2, 3, '913260000000003');
INSERT INTO sefaz_simulador.recibo (tenant_id, filial_id, modo, n_rec, dh_recbto, pronto_em)
  VALUES ('${id}', '${t.filial}', 'normal', '${nRec}', '2026-11-22T10:00:00-04:00', now());
`;
}

/**
 * Configuração do faturamento da filial (0026): bandeira ligada, com alterado_por; o gatilho grava a linha do
 * histórico. Fora da fixtureFaturamento porque os testes que migram só até antes da 0026 também usam aquela.
 */
export function fixtureConfiguracaoFilial(t: Tenant): string {
  return `
INSERT INTO faturamento.configuracao_filial (tenant_id, filial_id, faturamento_real_nfe_simulada, alterado_por)
  VALUES ('${t.id}', '${t.filial}', true, '${t.usuario}');
`;
}

/**
 * Contador de geração de títulos (0028): uma tentativa registrada para a nota da massa. Fora da fixtureFaturamento
 * porque os testes que migram só até antes da 0028 também usam aquela.
 */
export function fixtureTituloGeracao(t: Tenant): string {
  return `
INSERT INTO faturamento.titulo_geracao (tenant_id, nota_id, tentativas, ultima_tentativa_em, motivo)
  VALUES ('${t.id}', '${t.nota}', 1, '2026-11-22T12:00:00Z', 'RN-FAT-03: forma sem prazo na massa');
`;
}

/** Recado fictício de aprovação de produção fiscal da massa (core.ambiente_fiscal.recado_aprovacao). */
const RECADO_APROVACAO = 'R-20261121-120000-alexandre';

/**
 * Nota autorizada com o XML guardado (o caminho da T-0019: reserva do número, rascunho, em autorização, autorizada
 * com guarda pendente e XML), na filial e no ambiente pedidos, série 1. Em produção grava antes a filial no
 * core.ambiente_fiscal com o recado de aprovação (RN-FAT-04). Gravada pelo admin, que passa pelas mesmas travas.
 * Use uma filial nova por nota (o número sai 1) e um `cnf` diferente por nota (a chave é única no banco).
 * Devolve o id da nota e o SQL.
 */
export function sqlNotaAutorizada(
  t: Tenant,
  filial: string,
  ambiente: 'homologacao' | 'producao',
  cnf: number,
): { id: string; sql: string } {
  const nota = randomUUID();
  const chave = chaveAcesso(1, 1, cnf);
  const protocolo = `1132600000${String(cnf % 100000).padStart(5, '0')}`;
  const xml = `<nfeProc>${nota}</nfeProc>`;
  const producao =
    ambiente === 'producao'
      ? `INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao)
  VALUES ('${t.id}', '${filial}', 'producao', '${RECADO_APROVACAO}');`
      : '';
  const sql = `
SELECT set_config('app.tenant_id', '${t.id}', true);
${producao}
INSERT INTO faturamento.nota (id, tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
  natureza_operacao)
  VALUES ('${nota}', '${t.id}', '${filial}', 1, faturamento.reservar_numero('${filial}', '${ambiente}', 1::smallint, 1),
    '${randomUUID()}', '${t.cliente}', 'Venda');
UPDATE faturamento.nota SET status = 'em_autorizacao', chave_acesso = '${chave}', c_nf = '${cnfDe(cnf)}'
  WHERE id = '${nota}';
UPDATE faturamento.nota SET status = 'autorizada_guarda_pendente', protocolo = '${protocolo}',
  autorizada_em = now(), c_stat = 100 WHERE id = '${nota}';
INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256)
  VALUES ('${t.id}', 'nfe_autorizada', '${nota}', '${chave}', '${protocolo}', '${xml}', ${hashSql(xml)});
`;
  return { id: nota, sql };
}

/** Linha geral (tenant de referência) da carga aproximada: só o dono grava. */
export function fixtureCargaGeral(): string {
  return `
INSERT INTO fiscal.carga_aproximada (tenant_id, ncm, uf, aliquota_federal_nacional, aliquota_federal_importado,
  aliquota_estadual, vigencia_inicio, versao, fonte)
  VALUES (plataforma.tenant_referencia(), '22021000', 'AM', 130000, 160000, 200000, '2026-01-01', '26.1.A', 'IBPT');
`;
}

/** INSERT de uma condição de pagamento com a forma e as parcelas do cartão dadas (`parcelas` em SQL: '3' ou 'NULL'; T-0015). */
export const inserirCondicao = (tenant: string, codigo: string, forma: string, parcelas: string): string =>
  `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, parcelas_cartao)
   VALUES ('${tenant}', '${codigo}', 'Condição ${codigo}', '${forma}', '{0}', ${parcelas});`;

/** Ids dos cadastros extras que o zerar apaga (0043, 0053); os opcionais só entram quando dados. */
export interface IdsZeraveis {
  filial: string;
  vendedor: string;
  condicao: string;
  tabela: string;
  produto: string;
  unidade: string;
  item: string;
  saldo: string;
  movimento: string;
  cliente: string;
  endereco: string;
  contato: string;
  /** Vendedor V3, sem external_id (0053: no espelho, mas nunca publicado). */
  vendedor2?: string;
  /** Cliente com a mesma condição e o mesmo vendedor (0043: o que fica em uso e tem colunas anuladas). */
  cliente2?: string;
}

/**
 * Cadastros extras do tenant `t` para o zerar (dados fictícios): filial, vendedor, condição, tabela, produto e unidade,
 * item de preço, saldo e movimento, cliente com endereço e contato. `externalId` grava F2, V2 e P2 na filial, no vendedor
 * e no produto (0043).
 */
export function cadastrosZeraveis(t: Tenant, x: IdsZeraveis, opcoes: { externalId?: boolean } = {}): string {
  const ext = (v: string): string => (opcoes.externalId ? `, '${v}'` : '');
  const colExt = opcoes.externalId ? ', external_id' : '';
  const vendedor2 = x.vendedor2 ? `,\n         ('${x.vendedor2}', '${t.id}', 'V3', 'Vendedor novo', '${t.filial}'${ext('V3')})` : '';
  const cliente2 = x.cliente2
    ? `INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id,
  tabela_preco_id, filial_id, vendedor_id, limite_credito_centavos)
  VALUES ('${x.cliente2}', '${t.id}', 'PJ', '11444777000242', '9', 'Cliente com pedido', '${x.condicao}', '${x.tabela}', '${t.filial}',
    '${x.vendedor}', 0);`
    : '';
  return `
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep${colExt})
  VALUES ('${x.filial}', '${t.id}', '11222333000181', 'Filial livre', '3', 'Rua C', '3', 'Centro', '1302603', 'AM', '69000002'${ext('F2')});
INSERT INTO cadastros.vendedor (id, tenant_id, codigo, nome, filial_id${colExt})
  VALUES ('${x.vendedor}', '${t.id}', 'V2', 'Vendedor livre', '${t.filial}'${ext('V2')})${vendedor2};
INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias)
  VALUES ('${x.condicao}', '${t.id}', 'PX', 'PIX', '17', '{0}');
INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio) VALUES ('${x.tabela}', '${t.id}', 'Promo', '2026-01-01');
INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao,
  custo_centavos${colExt}) VALUES ('${x.produto}', '${t.id}', 'P2', 'Suco 1 L', '22021000', 'UN', 'UN', 'padrao', 299${ext('P2')});
INSERT INTO cadastros.produto_unidade (id, tenant_id, produto_id, unidade, fator) VALUES ('${x.unidade}', '${t.id}', '${x.produto}', 'CX', 60000);
INSERT INTO cadastros.tabela_preco_item (id, tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos)
  VALUES ('${x.item}', '${t.id}', '${x.tabela}', '${t.filial}', '${x.produto}', 990);
INSERT INTO cadastros.estoque_saldo (id, tenant_id, filial_id, produto_id, quantidade) VALUES ('${x.saldo}', '${t.id}', '${t.filial}', '${x.produto}', 5000);
INSERT INTO cadastros.estoque_movimento (id, tenant_id, filial_id, produto_id, tipo, quantidade, motivo)
  VALUES ('${x.movimento}', '${t.id}', '${t.filial}', '${x.produto}', 'entrada', 5000, 'carga inicial');
INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id,
  tabela_preco_id, filial_id, vendedor_id, limite_credito_centavos)
  VALUES ('${x.cliente}', '${t.id}', 'PJ', '11444777000161', '9', 'Cliente livre', '${x.condicao}', '${x.tabela}', '${t.filial}',
    '${x.vendedor}', 0);
${cliente2}
INSERT INTO cadastros.cliente_endereco (id, tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
  VALUES ('${x.endereco}', '${t.id}', '${x.cliente}', 'principal', 'Rua D', '4', 'Centro', '1302603', 'AM', '69000003');
INSERT INTO cadastros.cliente_contato (id, tenant_id, cliente_id, nome) VALUES ('${x.contato}', '${t.id}', '${x.cliente}', 'Financeiro');
`;
}

/** INSERT de uma regra válida do ICMS no regime normal (fiscal.regra_tributaria, T-0020); `campos` sobrescreve colunas (valores já em SQL). */
export function regraTributaria(campos: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    tenant_id: 'plataforma.tenant_atual()',
    crt: '3',
    uf_origem: `'AM'`,
    uf_destino: `'PA'`,
    cfop: `'6102'`,
    codigo: `'00'`,
    aliquota_icms: '120000',
    cst_pis: `'01'`,
    cst_cofins: `'01'`,
    versao_nt_rtc: `'NT 2025.002-RTC v1.30'`,
    fonte_tipo: `'lei'`,
    fonte_referencia: `'RICMS-AM'`,
    versao: `'2026.1'`,
    vigencia_inicio: `'2026-01-01'`,
    ...campos,
  };
  const colunas = Object.keys(base).filter((k) => base[k] !== 'OMITIR');
  return `INSERT INTO fiscal.regra_tributaria (${colunas.join(', ')}) VALUES (${colunas.map((k) => base[k]).join(', ')});`;
}
