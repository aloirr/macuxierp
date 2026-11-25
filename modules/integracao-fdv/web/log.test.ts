import { LogCadastroFdvTenant } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarClienteIntegracaoFdv } from './cliente';
import {
  caminhoDoLogCsv, colunasDeErrosLog, errosForaDaListaLog, linhasDeEnviosLog, linhasDeErrosLog, nomeDoCsvDoLog, textoErrosForaDaLista, TEXTO_LEGENDA_ERROS_LOG, ROTULO_CORRIGIR,
} from './log';

const log = (o: Partial<LogCadastroFdvTenant> = {}): LogCadastroFdvTenant => ({
  entidade: 'cliente',
  lido_em: '2026-11-24T20:00:00.000Z',
  envios: [{ em: '2026-11-24T19:00:00.000Z', origem: 'reprocessar', situacao: 'com_erros', registros: 10, com_erro: 2 }],
  total_erros: 2,
  motivo: 'erros_por_linha',
  erros: [
    { registro_external_id: 'C-1', nome_curto: 'Mercado Sol', campo: 'vendedor_id', codigo: 'vendedor_inexistente', motivo_texto: 'Vendedor não existe no FDV.', acao_texto: 'Carregue Vendedores antes.', corrigir_href: '/cadastros/clientes?busca=C-1' },
    { registro_external_id: 'C-2', nome_curto: null, campo: null, codigo: 'x', motivo_texto: 'Motivo.', acao_texto: 'Ação.', corrigir_href: null },
  ],
  ...o,
});

describe('Log do BKO (T-0086 D-4)', () => {
  it('RF-INF-04: renderiza as colunas registro, nome, campo, motivo, ação e Corrigir, nesta ordem', () => {
    expect(colunasDeErrosLog.map((c) => c.titulo)).toEqual(['Registro', 'Nome', 'Campo', 'Motivo', 'O que fazer', 'Corrigir cadastro']);
    const [a] = linhasDeErrosLog(log());
    expect(a).toEqual({ registro: 'C-1', nome: 'Mercado Sol', campo: 'vendedor_id', motivo: 'Vendedor não existe no FDV.', acao: 'Carregue Vendedores antes.', corrigirHref: '/cadastros/clientes?busca=C-1' });
  });
  it('RF-INF-04: a legenda diz que os registros não foram enviados ao FDV e o botão é Corrigir cadastro', () => {
    expect(TEXTO_LEGENDA_ERROS_LOG).toMatch(/^Estes registros não foram enviados ao FDV\./);
    expect(ROTULO_CORRIGIR).toBe('Corrigir cadastro');
  });
  it('o link Corrigir só existe quando corrigirHref existe (nulo no Zerar, sem link)', () => {
    const l = linhasDeErrosLog(log());
    expect(l.map((x) => x.corrigirHref !== null)).toEqual([true, false]);
    expect(l[1]).toMatchObject({ nome: '', campo: '' });
  });
  it('mostra os envios recentes no horário de Manaus, com origem e situação em português', () => {
    expect(linhasDeEnviosLog(log())[0]).toEqual({ quando: expect.stringContaining('15:00'), origem: 'Reprocessar', situacao: 'Com erros', tom: 'aviso', registros: 10, comErro: 2 });
  });
  it('o Baixar erros (.csv) aponta para a rota log.csv do SDK, com a entidade', () => {
    expect(caminhoDoLogCsv('cliente')).toBe('/v1/integracao-fdv/entidades/cliente/log.csv');
    expect(nomeDoCsvDoLog('cliente')).toBe('erros-cliente.csv');
  });
  it('estado vazio: sem erro aberto mostra a frase do estado vazio; sem envio, a dos envios', () => {
    const vazio = log({ erros: [], total_erros: 0, envios: [], motivo: null });
    expect(linhasDeErrosLog(vazio)).toEqual([]);
    expect(linhasDeEnviosLog(vazio)).toEqual([]);
  });
  it('avisa quantos erros ficam fora da lista (o teto da tela) e manda baixar o arquivo', () => {
    const l = log({ total_erros: 203 });
    expect(errosForaDaListaLog(l)).toBe(201);
    expect(textoErrosForaDaLista(1)).toContain('Mais 1 erro não aparece');
    expect(textoErrosForaDaLista(5)).toContain('Mais 5 erros não aparecem');
    expect(errosForaDaListaLog(log())).toBe(0);
  });
  it('o cliente lê o Log pela rota do BKO e valida a resposta', async () => {
    const urls: string[] = [];
    const cli = criarClienteIntegracaoFdv({
      baseUrl: '',
      token: () => 't',
      fetch: async (url) => {
        urls.push(url);
        return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => log() };
      },
    });
    expect((await cli.log('cliente')).erros).toHaveLength(2);
    expect(urls).toEqual(['/v1/integracao-fdv/entidades/cliente/log']);
  });
});
