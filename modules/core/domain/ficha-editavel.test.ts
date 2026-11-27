import { describe, expect, it } from 'vitest';
import type { EdicaoFicha, FichaReceitaPlanaMascarada } from '../contracts';
import { aplicarEdicao, avaliarTrocaCnpj, camposDiferentes, cnpjParaConferirUso, situacaoTrocaCnpj, mascararEmail, mascararTelefone, previaDaConsulta } from './ficha-editavel';

const SALVA: FichaReceitaPlanaMascarada = {
  nome_fantasia: 'Loja Teste', ie: null, logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '69000000',
  municipio_ibge: '1302603', uf: 'AM', email_mascarado: 'co****@teste.com.br', telefone_mascarado: '(92) ****-1234',
  cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'ATIVA', situacao_cadastral_data: null,
  data_abertura: '2010-01-01', natureza_juridica: 'LTDA', porte: 'ME', cnae_secundarios: ['4712100', '4713001'],
  receita_fonte: 'brasilapi', receita_consultada_em: '2026-11-01T00:00:00.000Z', razao_social: 'EMPRESA TESTE LTDA',
};
const EDICAO: EdicaoFicha = {
  razao_social: 'EMPRESA TESTE LTDA', nome_fantasia: 'Loja Teste', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro',
  cep: '69000000', municipio_ibge: '1302603', uf: 'AM', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'ATIVA',
  situacao_cadastral_data: null, data_abertura: '2010-01-01', natureza_juridica: 'LTDA', porte: 'ME', cnae_secundarios: ['4713001', '4712100'], origem: 'manual',
};
const AGORA = new Date('2026-11-27T12:00:00Z');

describe('RN-CORE-16: camposDiferentes', () => {
  it('RN-CORE-16: fichas iguais, ignorando espaços, caixa da UF e ordem dos CNAEs, não têm diferença', () => {
    expect(camposDiferentes(SALVA, { ...SALVA, bairro: '  Centro ', uf: 'am', cnae_secundarios: ['4713001', '4712100'] })).toEqual([]);
  });
  it('RN-CORE-16: devolve só os nomes dos campos diferentes (nunca valores)', () => {
    expect(camposDiferentes(SALVA, { ...SALVA, bairro: 'Outro', porte: null })).toEqual(['bairro', 'porte']);
  });
  it('RN-CORE-16: contato ausente na outra ficha não conta; contato mascarado diferente conta', () => {
    expect(camposDiferentes(SALVA, { ...SALVA, email_mascarado: undefined, telefone_mascarado: undefined })).toEqual([]);
    expect(camposDiferentes(SALVA, { ...SALVA, email_mascarado: 'xx****@teste.com.br' })).toEqual(['email']);
  });
  it('RN-CORE-16: razão social sem base salva não conta como diferente', () => {
    const { razao_social: _r, ...semRazao } = SALVA;
    expect(camposDiferentes(semRazao, { ...SALVA, razao_social: 'OUTRA' })).toEqual([]);
    expect(camposDiferentes(SALVA, { ...SALVA, razao_social: 'OUTRA' })).toEqual(['razao_social']);
  });
});

describe('RN-CORE-16: IE editável', () => {
  it('RN-CORE-16: IE diferente entra em camposDiferentes; ausente em qualquer lado não conta', () => {
    expect(camposDiferentes({ ...SALVA, ie: '123' }, { ...SALVA, ie: '456' })).toEqual(['ie']);
    expect(camposDiferentes({ ...SALVA, ie: '123' }, { ...SALVA, ie: ' isento ' })).toEqual(['ie']);
    const { ie: _i, ...semIe } = SALVA;
    expect(camposDiferentes(semIe, { ...SALVA, ie: '456' })).toEqual([]);
  });
  it('RN-CORE-16: aplicarEdicao grava a IE alterada, mantém quando ausente e limpa quando nula', () => {
    const r = aplicarEdicao({ ...SALVA, ie: '123' }, { ...EDICAO, ie: 'ISENTO' }, AGORA);
    expect(r.campos_alterados).toEqual(['ie']);
    expect(r.ficha.ie).toBe('ISENTO');
    const mantem = aplicarEdicao({ ...SALVA, ie: '123' }, EDICAO, AGORA);
    expect(mantem.campos_alterados).toEqual([]);
    expect('ie' in mantem.ficha).toBe(false);
    const limpa = aplicarEdicao({ ...SALVA, ie: '123' }, { ...EDICAO, ie: null }, AGORA);
    expect(limpa.campos_alterados).toEqual(['ie']);
    expect(limpa.ficha.ie).toBeNull();
  });
  it('RN-CORE-16: a prévia da Receita repete a IE salva e nunca a marca como diferente', () => {
    const { ficha } = aplicarEdicao(SALVA, EDICAO, AGORA);
    const r = previaDaConsulta({ ...SALVA, ie: '123' }, { ...ficha, fonte: 'brasilapi', consultado_em: AGORA.toISOString() });
    expect(r.previa.ie).toBe('123');
    expect(r.diferentes).not.toContain('ie');
  });
});

describe('RN-CORE-16: aplicarEdicao', () => {
  it('RN-CORE-16: sem mudança nenhuma devolve campos_alterados vazio', () => {
    expect(aplicarEdicao(SALVA, EDICAO, AGORA).campos_alterados).toEqual([]);
  });
  it('RN-CORE-16: devolve só os nomes alterados e a ficha para gravar, com fonte manual', () => {
    const r = aplicarEdicao(SALVA, { ...EDICAO, bairro: ' Aleixo ', uf: 'pa' }, AGORA);
    expect(r.campos_alterados).toEqual(['bairro', 'uf']);
    expect(r.ficha).toMatchObject({ bairro: 'Aleixo', uf: 'PA', fonte: 'manual', consultado_em: AGORA.toISOString() });
    expect('email' in r.ficha).toBe(false);
  });
  it('RN-CORE-16: e-mail e telefone só entram quando editados e diferentes do mascarado', () => {
    const r = aplicarEdicao(SALVA, { ...EDICAO, email: 'novo@teste.com.br', telefone: '9233335678' }, AGORA);
    expect(r.campos_alterados).toEqual(['email', 'telefone']);
    expect(r.ficha).toMatchObject({ email: 'novo@teste.com.br', telefone: '9233335678' });
    expect(aplicarEdicao(SALVA, { ...EDICAO, email: 'comercial@teste.com.br' }, AGORA).campos_alterados).toEqual([]);
  });
  it('RN-CORE-16: origem receita mantém a fonte e o instante da consulta', () => {
    const r = aplicarEdicao(SALVA, { ...EDICAO, origem: 'receita', consultado_em: '2026-11-26T10:00:00.000Z', porte: 'EPP' }, AGORA);
    expect(r.ficha).toMatchObject({ fonte: 'brasilapi', consultado_em: '2026-11-26T10:00:00.000Z' });
  });
  it('RN-CORE-16: máscaras seguem o padrão do banco', () => {
    expect(mascararEmail('comercial@teste.com.br')).toBe('co****@teste.com.br');
    expect(mascararTelefone('9232221234')).toBe('(92) ****-1234');
  });
});

describe('RN-CORE-16: avaliarTrocaCnpj', () => {
  const base = { atual: '11222333000181', novo: '11444777000161', confirmacao: true, superadmin: true, temNfeAutorizadaProducao: false, cnpjEmUso: false };
  it('RN-CORE-16: ok normaliza o CNPJ novo', () => {
    expect(avaliarTrocaCnpj({ ...base, novo: '11.444.777/0001-61' })).toEqual({ ok: true, cnpj: '11444777000161' });
  });
  it.each([
    [{ superadmin: false }, 'nao_superadmin'],
    [{ confirmacao: false }, 'sem_confirmacao'],
    [{ novo: '11444777000160' }, 'cnpj_invalido'],
    [{ novo: '11.222.333/0001-81' }, 'cnpj_igual'],
    [{ cnpjEmUso: true }, 'cnpj_em_uso'],
    [{ temNfeAutorizadaProducao: true }, 'nfe_autorizada_producao'],
  ] as const)('RN-CORE-16: %j bloqueia com %s', (alt, motivo) => {
    expect(avaliarTrocaCnpj({ ...base, ...alt })).toEqual({ ok: false, motivo });
  });
});

describe('RN-CORE-16: previaDaConsulta', () => {
  const FICHA = { ...EDICAO, fonte: 'brasilapi' as const, consultado_em: '2026-11-27T10:00:00.000Z' };
  it('RN-CORE-16: prévia mascara os contatos e marca só os campos diferentes do salvo', () => {
    const { origem: _o, ...base } = FICHA;
    const r = previaDaConsulta(SALVA, { ...base, bairro: 'Aleixo', email: 'contato@nova.com.br' });
    expect(r.previa).toMatchObject({ bairro: 'Aleixo', email_mascarado: 'co****@nova.com.br', telefone_mascarado: null });
    expect(r.diferentes).toEqual(['bairro', 'email']);
  });
  it('RN-CORE-16: contato que a Receita não trouxe não conta como diferente', () => {
    const { origem: _o, ...base } = FICHA;
    expect(previaDaConsulta(SALVA, base).diferentes).toEqual([]);
  });
});

describe('RN-CORE-16: situacaoTrocaCnpj', () => {
  it('RN-CORE-16: sem NF-e em produção permite; com NF-e bloqueia; sem resposta da consulta bloqueia como indisponível', () => {
    expect(situacaoTrocaCnpj(false)).toEqual({ permitida: true });
    expect(situacaoTrocaCnpj(true)).toMatchObject({ permitida: false, motivo: 'nfe_autorizada_producao' });
    expect(situacaoTrocaCnpj(null)).toEqual({ permitida: false, motivo: 'consulta_indisponivel', mensagem: 'Não foi possível verificar as notas agora; tente de novo' });
  });
});

describe('RN-CORE-16: cnpjParaConferirUso', () => {
  it('RN-CORE-16: devolve o CNPJ normalizado só quando é válido e diferente do atual', () => {
    expect(cnpjParaConferirUso('11222333000181', '11.444.777/0001-61')).toBe('11444777000161');
    expect(cnpjParaConferirUso('11222333000181', '11444777000160')).toBeNull();
    expect(cnpjParaConferirUso('11222333000181', '11.222.333/0001-81')).toBeNull();
  });
});
