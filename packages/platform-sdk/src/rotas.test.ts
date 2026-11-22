import { inspect } from 'node:util';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { erros, ErroApi, PADRAO_RN } from './erros';
import { defineModule } from './modulo';
import {
  ArquivoRecebido,
  cabecalhosDaRota,
  definirPlugin,
  definirRota,
  type ContextoRota,
  FUSO_PADRAO,
  fusoDaRota,
  PluginInvalido,
  QUANTIDADE_MAXIMA_ARQUIVOS,
  TAMANHO_MAXIMO_MULTIPART,
  tamanhoMaximoTotal,
  TEMPO_MAXIMO_ROTA_MS,
} from './rotas';

const manifesto = defineModule({ id: 'core', versao: '0.1.0', descricao: 'teste', depende: [], perfis: ['administrador'], publica: [], consome: [] });
const rota = (extra: object) => definirRota({ metodo: 'POST', caminho: '/certificados', acao: 'core.certificado.gerir', executar: async () => ({}), ...extra });

describe('erros comuns (RD-0001)', () => {
  it('naoEncontrado, indisponivel (503) e arquivoGrande (413)', () => {
    expect(erros.naoEncontrado('Cliente')).toMatchObject({ status: 404, codigo: 'NAO_ENCONTRADO', message: 'Cliente não encontrado' });
    expect(erros.indisponivel('SEFAZ')).toMatchObject({ status: 503, codigo: 'INDISPONIVEL' });
    expect(erros.arquivoGrande('arquivo', 50 * 1024)).toMatchObject({ status: 413, codigo: 'ARQUIVO_GRANDE', campos: { arquivo: 'até 50 KB' } });
    expect(new ErroApi(503, 'X', 'y').status).toBe(503);
  });

  it('PADRAO_RN reconhece o código da regra', () => {
    expect(PADRAO_RN.test('RN-CORE-06')).toBe(true);
    expect(PADRAO_RN.test('RN-CORE-6')).toBe(false);
  });
});

describe('cabeçalhos da rota', () => {
  it('minúsculas, lista unida e sem credencial', () => {
    expect(cabecalhosDaRota({ 'If-Match': 'abc', Authorization: 'Bearer x', cookie: 'c', 'x-lista': ['a', 'b'], vazio: undefined })).toEqual({ 'if-match': 'abc', 'x-lista': 'a, b' });
  });
});

describe('definirRota', () => {
  it('quem chama pode omitir cabeçalhos e arquivos: a rota recebe os dois vazios', async () => {
    const r = definirRota({ metodo: 'GET', caminho: '/eco', acao: 'core.empresa.ver', executar: async (_c, e) => ({ corpo: { cabecalhos: e.cabecalhos, arquivos: e.arquivos } }) });
    expect(await r.executar({} as never, { corpo: undefined, consulta: undefined, params: {} })).toEqual({ corpo: { cabecalhos: {}, arquivos: {} } });
    expect(await r.executar({} as never, { corpo: undefined, consulta: undefined, params: {}, cabecalhos: { 'if-match': 'v' } })).toMatchObject({ corpo: { cabecalhos: { 'if-match': 'v' } } });
  });
});

describe('multipart (upload do A1)', () => {
  it('o conteúdo do arquivo nunca aparece em JSON nem no inspect', () => {
    const a = new ArquivoRecebido('arquivo', 'certificado-de-fulano.pfx', 'application/x-pkcs12', Buffer.from('SEGREDO-DO-PFX'));
    expect(a.conteudo().toString()).toBe('SEGREDO-DO-PFX');
    const textos = [JSON.stringify({ a }), inspect(a), inspect({ a }, { depth: 5 })];
    for (const t of textos) {
      expect(t).not.toContain('SEGREDO');
      expect(t).not.toContain('U0VHUkVETy'); // base64
      expect(t).not.toContain('fulano');
    }
    expect(a.toJSON()).toEqual({ campo: 'arquivo', tipo: 'application/x-pkcs12', tamanho: 14 });
  });

  it('o plugin recusa multipart em GET, sem arquivo, com campo repetido ou limite fora da faixa', () => {
    const arq = { campo: 'arquivo', tamanhoMaximo: 50 * 1024 };
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [arq] } })])).not.toThrow();
    expect(() => definirPlugin(manifesto, [rota({ metodo: 'GET', multipart: { arquivos: [arq] } })])).toThrow(PluginInvalido);
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [] } })])).toThrow(PluginInvalido);
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [arq, arq] } })])).toThrow(PluginInvalido);
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [{ campo: 'arquivo', tamanhoMaximo: TAMANHO_MAXIMO_MULTIPART + 1 }] } })])).toThrow(PluginInvalido);
  });
});

describe('multipart com vários arquivos, limite total, Idempotency-Key e tempo por rota (T-0026)', () => {
  const carga = { campo: 'arquivos', tamanhoMaximo: TAMANHO_MAXIMO_MULTIPART, quantidadeMaxima: 16 };

  it('aceita até 10 MB por arquivo e no total, e até 32 arquivos por campo', () => {
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [carga], tamanhoMaximoTotal: TAMANHO_MAXIMO_MULTIPART } })])).not.toThrow();
    for (const errado of [{ ...carga, quantidadeMaxima: 0 }, { ...carga, quantidadeMaxima: QUANTIDADE_MAXIMA_ARQUIVOS + 1 }, { ...carga, quantidadeMaxima: 1.5 }]) {
      expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [errado] } })])).toThrow(PluginInvalido);
    }
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [carga], tamanhoMaximoTotal: TAMANHO_MAXIMO_MULTIPART + 1 } })])).toThrow(PluginInvalido);
  });

  it('total padrão = soma dos limites dos campos, até o teto', () => {
    expect(tamanhoMaximoTotal({ arquivos: [{ campo: 'a', tamanhoMaximo: 100 }, { campo: 'b', tamanhoMaximo: 50, quantidadeMaxima: 3 }] })).toBe(250);
    expect(tamanhoMaximoTotal({ arquivos: [carga] })).toBe(TAMANHO_MAXIMO_MULTIPART);
    expect(tamanhoMaximoTotal({ arquivos: [carga], tamanhoMaximoTotal: 1000 })).toBe(1000);
  });

  it('Idempotency-Key só em POST, PUT ou PATCH; tempoMaximoMs de 1 s a 120 s', () => {
    expect(() => definirPlugin(manifesto, [rota({ idempotencia: 'obrigatoria', tempoMaximoMs: TEMPO_MAXIMO_ROTA_MS })])).not.toThrow();
    expect(() => definirPlugin(manifesto, [rota({ metodo: 'GET', idempotencia: 'opcional' })])).toThrow(PluginInvalido);
    expect(() => definirPlugin(manifesto, [rota({ metodo: 'DELETE', idempotencia: 'opcional' })])).toThrow(PluginInvalido);
    for (const t of [999, TEMPO_MAXIMO_ROTA_MS + 1, 1500.5]) expect(() => definirPlugin(manifesto, [rota({ tempoMaximoMs: t })])).toThrow(PluginInvalido);
  });

  it('definirRota: sem todosArquivos, a rota recebe cada arquivo numa lista', async () => {
    const a = new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from('a'));
    const r = definirRota({ metodo: 'POST', caminho: '/x', acao: 'core.empresa.editar', executar: async (_c, e) => ({ corpo: e.todosArquivos }) });
    expect((await r.executar({} as never, { corpo: undefined, consulta: undefined, params: {}, arquivos: { arquivo: a } })).corpo).toEqual({ arquivo: [a] });
  });
});

describe('ContextoRota.publicar (T-0042)', () => {
  it('versao é opcional no tipo', () => {
    type Evento = Parameters<ContextoRota['publicar']>[0];
    expectTypeOf<{ nome: string; agregado_id: string; payload: Record<string, unknown> }>().toMatchTypeOf<Evento>();
    expectTypeOf<Evento['versao']>().toEqualTypeOf<number | undefined>();
  });
});

describe('ContextoRota.fuso (T-0042, regra 4)', () => {
  it('fuso IANA do tenant, opcional no tipo para os dublês dos módulos', () => {
    expectTypeOf<ContextoRota['fuso']>().toEqualTypeOf<string | undefined>();
  });

  it('fusoDaRota: o fuso do tenant; sem ele (dublê de teste), o padrão America/Manaus', () => {
    expect(FUSO_PADRAO).toBe('America/Manaus');
    expect(fusoDaRota({ fuso: 'America/Sao_Paulo' })).toBe('America/Sao_Paulo');
    expect(fusoDaRota({})).toBe('America/Manaus');
  });
});
