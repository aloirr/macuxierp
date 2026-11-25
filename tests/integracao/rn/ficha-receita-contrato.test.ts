/**
 * T-0101 (plano da v0.3.13, R-1 a R-3 no nível do contrato), com a API da etapa 2 do core (#661): a ficha plana da
 * migração 0063 (`FichaReceitaPlana`, `FichaReceitaPlanaMascarada`), `prepararFichaDaConsulta` e o catálogo de motivos
 * (com `cnpj_invalido`). A porta do core recebe a sugestão da consulta CNPJ dos cadastros (`sugestaoCnpj`, #640): aqui a
 * mesma resposta da fonte (formato da BrasilAPI e da base aberta) passa pelos dois, de ponta a ponta, e a ficha tem a
 * mesma abertura, natureza, porte e CNAE da sugestão, com a regra dos cadastros (data inexistente vira nula, DD/MM/AAAA
 * vira AAAA-MM-DD, CNAE secundário sem repetir nem igual ao principal; R-20261125-032933).
 * Rota, Revelar, auditoria, RLS e log: tests/integracao/plataforma/empresa-ficha.db.test.ts.
 * Dados fictícios (tests/apoio/ficha-receita.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  FichaReceitaPlana,
  FichaReceitaPlanaMascarada,
  MotivoFalhaReceita,
  ResultadoReceitaPlana,
} from '../../../modules/core/contracts/index';
import { mensagemDaFalhaReceita, prepararFichaDaConsulta, type ResultadoConsultaReceita } from '../../../modules/core/domain/index';
import { sugestaoCnpj } from '../../../modules/cadastros/api/consultas';
import { brutaBrasilApi, CNPJ_FICHA as CNPJ, CPF_FICHA_FMT as CPF_FMT, EMAIL_FICHA as EMAIL } from '../../apoio/ficha-receita';

const AGORA = '2026-11-25T03:50:00.000Z';
const bruta = brutaBrasilApi;

/** A mesma consulta que a porta `ConsultaCnpjParaCore` dos cadastros entrega ao core. */
const consulta = (b: Record<string, unknown> = bruta(), fonte = 'brasilapi'): ResultadoConsultaReceita => ({
  ok: true,
  sugestao: sugestaoCnpj(fonte, b, CNPJ),
  fonte,
  consultado_em: AGORA,
});
const preparar = (r: ResultadoConsultaReceita = consulta()) => prepararFichaDaConsulta({ cnpj: CNPJ, resposta: r });
const ficha = (r?: ResultadoConsultaReceita): FichaReceitaPlana => {
  const p = preparar(r);
  if (!p.ok) throw new Error(`esperava ficha, veio ${p.motivo}`);
  return p.ficha;
};

/** Colunas da ficha na 0063 (lista fechada do `empresa_gravar_receita`), mais fonte e data da consulta. */
const PLANA = [
  'razao_social', 'nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio_ibge', 'uf', 'email', 'telefone',
  'cnae_principal', 'regime_receita', 'situacao_cadastral', 'situacao_cadastral_data', 'data_abertura', 'natureza_juridica', 'porte',
  'cnae_secundarios', 'fonte', 'consultado_em',
];

describe('ficha da Receita: contrato plano da 0063 e prepararFichaDaConsulta (T-0101, R-1 a R-3)', () => {
  it('R-1: FichaReceitaPlana tem exatamente as colunas da ficha da 0063, mais fonte e data da consulta (sem CNPJ: ele nunca muda por aqui)', () => {
    expect(Object.keys(FichaReceitaPlana.shape).sort()).toEqual([...PLANA].sort());
    expect(Object.keys(FichaReceitaPlana.shape)).not.toContain('cnpj');
  });

  it('R-3: FichaReceitaPlanaMascarada só tem e-mail e telefone mascarados, nunca as chaves completas', () => {
    const chaves = Object.keys(FichaReceitaPlanaMascarada.shape);
    expect(chaves).toEqual(expect.arrayContaining(['email_mascarado', 'telefone_mascarado', 'receita_fonte', 'receita_consultada_em']));
    expect(chaves).not.toContain('email');
    expect(chaves).not.toContain('telefone');
  });

  it('R-1: a resposta completa da fonte vira uma FichaReceitaPlana válida, com todos os campos preenchidos e normalizados', () => {
    const f = ficha();
    expect(FichaReceitaPlana.parse(f)).toEqual(f);
    expect(Object.keys(f).sort()).toEqual([...PLANA].sort());
    for (const k of PLANA) expect(f[k as keyof FichaReceitaPlana], k).not.toBeNull();
    expect(f).toMatchObject({
      razao_social: 'FICHA FICTICIA LTDA',
      logradouro: 'AVENIDA DAS FICÇÕES',
      cep: '69075000',
      municipio_ibge: '1302603',
      uf: 'AM',
      email: EMAIL,
      telefone: '9232224567',
      cnae_principal: '4639701',
      cnae_secundarios: ['4637199', '4930202'],
      regime_receita: 'simples',
      situacao_cadastral_data: '2015-03-10',
      data_abertura: '2014-07-21',
      fonte: 'brasilapi',
      consultado_em: AGORA,
    });
  });

  it('R-1: a mesma resposta (BrasilAPI e base aberta) dá a mesma abertura, natureza, porte e CNAE na sugestão dos cadastros e na ficha do core', () => {
    const aberta: Record<string, unknown> = {
      razao_social: 'FICHA FICTICIA LTDA',
      porte: { descricao: 'Empresa de Pequeno Porte' },
      natureza_juridica: { descricao: 'Sociedade Empresária Limitada' },
      simples: { simples: 'Sim', mei: 'Não' },
      estabelecimento: {
        nome_fantasia: 'FICHA',
        situacao_cadastral: 'Ativa',
        data_inicio_atividade: '2014-07-21',
        atividade_principal: { id: '4639701' },
        atividades_secundarias: [{ id: '4637199' }, { id: '4930202' }],
        cep: '69075000',
        cidade: { nome: 'Manaus', ibge_id: 1302603 },
        estado: { sigla: 'AM' },
      },
    };
    for (const [fonte, b] of [['brasilapi', bruta()], ['receita-aberta', aberta]] as const) {
      const cad = sugestaoCnpj(fonte, b, CNPJ);
      const core = ficha(consulta(b, fonte));
      expect(core.data_abertura, fonte).toBe(cad.data_abertura);
      expect(core.natureza_juridica, fonte).toBe(cad.natureza_juridica);
      expect(core.porte, fonte).toBe(cad.porte);
      expect(core.cnae_principal, fonte).toBe(cad.cnae_fiscal);
      expect(core.cnae_secundarios, fonte).toEqual(cad.cnae_secundarios);
      expect(core.regime_receita, fonte).toBe('simples');
    }
  });

  it('regra dos cadastros (R-20261125-032933): data inexistente vira nula e DD/MM/AAAA vira AAAA-MM-DD, igual na sugestão e na ficha', () => {
    const casos: [unknown, string | null][] = [
      ['2014-02-30', null],
      ['2014-13-01', null],
      ['21/07/2014', '2014-07-21'],
      ['30/02/2014', null],
      ['2023-02-29', null],
      ['29/02/2024', '2024-02-29'],
      ['', null],
    ];
    for (const [entrada, esperado] of casos) {
      const b = { ...bruta(), data_inicio_atividade: entrada, data_situacao_cadastral: entrada };
      const cad = sugestaoCnpj('brasilapi', b, CNPJ);
      const f = ficha(consulta(b));
      expect([cad.data_abertura, f.data_abertura, f.situacao_cadastral_data], String(entrada)).toEqual([esperado, esperado, esperado]);
    }
  });

  it('regra dos cadastros (R-20261125-032933): CNAE secundário sem repetir nem igual ao principal, na sugestão e na ficha (ordem da fonte)', () => {
    const b = {
      ...bruta(),
      cnaes_secundarios: [{ codigo: 4930202 }, { codigo: 4639701 }, { codigo: 4637199 }, { codigo: 4930202 }, { codigo: 'x' }],
    };
    const cad = sugestaoCnpj('brasilapi', b, CNPJ);
    expect(cad.cnae_secundarios).toEqual(['4930202', '4637199']);
    expect(ficha(consulta(b)).cnae_secundarios).toEqual(['4930202', '4637199']);
  });

  it('LGPD: razão social de MEI sai sem o CPF, da sugestão dos cadastros até a ficha', () => {
    const f = ficha(consulta({ ...bruta(), razao_social: `FICHA FICTICIA ${CPF_FMT}` }));
    expect(f.razao_social).toBe('FICHA FICTICIA');
    expect(JSON.stringify(f)).not.toContain('123456789');
  });

  it('R-2: catálogo de motivos com cnpj_invalido; CNPJ com dígito inválido na resposta vira resposta_invalida', () => {
    expect([...MotivoFalhaReceita.options].sort()).toEqual(
      ['campo_acima_do_limite', 'cnpj_divergente', 'cnpj_invalido', 'cnpj_nao_encontrado', 'fonte_indisponivel', 'resposta_invalida'].sort(),
    );
    // CNPJ com dígito verificador errado na resposta da fonte: resposta inválida, nunca exceção nem valor
    const s = sugestaoCnpj('brasilapi', bruta(), CNPJ);
    expect(preparar({ ok: true, sugestao: { ...s, cnpj: '11222333000199' }, fonte: 'brasilapi', consultado_em: AGORA })).toEqual({ ok: false, motivo: 'resposta_invalida' });
  });

  it('R-2: as mensagens do catálogo são as do portal, sem CNPJ, e-mail nem número; o resultado de erro passa no contrato', () => {
    expect(mensagemDaFalhaReceita('fonte_indisponivel')).toBe('Não foi possível consultar a Receita agora. Tente de novo em alguns minutos.');
    expect(mensagemDaFalhaReceita('cnpj_nao_encontrado')).toContain('A Receita não encontrou o CNPJ desta empresa.');
    for (const m of MotivoFalhaReceita.options) {
      const texto = mensagemDaFalhaReceita(m);
      expect(texto, m).toMatch(/^[A-ZÀ-Ú]/);
      expect(texto, m).not.toMatch(/\d{3}|@|algo deu errado/i);
      expect(ResultadoReceitaPlana.parse({ estado: 'erro', motivo: m, mensagem: texto, ficha: null })).toMatchObject({ motivo: m });
    }
  });
});
