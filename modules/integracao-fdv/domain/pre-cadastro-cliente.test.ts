import { ClienteRecebidoFdv, montarRetornoClienteFdv } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import {
  codigoRecusaGravavel,
  corteDoExpurgoPreCadastro,
  decisaoParaGravar,
  hashDoRetornoCliente,
  lerPreCadastroFdv,
  linhaDaRotaClienteRecebido,
  situacaoDeChegada,
  tratarRespostaRetornoCliente,
  type LinhaClienteRecebido,
} from './pre-cadastro-cliente';

const UUID = '33333333-3333-4333-8333-333333333333';
const CLIENTE = '44444444-4444-4444-8444-444444444444';
const base = { cliente_uuid: UUID, recebido_em: '2026-11-24T18:00:00.000-04:00', razao_social: 'Mercado Exemplo', documento: '11.222.333/0001-81' };
const AGORA = new Date('2026-11-25T12:00:00.000Z');

describe('lerPreCadastroFdv (RN-INT-22 do FDV; T-0059 §5.1)', () => {
  it('RN-INT-22: o pendente da v1.0.28 (sem revisão nem hash) vale revisão 1, com o hash do ERP sobre o payload', () => {
    const r = lerPreCadastroFdv(base);
    expect(r).toMatchObject({ ok: true, revisao: 1, documento_mascarado: '11.222.333/****-**', vendedor_external_id: null });
    if (r.ok) expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('RN-INT-22: a tentativa muda a cada entrega e fica fora do hash e do payload guardado', () => {
    const a = lerPreCadastroFdv({ ...base, tentativa: 1 });
    const b = lerPreCadastroFdv({ ...base, tentativa: 2 });
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true);
    if (a.ok) expect(a.payload).not.toHaveProperty('tentativa');
  });
  it('RN-INT-22: revisão e hash do Hub valem como vieram', () => {
    const hash = 'a'.repeat(64);
    expect(lerPreCadastroFdv({ ...base, revisao: 3, hash, codigo_fdv: '00042' })).toMatchObject({ ok: true, revisao: 3, hash, codigo_fdv: '00042' });
  });
  it('decisão (a): vendedor_external_id ausente, nulo ou vazio fica nulo; quando vem, é lido', () => {
    for (const v of [undefined, null, '', '   ']) expect(lerPreCadastroFdv({ ...base, vendedor_external_id: v })).toMatchObject({ ok: true, vendedor_external_id: null });
    expect(lerPreCadastroFdv({ ...base, vendedor_external_id: ' V-07 ' })).toMatchObject({ vendedor_external_id: 'V-07' });
  });
  it('LGPD: fora do contrato devolve só o nome dos campos, nunca o valor', () => {
    const r = lerPreCadastroFdv({ ...base, razao_social: '', documento: 'dado-pessoal-secreto' });
    expect(r).toEqual({ ok: false, campos: ['razao_social'] });
    expect(JSON.stringify(lerPreCadastroFdv({ razao_social: 'Fulano de Tal' }))).not.toContain('Fulano');
  });
  it('LGPD: documento com tamanho estranho não vira máscara', () => {
    expect(lerPreCadastroFdv({ ...base, documento: '123' })).toMatchObject({ ok: true, documento_mascarado: null });
  });
});

describe('situacaoDeChegada (ADR 0069 do FDV: reenvio na mesma linha)', () => {
  it('RN-INT-22: primeira vez entra como recebido', () => expect(situacaoDeChegada(1, null)).toBe('recebido'));
  it('RN-INT-22: revisão nova depois de uma recusa é reenviado', () => expect(situacaoDeChegada(2, { revisao: 1, situacao: 'recusado' })).toBe('reenviado'));
  it('RN-INT-22: revisão nova depois de um aceito é recebido (não é reenvio)', () => expect(situacaoDeChegada(2, { revisao: 1, situacao: 'aceito' })).toBe('recebido'));
  it('RN-INT-22: revisão que não passa da anterior nunca é reenviado', () => expect(situacaoDeChegada(1, { revisao: 2, situacao: 'recusado' })).toBe('recebido'));
});

describe('decisaoParaGravar (CHECKs da 0057)', () => {
  it('aceito leva o cliente_id e nada de motivo nem erros', () => {
    expect(decisaoParaGravar({ status: 'vinculado', external_id: CLIENTE, cliente_id: CLIENTE }, AGORA)).toEqual({ situacao: 'aceito', cliente_id: CLIENTE, motivo: null, erros: null, ultima_recusa_em: null });
  });
  it('vinculado sem cliente_id é defeito da porta, não vira linha', () => {
    expect(() => decisaoParaGravar({ status: 'vinculado', external_id: CLIENTE }, AGORA)).toThrow();
  });
  it('recusado leva motivo (até 300), erros por campo e a data da recusa', () => {
    const erros = [{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' }];
    expect(decisaoParaGravar({ status: 'rejeitado_erp', motivo: 'x'.repeat(400), erros }, AGORA)).toMatchObject({ situacao: 'recusado', erros, ultima_recusa_em: AGORA, cliente_id: null });
    expect(decisaoParaGravar({ status: 'rejeitado_erp', motivo: 'Recusado', erros: [] }, AGORA)).toMatchObject({ erros: null });
  });
});

describe('tratarRespostaRetornoCliente (T-0059 §5.3)', () => {
  it('RN-INF-04: 200 (inclusive repetido e obsoleto) marca enviado', () => expect(tratarRespostaRetornoCliente({ status: 200 }, 'vinculado')).toEqual({ acao: 'enviado' }));
  it('RN-INF-04: 422 external_id_divergente no vinculado abre o conflito de chave (vinculo_divergente)', () => {
    expect(tratarRespostaRetornoCliente({ status: 422, codigo: 'external_id_divergente' }, 'vinculado')).toEqual({ acao: 'conflito_vinculo', codigo: 'external_id_divergente' });
  });
  it('RN-INF-04: 422 external_id_divergente na recusa não abre conflito: falha com alerta', () => {
    expect(tratarRespostaRetornoCliente({ status: 422, codigo: 'external_id_divergente' }, 'rejeitado_erp')).toMatchObject({ acao: 'falhou' });
  });
  it('RN-INF-04: os outros 422 falham com alerta e guardam o código', () => {
    for (const codigo of ['cliente_desconhecido', 'cliente_nao_entregue', 'transicao_invalida', 'revisao_desconhecida']) {
      expect(tratarRespostaRetornoCliente({ status: 422, codigo }, 'vinculado')).toEqual({ acao: 'falhou', codigo, alertar: 'retorno_cliente_recusado_pelo_hub' });
    }
  });
  it('RN-INF-04: 400 é defeito do ERP; 401, 403 e 426 pausam a credencial', () => {
    expect(tratarRespostaRetornoCliente({ status: 400, codigo: 'corpo_invalido' }, 'vinculado')).toMatchObject({ acao: 'falhou', alertar: 'retorno_cliente_defeito_do_erp' });
    for (const status of [401, 403, 426]) expect(tratarRespostaRetornoCliente({ status }, 'vinculado')).toEqual({ acao: 'pausa' });
  });
  it('RN-INF-04: rede, 408, 429 e 5xx tentam de novo; resposta inesperada também, marcada como inesperada', () => {
    for (const status of [0, 408, 429, 500, 503]) expect(tratarRespostaRetornoCliente({ status }, 'vinculado')).toEqual({ acao: 'retentar', inesperado: false });
    expect(tratarRespostaRetornoCliente({ status: 404 }, 'vinculado')).toEqual({ acao: 'retentar', inesperado: true });
  });
  it('LGPD: código estranho do Hub (texto livre) nunca é guardado', () => {
    expect(tratarRespostaRetornoCliente({ status: 422, codigo: 'Fulano de Tal 123' }, 'vinculado')).toMatchObject({ acao: 'falhou', codigo: 'desconhecido' });
    expect(codigoRecusaGravavel('Fulano')).toBe('desconhecido');
    expect(codigoRecusaGravavel('external_id_divergente')).toBe('external_id_divergente');
  });
});

describe('hashDoRetornoCliente', () => {
  it('a mesma decisão em instantes diferentes gera o mesmo hash (sem ocorrido_em)', () => {
    const d = { status: 'vinculado' as const, external_id: CLIENTE };
    const a = montarRetornoClienteFdv({ cliente_uuid: UUID, revisao: 2 }, d, { aditivos: true, ocorrido_em: '2026-11-25T12:00:00.000Z' });
    const b = montarRetornoClienteFdv({ cliente_uuid: UUID, revisao: 2 }, d, { aditivos: true, ocorrido_em: '2026-11-25T12:05:00.000Z' });
    expect(hashDoRetornoCliente(a)).toBe(hashDoRetornoCliente(b));
    expect(hashDoRetornoCliente(a)).not.toBe(hashDoRetornoCliente({ ...a, revisao: 3 }));
  });
});

describe('corteDoExpurgoPreCadastro (RN-INF-06)', () => {
  it('RN-INF-06: o corte é agora − 180 dias, com uma folga de relógio, nunca mais novo que isso', () => {
    const corte = corteDoExpurgoPreCadastro(AGORA);
    const limite = AGORA.getTime() - 180 * 86_400_000;
    expect(corte.getTime()).toBeLessThan(limite);
    expect(limite - corte.getTime()).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe('linhaDaRotaClienteRecebido (RN-INF-06, decisão (c))', () => {
  const linha: LinhaClienteRecebido = {
    id: CLIENTE, cliente_uuid: UUID, codigo_fdv: '00042', razao_social: 'Mercado Exemplo', documento_mascarado: '11.222.333/****-**', vendedor_external_id: null,
    recebido_em: new Date('2026-11-24T22:00:00.000Z'), revisao: 1, situacao: 'recusado', motivo: 'Documento inválido',
    erros: [{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' }], cliente_id: null, payload_expurgado_em: null, retorno: 'enviado',
  };
  it('RN-INF-06: a linha vigente sai com o documento mascarado e o vendedor nulo (a tela mostra "—")', () => {
    const r = linhaDaRotaClienteRecebido(linha);
    expect(ClienteRecebidoFdv.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ razao_social: 'Mercado Exemplo', documento_mascarado: '11.222.333/****-**', vendedor_external_id: null });
  });
  it('RN-INF-06: a linha expurgada sai com razão social "—" e documento nulo, mantendo situação, data, erros e códigos', () => {
    const r = linhaDaRotaClienteRecebido({ ...linha, razao_social: null, documento_mascarado: null, payload_expurgado_em: new Date('2027-05-30T00:00:00.000Z') });
    expect(ClienteRecebidoFdv.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ razao_social: '—', documento_mascarado: null, situacao: 'recusado', revisao: 1, motivo: 'Documento inválido', codigo_fdv: '00042' });
    expect(r.erros).toHaveLength(1);
  });
  it('LGPD: documento fora da máscara nunca sai', () => {
    expect(linhaDaRotaClienteRecebido({ ...linha, documento_mascarado: '11222333000181' }).documento_mascarado).toBeNull();
  });
});
