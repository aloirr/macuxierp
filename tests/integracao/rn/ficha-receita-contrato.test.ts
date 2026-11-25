/**
 * T-0101, etapa 1 (plano da v0.3.13, R-1 e R-3 no nível do contrato): a ficha completa da decisão do gerente
 * (24/11, ~23h45 de Manaus: abertura, natureza jurídica, porte e CNAE secundários, além do que o ADR 0012 já traz) está
 * no contrato do core (#637) e no detalhe mascarado; e a mesma resposta da fonte (formato da BrasilAPI) dá a mesma
 * abertura, natureza, porte e CNAE no core (`mapearRespostaReceita`) e na consulta CNPJ dos cadastros (`sugestaoCnpj`,
 * #640). O mapeamento campo a campo e as máscaras ficam no modules/core/domain/ficha-receita.test.ts (dono); rota,
 * Revelar, auditoria e log (R-1 a R-6 na rota) entram na etapa 2, em tests/integracao/plataforma/empresa-ficha.db.test.ts.
 * Dados fictícios (CNPJ de exemplo, exemplo.invalid).
 */
import { describe, expect, it } from 'vitest';
import {
  FichaReceita,
  FichaReceitaMascarada,
  ResultadoAtualizarReceita,
  type RespostaReceitaBruta,
} from '../../../modules/core/contracts/index';
import { atualizarFichaPelaReceita, mapearRespostaReceita, mascararFicha } from '../../../modules/core/domain/index';
import { sugestaoCnpj } from '../../../modules/cadastros/api/consultas';

const CNPJ = '11222333000181';
const AGORA = '2026-11-25T03:50:00.000Z';
const EMAIL = 'contato.ficha.t0101@exemplo.invalid';
const TELEFONE = '(92) 3222-4567';

/** Ficha completa, como a BrasilAPI responde. */
const bruta = (): RespostaReceitaBruta => ({
  cnpj: CNPJ,
  razao_social: 'FICHA FICTICIA LTDA',
  nome_fantasia: 'FICHA',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '2014-07-21',
  natureza_juridica: '2062 - Sociedade Empresária Limitada',
  porte: 'EMPRESA DE PEQUENO PORTE',
  cnae_fiscal: 4639701,
  cnae_fiscal_descricao: 'Comércio atacadista de produtos alimentícios em geral',
  cnaes_secundarios: [
    { codigo: 4637199, descricao: 'Comércio atacadista especializado em outros produtos alimentícios' },
    { codigo: 4930202, descricao: 'Transporte rodoviário de carga intermunicipal' },
  ],
  descricao_tipo_de_logradouro: 'AVENIDA',
  logradouro: 'DAS FICÇÕES',
  numero: '100',
  complemento: 'GALPÃO 2',
  bairro: 'DISTRITO INDUSTRIAL',
  cep: '69075000',
  municipio: 'MANAUS',
  codigo_municipio_ibge: 1302603,
  uf: 'AM',
  email: EMAIL,
  ddd_telefone_1: TELEFONE,
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
});

/** Os campos da ficha completa (decisão do gerente + ADR 0012), fora e-mail e telefone. */
const DADOS = [
  'razao_social',
  'nome_fantasia',
  'cnpj',
  'situacao_cadastral',
  'data_abertura',
  'natureza_juridica',
  'porte',
  'cnae_principal',
  'cnae_secundarios',
  'endereco',
  'regime',
  'consultado_em',
  'fonte',
] as const;
const ENDERECO = ['logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio', 'municipio_ibge', 'uf'];

describe('ficha da Receita: contrato da ficha completa (T-0101, R-1 e R-3 na etapa 1)', () => {
  it('R-1: FichaReceita tem a ficha completa (abertura, natureza, porte, CNAE principal e secundários, endereço, e-mail, telefone, data e fonte)', () => {
    expect(Object.keys(FichaReceita.shape).sort()).toEqual([...DADOS, 'email', 'telefone'].sort());
    expect(Object.keys(FichaReceita.shape.endereco.shape).sort()).toEqual([...ENDERECO].sort());
  });

  it('R-3: FichaReceitaMascarada tem os mesmos dados e só e-mail e telefone mascarados, nunca as chaves completas', () => {
    expect(Object.keys(FichaReceitaMascarada.shape).sort()).toEqual([...DADOS, 'email_mascarado', 'telefone_mascarado'].sort());
  });

  it('R-1: a resposta completa da fonte vira uma FichaReceita válida, sem chave fora do contrato e com todos os campos preenchidos', () => {
    const f = mapearRespostaReceita(bruta(), 'brasilapi', AGORA);
    expect(f).not.toBeNull();
    expect(FichaReceita.parse(f)).toEqual(f);
    for (const k of DADOS) expect(f![k], k).not.toBeNull();
    for (const k of ENDERECO) expect(f!.endereco[k as keyof FichaReceita['endereco']], `endereco.${k}`).not.toBeNull();
  });

  it('R-1 e R-3: o resultado de "Atualizar pela Receita" passa no contrato, com os nomes dos campos e a ficha mascarada', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior: null, resposta: { ok: true, dados: bruta(), fonte: 'brasilapi' }, agora: AGORA });
    expect(FichaReceita.parse(r.gravar)).toEqual(r.gravar);
    const ok = ResultadoAtualizarReceita.parse(r.resultado);
    expect(ok.estado).toBe('ok');
    if (ok.estado !== 'ok') return;
    expect(ok.campos_alterados).toEqual(expect.arrayContaining(['data_abertura', 'natureza_juridica', 'porte', 'cnae_secundarios']));
    for (const c of ok.campos_alterados) expect(c).toMatch(/^[a-z_]+$/);
    const m = mascararFicha(mapearRespostaReceita(bruta(), 'brasilapi', AGORA)!);
    expect(FichaReceitaMascarada.parse(m)).toEqual(ok.ficha);
  });

  it('R-1: a mesma resposta da BrasilAPI dá a mesma abertura, natureza, porte e CNAE no core e na consulta CNPJ dos cadastros (#640)', () => {
    const core = mapearRespostaReceita(bruta(), 'brasilapi', AGORA)!;
    const cad = sugestaoCnpj('brasilapi', bruta() as Record<string, unknown>, CNPJ);
    expect(cad.data_abertura).toBe(core.data_abertura);
    expect(cad.natureza_juridica).toBe(core.natureza_juridica);
    expect(cad.porte).toBe(core.porte);
    expect(cad.cnae_fiscal).toBe(core.cnae_principal!.codigo);
    expect(cad.cnae_secundarios).toEqual(core.cnae_secundarios.map((c) => c.codigo));
  });
});
