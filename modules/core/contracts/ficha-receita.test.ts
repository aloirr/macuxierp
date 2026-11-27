import { describe, expect, it } from 'vitest';
import { CnpjAlterado, EdicaoFicha, EVENTO_CNPJ_ALTERADO, FonteFichaReceita, MENSAGENS_BLOQUEIO_CNPJ, MotivoBloqueioCnpj, PreviaReceita, ROTAS_FICHA, ResultadoSalvarFicha, SituacaoTrocaCnpj, ResultadoTrocaCnpj, TrocaCnpj } from './ficha-receita';

const CNPJ_OK = '11222333000181';
const edicao = {
  razao_social: 'Empresa Fictícia LTDA', nome_fantasia: null, logradouro: null, numero: null, complemento: null, bairro: null,
  cep: null, municipio_ibge: null, uf: 'AM', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: null,
  situacao_cadastral_data: null, data_abertura: null, natureza_juridica: null, porte: null, cnae_secundarios: [], origem: 'manual',
};
const mascarada = {
  nome_fantasia: null, ie: null, logradouro: null, numero: null, complemento: null, bairro: null, cep: null, municipio_ibge: null, uf: null,
  email_mascarado: null, telefone_mascarado: null, cnae_principal: null, regime_receita: null, situacao_cadastral: null,
  situacao_cadastral_data: null, data_abertura: null, natureza_juridica: null, porte: null, cnae_secundarios: null, receita_fonte: null, receita_consultada_em: null,
};

describe('RN-CORE-16: contrato da ficha editável', () => {
  it('fonte aceita manual e recusa desconhecida', () => {
    expect(FonteFichaReceita.safeParse('manual').success).toBe(true);
    expect(FonteFichaReceita.safeParse('outra').success).toBe(false);
  });
  it('EdicaoFicha aceita sem fonte nem contatos e recusa limite estourado ou origem inválida', () => {
    expect(EdicaoFicha.safeParse(edicao).success).toBe(true);
    expect(EdicaoFicha.safeParse({ ...edicao, origem: 'receita', consultado_em: '2026-11-27T10:00:00Z', telefone: '92999990000' }).success).toBe(true);
    expect(EdicaoFicha.safeParse({ ...edicao, razao_social: 'x'.repeat(151) }).success).toBe(false);
    expect(EdicaoFicha.safeParse({ ...edicao, origem: 'cache' }).success).toBe(false);
    expect(EdicaoFicha.safeParse({ ...edicao, telefone: '123' }).success).toBe(false);
  });
  it('RN-CORE-16: IE aceita dígitos e ISENTO (maiúsculas, até 14), nula limpa, ausente mantém; recusa letras e excesso', () => {
    expect(EdicaoFicha.parse({ ...edicao, ie: ' isento ' }).ie).toBe('ISENTO');
    expect(EdicaoFicha.parse({ ...edicao, ie: '123456789' }).ie).toBe('123456789');
    expect(EdicaoFicha.parse({ ...edicao, ie: null }).ie).toBeNull();
    expect(EdicaoFicha.parse(edicao).ie).toBeUndefined();
    expect(EdicaoFicha.safeParse({ ...edicao, ie: '1'.repeat(15) }).success).toBe(false);
    expect(EdicaoFicha.safeParse({ ...edicao, ie: 'ABC123' }).success).toBe(false);
  });
  it('RN-CORE-16: evento core.empresa.cnpj_alterado@1 não leva CNPJ antigo e exige CNPJ novo válido', () => {
    expect(EVENTO_CNPJ_ALTERADO).toBe('core.empresa.cnpj_alterado@1');
    const ev = { tenant_id: '00000000-0000-4000-8000-0000000000e1', empresa_id: '00000000-0000-4000-8000-0000000000e1', cnpj_novo: CNPJ_OK, request_id: 'r', alterado_em: '2026-11-27T12:00:00Z' };
    expect(CnpjAlterado.safeParse(ev).success).toBe(true);
    expect(CnpjAlterado.safeParse({ ...ev, cnpj_novo: '11111111111111' }).success).toBe(false);
    expect(Object.keys(CnpjAlterado.shape).sort()).toEqual(['alterado_em', 'cnpj_novo', 'empresa_id', 'request_id', 'tenant_id']);
  });
  it('RN-CORE-16: request_id aceita migracao-0077:<uuid> e rejeita vazio ou gigante', () => {
    const ev = { tenant_id: '00000000-0000-4000-8000-0000000000e1', empresa_id: '00000000-0000-4000-8000-0000000000e1', cnpj_novo: CNPJ_OK, alterado_em: '2026-11-27T12:00:00Z' };
    expect(CnpjAlterado.safeParse({ ...ev, request_id: 'migracao-0077:00000000-0000-4000-8000-0000000000e1' }).success).toBe(true);
    expect(CnpjAlterado.safeParse({ ...ev, request_id: '' }).success).toBe(false);
    expect(CnpjAlterado.safeParse({ ...ev, request_id: 'x'.repeat(201) }).success).toBe(false);
  });
  it('ResultadoSalvarFicha cobre ok, sem_mudanca e erro', () => {
    expect(ResultadoSalvarFicha.safeParse({ estado: 'ok', campos_alterados: ['uf'], ficha: mascarada }).success).toBe(true);
    expect(ResultadoSalvarFicha.safeParse({ estado: 'sem_mudanca', ficha: mascarada }).success).toBe(true);
    expect(ResultadoSalvarFicha.safeParse({ estado: 'erro', motivo: 'validacao', mensagem: 'x', campos: { uf: 'inválida' } }).success).toBe(true);
    expect(ResultadoSalvarFicha.safeParse({ estado: 'erro', motivo: 'xx', mensagem: 'x' }).success).toBe(false);
  });
  it('PreviaReceita aceita ok e erro e recusa motivo fora do enum', () => {
    expect(PreviaReceita.safeParse({ estado: 'ok', previa: mascarada, diferentes: ['uf'], fonte: 'brasilapi', consultado_em: '2026-11-27T10:00:00Z' }).success).toBe(true);
    expect(PreviaReceita.safeParse({ estado: 'erro', motivo: 'fonte_indisponivel', mensagem: 'x' }).success).toBe(true);
    expect(PreviaReceita.safeParse({ estado: 'erro', motivo: 'zzz', mensagem: 'x' }).success).toBe(false);
  });
  it('TrocaCnpj exige DV válido e confirmacao true', () => {
    expect(TrocaCnpj.safeParse({ cnpj_novo: CNPJ_OK, confirmacao: true }).success).toBe(true);
    expect(TrocaCnpj.safeParse({ cnpj_novo: '11222333000182', confirmacao: true }).success).toBe(false);
    expect(TrocaCnpj.safeParse({ cnpj_novo: CNPJ_OK, confirmacao: false }).success).toBe(false);
    expect(TrocaCnpj.safeParse({ cnpj_novo: CNPJ_OK }).success).toBe(false);
  });
  it('ResultadoTrocaCnpj e mensagens cobrem todos os motivos', () => {
    expect(ResultadoTrocaCnpj.safeParse({ estado: 'ok', cnpj: CNPJ_OK }).success).toBe(true);
    expect(ResultadoTrocaCnpj.safeParse({ estado: 'bloqueado', motivo: 'cnpj_igual', mensagem: 'x' }).success).toBe(true);
    expect(ResultadoTrocaCnpj.safeParse({ estado: 'bloqueado', motivo: 'outro', mensagem: 'x' }).success).toBe(false);
    for (const m of MotivoBloqueioCnpj.options) expect(MENSAGENS_BLOQUEIO_CNPJ[m].length).toBeGreaterThan(10);
  });
});

describe('RN-CORE-16: rotas e situação da troca de CNPJ', () => {
  it('RN-CORE-16: ROTAS_FICHA tem os três caminhos do portal e SituacaoTrocaCnpj exige motivo quando não permitida', () => {
    expect(ROTAS_FICHA.salvar).toEqual({ metodo: 'PUT', caminho: '/v1/plataforma/empresas/:id/ficha' });
    expect(ROTAS_FICHA.situacaoCnpj).toEqual({ metodo: 'GET', caminho: '/v1/plataforma/empresas/:id/cnpj' });
    expect(ROTAS_FICHA.trocarCnpj.caminho).toBe('/v1/plataforma/empresas/:id/cnpj');
    expect(SituacaoTrocaCnpj.safeParse({ permitida: true }).success).toBe(true);
    expect(SituacaoTrocaCnpj.safeParse({ permitida: false }).success).toBe(false);
    expect(SituacaoTrocaCnpj.safeParse({ permitida: false, motivo: 'consulta_indisponivel', mensagem: MENSAGENS_BLOQUEIO_CNPJ.consulta_indisponivel }).success).toBe(true);
    expect(MotivoBloqueioCnpj.options).toContain('consulta_indisponivel');
  });
});
