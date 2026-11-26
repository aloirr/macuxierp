import { ClienteRecebidoFdv, LogCadastroFdvTenant } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarClienteIntegracaoFdv } from './cliente';
import {
  NOME_CSV_RECEBIDOS_LOG, TEXTO_VAZIO_RECEBIDOS_LOG, TITULO_SECAO_RECEBIDOS_LOG, colunasDeRecebidosLog, csvDeRecebidosLog, linhasDeRecebidosLog, motivoDoRecebidoLog,
  caminhoDoLogCsv, colunasDeErrosLog, errosForaDaListaLog, linhasDeEnviosLog, linhasDeErrosLog, nomeDoCsvDoLog, textoErrosForaDaLista, TEXTO_LEGENDA_ERROS_LOG
} from './log';

const log = (o: Partial<LogCadastroFdvTenant> = {}): LogCadastroFdvTenant => ({
  entidade: 'cliente',
  lido_em: '2026-11-24T20:00:00.000Z',
  envios: [{ em: '2026-11-24T19:00:00.000Z', origem: 'reprocessar', situacao: 'com_erros', registros: 10, com_erro: 2 }],
  total_erros: 2,
  recebidos: [],
  total_recebidos: 0,
  motivo: 'erros_por_linha',
  erros: [
    { registro_external_id: 'C-1', nome_curto: 'Mercado Sol', campo: 'vendedor_id', codigo: 'vendedor_inexistente', motivo_texto: 'Vendedor não existe no FDV.', acao_texto: 'Carregue Vendedores antes.', corrigir_href: '/cadastros/clientes?busca=C-1' },
    { registro_external_id: 'C-2', nome_curto: null, campo: null, codigo: 'x', motivo_texto: 'Motivo.', acao_texto: 'Ação.', corrigir_href: null },
  ],
  ...o,
});

describe('Log do BKO (T-0086 D-4)', () => {
  it('RF-INF-04: renderiza as colunas registro, nome, campo, motivo, ação e Corrigir cadastro, nesta ordem', () => {
    expect(colunasDeErrosLog.map((c) => c.titulo)).toEqual(['Registro', 'Nome', 'Campo', 'Motivo', 'O que fazer', 'Corrigir cadastro']);
    const [a] = linhasDeErrosLog(log());
    expect(a).toEqual({ registro: 'C-1', nome: 'Mercado Sol', campo: 'vendedor_id', motivo: 'Vendedor não existe no FDV.', acao: 'Carregue Vendedores antes.', corrigirHref: '/cadastros/clientes?busca=C-1' });
  });
  it('RF-INF-04: a legenda diz que os registros não foram enviados ao Macuxi FDV', () => {
    expect(TEXTO_LEGENDA_ERROS_LOG).toBe('Estes registros não foram enviados ao Macuxi FDV.');
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

describe('Recebidos do FDV no Log (RN-INF-09; T-0110)', () => {
  const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const rec = (o: Partial<ClienteRecebidoFdv> = {}): ClienteRecebidoFdv => ({
    id: U(1), cliente_uuid: U(2), codigo_fdv: null, razao_social: 'Mercado Sol', documento_mascarado: '11.222.333/****-**', vendedor_external_id: 'V-1',
    recebido_em: '2026-11-26T12:30:00.000Z', revisao: 1, situacao: 'aceito', motivo: null, erros: [], cliente_id: U(3), retorno: 'enviado', ...o,
  });
  const recusado = rec({ situacao: 'recusado', cliente_id: null, motivo: 'recusado', retorno: 'pendente', vendedor_external_id: null, erros: [{ campo: 'vendedor_external_id', codigo: 'vendedor_fdv_inativo', mensagem: 'x' }] });

  it('RN-INF-09: as colunas, na ordem da tela', () => {
    expect(colunasDeRecebidosLog.map((c) => c.titulo)).toEqual(['Situação', 'Cliente', 'Documento', 'Vendedor', 'Recebido em', 'Revisão', 'Motivo', 'Retorno']);
    expect(TITULO_SECAO_RECEBIDOS_LOG).toBe('Recebidos do FDV');
    expect(TEXTO_VAZIO_RECEBIDOS_LOG).toMatch(/Nenhum/);
  });
  it('RN-INF-09: a data sai no fuso do tenant, o vendedor ausente vira traço e o documento é o mascarado', () => {
    const [a, b] = linhasDeRecebidosLog([rec(), recusado], 'America/Manaus');
    expect(a).toMatchObject({ situacao: 'Aceito', documento: '11.222.333/****-**', vendedor: 'V-1', motivo: '', retorno: 'Voltou ao FDV' });
    expect(a!.recebidoEm).toBe(linhasDeEnviosLog(log({ envios: [{ em: '2026-11-26T12:30:00.000Z', origem: 'ciclo', situacao: 'concluido', registros: 1, com_erro: 0 }] }), 'America/Manaus')[0]!.quando);
    expect(b).toMatchObject({ situacao: 'Recusado', vendedor: '—', retorno: 'Na fila para voltar ao FDV' });
  });
  it('RN-INF-09: o motivo é vazio fora de recusado, genérico sem erro e sem texto repetido', () => {
    expect(motivoDoRecebidoLog(rec())).toBe('');
    expect(motivoDoRecebidoLog(rec({ ...recusado, erros: [] }))).toMatch(/suporte/);
    expect(motivoDoRecebidoLog(rec({ ...recusado, erros: [recusado.erros[0]!, recusado.erros[0]!] }))).toBe(motivoDoRecebidoLog(recusado));
  });
  it('RN-INF-09 e LGPD: o CSV traz o cabeçalho e as linhas, só com o documento mascarado', () => {
    const linhas = csvDeRecebidosLog([rec(), recusado], 'America/Manaus').trim().split('\r\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toBe('Situação;Cliente;Documento;Vendedor;Recebido em;Revisão;Motivo;Retorno');
    expect(linhas[2]).toContain('Vendedor inativo');
    expect(NOME_CSV_RECEBIDOS_LOG).toBe('recebidos-fdv.csv');
    expect(linhas.join('\n')).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{14}/);
  });
});
