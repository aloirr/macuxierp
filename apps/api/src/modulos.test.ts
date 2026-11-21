/**
 * Registro dos módulos (T-0029) com um módulo dublê no lugar do core: licença e perfil checados (RN-CORE-02), rota
 * multipart do A1 com limite de 50 KB (RF-CORE-04) e cabeçalhos na rota. O conteúdo do `.pfx` nunca vai para o log.
 */
import { Writable } from 'node:stream';
import { defineModule, definirPlugin, definirRota, type Licenca, type Perfil } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarApp } from './app';
import { emitirTokenAcesso } from './auth/jwt';
import { RepositorioAuthMemoria } from './auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { MODULOS_MONTADOS, RegistroModulosInvalido, registrarModulos } from './modulos';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const USUARIO = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const FILIAL = '3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e';
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const AGORA = new Date('2026-11-21T15:00:00Z');
const LIMITE_PFX = 50 * 1024;

const manifesto = (id: 'core' | 'cadastros' | 'pedido', depende: ('core' | 'cadastros')[] = id === 'core' ? [] : ['core']) =>
  defineModule({ id, versao: '0.1.0', descricao: 'dublê', depende, perfis: ['administrador'], publica: [], consome: [] });

/** Dublê do core: o upload do A1 (multipart) e uma leitura que devolve o `If-Match` recebido. */
const vistos: { tamanho: number; senha: string; cabecalhos: Record<string, string> }[] = [];
const coreDuble = definirPlugin(manifesto('core'), [
  definirRota({
    metodo: 'POST',
    caminho: '/certificados',
    acao: 'core.certificado.gerir',
    corpo: z.object({ filial_id: z.string().uuid(), senha: z.string().min(1) }),
    multipart: { arquivos: [{ campo: 'arquivo', tamanhoMaximo: LIMITE_PFX }] },
    executar: async (_c, e) => {
      vistos.push({ tamanho: e.arquivos.arquivo!.tamanho, senha: e.corpo.senha, cabecalhos: e.cabecalhos });
      return { status: 201, corpo: { tamanho: e.arquivos.arquivo!.tamanho } };
    },
  }),
  definirRota({ metodo: 'GET', caminho: '/eco', acao: 'core.empresa.ver', executar: async (_c, e) => ({ corpo: e.cabecalhos }) }),
]);
const cadastrosDuble = definirPlugin(manifesto('cadastros'), [
  definirRota({ metodo: 'GET', caminho: '/clientes', acao: 'cadastros.ver', executar: async () => ({ corpo: { itens: [], proximo_cursor: null } }) }),
]);

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  vistos.length = 0;
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function montar(licencas: Licenca[] = [], logs?: string[]) {
  const app = await criarApp({
    versao: '0.1.0',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: SEGREDO },
    cookieSeguro: true,
    banco: new BancoMemoria(),
    repoAuth: new RepositorioAuthMemoria(),
    licencas: { ler: async () => licencas },
    outbox: new OutboxMemoria(),
    auditoria: new AuditoriaMemoria(),
    trabalhos: new FilaDeTrabalhosMemoria(),
    relogio: new RelogioFixo(AGORA),
    modulos: registrarModulos([coreDuble, cadastrosDuble]),
    logger: logs ? { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) } : false,
  });
  apps.push(app);
  return app;
}

const token = (perfil: Perfil) => `Bearer ${emitirTokenAcesso({ usuario_id: USUARIO, tenant_id: TENANT, perfil, filial_ids: [FILIAL] }, SEGREDO, AGORA, 900).token}`;

function formulario(campos: Record<string, string>, arquivos: Record<string, Buffer>) {
  const limite = 'limite-de-teste-0029';
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const [k, v] of Object.entries(arquivos)) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"; filename="certificado-fulano.pfx"\r\nContent-Type: application/x-pkcs12\r\n\r\n`), v, Buffer.from('\r\n'));
  }
  partes.push(Buffer.from(`--${limite}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${limite}` } };
}

const pfx = (n: number) => Buffer.alloc(n, 'P');

describe('registrarModulos', () => {
  it('ordem de MODULOS, manifesto vira plugin sem rotas, repetido ou sem dependência é recusado', () => {
    const r = registrarModulos([manifesto('pedido'), cadastrosDuble, coreDuble]);
    expect(r.map((p) => p.manifesto.id)).toEqual(['core', 'cadastros', 'pedido']);
    expect(r[2]!.rotas).toEqual([]);
    expect(() => registrarModulos([coreDuble, coreDuble])).toThrow(RegistroModulosInvalido);
    expect(() => registrarModulos([cadastrosDuble])).toThrow(/depende de core/);
    expect(() => registrarModulos([coreDuble, manifesto('pedido', ['core', 'cadastros'])])).toThrow(/depende de cadastros/);
  });

  it('os módulos da v1 estão todos montados', () => {
    expect(MODULOS_MONTADOS.map((m) => m.manifesto.id)).toEqual(['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv']);
  });
});

describe('rotas dos módulos registrados (RN-CORE-02)', () => {
  it('licença: cadastros sem licença é 403 MODULO_INATIVO; o core é sempre licenciado', async () => {
    const app = await montar();
    const sem = await app.inject({ url: '/v1/cadastros/clientes', headers: { authorization: token('administrador') } });
    expect(sem.statusCode).toBe(403);
    expect(sem.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    const app2 = await montar([{ modulo: 'cadastros', ativo: true, valido_ate: null }]);
    expect((await app2.inject({ url: '/v1/cadastros/clientes', headers: { authorization: token('vendedor') } })).statusCode).toBe(200);
  });

  it('perfil: vendedor não envia certificado (403 antes de ler o arquivo); sem sessão é 401', async () => {
    const app = await montar();
    const f = formulario({ filial_id: FILIAL, senha: 'x' }, { arquivo: pfx(10) });
    const r = await app.inject({ method: 'POST', url: '/v1/core/certificados', ...f, headers: { ...f.headers, authorization: token('vendedor') } });
    expect(r.json()).toMatchObject({ codigo: 'PERFIL_SEM_PERMISSAO' });
    expect((await app.inject({ method: 'POST', url: '/v1/core/certificados', ...f })).statusCode).toBe(401);
    expect(vistos).toEqual([]);
  });

  it('cabeçalhos chegam à rota sem authorization nem cookie', async () => {
    const app = await montar();
    const r = await app.inject({ url: '/v1/core/eco', headers: { authorization: token('leitura'), 'if-match': '"v1"', cookie: 'a=b' } });
    expect(r.json()).toMatchObject({ 'if-match': '"v1"' });
    expect(r.json()).not.toHaveProperty('authorization');
    expect(r.json()).not.toHaveProperty('cookie');
  });
});

describe('multipart do A1 (até 50 KB)', () => {
  const enviar = async (app: Awaited<ReturnType<typeof montar>>, campos: Record<string, string>, arquivos: Record<string, Buffer>) => {
    const f = formulario(campos, arquivos);
    return app.inject({ method: 'POST', url: '/v1/core/certificados', payload: f.payload, headers: { ...f.headers, authorization: token('administrador') } });
  };

  it('aceita exatamente 50 KB, valida os campos de texto pelo corpo e nada do arquivo nem da senha vai ao log', async () => {
    const logs: string[] = [];
    const app = await montar([], logs);
    const r = await enviar(app, { filial_id: FILIAL, senha: 'SENHA-DO-A1' }, { arquivo: pfx(LIMITE_PFX) });
    expect(r.statusCode).toBe(201);
    expect(vistos[0]).toMatchObject({ tamanho: LIMITE_PFX, senha: 'SENHA-DO-A1' });
    const log = logs.join('');
    expect(log).toContain('request completed');
    for (const proibido of ['SENHA-DO-A1', 'PPPPPPPP', 'fulano', 'Bearer']) expect(log).not.toContain(proibido);
  });

  it('acima de 50 KB é 413 ARQUIVO_GRANDE', async () => {
    const r = await enviar(await montar(), { filial_id: FILIAL, senha: 's' }, { arquivo: pfx(LIMITE_PFX + 1) });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_GRANDE', campos: { arquivo: 'até 50 KB' } });
  });

  it('sem arquivo, arquivo vazio, arquivo não declarado, campo inválido ou JSON no lugar do multipart é 400', async () => {
    const app = await montar();
    const casos = [
      await enviar(app, { filial_id: FILIAL, senha: 's' }, {}),
      await enviar(app, { filial_id: FILIAL, senha: 's' }, { arquivo: Buffer.alloc(0) }),
      await enviar(app, { filial_id: FILIAL, senha: 's' }, { outro: pfx(5) }),
      await enviar(app, { filial_id: 'x', senha: 's' }, { arquivo: pfx(5) }),
      await app.inject({ method: 'POST', url: '/v1/core/certificados', payload: { filial_id: FILIAL }, headers: { authorization: token('administrador') } }),
    ];
    expect(casos.map((r) => [r.statusCode, r.json().codigo])).toEqual(Array(5).fill([400, 'VALIDACAO']));
    expect(vistos).toEqual([]);
  });
});
