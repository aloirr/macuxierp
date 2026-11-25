/**
 * T-0101 (plano da v0.3.13, R-1 e R-3 no nível do contrato): a ficha completa da decisão do gerente (24/11, ~23h45 de Manaus: abertura, natureza jurídica, porte e CNAE secundários, além do que o
 * ADR 0012 já traz) está em `FichaReceitaPlana` (o que se grava) e `FichaReceitaPlanaMascarada` (o detalhe, sem e-mail
 * nem telefone completos); o "Atualizar pela Receita" passa em `ResultadoReceitaPlana`; e a mesma resposta da fonte
 * (formato da BrasilAPI), lida pela consulta CNPJ dos cadastros (`sugestaoCnpj`, #640), chega à ficha do core
 * (`prepararFichaDaConsulta`) com a mesma abertura, natureza, porte e CNAE. O mapeamento campo a campo e as máscaras
 * ficam no modules/core/domain/ficha-receita.test.ts (dono); rota, Revelar e auditoria no empresa-ficha.db.test.ts.
 * Dados fictícios (CNPJ de exemplo, exemplo.invalid).
 */
import { describe, expect, it } from 'vitest';
import {
  FichaReceitaPlana,
  FichaReceitaPlanaMascarada,
  ResultadoReceitaPlana,
  type RespostaReceitaBruta,
} from '../../../modules/core/contracts/index';
import { prepararFichaDaConsulta, type SugestaoReceita } from '../../../modules/core/domain/index';
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
  data_situacao_cadastral: '2014-07-21',
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

/** A consulta CNPJ dos cadastros (fonte única da leitura da BrasilAPI) e a ficha que o core prepara a partir dela. */
const sugestao = () => sugestaoCnpj('brasilapi', bruta() as Record<string, unknown>, CNPJ);
const preparar = () => prepararFichaDaConsulta({ cnpj: CNPJ, resposta: { ok: true, sugestao: sugestao() as unknown as SugestaoReceita, fonte: 'brasilapi', consultado_em: AGORA } });

/** Os campos da ficha completa (decisão do gerente + ADR 0012), comuns à ficha gravada e à mascarada. */
const COMUNS = [
  'nome_fantasia',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cep',
  'municipio_ibge',
  'uf',
  'cnae_principal',
  'regime_receita',
  'situacao_cadastral',
  'situacao_cadastral_data',
  'data_abertura',
  'natureza_juridica',
  'porte',
  'cnae_secundarios',
] as const;

describe('ficha da Receita: contrato da ficha completa (T-0101, R-1 e R-3)', () => {
  it('R-1: FichaReceitaPlana tem a ficha completa (abertura, natureza, porte, CNAE principal e secundários, endereço, e-mail, telefone, data e fonte)', () => {
    expect(Object.keys(FichaReceitaPlana.shape).sort()).toEqual([...COMUNS, 'razao_social', 'email', 'telefone', 'fonte', 'consultado_em'].sort());
  });

  it('R-3: FichaReceitaPlanaMascarada tem os mesmos dados e só e-mail e telefone mascarados, nunca as chaves completas', () => {
    const chaves = Object.keys(FichaReceitaPlanaMascarada.shape);
    expect(chaves).toEqual(expect.arrayContaining([...COMUNS, 'email_mascarado', 'telefone_mascarado', 'receita_fonte', 'receita_consultada_em']));
    expect(chaves).not.toContain('email');
    expect(chaves).not.toContain('telefone');
  });

  it('R-1: a resposta da BrasilAPI pela consulta CNPJ dos cadastros (#640) vira uma FichaReceitaPlana completa, sem chave fora do contrato e igual à dos cadastros', () => {
    const cad = sugestao();
    const r = preparar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(FichaReceitaPlana.strict().parse(r.ficha)).toEqual(r.ficha);
    for (const k of [...COMUNS, 'email', 'telefone'] as const) expect(r.ficha[k], k).not.toBeNull();
    expect(r.ficha).toMatchObject({ email: EMAIL, telefone: '9232224567', fonte: 'brasilapi', consultado_em: AGORA });
    expect(cad.data_abertura).toBe(r.ficha.data_abertura);
    expect(cad.natureza_juridica).toBe(r.ficha.natureza_juridica);
    expect(cad.porte).toBe(r.ficha.porte);
    expect(String(cad.cnae_fiscal)).toBe(r.ficha.cnae_principal);
    expect((cad.cnae_secundarios ?? []).map(String)).toEqual(['4637199', '4930202']);
    expect(r.ficha.cnae_secundarios).toEqual(['4637199', '4930202']);
  });

  it('R-1 e R-3: ResultadoReceitaPlana aceita o ok (só nomes de campo e a ficha mascarada) e o erro com motivo; recusa o valor completo do contato', () => {
    const mascarada = FichaReceitaPlanaMascarada.parse({
      ...Object.fromEntries(COMUNS.map((k) => [k, null])),
      ie: null,
      email_mascarado: 'co****@exemplo.invalid',
      telefone_mascarado: '(92) ****-4567',
      receita_fonte: 'brasilapi',
      receita_consultada_em: AGORA,
    });
    const ok = ResultadoReceitaPlana.parse({ estado: 'ok', campos_alterados: ['data_abertura', 'porte'], ficha: mascarada });
    expect(ok.estado).toBe('ok');
    expect(ResultadoReceitaPlana.parse({ estado: 'erro', motivo: 'cnpj_invalido', mensagem: 'x', ficha: null }).estado).toBe('erro');
    expect(ResultadoReceitaPlana.safeParse({ estado: 'erro', motivo: 'outro', mensagem: 'x', ficha: null }).success).toBe(false);
    // A ficha do resultado é a mascarada: o e-mail completo não é chave dela (o objeto do Zod descarta chaves estranhas).
    const comEmail = ResultadoReceitaPlana.parse({ estado: 'ok', campos_alterados: [], ficha: { ...mascarada, email: EMAIL } });
    expect(JSON.stringify(comEmail)).not.toContain(EMAIL);
  });
});
