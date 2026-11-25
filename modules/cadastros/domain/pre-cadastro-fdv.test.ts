import type { ClienteParaErpFdv } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ClienteDados } from '../contracts';
import { MENSAGENS_PRE_CADASTRO_FDV, NOME_CONTATO_FDV, motivoDaRecusaFdv, validarPreCadastroFdv, type ContextoPreCadastroFdv } from './pre-cadastro-fdv';

const FILIAL = '33333333-3333-4333-8333-333333333333';
const pre = (o: Partial<ClienteParaErpFdv> = {}): ClienteParaErpFdv => ({
  cliente_uuid: '44444444-4444-4444-8444-444444444444', recebido_em: '2026-11-24T10:00:00-04:00', razao_social: 'Mercadinho Central Ltda',
  documento: '11.222.333/0001-81', inscricao_estadual: '012345679', logradouro: 'Av. Djalma Batista', numero: '100', bairro: 'Chapada',
  cidade: 'Manaus', uf: 'AM', cep: '69050-010', ...o,
});
const ctx = (o: Partial<ContextoPreCadastroFdv> = {}): ContextoPreCadastroFdv => ({
  documentoJaCadastrado: false, filialId: FILIAL, municipiosDaUf: [{ ibge: '1302603', nome: 'Manaus' }, { ibge: '1301902', nome: 'Itacoatiara' }], ...o,
});
const codigos = (r: ReturnType<typeof validarPreCadastroFdv>) => (r.ok ? [] : r.erros.map((e) => `${e.campo}:${e.codigo}`));

describe('telefone do pré-cadastro (RN-INF-08)', () => {
  it('RN-INF-08: o telefone vira contato "Contato do FDV" (o FDV não manda nome), só com dígitos', () => {
    const r = validarPreCadastroFdv(pre({ telefone: '(92) 99999-1234' }), ctx());
    expect(r.ok && r.contato).toEqual({ nome: NOME_CONTATO_FDV, email: null, telefone: '92999991234', papel: null });
    expect(NOME_CONTATO_FDV).toBe('Contato do FDV');
  });
  it('RN-INF-08: sem telefone não há contato; telefone inválido é descartado como o e-mail, sem recusar', () => {
    for (const telefone of [undefined, null, '  ', '123', 'abc']) {
      const r = validarPreCadastroFdv(pre({ telefone }), ctx());
      expect(r.ok && r.contato, String(telefone)).toBeNull();
    }
  });
});

describe('pré-cadastro do FDV (RN-CAD-01/02/03)', () => {
  it('aceito: vira ClienteDados válido, sem limite, vendedor, condição nem tabela', () => {
    const r = validarPreCadastroFdv(pre(), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => ClienteDados.parse(r.dados)).not.toThrow();
    expect(r.dados).toMatchObject({ tipo_pessoa: 'PJ', documento: '11222333000181', ie: '012345679', ind_ie_dest: '1', limite_credito_centavos: 0, vendedor_id: null, filial_id: FILIAL, external_id: null });
    expect(r.dados.enderecos[0]).toMatchObject({ tipo: 'principal', municipio_ibge: '1302603', uf: 'AM', cep: '69050010' });
  });

  it('RN-CAD-01: CPF de 11 dígitos vira PF e o CNPJ alfanumérico de 14 caracteres vira PJ', () => {
    const pf = validarPreCadastroFdv(pre({ documento: '529.982.247-25', inscricao_estadual: '' }), ctx());
    expect(pf.ok && pf.dados.tipo_pessoa).toBe('PF');
    const pj = validarPreCadastroFdv(pre({ documento: '12.ABC.345/01DE-35' }), ctx());
    expect(pj.ok && pj.dados.tipo_pessoa).toBe('PJ');
  });

  it('RN-CAD-01: documento ausente é obrigatório; dígito errado ou tamanho errado é inválido', () => {
    expect(codigos(validarPreCadastroFdv(pre({ documento: null }), ctx()))).toEqual(['documento:documento_obrigatorio']);
    expect(codigos(validarPreCadastroFdv(pre({ documento: '  ' }), ctx()))).toEqual(['documento:documento_obrigatorio']);
    expect(codigos(validarPreCadastroFdv(pre({ documento: '11222333000182' }), ctx()))).toEqual(['documento:documento_invalido']);
    expect(codigos(validarPreCadastroFdv(pre({ documento: '123456789012' }), ctx()))).toEqual(['documento:documento_invalido']);
  });

  it('RN-CAD-01: documento já cadastrado e ativo no tenant recusa, e a mensagem não leva o documento', () => {
    const r = validarPreCadastroFdv(pre(), ctx({ documentoJaCadastrado: true }));
    expect(codigos(r)).toEqual(['documento:documento_ja_cadastrado']);
    if (!r.ok) expect(r.erros[0]?.mensagem).not.toMatch(/\d{5}/);
  });

  it('RN-CAD-02: IE vazia vira ind_ie_dest 9, ISENTO vira 2 e IE válida vira 1', () => {
    const vazia = validarPreCadastroFdv(pre({ inscricao_estadual: null }), ctx());
    expect(vazia.ok && [vazia.dados.ind_ie_dest, vazia.dados.ie]).toEqual(['9', null]);
    const isento = validarPreCadastroFdv(pre({ inscricao_estadual: 'isento' }), ctx());
    expect(isento.ok && [isento.dados.ind_ie_dest, isento.dados.ie]).toEqual(['2', 'ISENTO']);
    const valida = validarPreCadastroFdv(pre({ inscricao_estadual: '01.234.567-9' }), ctx());
    expect(valida.ok && [valida.dados.ind_ie_dest, valida.dados.ie]).toEqual(['1', '012345679']);
  });

  it('RN-CAD-02: IE com dígito errado para a UF recusa com ie_invalida', () => {
    expect(codigos(validarPreCadastroFdv(pre({ inscricao_estadual: '012345678' }), ctx()))).toEqual(['inscricao_estadual:ie_invalida']);
  });

  it('RN-CAD-03: cidade e UF casam com o IBGE sem diferenciar acento nem caixa', () => {
    const r = validarPreCadastroFdv(pre({ cidade: ' ITACOATIARA ', uf: 'am' }), ctx());
    expect(r.ok && r.dados.enderecos[0]?.municipio_ibge).toBe('1301902');
  });

  it('RN-CAD-03: UF inexistente e cidade fora da UF recusam, cada uma no seu campo', () => {
    expect(codigos(validarPreCadastroFdv(pre({ uf: 'XX' }), ctx()))).toEqual(['uf:uf_invalida']);
    expect(codigos(validarPreCadastroFdv(pre({ uf: null }), ctx()))).toEqual(['uf:uf_invalida']);
    expect(codigos(validarPreCadastroFdv(pre({ cidade: 'Atlantida' }), ctx()))).toEqual(['cidade:municipio_nao_encontrado']);
    expect(codigos(validarPreCadastroFdv(pre({ cidade: '' }), ctx()))).toEqual(['cidade:municipio_nao_encontrado']);
  });

  it('RN-CAD-03: cidade ambígua na UF recusa com o código municipio_nao_encontrado', () => {
    const dup = ctx({ municipiosDaUf: [{ ibge: '1302603', nome: 'Manaus' }, { ibge: '1302604', nome: 'MANAUS' }] });
    expect(codigos(validarPreCadastroFdv(pre(), dup))).toEqual(['cidade:municipio_nao_encontrado']);
  });

  it('endereço da NF-e: CEP de 8 dígitos, logradouro e bairro obrigatórios; sem número vira S/N', () => {
    expect(codigos(validarPreCadastroFdv(pre({ cep: '6905001' }), ctx()))).toEqual(['cep:cep_invalido']);
    expect(codigos(validarPreCadastroFdv(pre({ cep: null, logradouro: '', bairro: null }), ctx()))).toEqual(['cep:cep_invalido', 'logradouro:campo_obrigatorio', 'bairro:campo_obrigatorio']);
    const r = validarPreCadastroFdv(pre({ numero: null }), ctx());
    expect(r.ok && r.dados.enderecos[0]?.numero).toBe('S/N');
  });

  it('RN-CAD-03: número e complemento acima de 60 recusam com tamanho_maximo (sem cortar em silêncio); sem número vira S/N', () => {
    expect(codigos(validarPreCadastroFdv(pre({ numero: '9'.repeat(61) }), ctx()))).toEqual(['numero:tamanho_maximo']);
    expect(codigos(validarPreCadastroFdv(pre({ complemento: 'C'.repeat(61) }), ctx()))).toEqual(['complemento:tamanho_maximo']);
    const r = validarPreCadastroFdv(pre({ numero: '', complemento: 'Sala 2' }), ctx());
    expect(r.ok && r.dados.enderecos[0]).toMatchObject({ numero: 'S/N', complemento: 'Sala 2' });
  });

  it('razão social acima de 60 recusa com tamanho_maximo', () => {
    expect(codigos(validarPreCadastroFdv(pre({ razao_social: 'A'.repeat(61) }), ctx()))).toEqual(['razao_social:tamanho_maximo']);
    expect(validarPreCadastroFdv(pre({ razao_social: 'A'.repeat(60) }), ctx()).ok).toBe(true);
  });

  it('filial: sem filial resolvida (informada inexistente ou sem padrão) recusa com filial_nao_encontrada', () => {
    expect(codigos(validarPreCadastroFdv(pre({ filial_external_id: 'F99' }), ctx({ filialId: null })))).toEqual(['filial_external_id:filial_nao_encontrada']);
  });

  it('todas as recusas saem juntas, na ordem dos campos, e nenhuma mensagem leva o valor recusado', () => {
    const r = validarPreCadastroFdv(pre({ documento: '123', inscricao_estadual: '999', cidade: 'Zzz', cep: 'x', logradouro: null, razao_social: 'B'.repeat(70) }), ctx({ filialId: null }));
    expect(codigos(r)).toEqual([
      'documento:documento_invalido', 'cidade:municipio_nao_encontrado', 'inscricao_estadual:ie_invalida', 'cep:cep_invalido',
      'logradouro:campo_obrigatorio', 'razao_social:tamanho_maximo', 'filial_external_id:filial_nao_encontrada',
    ]);
    if (!r.ok) for (const e of r.erros) expect(Object.values(MENSAGENS_PRE_CADASTRO_FDV)).toContain(e.mensagem);
  });

  it('motivo: junção das mensagens sem repetir, até 300 caracteres', () => {
    const r = validarPreCadastroFdv(pre({ documento: null, cep: 'x', logradouro: '', bairro: '' }), ctx());
    if (r.ok) throw new Error('esperava recusa');
    const motivo = motivoDaRecusaFdv(r.erros);
    expect(motivo).toContain(MENSAGENS_PRE_CADASTRO_FDV.documento_obrigatorio);
    expect(motivo.split(MENSAGENS_PRE_CADASTRO_FDV.campo_obrigatorio)).toHaveLength(2);
    const longos = Array.from({ length: 12 }, (_, i) => ({ campo: `c${i}`, codigo: 'x', mensagem: `${i}`.repeat(40) }));
    expect(motivoDaRecusaFdv(longos).length).toBeLessThanOrEqual(300);
  });
});
