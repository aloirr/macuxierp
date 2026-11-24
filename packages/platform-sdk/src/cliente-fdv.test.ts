import { describe, expect, it } from 'vitest';
import {
  ClienteParaErpFdv,
  ClienteRecebidoFdv,
  ClientesPendentesFdv,
  ERROS_RECUSA_CLIENTE_MAX_FDV,
  RetornoClienteAceitoFdv,
  RetornoClienteFdv,
  aditivosClienteFdvLigados,
  mascararDocumentoFdv,
  montarRetornoClienteFdv,
  revisaoDoPreCadastro,
} from './cliente-fdv';
import { CAMINHOS_INTEGRACAO_FDV_TENANT } from './portal-integracao-operacao';
import * as sdk from './index';

const UUID = '33333333-3333-4333-8333-333333333333';
const AGORA = '2026-11-24T22:30:00.000Z';

/** Pendente como a v1.0.28 manda (sem os aditivos da ADR 0069 do FDV). */
const v1028 = {
  cliente_uuid: UUID,
  recebido_em: '2026-11-24T18:00:00.000-04:00',
  razao_social: 'Mercado Exemplo',
  nome_fantasia: null,
  documento: '11222333000181',
  inscricao_estadual: null,
  telefone: null,
  email: null,
  logradouro: 'Rua A',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69000000',
  latitude: null,
  longitude: null,
  filial_external_id: null,
};

describe('pendentes (v1.0.28 e aditivos da ADR 0069 do FDV)', () => {
  it('lê a v1.0.28 (revisão 1) e a nova, e tolera campo novo', () => {
    expect(revisaoDoPreCadastro(ClienteParaErpFdv.parse(v1028))).toBe(1);
    const novo = ClienteParaErpFdv.parse({ ...v1028, revisao: 2, hash: 'a'.repeat(64), codigo_fdv: '00123', tentativa: 1, campo_futuro: 'x' });
    expect(revisaoDoPreCadastro(novo)).toBe(2);
    expect(ClientesPendentesFdv.parse({ clientes: [v1028] }).clientes).toHaveLength(1);
    expect(ClienteParaErpFdv.safeParse({ ...v1028, codigo_fdv: '12' }).success).toBe(false);
    expect(ClientesPendentesFdv.safeParse({ clientes: Array(101).fill(v1028) }).success).toBe(false);
  });
});

describe('opção MACUXIERP_FDV_CLIENTE_REVISAO', () => {
  it('padrão ligado; desligado; outro valor derruba', () => {
    const N = 'MACUXIERP_FDV_CLIENTE_REVISAO';
    expect(aditivosClienteFdvLigados({})).toBe(true);
    expect(aditivosClienteFdvLigados({ [N]: ' Ligado ' })).toBe(true);
    expect(aditivosClienteFdvLigados({ [N]: 'desligado' })).toBe(false);
    expect(() => aditivosClienteFdvLigados({ [N]: 'sim' })).toThrow(/configuração inválida/);
  });
});

describe('montarRetornoClienteFdv', () => {
  const erros = [{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'CNPJ com dígito verificador inválido' }];
  const recusa = { status: 'rejeitado_erp', motivo: 'Documento inválido', erros } as const;

  it('aditivos desligados (v1.0.28): sem revisão nem erros', () => {
    const r = montarRetornoClienteFdv({ cliente_uuid: UUID, revisao: 3 }, recusa, { aditivos: false, ocorrido_em: AGORA });
    expect(r).toEqual({ versao_contrato: 'v1', cliente_uuid: UUID, status: 'rejeitado_erp', motivo: 'Documento inválido', ocorrido_em: AGORA });
  });

  it('aditivos ligados: revisão só se o pendente a trouxe; erros só se houver', () => {
    expect(montarRetornoClienteFdv({ cliente_uuid: UUID, revisao: 3 }, recusa, { aditivos: true, ocorrido_em: AGORA })).toMatchObject({ revisao: 3, erros });
    const semRevisao = montarRetornoClienteFdv({ cliente_uuid: UUID }, { ...recusa, erros: [] }, { aditivos: true, ocorrido_em: AGORA });
    expect(semRevisao).not.toHaveProperty('revisao');
    expect(semRevisao).not.toHaveProperty('erros');
  });

  it('vinculado leva o código e nunca motivo; corta motivo e erros nos limites', () => {
    expect(montarRetornoClienteFdv({ cliente_uuid: UUID }, { status: 'vinculado', external_id: 'C000123' }, { aditivos: true, ocorrido_em: AGORA })).toEqual({
      versao_contrato: 'v1', cliente_uuid: UUID, status: 'vinculado', external_id: 'C000123', ocorrido_em: AGORA,
    });
    const longo = montarRetornoClienteFdv({ cliente_uuid: UUID }, { ...recusa, motivo: 'x'.repeat(500), erros: Array(60).fill(erros[0]) }, { aditivos: true, ocorrido_em: AGORA });
    expect(longo.motivo).toHaveLength(300);
    expect(longo.erros).toHaveLength(ERROS_RECUSA_CLIENTE_MAX_FDV);
  });

  it('o Zod recusa as combinações erradas', () => {
    const base = { versao_contrato: 'v1', cliente_uuid: UUID, ocorrido_em: AGORA };
    expect(RetornoClienteFdv.safeParse({ ...base, status: 'vinculado' }).success).toBe(false);
    expect(RetornoClienteFdv.safeParse({ ...base, status: 'vinculado', external_id: 'C1', motivo: 'x' }).success).toBe(false);
    expect(RetornoClienteFdv.safeParse({ ...base, status: 'rejeitado_erp' }).success).toBe(false);
    expect(RetornoClienteFdv.safeParse({ ...base, status: 'rejeitado_erp', motivo: 'x', external_id: 'C1' }).success).toBe(false);
  });

  it('o 200 da v1.0.28 (sem revisão) e o obsoleto', () => {
    expect(RetornoClienteAceitoFdv.safeParse({ cliente_uuid: UUID, estado: 'vinculado', repetido: false }).success).toBe(true);
    expect(RetornoClienteAceitoFdv.parse({ cliente_uuid: UUID, estado: 'rejeitado', repetido: false, revisao: 2, obsoleto: true }).obsoleto).toBe(true);
  });
});

describe('seção "Clientes recebidos do FDV" (LGPD)', () => {
  it('mascara CPF e CNPJ; outro tamanho vira nulo', () => {
    expect(mascararDocumentoFdv('123.456.789-09')).toBe('***.456.789-**');
    expect(mascararDocumentoFdv('11.222.333/0001-81')).toBe('11.222.333/****-**');
    expect(mascararDocumentoFdv('123')).toBeNull();
    expect(mascararDocumentoFdv(null)).toBeNull();
  });

  const linha = {
    id: UUID, cliente_uuid: UUID, codigo_fdv: null, razao_social: 'Mercado Exemplo', documento_mascarado: '11.222.333/****-**',
    vendedor_external_id: null, recebido_em: AGORA, revisao: 1, situacao: 'recusado', motivo: 'Documento inválido',
    erros: [{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'CNPJ com dígito verificador inválido' }], cliente_id: null, retorno: 'enviado',
  };

  it('aceita a linha recusada; o documento inteiro não passa; aceito exige o cliente', () => {
    expect(ClienteRecebidoFdv.parse(linha)).toEqual(linha);
    expect(ClienteRecebidoFdv.safeParse({ ...linha, documento_mascarado: '11222333000181' }).success).toBe(false);
    expect(ClienteRecebidoFdv.safeParse({ ...linha, situacao: 'aceito', motivo: null, erros: [] }).success).toBe(false);
    expect(ClienteRecebidoFdv.safeParse({ ...linha, situacao: 'aceito', motivo: null, erros: [], cliente_id: UUID }).success).toBe(true);
    expect(ClienteRecebidoFdv.safeParse({ ...linha, situacao: 'reenviado', motivo: null }).success).toBe(false);
  });

  it('caminho do BKO e reexport pelo índice', () => {
    expect(CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidos).toBe('/integracao-fdv/clientes-recebidos');
    expect(sdk.montarRetornoClienteFdv).toBe(montarRetornoClienteFdv);
  });
});
