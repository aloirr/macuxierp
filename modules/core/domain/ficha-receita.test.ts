import { describe, expect, it } from 'vitest';
import type { FichaReceita, RespostaReceitaBruta } from '../contracts';
import {
  atualizarFichaPelaReceita,
  camposAlterados,
  mascararEmail,
  mascararFicha,
  mascararTelefone,
  mapearRespostaReceita,
  revelarContato,
} from './ficha-receita';

const CNPJ = '11222333000181';
const AGORA = '2026-11-24T12:00:00.000Z';

const bruta = (o: Partial<RespostaReceitaBruta> = {}): RespostaReceitaBruta => ({
  cnpj: CNPJ,
  razao_social: 'EMPRESA TESTE LTDA',
  nome_fantasia: 'TESTE',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '2015-03-10',
  natureza_juridica: '2062 - Sociedade Empresária Limitada',
  porte: 'DEMAIS',
  cnae_fiscal: 4711302,
  cnae_fiscal_descricao: 'Comércio varejista',
  cnaes_secundarios: [{ codigo: 4712100, descricao: 'Minimercados' }, { codigo: 0, descricao: 'lixo' }],
  logradouro: 'RUA A',
  numero: '10',
  complemento: '',
  bairro: 'CENTRO',
  cep: '69000000',
  municipio: 'MANAUS',
  codigo_municipio_ibge: 1302603,
  uf: 'am',
  email: ' Contato@Teste.com.br ',
  ddd_telefone_1: '(92) 3222-1234',
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
  ...o,
});

describe('máscara de e-mail (ADR 0012, emenda da ficha)', () => {
  it('ADR-0012: mantém 2 letras do local, **** e o domínio', () => {
    expect(mascararEmail('domingos@gmail.com')).toBe('do****@gmail.com');
  });
  it('ADR-0012: local de 1 ou 2 letras vira * + ****', () => {
    expect(mascararEmail('a@x.com')).toBe('*****@x.com');
    expect(mascararEmail('ab@x.com')).toBe('*****@x.com');
  });
  it('ADR-0012: sem e-mail devolve nulo', () => {
    expect(mascararEmail(null)).toBeNull();
  });
  it('ADR-0012: paridade com plataforma.mascarar_email da migração 0035 (local de 1, 2 e 3+ letras, sem @, nulo)', () => {
    const casos: [string | null, string | null][] = [
      ['a@x.com', '*****@x.com'],
      ['ab@x.com', '*****@x.com'],
      ['abc@x.com', 'ab****@x.com'],
      ['sem-arroba', '****'],
      ['', '****'],
      ['a@b@x.com', 'a@****@x.com'],
      [null, null],
    ];
    for (const [entrada, esperado] of casos) expect(mascararEmail(entrada)).toBe(esperado);
  });
});

describe('máscara de telefone (ADR 0012, emenda da ficha)', () => {
  it('ADR-0012: DDD + **** + 4 últimos dígitos', () => {
    expect(mascararTelefone('9232221234')).toBe('(92) ****-1234');
    expect(mascararTelefone('92991231234')).toBe('(92) ****-1234');
  });
  it('ADR-0012: dado incompleto ou ausente não vaza dígitos', () => {
    expect(mascararTelefone('12345')).toBe('****');
    expect(mascararTelefone(null)).toBeNull();
  });
});

describe('mapeamento da resposta da fonte (RF-CAD-02)', () => {
  it('RF-CAD-02: normaliza CNPJ, UF, CNAE, e-mail e telefone e descarta CNAE inválido', () => {
    const f = mapearRespostaReceita(bruta(), 'brasilapi', AGORA);
    expect(f).toMatchObject({
      cnpj: CNPJ,
      email: 'contato@teste.com.br',
      telefone: '9232221234',
      regime: 'simples',
      fonte: 'brasilapi',
      consultado_em: AGORA,
      data_abertura: '2015-03-10',
      natureza_juridica: '2062 - Sociedade Empresária Limitada',
      porte: 'DEMAIS',
    });
    expect(f?.endereco).toMatchObject({ uf: 'AM', municipio_ibge: '1302603', complemento: null, cep: '69000000' });
    expect(f?.cnae_principal).toEqual({ codigo: '4711302', descricao: 'Comércio varejista' });
    expect(f?.cnae_secundarios).toEqual([{ codigo: '4712100', descricao: 'Minimercados' }]);
  });
  it('RF-CAD-02: o logradouro leva o tipo quando a fonte o informa', () => {
    expect(mapearRespostaReceita(bruta({ descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'DJALMA BATISTA' }), 'brasilapi', AGORA)?.endereco.logradouro).toBe('AVENIDA DJALMA BATISTA');
  });
  it('RF-CAD-02: MEI tem regime mei; sem opção, nulo', () => {
    expect(mapearRespostaReceita(bruta({ opcao_pelo_mei: true }), 'brasilapi', AGORA)?.regime).toBe('mei');
    expect(mapearRespostaReceita(bruta({ opcao_pelo_simples: false, opcao_pelo_mei: false }), 'brasilapi', AGORA)?.regime).toBeNull();
  });
  it('RF-CAD-02: resposta sem razão social ou com CNPJ inválido é recusada', () => {
    expect(mapearRespostaReceita(bruta({ razao_social: '' }), 'brasilapi', AGORA)).toBeNull();
    expect(mapearRespostaReceita(bruta({ cnpj: '123' }), 'brasilapi', AGORA)).toBeNull();
  });
  it('RF-CAD-02: telefone fora de 10 ou 11 dígitos vira nulo', () => {
    expect(mapearRespostaReceita(bruta({ ddd_telefone_1: '123' }), 'brasilapi', AGORA)?.telefone).toBeNull();
  });
});

describe('campos alterados para a auditoria (ADR 0012)', () => {
  const base = mapearRespostaReceita(bruta(), 'brasilapi', AGORA) as FichaReceita;
  it('ADR-0012: sem ficha anterior, todos os campos preenchidos contam; data e fonte nunca', () => {
    const nomes = camposAlterados(null, base);
    expect(nomes).toContain('razao_social');
    expect(nomes).toContain('email');
    expect(nomes).not.toContain('consultado_em');
    expect(nomes).not.toContain('fonte');
  });
  it('ADR-0012: devolve só os nomes (ordenados) do que mudou, nunca valores', () => {
    const nova = { ...base, telefone: '9233334444', email: null, endereco: { ...base.endereco, numero: '99' }, consultado_em: '2026-12-01T00:00:00.000Z' };
    expect(camposAlterados(base, nova)).toEqual(['email', 'endereco', 'telefone']);
  });
  it('ADR-0012: nada mudou devolve lista vazia (a consulta ainda é guardada)', () => {
    expect(camposAlterados(base, { ...base, data_abertura: '2016-01-01', natureza_juridica: 'X', porte: 'ME', cnae_secundarios: [] })).toEqual([
      'cnae_secundarios',
      'data_abertura',
      'natureza_juridica',
      'porte',
    ]);
    expect(camposAlterados(base, { ...base, consultado_em: '2026-12-01T00:00:00.000Z' })).toEqual([]);
  });
});

describe('Atualizar pela Receita (T-0101, RF-CAD-02)', () => {
  const anterior = mapearRespostaReceita(bruta({ razao_social: 'ANTIGA LTDA' }), 'brasilapi', '2026-01-01T00:00:00.000Z') as FichaReceita;
  it('ADR-0012: resposta boa devolve a ficha, os nomes alterados e a ficha mascarada', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior, resposta: { ok: true, dados: bruta(), fonte: 'brasilapi' }, agora: AGORA });
    expect(r.resultado.estado).toBe('ok');
    expect(r.gravar?.razao_social).toBe('EMPRESA TESTE LTDA');
    expect(r.campos_alterados).toEqual(['razao_social']);
    if (r.resultado.estado === 'ok') {
      expect(r.resultado.ficha.email_mascarado).toBe('co****@teste.com.br');
      expect(JSON.stringify(r.resultado)).not.toContain('3222');
    }
  });
  it('ADR-0012: falha da fonte não apaga a ficha anterior e vira erro tratado', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior, resposta: { ok: false, motivo: 'fonte_indisponivel' }, agora: AGORA });
    expect(r.gravar).toBeNull();
    expect(r.resultado).toMatchObject({ estado: 'erro', motivo: 'fonte_indisponivel' });
    if (r.resultado.estado === 'erro') expect(r.resultado.ficha?.razao_social).toBe('ANTIGA LTDA');
  });
  it('ADR-0012: sem ficha anterior a falha devolve ficha nula', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior: null, resposta: { ok: false, motivo: 'cnpj_nao_encontrado' }, agora: AGORA });
    expect(r.resultado).toMatchObject({ estado: 'erro', motivo: 'cnpj_nao_encontrado', ficha: null });
  });
  it('ADR-0012: o CNPJ da empresa nunca muda: resposta de outro CNPJ é recusada', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior, resposta: { ok: true, dados: bruta({ cnpj: '11444777000161' }), fonte: 'brasilapi' }, agora: AGORA });
    expect(r.gravar).toBeNull();
    expect(r.resultado).toMatchObject({ estado: 'erro', motivo: 'cnpj_divergente' });
  });
  it('ADR-0012: resposta ilegível vira resposta_invalida', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior, resposta: { ok: true, dados: bruta({ razao_social: null }), fonte: 'brasilapi' }, agora: AGORA });
    expect(r.resultado).toMatchObject({ estado: 'erro', motivo: 'resposta_invalida' });
  });
  it('ADR-0012: a mensagem de erro não carrega dado da empresa', () => {
    const r = atualizarFichaPelaReceita({ cnpj: CNPJ, anterior, resposta: { ok: false, motivo: 'fonte_indisponivel' }, agora: AGORA });
    if (r.resultado.estado === 'erro') expect(r.resultado.mensagem).not.toContain(CNPJ);
  });
});

describe('Revelar contato (ADR 0012, emenda da ficha)', () => {
  const ficha = mapearRespostaReceita(bruta(), 'brasilapi', AGORA) as FichaReceita;
  it('ADR-0012: e-mail completo e telefone formatado', () => {
    expect(revelarContato('email', ficha)).toEqual({ valor: 'contato@teste.com.br', auditar: true });
    expect(revelarContato('telefone', ficha)).toEqual({ valor: '(92) 3222-1234', auditar: true });
  });
  it('ADR-0012: celular formata com 9 dígitos', () => {
    expect(revelarContato('telefone', { ...ficha, telefone: '92991231234' }).valor).toBe('(92) 99123-1234');
  });
  it('ADR-0012: sem dado ou sem ficha, resposta vazia tratada e sem auditoria de revelação', () => {
    expect(revelarContato('email', { ...ficha, email: null })).toEqual({ valor: null, auditar: false });
    expect(revelarContato('telefone', null)).toEqual({ valor: null, auditar: false });
  });
  it('ADR-0012: campo fora de email|telefone é recusado', () => {
    expect(() => revelarContato('cnpj' as never, ficha)).toThrow();
  });
});

describe('ficha mascarada', () => {
  it('ADR-0012: o detalhe nunca leva e-mail nem telefone completos', () => {
    const f = mapearRespostaReceita(bruta(), 'brasilapi', AGORA) as FichaReceita;
    const m = mascararFicha(f);
    expect(m).not.toHaveProperty('email');
    expect(m).not.toHaveProperty('telefone');
    expect(m.telefone_mascarado).toBe('(92) ****-1234');
  });
});
