import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerCsv } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { EntidadeCarga } from '../contracts';
import { LAYOUT, nomeArquivoCarga, mapearLinha, prepararCriacao, prepararEnderecoNovo, validarFiscalLinhaProduto, type ContextoMapeamento, type Registro } from '../domain';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
/** A fixture é lida pelo `lerCsv` do SDK, como a API lê o arquivo do cliente. */
function fixture(entidade: EntidadeCarga): Registro[] {
  const l = LAYOUT[entidade];
  const r = lerCsv(readFileSync(join(pasta, nomeArquivoCarga(entidade))), { aceitas: [...l.usadas, ...l.ignoradas], obrigatorias: l.obrigatorias });
  if (!r.ok) throw new Error(`fixture ${entidade}: ${r.erro.motivo}`);
  return r.linhas.map((x) => x.celulas);
}
const ctx: ContextoMapeamento = {
  municipiosDaUf: (uf) =>
    ({
      AM: [{ ibge: '1302603', nome: 'Manaus' }],
      SP: [{ ibge: '3550308', nome: 'São Paulo' }, { ibge: '3500105', nome: "Santa Bárbara d'Oeste" }],
    })[uf] ?? [],
};
const mapear = <E extends EntidadeCarga>(e: E, extra: Record<string, string>, base = 0) =>
  mapearLinha(e, { ...fixture(e)[base]!, ...extra }, 2, ctx);

describe('mapeamento da fixture (os 8 arquivos)', () => {
  it('todas as linhas da fixture mapeiam sem erro', () => {
    const ordem: EntidadeCarga[] = ['filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente'];
    for (const e of ordem) fixture(e).forEach((r, i) => expect(mapearLinha(e, r, i + 2, ctx), `${e}:${i + 2}`).toMatchObject({ ok: true }));
  });
  it('D6: célula vazia vira undefined (não altera) e o padrão só vale na criação', () => {
    const r = mapear('cliente', { documento: '' }, 2);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.linha.dados.limite_credito_centavos).toBe(0);
      expect(r.linha.dados.nome_fantasia).toBeUndefined();
      expect(r.linha.dados.documento).toBeUndefined();
    }
  });
  it('RN-CAD-03: cidade e UF resolvem o IBGE e o endereço principal sai do cliente', () => {
    const r = mapear('cliente', {});
    expect(r.ok && r.linha.enderecos[0]).toMatchObject({ tipo: 'principal', external_id: 'C-EX-01:principal', dados: { municipio_ibge: '1302603', uf: 'AM', cep: '69000001' } });
  });
  it('RN-CAD-03: município_ibge vence o nome e passa pela validação da UF', () => {
    expect(mapear('cliente', { 'endereco.municipio_ibge': '3550308' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-03', campo: 'endereco.municipio_ibge' }] });
    expect(mapear('cliente', { 'endereco.cidade': 'Atlantida', 'endereco.municipio_ibge': '1302603' })).toMatchObject({ ok: true });
  });
  it('T-0058: cada linha do cliente.csv traz um endereço: tipo_endereco e seq geram o external_id <cliente>:<tipo>[:<seq>]', () => {
    const entrega = mapear('cliente', { tipo_endereco: 'Entrega', seq: '2' }, 1);
    expect(entrega.ok && entrega.linha.enderecos).toMatchObject([{ linha: 2, tipo: 'entrega', seq: 2, external_id: 'C-EX-01:entrega:2', dados: { cep: '69000002', bairro: 'Distrito' } }]);
    const cobranca = mapear('cliente', { tipo_endereco: 'cobranca', seq: '' }, 1);
    expect(cobranca.ok && cobranca.linha.enderecos[0]?.external_id).toBe('C-EX-01:cobranca');
  });
  it('T-0058: sem tipo_endereco o endereço da linha é o principal; sem coluna de endereço nem tipo a linha não leva endereço', () => {
    const principal = mapear('cliente', { tipo_endereco: '' });
    expect(principal.ok && principal.linha.enderecos[0]).toMatchObject({ tipo: 'principal', external_id: 'C-EX-01:principal' });
    const vazio = mapear('cliente', { tipo_endereco: '', 'endereco.logradouro': '', 'endereco.numero': '', 'endereco.bairro': '', 'endereco.cidade': '', 'endereco.uf': '', 'endereco.cep': '' });
    expect(vazio.ok && vazio.linha.enderecos).toEqual([]);
  });
  it('T-0058: tipo_endereco e seq fora do formato e external_id do endereço acima de 64 caracteres são recusados, sem o valor', () => {
    expect(mapear('cliente', { tipo_endereco: 'casa' })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_FORMATO', campo: 'tipo_endereco' }] });
    expect(mapear('cliente', { seq: '0' })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_FORMATO', campo: 'seq' }] });
    expect(mapear('cliente', { seq: '1.5' }).ok).toBe(false);
    const longo = mapear('cliente', { external_id: 'c'.repeat(60), tipo_endereco: 'entrega', seq: '1' });
    expect(longo).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_TAMANHO', campo: 'external_id', motivo: 'external_id do endereço acima de 64 caracteres: use um external_id menor' }] });
    expect(mapear('cliente', { external_id: 'c'.repeat(54), tipo_endereco: 'principal' }).ok).toBe(true);
  });
  it('RN-CAD-02: em linha de entrega a IE não é validada pela UF dela (vale a UF do principal do grupo, na gravação)', () => {
    const r = mapear('cliente', { tipo_endereco: 'entrega', 'endereco.uf': 'SP', 'endereco.cidade': 'São Paulo', inscricao_estadual: '012300004' }, 1);
    expect(r.ok && r.linha.dados.ie).toBe('012300004');
  });
  it('RN-CAD-01: CPF e CNPJ são validados pelo dígito verificador e o tipo vem do tamanho', () => {
    const pf = mapear('cliente', { documento: '123.456.780-62' });
    expect(pf.ok && pf.linha.dados).toMatchObject({ tipo_pessoa: 'PF', documento: '12345678062' });
    const pj = mapear('cliente', { documento: '99.000.002/0001-48' });
    expect(pj.ok && pj.linha.dados).toMatchObject({ tipo_pessoa: 'PJ', documento: '99000002000148' });
    expect(mapear('cliente', { documento: '123.456.780-63' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-01' }] });
    expect(mapear('cliente', { documento: '99000002000149' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-01' }] });
    expect(mapear('cliente', { documento: '123' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-01' }] });
  });
  it('RN-CAD-01: o CNPJ alfanumérico (14 caracteres) segue a mesma validação do SDK', () => {
    const valido = mapear('cliente', { documento: '12.ABC.345/01DE-35' });
    const invalido = mapear('cliente', { documento: '12.ABC.345/01DE-36' });
    expect(valido.ok).not.toBe(invalido.ok);
    expect(invalido).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-01' }] });
  });
  it('RN-CAD-02: IE pela UF do endereço e indicador sugerido pela IE', () => {
    const ok = mapear('cliente', { inscricao_estadual: '01.230.000-4' });
    expect(ok.ok && ok.linha.dados).toMatchObject({ ie: '012300004', ind_ie_dest: '1' });
    expect(mapear('cliente', { inscricao_estadual: '012300005' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-02' }] });
    const isento = mapear('cliente', { inscricao_estadual: 'ISENTO' });
    expect(isento.ok && isento.linha.dados.ind_ie_dest).toBe('2');
  });
  it('RN-CAD-02: indicador incompatível com a IE é recusado', () => {
    expect(mapear('cliente', { ind_ie_dest: '1' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-02' }] });
    expect(mapear('cliente', { ind_ie_dest: '2', inscricao_estadual: '012300004' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-02' }] });
  });
  it('RN-CAD-02: a IE da filial passa pela regra da UF', () => {
    expect(mapear('filial', { ie: '012300005' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-02', campo: 'ie' }] });
  });
  it('D3: external_id de 65 caracteres é recusado, 64 passa', () => {
    expect(mapear('vendedor', { external_id: 'x'.repeat(65) })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_TAMANHO', campo: 'external_id' }] });
    expect(mapear('vendedor', { external_id: 'x'.repeat(64) })).toMatchObject({ ok: true });
  });
  it('D3: texto acima do limite da NF-e (60) é recusado, nunca cortado', () => {
    expect(mapear('cliente', { razao_social: 'A'.repeat(61) })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_TAMANHO', campo: 'razao_social' }] });
    expect(mapear('filial', { logradouro: 'A'.repeat(61) })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_TAMANHO', campo: 'logradouro' }] });
  });
  it('external_id vazio é recusado como obrigatório', () => {
    expect(mapear('vendedor', { external_id: '' })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_OBRIGATORIO' }] });
  });
  it('RN-CAD-09: tPag pelo dicionário (dinheiro, PIX, cartão, débito, boleto); fora dele vira tPag recusado, sem aviso; a coluna tpag vence', () => {
    const tpag = (codigo: string) => { const r = mapear('condicao_pagamento', { forma_codigo: codigo }); return r.ok && r.linha.dados.forma_tpag; };
    const esperado: Record<string, string> = { DINHEIRO: '01', PIX: '17', cartao: '03', CARTAO_CREDITO: '03', CARTAO_DEBITO: '04', BOLETO: '15', CHEQUE: '99', DEPOSITO: '99', TRANSFERENCIA: '99', FIADO: '99' };
    for (const [c, t] of Object.entries(esperado)) expect(tpag(c), c).toBe(t);
    const boleto = mapear('condicao_pagamento', {});
    expect(boleto.ok && boleto.linha.dados.forma_tpag).toBe('15');
    const explicito = mapear('condicao_pagamento', { forma_tpag: '05' });
    expect(explicito.ok && explicito.linha.dados.forma_tpag).toBe('05');
    const vence = mapear('condicao_pagamento', { forma_codigo: 'PIX', forma_tpag: '03' });
    expect(vence.ok && vence.linha.dados.forma_tpag).toBe('03');
  });
  it('RN-CAD-09: parcelas_dias "3x" vira parcelas_cartao; "13x" passa na linha (1 a 99; a faixa 1 a 12 é do domain); "3" segue como prazo e a gravação decide pela forma', () => {
    const tres = mapear('condicao_pagamento', { parcelas_dias: '3x' });
    expect(tres.ok && tres.linha.dados).toMatchObject({ parcelas_cartao: 3 });
    expect(tres.ok && tres.linha.dados.prazos_dias).toBeUndefined();
    const doze = mapear('condicao_pagamento', { parcelas_dias: '12X' });
    expect(doze.ok && doze.linha.dados.parcelas_cartao).toBe(12);
    const treze = mapear('condicao_pagamento', { parcelas_dias: '13x' });
    expect(treze.ok && treze.linha.dados.parcelas_cartao).toBe(13);
    expect(mapear('condicao_pagamento', { parcelas_dias: '100x' })).toMatchObject({ ok: false, erros: [{ campo: 'parcelas_cartao' }] });
    expect(mapear('condicao_pagamento', { parcelas_dias: '0x' })).toMatchObject({ ok: false });
    const simples = mapear('condicao_pagamento', { parcelas_dias: '3' });
    expect(simples.ok && simples.linha.dados.prazos_dias).toEqual([3]);
  });
  it('critério 4: parcelas_dias usa a regra do contrato (1 a 36 parcelas, 0 a 999 dias) e aceita qualquer ordem; fator inteiro de 1 a 9999', () => {
    const r = mapear('condicao_pagamento', { parcelas_dias: '30/60/90' });
    expect(r.ok && r.linha.dados.prazos_dias).toEqual([30, 60, 90]);
    const desordenada = mapear('condicao_pagamento', { parcelas_dias: '60/30/0' });
    expect(desordenada.ok && desordenada.linha.dados.prazos_dias).toEqual([60, 30, 0]);
    const mil = mapear('condicao_pagamento', { parcelas_dias: '999/400' });
    expect(mil.ok && mil.linha.dados.prazos_dias).toEqual([999, 400]);
    const trinta = (n: number) => Array.from({ length: n }, (_, i) => i).join('/');
    expect(mapear('condicao_pagamento', { parcelas_dias: trinta(36) })).toMatchObject({ ok: true });
    for (const parcelas_dias of ['1000', trinta(37), '30//60', '1,5']) {
      expect(mapear('condicao_pagamento', { parcelas_dias }), parcelas_dias).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_FORMATO', campo: expect.stringMatching(/^(parcelas|prazos)_dias/) }] });
    }
    expect(mapear('produto_unidade', { fator: '0' })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_FORMATO', campo: 'fator' }] });
    expect(mapear('produto_unidade', { fator: '1,5' }).ok).toBe(false);
  });
  it('RN-CAD-07: saldo com até 4 casas vira Qtd4 e 5 casas é recusado', () => {
    const r = mapear('estoque', { saldo: '10,5' });
    expect(r.ok && r.linha.saldo).toBe(105_000);
    expect(mapear('estoque', { saldo: '1,23456' })).toMatchObject({ ok: false, erros: [{ campo: 'saldo' }] });
    expect(mapear('estoque', { saldo: '1.500' })).toMatchObject({ ok: false });
  });
  it('RN-CAD-06: fim da vigência antes do início recusa a linha', () => {
    expect(mapear('preco', { vigencia_fim: '2025-12-31' })).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-06' }] });
  });
  it('produto: desconto máximo em pontos-base (12,5% = 1250) e NCM sem máscara', () => {
    const r = mapear('produto', {});
    expect(r.ok && r.linha.desconto_maximo_bp).toBe(1250);
    expect(r.ok && r.linha.dados.ncm).toBe('21069030');
    expect(mapear('produto', { desconto_maximo_pct: '100,01' })).toMatchObject({ ok: false });
  });
  it('produto_unidade: fator × 10.000 e unidade em maiúsculas', () => {
    const r = mapear('produto_unidade', {});
    expect(r.ok && r.linha.dados).toMatchObject({ unidade: 'CX', fator: 120_000 });
  });
  it('Zod do contrato: e-mail e EAN fora do formato são recusados sem o valor', () => {
    expect(mapear('cliente', { email: 'sem-arroba' })).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_FORMATO', campo: 'email_nfe' }] });
    expect(mapear('produto', { ean: '123' })).toMatchObject({ ok: false, erros: [{ campo: 'ean' }] });
  });
});

describe('campos fiscais na carga (T-0021)', () => {
  it('RN-FIS-02: produto lê producao_propria (vazio = não altera) e a filial lê industrial_ipi e regime_pis_cofins', () => {
    const p = mapear('produto', { producao_propria: 'sim' });
    expect(p.ok && p.linha.dados.producao_propria).toBe(true);
    const vazio = mapear('produto', { producao_propria: '' });
    expect(vazio.ok && vazio.linha.dados.producao_propria).toBeUndefined();
    const f = mapear('filial', { crt: '3', industrial_ipi: '1', regime_pis_cofins: 'Nao_Cumulativo' });
    expect(f.ok && f.linha.dados).toMatchObject({ crt: '3', industrial_ipi: true, regime_pis_cofins: 'nao_cumulativo' });
    expect(mapear('filial', { regime_pis_cofins: 'outro' })).toMatchObject({ ok: false });
  });
  it('RN-FIS-02: CRT diferente de 3 com regime vazio normaliza o regime para null; CRT 3 ou sem CRT não altera', () => {
    const c1 = mapear('filial', { crt: '1', regime_pis_cofins: '' });
    expect(c1.ok && c1.linha.dados.regime_pis_cofins).toBeNull();
    const c3 = mapear('filial', { crt: '3', regime_pis_cofins: '' });
    expect(c3.ok && c3.linha.dados.regime_pis_cofins).toBeUndefined();
    const semCrt = mapear('filial', { regime_pis_cofins: '' });
    expect(semCrt.ok && semCrt.linha.dados.regime_pis_cofins).toBeUndefined();
  });
});

describe('padrões e obrigatórios na criação', () => {
  it('RN-CAD-04: produto novo sem NCM é recusado pedindo a coluna ncm', () => {
    const r = mapear('produto', { ncm: '' });
    expect(r.ok && prepararCriacao('produto', r.linha)).toMatchObject({ ok: false, erros: [{ codigo: 'RN-CAD-04', campo: 'ncm' }] });
  });
  it('D6: produto novo recebe PADRAO com aviso e unidade tributável vem da comercial na API', () => {
    const r = mapear('produto', {}, 1);
    const c = r.ok && prepararCriacao('produto', r.linha);
    expect(c && c.ok && c.linha.dados.grupo_tributacao).toBe('PADRAO');
    expect(c && c.ok && c.linha.avisos).toHaveLength(1);
  });
  it('D6: cliente novo sem documento ou sem endereço é recusado; numero vazio vira S/N', () => {
    const sem = mapear('cliente', { documento: '', 'endereco.cep': '' });
    const c = sem.ok && prepararCriacao('cliente', sem.linha);
    expect(c && !c.ok && c.erros.map((e) => e.campo)).toEqual(['documento', 'endereco.cep']);
    const ok = mapear('cliente', {});
    const p = ok.ok && prepararCriacao('cliente', ok.linha);
    expect(p && p.ok && p.linha.enderecos[0]?.dados.numero).toBe('S/N');
    expect(p && p.ok && p.linha.dados.ind_ie_dest).toBe('9');
  });
  it('D6: filial nova exige crt; vendedor novo usa o external_id como código se couber em 20', () => {
    const f = mapear('filial', { crt: '' });
    expect(f.ok && prepararCriacao('filial', f.linha)).toMatchObject({ ok: false, erros: [{ campo: 'crt' }] });
    const v = mapear('vendedor', {});
    expect(v.ok && prepararCriacao('vendedor', v.linha)).toMatchObject({ ok: true, linha: { dados: { codigo: 'V-EX-01' } } });
    const longo = mapear('vendedor', { external_id: 'v'.repeat(30) });
    expect(longo.ok && prepararCriacao('vendedor', longo.linha)).toMatchObject({ ok: false, erros: [{ codigo: 'CARGA_TAMANHO' }] });
  });
  it('D6: condição nova sem descrição usa forma + parcelas e exige a forma (RN-CAD-09)', () => {
    const p = mapear('condicao_pagamento', { descricao: '' }, 1);
    expect(p.ok && prepararCriacao('condicao_pagamento', p.linha)).toMatchObject({ ok: true, linha: { dados: { descricao: 'Boleto Exemplo 30/60' } } });
    const sem = mapear('condicao_pagamento', { descricao: '', forma_codigo: '', forma_nome: '', forma_tpag: '' }, 1);
    expect(sem.ok && prepararCriacao('condicao_pagamento', sem.linha)).toMatchObject({ ok: false, erros: [{ campo: 'forma_codigo' }, { campo: 'descricao' }] });
  });
  it('T-0058: endereço novo do cliente exige logradouro, bairro, município, UF e CEP; numero vazio vira S/N', () => {
    const e = mapear('cliente', { tipo_endereco: 'entrega', 'endereco.bairro': '', 'endereco.cep': '' }, 1);
    const novo = e.ok ? e.linha.enderecos[0]! : (undefined as never);
    expect(prepararEnderecoNovo(novo)).toMatchObject({ ok: false, erros: [{ campo: 'endereco.bairro', linha: 2 }, { campo: 'endereco.cep' }] });
    const ok = mapear('cliente', { tipo_endereco: 'entrega' }, 1);
    expect(ok.ok && prepararEnderecoNovo(ok.linha.enderecos[0]!)).toMatchObject({ ok: true, dados: { numero: '50' } });
    const semNumero = mapear('cliente', { tipo_endereco: 'entrega', 'endereco.numero': '' }, 1);
    expect(semNumero.ok && prepararEnderecoNovo(semNumero.linha.enderecos[0]!)).toMatchObject({ ok: true, dados: { numero: 'S/N' } });
  });
  it('RN-CAD-04: NCM não vigente e CEST fora do NCM voltam como erro da linha, sem o valor', () => {
    const erros = validarFiscalLinhaProduto(9, { ncm: '21069030', cest: '1234567', ncmVigente: false, ncmExigeCest: false, cestVigente: true, cestCombinaComNcm: false });
    expect(erros.map((e) => [e.linha, e.codigo, e.campo])).toEqual([[9, 'RN-CAD-04', 'ncm'], [9, 'RN-CAD-04', 'cest']]);
    const st = validarFiscalLinhaProduto(9, { ncm: '22021000', cest: null, ncmVigente: true, ncmExigeCest: true, cestVigente: false, cestCombinaComNcm: false });
    expect(st).toMatchObject([{ codigo: 'RN-CAD-04', campo: 'cest' }]);
  });
});

describe('relatório sem dado digitado (RN-CORE-07, D9)', () => {
  it('RN-CORE-07: nenhum valor-sentinela da célula aparece nos erros serializados', () => {
    const SENT = 'SENTINELA-9F3K';
    const casos: [EntidadeCarga, Record<string, string>][] = [
      ['cliente', { documento: `12345678${SENT}` }],
      ['cliente', { 'endereco.cidade': SENT }],
      ['cliente', { inscricao_estadual: SENT }],
      ['cliente', { 'endereco.municipio_ibge': `13${SENT}` }],
      ['cliente', { email: `${SENT}` }],
      ['cliente', { razao_social: SENT.repeat(10) }],
      ['filial', { cnpj: SENT, ie: SENT }],
      ['produto', { ean: SENT, desconto_maximo_pct: SENT }],
      ['estoque', { saldo: SENT }],
      ['preco', { vigencia_inicio: SENT, preco_cents: SENT }],
      ['condicao_pagamento', { parcelas_dias: SENT }],
      ['condicao_pagamento', { forma_tpag: SENT }],
      ['cliente', { tipo_endereco: SENT }],
      ['cliente', { seq: SENT }],
      ['vendedor', { external_id: SENT.repeat(10) }],
    ];
    for (const [e, extra] of casos) {
      const r = mapear(e, extra);
      expect(r.ok, e).toBe(false);
      expect(JSON.stringify(r)).not.toContain(SENT);
    }
  });
  it('RN-CAD-02: inscricao_estadual sem endereco.uf na linha segue para a API (que valida pela UF do endereço gravado), em vez de sumir', () => {
    const r = mapear('cliente', { 'endereco.logradouro': '', 'endereco.numero': '', 'endereco.bairro': '', 'endereco.cidade': '', 'endereco.uf': '', 'endereco.cep': '', tipo_endereco: '', inscricao_estadual: '012300004', documento: '' }, 2);
    expect(r.ok && r.linha.dados.ie).toBe('012300004');
    expect(r.ok && r.linha.dados.ind_ie_dest).toBe('1');
  });
});
