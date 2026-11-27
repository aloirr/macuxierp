import { PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ErroPlataforma, ConfigIndisponivel, mensagemDoErro } from './erros';
import { ERRO_CODIGO_EM_USO, ERRO_CODIGO_REGRA, ERRO_CODIGO_VAZIO, ERRO_GERAR_INCERTO, ERRO_PEPPER_AUSENTE, ERRO_REVOGAR } from './entrada-textos';
import { botaoDaChave, chaveNaoCopiada, dataHoraTenant, ehGeracaoIncerta, estadoDaChave, linhasLotes, reduzirChave, validarConectorId, vistaEntrada } from './entrada';

const PREFIXO = 'AbCdEfGh';
const CHAVE = 'A'.repeat(43);
const L1 = '11111111-1111-4111-8111-111111111111';
const leitura = (extra: Record<string, unknown> = {}) =>
  PortalEntradaLeitura.parse({
    credenciais: [{ conector_id: 'erp-cliente', prefixo: PREFIXO, criada_em: '2026-11-26T15:00:00.000Z', revogada_em: null }],
    ultimo_sinal: { conector_id: 'erp-cliente', em: '2026-11-26T16:30:00.000Z', versao_conector: '1.2.0' },
    lotes: [
      { lote_id: L1, entidade: 'produto', modo: 'delta', status: 'concluido_com_erros', recebidos: 40, com_erro: 2, recebido_em: '2026-11-26T14:00:00.000Z', concluido_em: '2026-11-26T14:01:00.000Z' },
    ],
    ...extra,
  });

describe('código do conector', () => {
  it('vazio, fora da regra e válido (com a mesma regra do SDK)', () => {
    expect(validarConectorId('  ')).toEqual({ ok: false, erro: ERRO_CODIGO_VAZIO });
    expect(validarConectorId('com espaço')).toEqual({ ok: false, erro: ERRO_CODIGO_REGRA });
    expect(validarConectorId('-comeca-hifen')).toEqual({ ok: false, erro: ERRO_CODIGO_REGRA });
    expect(validarConectorId('a'.repeat(101))).toEqual({ ok: false, erro: ERRO_CODIGO_REGRA });
    expect(validarConectorId(' erp.cliente_1-a ')).toEqual({ ok: true, valor: 'erp.cliente_1-a' });
  });
});

describe('data e hora no fuso do tenant', () => {
  it('"(Manaus)" só quando o fuso é Manaus', () => {
    expect(dataHoraTenant('2026-11-26T16:30:00.000Z', 'America/Manaus')).toBe('26/11/2026 12:30 (Manaus)');
    expect(dataHoraTenant('2026-11-26T16:30:00.000Z', 'America/Sao_Paulo')).toBe('26/11/2026 13:30');
  });
});

describe('vista do bloco', () => {
  it('sem leitura (falha ao carregar): sem chave, sem lotes e código vazio', () => {
    const v = vistaEntrada(null, 'America/Manaus');
    expect(v).toMatchObject({ vigente: null, codigoSugerido: '', lotes: [] });
  });
  it('com chave vigente: ficha com prefixo, versão, último sinal e criação', () => {
    const v = vistaEntrada(leitura(), 'America/Manaus');
    expect(v.vigente).toEqual({ conectorId: 'erp-cliente', prefixo: `${PREFIXO}…`, versao: '1.2.0', ultimoSinal: '26/11/2026 12:30 (Manaus)', criadaEm: '26/11/2026 11:00 (Manaus)' });
    expect(v.codigoSugerido).toBe('erp-cliente');
  });
  it('sinal de outro conector ou ausente: "ainda sem sinal" e versão "—"', () => {
    const outro = vistaEntrada(leitura({ ultimo_sinal: { conector_id: 'outro', em: '2026-11-26T16:30:00.000Z', versao_conector: '1.2.0' } }), 'America/Manaus');
    expect(outro.vigente).toMatchObject({ ultimoSinal: 'ainda sem sinal', versao: '—' });
    expect(vistaEntrada(leitura({ ultimo_sinal: null }), 'America/Manaus').vigente).toMatchObject({ ultimoSinal: 'ainda sem sinal', versao: '—' });
  });
  it('chave revogada não é vigente, mas o código dela vira sugestão', () => {
    const rev = leitura({ credenciais: [{ conector_id: 'velho', prefixo: PREFIXO, criada_em: '2026-11-20T15:00:00.000Z', revogada_em: '2026-11-21T15:00:00.000Z' }] });
    const v = vistaEntrada(rev, 'America/Manaus');
    expect(v.vigente).toBeNull();
    expect(v.codigoSugerido).toBe('velho');
  });
  it('várias credenciais: vale a vigente mais recente', () => {
    const l = leitura({
      credenciais: [
        { conector_id: 'a', prefixo: PREFIXO, criada_em: '2026-11-01T15:00:00.000Z', revogada_em: null },
        { conector_id: 'b', prefixo: 'ZyXwVuTs', criada_em: '2026-11-10T15:00:00.000Z', revogada_em: null },
        { conector_id: 'c', prefixo: PREFIXO, criada_em: '2026-11-25T15:00:00.000Z', revogada_em: '2026-11-26T15:00:00.000Z' },
      ],
    });
    expect(vistaEntrada(l, 'America/Manaus').vigente?.conectorId).toBe('b');
  });
});

describe('botão da chave', () => {
  it('sem chave: Gerar chave sem confirmação; com chave: Trocar chave com confirmação', () => {
    expect(botaoDaChave(false, false)).toEqual({ rotulo: 'Gerar chave', pedeConfirmacao: false });
    expect(botaoDaChave(true, false)).toEqual({ rotulo: 'Trocar chave', pedeConfirmacao: true });
  });
  it('depois de falha incerta o botão volta a "Gerar chave", sem confirmação', () => {
    expect(botaoDaChave(true, true)).toEqual({ rotulo: 'Gerar chave', pedeConfirmacao: false });
  });
});

describe('lista de lotes', () => {
  it('uma linha por lote, cadastro em português, contagens e situação em texto', () => {
    const [l] = linhasLotes(leitura().lotes, 'America/Manaus');
    expect(l).toMatchObject({ id: L1, cadastro: 'Produtos', recebidoEm: '26/11/2026 10:00 (Manaus)', recebidos: 40, comErro: 2, situacao: { texto: 'Concluído com erros', tom: 'aviso' } });
  });
  it('todas as situações têm texto e tom', () => {
    const base = leitura().lotes[0]!;
    const tons = (['recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou'] as const).map((status) => linhasLotes([{ ...base, status }], 'America/Manaus')[0]!.situacao);
    expect(tons).toEqual([
      { texto: 'Recebido', tom: 'neutro' },
      { texto: 'Em processamento', tom: 'neutro' },
      { texto: 'Concluído', tom: 'sucesso' },
      { texto: 'Concluído com erros', tom: 'aviso' },
      { texto: 'Falhou', tom: 'erro' },
    ]);
  });
  it('sem lotes: lista vazia', () => expect(linhasLotes([], 'America/Manaus')).toEqual([]));
});

describe('mapeamento de erros da API de entrada', () => {
  const e = (status: number, codigo: string, mensagem = '') => new ErroPlataforma(status, codigo, {}, mensagem);
  it('503 INDISPONIVEL do E3 (sem o pepper): texto fixo, sem citar variável', () => {
    const m = mensagemDoErro(e(503, 'INDISPONIVEL', 'Entrada de dados indisponível'), 'entrada');
    expect(m.texto).toBe(ERRO_PEPPER_AUSENTE);
    expect(m.texto).not.toContain('MACUXIERP');
  });
  it('409 CONFLITO do E3 (código preso a outra empresa): erro junto do campo', () => {
    expect(mensagemDoErro(e(409, 'CONFLITO', 'Este código de conector já é usado por outra empresa.'), 'entrada')).toMatchObject({ texto: '', campos: { conector_id: ERRO_CODIGO_EM_USO } });
  });
  it('400 e 422: código fora da regra, junto do campo', () => {
    expect(mensagemDoErro(e(400, 'VALIDACAO'), 'entrada').campos.conector_id).toBe(ERRO_CODIGO_REGRA);
    expect(mensagemDoErro(e(422, 'VALIDACAO'), 'entrada').campos.conector_id).toBe(ERRO_CODIGO_REGRA);
  });
  it('rede, 5xx: "Não foi possível confirmar a chave..." ao gerar; ao revogar, o texto próprio', () => {
    const rede = new ConfigIndisponivel('x');
    const g = mensagemDoErro(rede, 'entrada');
    expect(g.texto).toBe(ERRO_GERAR_INCERTO);
    expect(g.campos).toEqual({});
    expect(mensagemDoErro(rede, 'entrada_revogar').texto).toBe(ERRO_REVOGAR);
    expect(mensagemDoErro(e(404, 'NAO_ENCONTRADO'), 'entrada_revogar').texto).toBe(ERRO_REVOGAR);
  });
  it('ehGeracaoIncerta só para a falha de rede ao gerar', () => {
    expect(ehGeracaoIncerta({ ok: false, erro: ERRO_GERAR_INCERTO, campos: {}, chaveNova: false })).toBe(true);
    expect(ehGeracaoIncerta({ ok: false, erro: ERRO_PEPPER_AUSENTE, campos: {}, chaveNova: false })).toBe(false);
    expect(ehGeracaoIncerta({ ok: true, valor: null })).toBe(false);
  });
});

describe('fluxo do diálogo da chave (reducer)', () => {
  const fechado = estadoDaChave();
  const aberto = reduzirChave(fechado, { tipo: 'gerada', chave: CHAVE });
  it('começa sem diálogo e sem chave na memória', () => {
    expect(fechado).toEqual({ chave: null, copiou: null, confirmandoFechar: false });
  });
  it('a chave gerada abre o diálogo, ainda não copiada', () => {
    expect(aberto).toEqual({ chave: CHAVE, copiou: null, confirmandoFechar: false });
    expect(chaveNaoCopiada(aberto)).toBe(true);
  });
  it('Esc e fundo (mesmo aoFechar) sem copiar pedem confirmação e não perdem a chave', () => {
    const s = reduzirChave(aberto, { tipo: 'fechar' });
    expect(s).toEqual({ chave: CHAVE, copiou: null, confirmandoFechar: true });
  });
  it('Voltar da confirmação mantém a chave; Fechar sem copiar descarta tudo', () => {
    const conf = reduzirChave(aberto, { tipo: 'fechar' });
    expect(reduzirChave(conf, { tipo: 'voltar' })).toEqual(aberto);
    expect(reduzirChave(conf, { tipo: 'descartar' })).toEqual(fechado);
  });
  it('depois de copiar, fechar vai direto', () => {
    const copiada = reduzirChave(aberto, { tipo: 'copiou', ok: true });
    expect(copiada.copiou).toBe('sim');
    expect(chaveNaoCopiada(copiada)).toBe(false);
    expect(reduzirChave(copiada, { tipo: 'fechar' })).toEqual(fechado);
  });
  it('falha do clipboard não conta como copiada: ainda pede confirmação', () => {
    const falhou = reduzirChave(aberto, { tipo: 'copiou', ok: false });
    expect(falhou.copiou).toBe('falhou');
    expect(chaveNaoCopiada(falhou)).toBe(true);
    expect(reduzirChave(falhou, { tipo: 'fechar' }).confirmandoFechar).toBe(true);
  });
  it('"Já copiei" fecha sempre, mesmo sem ter usado Copiar', () => {
    expect(reduzirChave(aberto, { tipo: 'ja-copiei' })).toEqual(fechado);
  });
});
