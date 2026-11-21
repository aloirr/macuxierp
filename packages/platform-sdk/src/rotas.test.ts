import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { erros, ErroApi, PADRAO_RN } from './erros';
import { defineModule } from './modulo';
import { ArquivoRecebido, cabecalhosDaRota, definirPlugin, definirRota, PluginInvalido, TAMANHO_MAXIMO_ARQUIVO } from './rotas';

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
    expect(() => definirPlugin(manifesto, [rota({ multipart: { arquivos: [{ campo: 'arquivo', tamanhoMaximo: TAMANHO_MAXIMO_ARQUIVO + 1 }] } })])).toThrow(PluginInvalido);
  });
});
