import { paraCsv } from '@macuxierp/platform-sdk/listas';
import { describe, expect, it } from 'vitest';
import { ENTIDADES_HUB_F2, MonitorResposta } from '../contracts';
import { manifest } from '../manifest';
import { criarClienteIntegracaoFdv, ErroIntegracaoFdv } from './cliente';
import { colunasDeErros, linhasDeConflitos, linhasDeErros, linhasDoMonitor, resumoDoSinal } from './monitor';
import { PAGINAS_INTEGRACAO_FDV, paginaLotes } from './paginas';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (o: Partial<MonitorResposta> = {}): MonitorResposta => ({
  credencial: { id: U(1), conector_id: 'erp-1', ambiente: 'producao', chave_prefixo: 'abcd1234', criada_em: '2026-11-22T14:00:00.000Z', ultimo_uso_em: null },
  configuracao: { entidades_habilitadas: ['produto', 'cliente'], limite_registros_lote: 500 },
  sinal: { ultimo_envio_em: '2026-11-22T14:05:00.000Z', ultimo_aceito_em: '2026-11-22T14:05:00.000Z', ultimo_http: 200, parado_por_versao: false, ultimo_codigo: null, politica_versao: { minima: '1.4.0' } },
  entidades: ENTIDADES_HUB_F2.map((entidade) => ({
    entidade, ultimo_envio_em: null, ultimo_sucesso_em: null, pendentes: 0, situacao: 'ok' as const, pausada_motivo: null, pausada_mensagem: null, habilitada: entidade === 'produto' || entidade === 'cliente', proxima_tentativa_em: null, erros_abertos: 0,
  })),
  erros: [],
  conflitos: [],
  ...o,
});
const pausado = base({
  entidades: base().entidades.map((e) =>
    e.entidade === 'produto'
      ? { ...e, situacao: 'pausada' as const, pausada_motivo: 'credencial' as const, pausada_mensagem: 'Credencial recusada pelo FDV.', pendentes: 1200, erros_abertos: 2, ultimo_envio_em: '2026-11-22T14:00:00.000Z', ultimo_sucesso_em: '2026-11-22T13:00:00.000Z' }
      : e,
  ),
});

describe('páginas do BKO do Integração FDV (RF-INF-04)', () => {
  it('toda página está no menu do manifesto e tem rota própria; o monitor é o item do menu e os lotes abrem a partir dele', () => {
    const menus = new Set<string>(manifest.web?.menus);
    for (const p of PAGINAS_INTEGRACAO_FDV) expect(menus.has(p.menu), p.id).toBe(true);
    expect(new Set(PAGINAS_INTEGRACAO_FDV.map((p) => p.rota)).size).toBe(PAGINAS_INTEGRACAO_FDV.length);
    expect(PAGINAS_INTEGRACAO_FDV.find((p) => p.id === 'monitor')).toMatchObject({ rota: '/integracao-fdv/integracao-fdv', ver: 'integracao-fdv.ver' });
    expect(PAGINAS_INTEGRACAO_FDV.find((p) => p.id === 'lotes')?.ocultaNoMenu).toBe(true);
  });
  it('a lista de lotes usa o descritor do SDK: filtros na URL, paginação, CSV e API do módulo', () => {
    expect(paginaLotes.api).toBe('/v1/integracao-fdv/lotes');
    expect(paginaLotes.chaves).toEqual(['cursor', 'entidade', 'estado', 'limite']);
    expect(paginaLotes.csv).toEqual({ arquivo: 'lotes-integracao-fdv.csv' });
    expect(paginaLotes.consulta.safeParse({ estado: 'inventado' }).success).toBe(false);
  });
});

describe('monitor por entidade', () => {
  it('RF-INF-04: mostra as 10 entidades com nome em português, horário de Manaus e situação por cadastro', () => {
    const l = linhasDoMonitor(pausado, 'America/Manaus');
    expect(l).toHaveLength(10);
    const p = l.find((x) => x.entidade === 'produto')!;
    expect(p).toMatchObject({ rotulo: 'Produtos', situacao: 'Pausada', tom: 'aviso', pendentes: '1.200', erros: 2, motivoPausa: 'Credencial recusada pelo FDV.' });
    expect(p.ultimoEnvio).toBe('22/11/2026 10:00');
    expect(p.ultimoSucesso).toBe('22/11/2026 09:00');
    const c = l.find((x) => x.entidade === 'cliente')!;
    expect(c).toMatchObject({ situacao: 'Funcionando', tom: 'ok', ultimoEnvio: 'Ainda não enviou' });
    expect(l.find((x) => x.entidade === 'filial')).toMatchObject({ situacao: 'Desligada', tom: 'neutro' });
  });
});

describe('sinal, erros e conflitos', () => {
  it('RF-INF-04, RD-1070, RD-1074: o sinal mostra o último aceito em Manaus e só a frase de versão não aceita; parado por versão vira aviso', () => {
    expect(resumoDoSinal(base(), 'America/Manaus')).toMatchObject({ texto: 'Última resposta do FDV em 22/11/2026 10:05', tom: 'ok', politica: null });
    expect(resumoDoSinal(base({ sinal: null }), 'America/Manaus')).toMatchObject({ texto: 'Ainda não falou com o FDV', tom: 'neutro' });
    const parado = base({ sinal: { ...base().sinal!, parado_por_versao: true } });
    expect(resumoDoSinal(parado, 'America/Manaus')).toMatchObject({ tom: 'aviso', politica: 'Versão do FDV não aceita. Atualize o Macuxi FDV.' });
    // RD-1070: sem ultimo_aceito_em e parado por versão, a mesma frase
    const paradoSemAceite = base({ sinal: { ...base().sinal!, ultimo_aceito_em: null, parado_por_versao: true } });
    expect(resumoDoSinal(paradoSemAceite, 'America/Manaus')).toMatchObject({ tom: 'aviso', politica: 'Versão do FDV não aceita. Atualize o Macuxi FDV.' });
  });
  it('RN-INF-04: o erro por linha mostra código do cadastro, campo e a mensagem do catálogo, com CSV', () => {
    const m = base({ erros: [{ id: U(5), lote_envio_id: U(6), indice: 3, origem: 'hub', entidade: 'produto', registro_external_id: 'P1', codigo: 'campo_obrigatorio', campo: 'nome', reprocessavel: false, resolvido_em: null, mensagem: 'Campo obrigatório vazio no cadastro.' }] });
    const l = linhasDeErros(m);
    expect(l).toEqual([{ cadastro: 'Produtos', registro: 'P1', campo: 'nome', codigo: 'campo_obrigatorio', mensagem: 'Campo obrigatório vazio no cadastro.' }]);
    const csv = paraCsv(colunasDeErros, l);
    expect(csv.split('\r\n')[0]).toContain('Mensagem');
    expect(csv).toContain('Campo obrigatório vazio no cadastro.');
  });
  it('ADR 0010: o conflito de chave aberto aparece com o texto do catálogo e o horário de Manaus', () => {
    const m = base({ conflitos: [{ id: U(7), entidade: 'produto', erp_id: U(8), chave: 'P9', codigo: 'chave_duplicada', mensagem: 'Outro cadastro já usa este código.', detectado_em: '2026-11-22T14:00:00.000Z' }] });
    expect(linhasDeConflitos(m, 'America/Manaus')).toEqual([{ cadastro: 'Produtos', chave: 'P9', mensagem: 'Outro cadastro já usa este código.', detectadoEm: '22/11/2026 10:00' }]);
  });
});

describe('cliente da API (só leitura)', () => {
  const resposta = (status: number, corpo: unknown, tipo = 'application/json') => ({ status, ok: status < 400, headers: { get: () => tipo }, json: async () => corpo });
  it('chama /v1/integracao-fdv com o token, valida a resposta e não expõe método de escrita', async () => {
    const chamadas: { url: string; method: string; auth: string }[] = [];
    const cli = criarClienteIntegracaoFdv({
      baseUrl: 'https://erp.exemplo', token: () => 't0k',
      fetch: async (url, init) => {
        chamadas.push({ url, method: init.method, auth: init.headers.Authorization! });
        return resposta(200, base());
      },
    });
    expect((await cli.monitor()).entidades).toHaveLength(10);
    expect(chamadas.map((c) => `${c.method} ${c.url.replace('https://erp.exemplo', '')}`)).toEqual(['GET /v1/integracao-fdv/monitor']);
    expect(chamadas.every((c) => c.auth === 'Bearer t0k')).toBe(true);
    expect(cli.caminhoDoCsv({ entidade: 'produto' })).toBe('/v1/integracao-fdv/lotes/exportar?entidade=produto');
  });
  it('erro da API vira ErroIntegracaoFdv com a mensagem da API', async () => {
    const cli = criarClienteIntegracaoFdv({ baseUrl: '', token: () => 't', fetch: async () => resposta(400, { codigo: 'VALIDACAO', mensagem: 'Dados inválidos' }) });
    const e = await cli.monitor().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroIntegracaoFdv);
    expect(e).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
    const html = criarClienteIntegracaoFdv({ baseUrl: '', token: () => 't', fetch: async () => resposta(502, '<html>', 'text/html') });
    expect(await html.monitor().catch((x: unknown) => x)).toMatchObject({ status: 502, codigo: 'ERRO' });
  });
});
