import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LogCadastroFdvTenant } from '@macuxierp/platform-sdk';
import {
  colunasDeErrosLog, ROTULO_BAIXAR_ERROS, ROTULO_CORRIGIR, TEXTO_ESTADO_LOG, TEXTO_LEGENDA_ERROS_LOG, TEXTO_VAZIO_RECEBIDOS_LOG, TITULO_SECAO_RECEBIDOS_LOG,
} from '@macuxierp/integracao-fdv/web';
import { Chip } from '@macuxierp/ui';
import { CorpoLogBko, EstadoLog, TEXTO_FALHA_CARGA_LOG, caminhoDoDownloadErros, corrigirEmSegundo, textoErrosAbertos, ROTULO_TENTAR_DE_NOVO } from './log';

vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes-log-fdv', () => ({ lerLogFdv: async () => ({ ok: false, motivo: 'erro' }) }));

const log = LogCadastroFdvTenant.parse({
  entidade: 'cliente', lido_em: '2026-11-22T15:00:00.000Z', motivo: 'erros_por_linha', total_erros: 3,
  envios: [{ em: '2026-11-22T14:05:00.000Z', origem: 'ciclo', situacao: 'com_erros', registros: 10, com_erro: 2 }],
  erros: [
    { registro_external_id: 'CLI-001', nome_curto: 'Mercado Sol', campo: 'cnpj', codigo: 'cnpj_invalido', motivo_texto: 'O CNPJ é inválido.', acao_texto: 'Corrija o CNPJ no cadastro.', corrigir_href: '/cadastros/clientes/abc' },
    { registro_external_id: 'CLI-002', nome_curto: null, campo: null, codigo: 'apagado', motivo_texto: 'O registro foi apagado.', acao_texto: 'Nada a fazer.', corrigir_href: null },
  ],
});

describe('BKO: Log da Integração FDV (T-0086, D-4)', () => {
  it('mostra as colunas, o registro, o nome curto, o campo, o motivo e a ação', () => {
    const h = renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />);
    for (const c of colunasDeErrosLog) expect(h).toContain(c.titulo);
    for (const t of ['CLI-001', 'Mercado Sol', 'cnpj', 'O CNPJ é inválido.', 'Corrija o CNPJ no cadastro.']) expect(h).toContain(t);
  });

  it('"Corrigir cadastro" só como link quando há corrigirHref, levando ao destino do 2a', () => {
    const h = renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />);
    expect(h.match(/<a href="\/cadastros/g)).toHaveLength(1); // o outro link é o download do CSV
    expect(h).toContain(`<a href="/cadastros/clientes/abc">${ROTULO_CORRIGIR}</a>`);
  });

  it('a legenda diz que os registros não foram enviados ao FDV, acima da tabela e só com erros listados', () => {
    const h = renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />);
    expect(h).toContain(TEXTO_LEGENDA_ERROS_LOG);
    expect(h.indexOf(TEXTO_LEGENDA_ERROS_LOG)).toBeLessThan(h.indexOf('<table'));
    const zero = renderToStaticMarkup(<CorpoLogBko log={{ ...log, total_erros: 0, erros: [] }} entidade="cliente" fuso="America/Manaus" />);
    expect(zero).not.toContain(TEXTO_LEGENDA_ERROS_LOG);
  });

  it('mostra o horário do envio em Manaus (14:05 UTC = 10:05)', () => {
    expect(renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />)).toContain('10:05');
  });

  it('o CSV vai pelo proxy do shell', () => {
    expect(caminhoDoDownloadErros('cliente')).toBe('/baixar-erros-fdv?entidade=cliente');
  });

  it('estados: carregando, vazio, erro e sem permissão', () => {
    const e = (r: Parameters<typeof EstadoLog>[0]['r']) => renderToStaticMarkup(<EstadoLog r={r} entidade="cliente" fuso="America/Manaus" />);
    expect(e(null)).toContain(TEXTO_ESTADO_LOG.carregando);
    expect(e({ ok: true, log: { ...log, total_erros: 0, erros: [], envios: [] } })).toContain(TEXTO_ESTADO_LOG.vazio);
    expect(e({ ok: false, motivo: 'erro' })).toContain(TEXTO_ESTADO_LOG.erro);
    expect(e({ ok: false, motivo: 'sem_permissao' })).toContain('Seu perfil não pode ver o Log');
  });

  it('"Falhou" sai com o tom erro e "Com erros" com o tom aviso', () => {
    const l = LogCadastroFdvTenant.parse({
      ...log, erros: [], total_erros: 0,
      envios: [
        { em: '2026-11-22T14:05:00.000Z', origem: 'ciclo', situacao: 'falhou', registros: 1, com_erro: 1 },
        { em: '2026-11-22T13:05:00.000Z', origem: 'reprocessar', situacao: 'com_erros', registros: 5, com_erro: 2 },
      ],
    });
    const h = renderToStaticMarkup(<CorpoLogBko log={l} entidade="cliente" fuso="America/Manaus" />);
    const estilo = (tom: 'erro' | 'aviso', t: string) => /style="([^"]*)"/.exec(renderToStaticMarkup(<Chip tom={tom}>{t}</Chip>))![1];
    expect(estilo('erro', 'x')).not.toBe(estilo('aviso', 'x'));
    expect(h).toContain(`<span style="${estilo('erro', 'Falhou')}">Falhou</span>`);
    expect(h).toContain(`<span style="${estilo('aviso', 'Com erros')}">Com erros</span>`);
  });

  it('o resumo diz "N erros abertos" e leva o download no topo, antes da tabela', () => {
    const h = renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />);
    expect(h).toContain('3 erros abertos');
    expect(h).not.toContain('Erros abertos:');
    expect(h.indexOf(ROTULO_BAIXAR_ERROS)).toBeGreaterThan(-1);
    expect(h.indexOf(ROTULO_BAIXAR_ERROS)).toBeLessThan(h.indexOf('<table'));
    expect(textoErrosAbertos(1)).toBe('1 erro aberto');
    const zero = renderToStaticMarkup(<CorpoLogBko log={{ ...log, total_erros: 0, erros: [] }} entidade="cliente" fuso="America/Manaus" />);
    expect(zero).not.toContain(ROTULO_BAIXAR_ERROS);
    expect(zero).toContain(TEXTO_ESTADO_LOG.vazio);
    expect(zero).not.toContain('0 erros');
  });

  it('o estado de erro traz "Tentar de novo" quando há ação', () => {
    const r = { ok: false, motivo: 'erro' } as const;
    expect(renderToStaticMarkup(<EstadoLog r={r} entidade="cliente" fuso="America/Manaus" aoTentarDeNovo={() => {}} />)).toContain(`>${ROTULO_TENTAR_DE_NOVO}</button>`);
    expect(renderToStaticMarkup(<EstadoLog r={r} entidade="cliente" fuso="America/Manaus" aoTentarDeNovo={() => {}} />)).toContain(`>${TEXTO_FALHA_CARGA_LOG}<`);
    expect(renderToStaticMarkup(<EstadoLog r={r} entidade="cliente" fuso="America/Manaus" />)).not.toContain(ROTULO_TENTAR_DE_NOVO);
  });

  describe('Recebidos do FDV (T-0110)', () => {
    const rec = (o: Record<string, unknown>) => ({
      id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c', cliente_uuid: '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d', codigo_fdv: '12345',
      razao_social: 'Mercadinho Ficticio Ltda', documento_mascarado: '11.444.777/****-**', vendedor_external_id: null,
      recebido_em: '2026-11-26T10:00:00-04:00', revisao: 1, situacao: 'recebido', motivo: null, erros: [], cliente_id: null, retorno: null, ...o,
    });
    const comRecebidos = (recebidos: unknown[], total = recebidos.length) => LogCadastroFdvTenant.parse({ ...log, recebidos, total_recebidos: total });
    const html = (l: LogCadastroFdvTenant, entidade: 'cliente' | 'vendedor' = 'cliente') => renderToStaticMarkup(<CorpoLogBko log={l} entidade={entidade} fuso="America/Manaus" />);

    it('a seção só aparece para cliente, abaixo de "Envios recentes"', () => {
      const l = comRecebidos([rec({})]);
      const h = html(l);
      expect(h).toContain(`<h3>${TITULO_SECAO_RECEBIDOS_LOG}</h3>`);
      expect(h.indexOf(TITULO_SECAO_RECEBIDOS_LOG)).toBeGreaterThan(h.indexOf('Envios recentes'));
      expect(html({ ...l, entidade: 'vendedor' }, 'vendedor')).not.toContain(TITULO_SECAO_RECEBIDOS_LOG);
    });

    it('estado vazio usa o texto do módulo e não oferece CSV', () => {
      const h = html(comRecebidos([]));
      expect(h).toContain(TEXTO_VAZIO_RECEBIDOS_LOG);
      expect(h).not.toContain('Baixar recebidos');
      expect(h).toContain(`<h3>${TITULO_SECAO_RECEBIDOS_LOG}</h3>`);
    });

    it('o botão do CSV fica no cabeçalho da seção, ao lado do título e acima da tabela', () => {
      const h = html(comRecebidos([rec({})]));
      const secao = h.slice(h.indexOf('data-recebidos-fdv'));
      expect(secao).toContain(`<div class="resumo-log"><h3>${TITULO_SECAO_RECEBIDOS_LOG}</h3><a class="mx-botao-secundario" href="/baixar-recebidos-fdv">Baixar recebidos (.csv)</a></div>`);
      expect(secao.indexOf('Baixar recebidos')).toBeLessThan(secao.indexOf('<table'));
    });

    it('"Recebido em" é coluna de data, com algarismos tabulares como o "Quando" dos envios', () => {
      const h = html(comRecebidos([rec({})]));
      const estiloDe = (texto: string) => new RegExp(`<td([^>]*)>${texto}</td>`).exec(h)?.[1];
      expect(estiloDe('26/11/2026[^<]*')).toContain('font-variant-numeric:tabular-nums');
      expect(estiloDe('Mercadinho Ficticio Ltda')).not.toContain('tabular-nums');
    });

    it('avisa o fato quando há mais recebidos do que a lista traz (texto do módulo)', () => {
      expect(html(comRecebidos([rec({})], 1))).not.toContain('Mostrando os');
      const h = html(comRecebidos([rec({})], 5));
      expect(h).toContain('Mostrando os 1 mais recentes de 5.');
    });
  });

  it('no celular "Corrigir cadastro" é a 2ª coluna; no desktop continua a última', () => {
    const ths = (celular: boolean) => [...renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" celular={celular} />).matchAll(/<th [^>]*>([^<]*)</g)].map((m) => m[1]).slice(0, 6);
    expect(ths(true)[1]).toBe(ROTULO_CORRIGIR);
    expect(ths(false)[5]).toBe(ROTULO_CORRIGIR);
    expect(corrigirEmSegundo([{ id: 'a' }, { id: 'b' }, { id: 'corrigirHref' }]).map((c) => c.id)).toEqual(['a', 'corrigirHref', 'b']);
  });
});
