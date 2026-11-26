import { describe, expect, it } from 'vitest';
import { FichaReceitaPlana, MotivoFalhaReceita, type FichaReceitaPlanaMascarada } from '../contracts';
import { codigosParaDescrever, descreverFicha, mensagemDaFalhaReceita, prepararFichaDaConsulta, regimeDaOpcao, type ResultadoConsultaReceita, type SugestaoReceita } from './ficha-receita';

const CNPJ = '11222333000181';
const AGORA = '2026-11-24T12:00:00.000Z';

const sugestao = (o: Partial<SugestaoReceita> = {}): SugestaoReceita => ({
  cnpj: CNPJ,
  razao_social: 'EMPRESA TESTE LTDA',
  nome_fantasia: 'TESTE',
  situacao_cadastral: 'ATIVA',
  cnae_fiscal: '4711302',
  endereco: { logradouro: 'RUA A', numero: '10', complemento: null, bairro: 'CENTRO', cep: '69000-000', municipio_ibge: '1302603', uf: 'am' },
  cnae_secundarios: ['4712100', '4711302', '4712100', 'lixo'],
  porte: 'DEMAIS',
  natureza_juridica: '2062 - Sociedade Empresária Limitada',
  email: ' Contato@Teste.com.br ',
  telefone: '(92) 3222-1234',
  opcao_simples: true,
  opcao_mei: false,
  data_situacao_cadastral: '2020-01-02',
  data_abertura: '2015-03-10',
  ...o,
});
const ok = (s: SugestaoReceita, fonte = 'brasilapi'): ResultadoConsultaReceita => ({ ok: true, sugestao: s, fonte, consultado_em: AGORA });
const preparar = (r: ResultadoConsultaReceita, cnpj = CNPJ) => prepararFichaDaConsulta({ cnpj, resposta: r });

describe('ficha da Receita: mapeamento da SugestaoCnpj (T-0101, RF-CAD-02)', () => {
  it('RF-CAD-02: cnae_fiscal vira cnae_principal e data_situacao_cadastral vira situacao_cadastral_data', () => {
    const r = preparar(ok(sugestao()));
    expect(r.ok && r.ficha).toMatchObject({ cnae_principal: '4711302', situacao_cadastral_data: '2020-01-02', data_abertura: '2015-03-10' });
  });
  it('RF-CAD-02: normaliza e-mail (minúsculas), telefone (dígitos), CEP e UF; a ficha passa no contrato do banco', () => {
    const r = preparar(ok(sugestao()));
    if (!r.ok) throw new Error('esperava ok');
    expect(r.ficha).toMatchObject({ email: 'contato@teste.com.br', telefone: '9232221234', cep: '69000000', uf: 'AM' });
    expect(FichaReceitaPlana.safeParse(r.ficha).success).toBe(true);
  });
  it('RF-CAD-02: CNAE secundário sem repetido, sem o principal e sem lixo; CNAE de 6 dígitos ganha o zero', () => {
    const r = preparar(ok(sugestao({ cnae_fiscal: '111301', cnae_secundarios: ['4712100', '0111301', '4712100', 'x'] })));
    expect(r.ok && r.ficha.cnae_principal).toBe('0111301');
    expect(r.ok && r.ficha.cnae_secundarios).toEqual(['4712100']);
  });
  it('RF-CAD-02: consulta sem e-mail e telefone (cache) não leva as chaves, para o banco manter os atuais', () => {
    const r = preparar(ok(sugestao({ email: null, telefone: undefined }), 'cache'));
    if (!r.ok) throw new Error('esperava ok');
    expect('email' in r.ficha).toBe(false);
    expect('telefone' in r.ficha).toBe(false);
    expect(r.ficha.fonte).toBe('cache');
  });
  it('RF-CAD-02: regime pela opção MEI e Simples; normal só quando a fonte nega as duas; sem dado, nulo', () => {
    expect(regimeDaOpcao(true, true)).toBe('mei');
    expect(regimeDaOpcao(false, true)).toBe('simples');
    expect(regimeDaOpcao(false, false)).toBe('normal');
    expect(regimeDaOpcao(null, undefined)).toBeNull();
    expect(regimeDaOpcao(false, null)).toBeNull();
  });
  it('RF-CAD-02: campo no limite do contrato passa; um caractere a mais recusa tudo, sem cortar nem citar o valor', () => {
    const noLimite = preparar(ok(sugestao({ razao_social: 'R'.repeat(150), endereco: { logradouro: 'L'.repeat(120), bairro: 'B'.repeat(80), complemento: 'C'.repeat(120) } })));
    expect(noLimite.ok && FichaReceitaPlana.safeParse(noLimite.ficha).success).toBe(true);
    for (const o of [{ razao_social: 'R'.repeat(151) }, { endereco: { bairro: 'B'.repeat(81) } }, { porte: 'P'.repeat(61) }, { endereco: { numero: 'N'.repeat(21) } }]) {
      const r = preparar(ok(sugestao(o)));
      expect(r).toEqual({ ok: false, motivo: 'campo_acima_do_limite' });
    }
  });
  it('RF-CAD-02: data fora de AAAA-MM-DD vira nula', () => {
    const r = preparar(ok(sugestao({ data_abertura: '10/03/2015' })));
    expect(r.ok && r.ficha.data_abertura).toBeNull();
  });
  it('RF-CAD-02: data inexistente (2014-02-30) vira nula, também na data da situação; 2016-02-29 vale', () => {
    const r = preparar(ok(sugestao({ data_abertura: '2014-02-30', data_situacao_cadastral: '2015-13-01' })));
    expect(r.ok && r.ficha.data_abertura).toBeNull();
    expect(r.ok && r.ficha.situacao_cadastral_data).toBeNull();
    const b = preparar(ok(sugestao({ data_abertura: '2016-02-29' })));
    expect(b.ok && b.ficha.data_abertura).toBe('2016-02-29');
  });
});

describe('ficha da Receita: falhas não gravam (a ficha anterior fica)', () => {
  it('RF-CAD-02: fonte fora do ar, CNPJ não encontrado e CNPJ inválido viram motivo tratado', () => {
    expect(preparar({ ok: false, motivo: 'fonte_indisponivel' })).toEqual({ ok: false, motivo: 'fonte_indisponivel' });
    expect(preparar({ ok: false, motivo: 'nao_encontrado' })).toEqual({ ok: false, motivo: 'cnpj_nao_encontrado' });
    expect(preparar({ ok: false, motivo: 'cnpj_invalido' })).toEqual({ ok: false, motivo: 'cnpj_invalido' });
  });
  it('RF-CAD-02: os textos de falha não citam a fonte técnica nem dizem "nada foi gravado"', () => {
    for (const m of MotivoFalhaReceita.options) {
      expect(mensagemDaFalhaReceita(m)).not.toMatch(/brasilapi|nada foi gravado/i);
    }
    expect(mensagemDaFalhaReceita('cnpj_invalido')).toBe('O CNPJ desta empresa é inválido. Ele veio da filial padrão: corrija o CNPJ da empresa pelo operador antes de atualizar pela Receita.');
  });
  it('RF-CAD-02: resposta de outro CNPJ não grava', () => {
    expect(preparar(ok(sugestao({ cnpj: '04252011000110' })))).toEqual({ ok: false, motivo: 'cnpj_divergente' });
  });
  it('RF-CAD-02: sem razão social ou com fonte desconhecida a resposta é inválida', () => {
    expect(preparar(ok(sugestao({ razao_social: ' ' })))).toEqual({ ok: false, motivo: 'resposta_invalida' });
    expect(preparar(ok(sugestao(), 'outra'))).toEqual({ ok: false, motivo: 'resposta_invalida' });
  });
  it('RF-CAD-02: nenhum motivo carrega valor da ficha', () => {
    const r = preparar(ok(sugestao({ cnpj: '04252011000110' })));
    expect(JSON.stringify(r)).not.toContain('EMPRESA TESTE');
  });
});

describe('ficha da Receita: descrições do CNAE e nome do município (T-0106, 0066)', () => {
  const base = {
    municipio_ibge: '1302603', uf: 'AM', cnae_principal: '0111301', cnae_secundarios: ['4712100', '9999999'],
  } as FichaReceitaPlanaMascarada;
  const cnaes = [{ codigo: '0111301', descricao: 'CULTIVO DE ARROZ' }, { codigo: '4712100', descricao: 'COMÉRCIO VAREJISTA' }];
  const municipios = [{ codigo: '1302603', nome: 'Manaus', uf: 'AM' }];

  it('RF-CAD-02: códigos para consultar são o principal e os secundários, sem repetidos, e o município', () => {
    expect(codigosParaDescrever({ ...base, cnae_secundarios: ['4712100', '0111301', '4712100'] })).toEqual({ cnaes: ['0111301', '4712100'], municipios: ['1302603'] });
    expect(codigosParaDescrever({ ...base, cnae_principal: null, cnae_secundarios: null, municipio_ibge: null })).toEqual({ cnaes: [], municipios: [] });
  });
  it('RF-CAD-02: junta descrição do principal, dos secundários (mesma ordem) e nome do município', () => {
    const f = descreverFicha(base, cnaes, municipios);
    expect(f.cnae_principal).toBe('0111301');
    expect(f.cnae_principal_descricao).toBe('CULTIVO DE ARROZ');
    expect(f.cnae_secundarios_descritos).toEqual([{ codigo: '4712100', descricao: 'COMÉRCIO VAREJISTA' }, { codigo: '9999999', descricao: null }]);
    expect(f.municipio_nome).toBe('Manaus');
  });
  it('RF-CAD-02: CNAE e município desconhecidos ficam com descrição e nome nulos; sem secundários, a lista é nula', () => {
    const f = descreverFicha({ ...base, cnae_secundarios: [], municipio_ibge: '9999999' }, [], []);
    expect(f).toMatchObject({ cnae_principal_descricao: null, cnae_secundarios_descritos: null, municipio_nome: null });
  });
  it('RF-CAD-02: resposta ausente do banco (null/undefined) vale como lista vazia', () => {
    expect(descreverFicha(base, null, undefined).cnae_principal_descricao).toBeNull();
  });
});
