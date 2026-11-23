/** Peças puras do portal `/config` na API (T-0050, ADR 0012 §4 e §6; cargas da T-0058): SQLSTATE → HTTP e limite de login por IP. */
import { CODIGOS_ESTADO_MUDOU_ZERAR, ErroApi, MENSAGENS_CARGA_PORTAL } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { erroDaPlataforma } from './erros';
import { LimitePorIp } from './limite-ip';

const pg = (code: string, message = 'empresa "Fulano de Tal" não encontrada') => Object.assign(new Error(message), { code });

describe('erroDaPlataforma (ADR 0012 §4)', () => {
  it.each([
    ['MXS01', 401, 'NAO_AUTENTICADO'],
    ['P0002', 404, 'NAO_ENCONTRADO'],
    ['23505', 409, 'CONFLITO'],
    ['23514', 422, 'REGRA_PLATAFORMA'],
  ])('%s vira %i %s com mensagem fixa, sem o texto do banco', (code, status, codigo) => {
    const e = erroDaPlataforma(pg(code));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status, codigo });
    expect((e as ErroApi).message).not.toContain('Fulano');
  });

  it.each([
    ['MXI01', 'Cadastre a credencial do FDV antes'],
    ['MXI02', 'A credencial mudou; recarregue a página.'],
    ['MXI03', 'O estado mudou; recarregue a página.'],
  ])('%s (0038, ADR 0013 §2) vira 409 CONFLITO com mensagem fixa', (code, mensagem) => {
    const e = erroDaPlataforma(pg(code));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', message: mensagem });
    expect((e as ErroApi).detalhes).toBeUndefined();
  });

  it.each(['entidade_desabilitada', 'lote_em_voo', 'sem_pausa'])('MXI03 com DETAIL %s leva só o código do domain em detalhes.codigo', (detail) => {
    const e = erroDaPlataforma(Object.assign(pg('MXI03'), { detail }));
    expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', detalhes: { codigo: detail } });
  });

  it('MXI03 com DETAIL fora da lista não ecoa o texto do banco', () => {
    const e = erroDaPlataforma(Object.assign(pg('MXI03'), { detail: 'cliente Fulano de Tal' })) as ErroApi;
    expect(e.detalhes).toBeUndefined();
    expect(JSON.stringify({ m: e.message, d: e.detalhes })).not.toContain('Fulano');
  });

  it.each(['empresa_inativa', 'modulo_desligado'])('MXI04 (0039) com DETAIL %s vira 422 RN-CORE-02 com o motivo em detalhes.codigo', (detail) => {
    const e = erroDaPlataforma(Object.assign(pg('MXI04'), { detail }));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({
      status: 422,
      codigo: 'RN-CORE-02',
      message: 'A empresa precisa estar ativa e com o módulo Integração FDV licenciado.',
      detalhes: { codigo: detail },
    });
  });

  it('MXI04 com DETAIL fora da lista não ecoa o texto do banco', () => {
    const e = erroDaPlataforma(Object.assign(pg('MXI04'), { detail: 'cliente Fulano de Tal' })) as ErroApi;
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
    expect(e.detalhes).toBeUndefined();
    expect(JSON.stringify({ m: e.message, d: e.detalhes })).not.toContain('Fulano');
  });

  it('23514 da 0038 (empresa fora de ativo, módulo desligado) segue 422 REGRA_PLATAFORMA', () => {
    for (const m of ['empresa fora de ativo', 'módulo integracao-fdv desligado na empresa']) {
      expect(erroDaPlataforma(pg('23514', m))).toMatchObject({ status: 422, codigo: 'REGRA_PLATAFORMA', message: 'Pedido recusado pelas regras da plataforma' });
    }
  });

  it('MXC01 (carga do portal, T-0058) vira 409 CONFLITO com mensagem e código fixos, sem o DETAIL do banco', () => {
    const e = erroDaPlataforma(Object.assign(pg('MXC01'), { detail: 'cliente Fulano de Tal' })) as ErroApi;
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({
      status: 409,
      codigo: 'CONFLITO',
      message: 'Já há uma carga em andamento nesta empresa.',
      detalhes: { codigo: 'carga_em_andamento' },
    });
    expect(JSON.stringify({ m: e.message, d: e.detalhes })).not.toContain('Fulano');
  });

  it.each(CODIGOS_ESTADO_MUDOU_ZERAR)('MXC03 do zerar (0043, RN-CAD-10) com DETAIL %s vira 409 "os dados mudaram" com o DETAIL em detalhes.codigo', (detail) => {
    const e = erroDaPlataforma(Object.assign(pg('MXC03'), { detail, hint: 'cliente' })) as ErroApi;
    expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', message: MENSAGENS_CARGA_PORTAL.estadoMudouZerar, detalhes: { codigo: detail } });
  });

  it('MXC03 com DETAIL fora da lista fechada vira 409 sem código', () => {
    for (const detail of ['cliente Fulano de Tal', undefined]) {
      const e = erroDaPlataforma(Object.assign(pg('MXC03'), { detail })) as ErroApi;
      expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', message: MENSAGENS_CARGA_PORTAL.estadoMudouZerar });
      expect(e.detalhes).toBeUndefined();
    }
  });

  it('MXI03 do zerar_espelho (0043) com DETAIL entidade_ligada leva o código em detalhes.codigo', () => {
    expect(erroDaPlataforma(Object.assign(pg('MXI03'), { detail: 'entidade_ligada' }))).toMatchObject({ status: 409, detalhes: { codigo: 'entidade_ligada' } });
  });

  it.each(['empresa_inativa', 'modulo_desligado'])('MXC04 (carga do portal) com DETAIL %s vira 422 RN-CORE-02 com o motivo em detalhes.codigo', (detail) => {
    const e = erroDaPlataforma(Object.assign(pg('MXC04'), { detail }));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-02', message: 'A empresa precisa estar ativa e com o módulo Cadastros licenciado.', detalhes: { codigo: detail } });
  });

  it('MXC04 com DETAIL fora da lista fechada não ecoa o texto do banco', () => {
    for (const detail of ['cliente Fulano de Tal', 'carga_em_andamento', undefined]) {
      const e = erroDaPlataforma(Object.assign(pg('MXC04'), { detail })) as ErroApi;
      expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
      expect(e.detalhes).toBeUndefined();
      expect(e.message).not.toContain('Fulano');
    }
  });

  it('o resto segue como está (ErroApi do plugin, erro de programação → 500)', () => {
    const api = new ErroApi(422, 'RN-CORE-02', 'x');
    expect(erroDaPlataforma(api)).toBe(api);
    const outro = pg('42501');
    expect(erroDaPlataforma(outro)).toBe(outro);
  });
});

describe('LimitePorIp (ADR 0012 §6)', () => {
  it('10 tentativas por IP em 15 min; a 11ª é recusada; a janela vence; IPs são independentes', () => {
    const l = new LimitePorIp(10, 15 * 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(l.contar('1.1.1.1', t0 + i)).toBe(true);
    expect(l.contar('1.1.1.1', t0 + 11)).toBe(false);
    expect(l.contar('2.2.2.2', t0 + 11)).toBe(true);
    expect(l.contar('1.1.1.1', t0 + 15 * 60_000)).toBe(true);
  });

  it('não cresce sem fim: a limpeza tira as janelas vencidas', () => {
    const l = new LimitePorIp(10, 1000, 100);
    for (let i = 0; i < 150; i++) l.contar(`ip-${i}`, 0);
    l.contar('novo', 5000);
    expect(l.tamanho).toBeLessThanOrEqual(51);
  });
});
