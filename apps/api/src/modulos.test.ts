/**
 * Registro dos módulos (T-0029): core e cadastros montados de verdade (`montarModulos`, repositórios dublês) com
 * licença e perfil checados (RN-CORE-02) e o A1 do cadastros pela porta do core; e um módulo dublê no lugar do core
 * para a rota multipart do A1 com limite de 50 KB (RF-CORE-04) e cabeçalhos na rota. O `.pfx` nunca vai para o log.
 */
import { Writable } from 'node:stream';
import {
  CAMINHOS_CARGAS_PLATAFORMA,
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA,
  CAMPO_ARQUIVO_CARGA_PORTAL,
  defineModule,
  definirPlugin,
  definirRota,
  MAX_BYTES_ARQUIVO_CARGA_PORTAL,
  PREFIXO_PLATAFORMA,
  TAMANHO_MAXIMO_MULTIPART,
  type Licenca,
  type Perfil,
  type PluginModulo,
} from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, IdempotenciaMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { afterEach, describe, expect, it } from 'vitest';
import { CAMINHOS_ZERAR_PEDIDOS } from '@macuxierp/pedido/contracts';
import { z } from 'zod';
import { criarApp, type DependenciasApp } from './app';
import { emitirTokenAcesso } from './auth/jwt';
import { RepositorioAuthMemoria } from './auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { formulario, NOME_ARQUIVO_PADRAO } from './apoio-multipart';
import { dependenciasCoreDeTeste, modulosDeTeste, repoCoreDuble } from './apoio-teste';
import {
  a1AtivoDoCore,
  certificadosDoCore,
  EMISSAO_PRODUCAO_HABILITADA,
  montarDependenciasProducao,
  montarModulos,
  pluginsPlataforma,
  RegistroModulosInvalido,
  registrarModulos,
} from './modulos';

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
  definirRota({
    metodo: 'POST',
    caminho: '/anexos',
    acao: 'core.certificado.gerir',
    multipart: { arquivos: [{ campo: 'anexo', tamanhoMaximo: TAMANHO_MAXIMO_MULTIPART }] },
    executar: async (_c, e) => ({ status: 201, corpo: { tamanho: e.arquivos.anexo!.tamanho } }),
  }),
  definirRota({ metodo: 'GET', caminho: '/eco', acao: 'core.empresa.ver', executar: async (_c, e) => ({ corpo: e.cabecalhos }) }),
]);
const cadastrosDuble = definirPlugin(manifesto('cadastros'), []);

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  vistos.length = 0;
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function montar(licencas: Licenca[] = [], logs?: string[], modulos: readonly PluginModulo[] = registrarModulos([coreDuble, cadastrosDuble]), extra: Partial<DependenciasApp> = {}) {
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
    avisosA1: async () => [],
    modulos,
    logger: logs ? { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) } : false,
    ...extra,
  });
  apps.push(app);
  return app;
}

const token = (perfil: Perfil) => `Bearer ${emitirTokenAcesso({ usuario_id: USUARIO, tenant_id: TENANT, perfil, filial_ids: [FILIAL] }, SEGREDO, AGORA, 900).token}`;

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

  it('montarModulos: os seis da v1; core, cadastros, pedido (T-0016), faturamento (T-0045 lote A) e integração FDV (T-0011) com rotas, o fiscal só com o manifesto', () => {
    const m = modulosDeTeste();
    expect(m.map((p) => p.manifesto.id)).toEqual(['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv']);
    expect(m.map((p) => p.rotas.length > 0)).toEqual([true, true, true, true, false, true]);
    const integracao = m.find((p) => p.manifesto.id === 'integracao-fdv')!;
    // BKO do tenant só de leitura (ADR 0013 §6, T-0056): a credencial, a configuração e a operação são do portal `/config`.
    // T-0086 §4: o Log por cadastro e o "Baixar erros (.csv)" do BKO, também só de leitura.
    expect(integracao.rotas.map((r) => `${r.metodo} ${r.caminho}`)).toEqual([
      'GET /monitor', 'GET /status', 'GET /entidades/:entidade/log', 'GET /entidades/:entidade/log.csv', 'GET /lotes', 'GET /lotes/exportar',
      'GET /clientes-recebidos', 'GET /clientes-recebidos/exportar', 'GET /lotes/:id/erros',
    ]);
    expect(integracao.rotas.every((r) => r.acao === 'integracao-fdv.ver')).toBe(true);
    const pedido = m.find((p) => p.manifesto.id === 'pedido')!;
    expect(pedido.rotas.map((r) => `${r.metodo} ${r.caminho}`)).toContain('POST /pedidos');
    const faturamento = m.find((p) => p.manifesto.id === 'faturamento')!;
    expect(faturamento.rotas.map((r) => `${r.metodo} ${r.caminho}`)).toEqual(
      expect.arrayContaining(['POST /notas', 'GET /notas', 'POST /notas/:id/cancelar', 'POST /notas/:id/carta-correcao', 'POST /inutilizacoes', 'POST /notas/:id/consultar']),
    );
    // RN-CORE-02: toda rota do faturamento declara a ação (perfil); tenant e licença ficam no `executarAutorizado` da plataforma.
    expect(faturamento.rotas.every((r) => r.acao.startsWith('faturamento.'))).toBe(true);
  });

  it('faturamento na API: o veredito do A1 vem da porta do core na transação da rota (sem decifrar)', async () => {
    const tx = { marca: 'tx-da-rota' } as never;
    const vistas: unknown[] = [];
    const repo = repoCoreDuble({
      empresa: async (t) => (vistas.push(t), null),
      certificados: async (t) => (vistas.push(t), [{ ativo: true, valido_de: new Date('2026-01-01T00:00:00Z'), valido_ate: new Date('2027-01-01T00:00:00Z') }] as never),
    });
    expect(await a1AtivoDoCore(repo, () => AGORA).temA1Ativo(tx, FILIAL)).toMatchObject({ valido: true });
    expect(vistas).toEqual([tx, tx]);
  });
});

describe('core e cadastros montados de verdade (RN-CORE-02)', () => {
  const EMPRESA = { id: TENANT, razao_social: 'Empresa Piloto LTDA', nome_fantasia: null, cnpj: '11222333000181', ie: null, fuso: 'America/Manaus', updated_at: AGORA };
  const reais = () =>
    modulosDeTeste({
      core: repoCoreDuble({ empresa: async () => EMPRESA }),
      cadastros: { condicoesPagamento: { listar: async () => ({ itens: [], proximo_cursor: null }) } as never },
    });
  // Os módulos reais podem declarar rotas idempotentes (ex.: carga de CSV do cadastros): a API exige o repositório.
  const montarReais = (licencas: Licenca[] = []) => montar(licencas, undefined, reais(), { idempotencia: new IdempotenciaMemoria() });
  const get = (app: Awaited<ReturnType<typeof montar>>, url: string, perfil: Perfil) => app.inject({ url, headers: { authorization: token(perfil) } });

  it('core responde sem licença no tenant (sempre licenciado); perfil sem permissão é 403 PERFIL_SEM_PERMISSAO', async () => {
    const app = await montarReais();
    const r = await get(app, '/v1/core/empresa', 'leitura');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: TENANT, razao_social: 'Empresa Piloto LTDA' });
    const barrado = await get(app, '/v1/core/usuarios', 'vendedor');
    expect([barrado.statusCode, barrado.json().codigo]).toEqual([403, 'PERFIL_SEM_PERMISSAO']);
    expect((await app.inject({ url: '/v1/core/empresa' })).statusCode).toBe(401);
  });

  it('cadastros sem licença é 403 MODULO_INATIVO; com licença responde; leitura não edita', async () => {
    const sem = await get(await montarReais(), '/v1/cadastros/condicoes-pagamento', 'administrador');
    expect([sem.statusCode, sem.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
    const vencida = await get(await montarReais([{ modulo: 'cadastros', ativo: true, valido_ate: new Date('2026-11-20T00:00:00Z') }]), '/v1/cadastros/condicoes-pagamento', 'administrador');
    expect(vencida.json().codigo).toBe('MODULO_INATIVO');
    const app = await montarReais([{ modulo: 'cadastros', ativo: true, valido_ate: null }]);
    const ok = await get(app, '/v1/cadastros/condicoes-pagamento', 'leitura');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ itens: [] });
    const escrita = await app.inject({ method: 'POST', url: '/v1/cadastros/condicoes-pagamento', payload: {}, headers: { authorization: token('leitura') } });
    expect([escrita.statusCode, escrita.json().codigo]).toEqual([403, 'PERFIL_SEM_PERMISSAO']);
  });

  it('o cadastros vê o A1 da filial pela porta do core (RN-CORE-06), na transação da rota', async () => {
    const cert = (validoAte: Date) => ({ id: USUARIO, filial_id: FILIAL, titular: 't', cnpj: '11222333000181', valido_de: new Date('2026-01-01T00:00:00Z'), valido_ate: validoAte, impressao_digital: 'x', ativo: true, origem: 'upload' as const });
    const tx = {} as never;
    const porta = (certs: ReturnType<typeof cert>[]) => certificadosDoCore(repoCoreDuble({ empresa: async () => EMPRESA, certificados: async (t) => (expect(t).toBe(tx), certs) }));
    expect(await porta([cert(new Date('2027-01-01T00:00:00Z'))]).filialTemA1Valido(tx, FILIAL, AGORA)).toBe(true);
    expect(await porta([cert(new Date('2026-11-01T00:00:00Z'))]).filialTemA1Valido(tx, FILIAL, AGORA)).toBe(false);
    expect(await porta([]).filialTemA1Valido(tx, FILIAL, AGORA)).toBe(false);
  });
});

describe('rota multipart do dublê: perfil antes do arquivo e cabeçalhos (RN-CORE-02)', () => {
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
    for (const proibido of ['SENHA-DO-A1', 'PPPPPPPP', NOME_ARQUIVO_PADRAO, 'Bearer']) expect(log).not.toContain(proibido);
  });

  it('acima de 50 KB é 413 ARQUIVO_GRANDE', async () => {
    const r = await enviar(await montar(), { filial_id: FILIAL, senha: 's' }, { arquivo: pfx(LIMITE_PFX + 1) });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_GRANDE', campos: { arquivo: 'até 50 KB' } });
  });

  it('limite da rota igual ao teto global (10 MiB): aceita no limite e acima dele é 413 ARQUIVO_GRANDE, não CORPO_GRANDE', async () => {
    const app = await montar();
    const anexo = async (n: number) => {
      const f = formulario({}, { anexo: pfx(n) });
      return app.inject({ method: 'POST', url: '/v1/core/anexos', payload: f.payload, headers: { ...f.headers, authorization: token('administrador') } });
    };
    expect((await anexo(TAMANHO_MAXIMO_MULTIPART)).statusCode).toBe(201);
    const r = await anexo(TAMANHO_MAXIMO_MULTIPART + 1);
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_GRANDE', campos: { anexo: 'até 10240 KB' } });
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

describe('rota de lote: vários arquivos, total, Idempotency-Key e tempo por rota (T-0026)', () => {
  let ms = 0;
  let execucoes = 0;
  const lotes = definirPlugin(manifesto('core'), [
    definirRota({
      metodo: 'POST',
      caminho: '/lotes',
      acao: 'core.certificado.gerir',
      corpo: z.object({ modo: z.enum(['validar', 'gravar']) }),
      multipart: { arquivos: [{ campo: 'arquivos', tamanhoMaximo: 100, quantidadeMaxima: 3 }], tamanhoMaximoTotal: 150 },
      idempotencia: 'opcional',
      tempoMaximoMs: 1_000,
      executar: async (c, e) => {
        execucoes++;
        if (e.corpo.modo === 'gravar') {
          ms += 1_001; // a rota "demora": a próxima consulta passa do prazo
          await c.tx.consultar('SELECT 1');
        }
        return { corpo: { n: execucoes, arquivos: e.todosArquivos.arquivos!.map((a) => [a.nome, a.tamanho]) }, cabecalhos: { 'x-teste': 'sim' } };
      },
    }),
  ]);
  const montarLotes = (idempotencia = new IdempotenciaMemoria()) =>
    montar([], undefined, registrarModulos([lotes, cadastrosDuble]), { idempotencia, cronometro: () => ms });

  const formularioLote = (modo: string, arquivos: [string, string][]) =>
    formulario({ modo }, arquivos.map(([nome, conteudo]) => ({ campo: 'arquivos', nome, conteudo, tipo: 'text/csv' })));
  const enviar = (app: Awaited<ReturnType<typeof montar>>, modo: string, arquivos: [string, string][], chave?: string) => {
    const f = formularioLote(modo, arquivos);
    return app.inject({ method: 'POST', url: '/v1/core/lotes', payload: f.payload, headers: { ...f.headers, authorization: token('administrador'), ...(chave ? { 'idempotency-key': chave } : {}) } });
  };
  afterEach(() => {
    ms = 0;
    execucoes = 0;
  });

  it('vários arquivos no mesmo campo chegam em ordem, com o nome; acima da quantidade é 400 e do total é 413', async () => {
    const app = await montarLotes();
    const r = await enviar(app, 'validar', [['cliente.csv', 'a'.repeat(60)], ['produto.csv', 'b'.repeat(40)]]);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ n: 1, arquivos: [['cliente.csv', 60], ['produto.csv', 40]] });
    const muitos = await enviar(app, 'validar', [['a.csv', 'a'], ['b.csv', 'b'], ['c.csv', 'c'], ['d.csv', 'd']]);
    expect([muitos.statusCode, muitos.json().codigo]).toEqual([400, 'VALIDACAO']);
    const grande = await enviar(app, 'validar', [['a.csv', 'a'.repeat(100)], ['b.csv', 'b'.repeat(51)]]);
    expect([grande.statusCode, grande.json()]).toEqual([413, expect.objectContaining({ codigo: 'ARQUIVO_GRANDE', campos: { _: 'até 0 KB' } })]);
    const umGrande = await enviar(app, 'validar', [['a.csv', 'a'.repeat(101)]]);
    expect(umGrande.json()).toMatchObject({ codigo: 'ARQUIVO_GRANDE', campos: { arquivos: 'até 0 KB' } });
    expect(execucoes).toBe(1);
  });

  it('Idempotency-Key: o reenvio devolve a mesma resposta sem executar; outro pedido com a chave chega ao HTTP como 409', async () => {
    const repo = new IdempotenciaMemoria();
    const app = await montarLotes(repo);
    const arquivos: [string, string][] = [['cliente.csv', 'x;y']];
    const a = await enviar(app, 'validar', arquivos, 'chave-lote-0001');
    const b = await enviar(app, 'validar', arquivos, 'chave-lote-0001');
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(b.json()).toEqual(a.json());
    expect([a.headers['x-teste'], b.headers['idempotency-replayed']]).toEqual(['sim', 'true']);
    expect(execucoes).toBe(1);
    const outro = await enviar(app, 'validar', [['cliente.csv', 'x;z']], 'chave-lote-0001');
    expect([outro.statusCode, outro.json().codigo]).toEqual([409, 'CONFLITO']);
    expect((await enviar(app, 'validar', arquivos)).statusCode).toBe(200); // opcional: sem a chave executa sempre
    expect(execucoes).toBe(2);
    expect([...repo.registros.keys()]).toEqual([`${TENANT}|POST /v1/core/lotes|chave-lote-0001`]);
  });

  it('passou do tempo da rota: 503 TEMPO_ESGOTADO e nada é guardado na idempotência', async () => {
    const repo = new IdempotenciaMemoria();
    const r = await enviar(await montarLotes(repo), 'gravar', [['cliente.csv', 'x']], 'chave-lote-0002');
    expect([r.statusCode, r.json().codigo]).toEqual([503, 'TEMPO_ESGOTADO']);
    expect([...repo.registros.values()].every((x) => x.status === null)).toBe(true);
  });

  it('rota com idempotencia sem o repositório na API não sobe', async () => {
    await expect(montar([], undefined, registrarModulos([lotes, cadastrosDuble]))).rejects.toThrow(/idempotencia sem o repositório/);
  });
});

describe('integração FDV montada na API (T-0011, RN-CORE-02)', () => {
  const LICENCAS: Licenca[] = ['cadastros', 'pedido', 'integracao-fdv'].map((modulo) => ({ modulo: modulo as Licenca['modulo'], ativo: true, valido_ate: null }));
  const montarIntegracao = (licencas: Licenca[]) => montar(licencas, undefined, modulosDeTeste(), { idempotencia: new IdempotenciaMemoria() });
  const chamar = (app: Awaited<ReturnType<typeof montar>>, metodo: 'GET', url: string, perfil: Perfil) =>
    app.inject({ method: metodo, url, headers: { authorization: token(perfil) } });

  it('sem licença do módulo: 403 MODULO_INATIVO; vendedor e faturista não veem o monitor (PERFIL_SEM_PERMISSAO)', async () => {
    const sem = await chamar(await montarIntegracao([]), 'GET', '/v1/integracao-fdv/monitor', 'administrador');
    expect([sem.statusCode, sem.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
    const app = await montarIntegracao(LICENCAS);
    for (const perfil of ['vendedor', 'faturista', 'fiscal'] as const) {
      const r = await chamar(app, 'GET', '/v1/integracao-fdv/monitor', perfil);
      expect([perfil, r.statusCode, r.json().codigo]).toEqual([perfil, 403, 'PERFIL_SEM_PERMISSAO']);
    }
  });

  // O 503 sem a chave mestra e a escrita do conector ficam no portal: `integracao-fdv-portal.db.test.ts` (T-0056, ADR 0013).
});

describe('faturamento na API: emissão em produção desligada até a T-0046 (RN-FAT-04, regra 7)', () => {
  const PEDIDO = '5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f80';
  const LICENCAS: Licenca[] = ['cadastros', 'pedido', 'faturamento'].map((modulo) => ({ modulo: modulo as Licenca['modulo'], ativo: true, valido_ate: null }));

  it('a constante é false, sem variável de ambiente', () => {
    expect(EMISSAO_PRODUCAO_HABILITADA).toBe(false);
  });

  it('filial em produção: POST /notas dá 422 RN-FAT-04 antes de reservar o número (a série não anda)', async () => {
    const chamadas: string[] = [];
    const anotar = <T>(nome: string, valor: T) => async () => (chamadas.push(nome), valor);
    // Só o que a emissão lê ANTES do ambiente; reservar o número (ou qualquer outra porta) lança e vira 500, não 422.
    const notas: never = new Proxy<Record<string, unknown>>(
      { travarIdempotencia: anotar('travarIdempotencia', undefined), buscarPorIdempotencia: anotar('buscarPorIdempotencia', null), travarPedido: anotar('travarPedido', undefined), quantidadesJaFaturadas: anotar('quantidadesJaFaturadas', new Map()) },
      { get: (alvo, prop) => (prop in alvo ? alvo[prop as string] : prop === 'then' ? undefined : async () => (chamadas.push(String(prop)), Promise.reject(new Error(`notas.${String(prop)} não esperado`)))) },
    ) as never;
    const modulos = montarModulos({
      core: dependenciasCoreDeTeste(),
      cadastros: { fontes: { cnpj: [], cep: [] } },
      faturamento: {
        notas,
        pedidos: { obter: anotar('pedidos.obter', { filial_id: FILIAL }) } as never,
        situacao: { situacao: anotar('situacao', { status: 'aprovado' }) } as never,
        cadastros: { filial: anotar('cadastros.filial', { id: FILIAL, emissora: true, nfe_serie: 1, ie: '053000000' }) } as never,
        ambiente: { ambiente: anotar('ambiente', 'producao') } as never,
      },
    });
    const app = await montar(LICENCAS, undefined, modulos, { idempotencia: new IdempotenciaMemoria() });
    const r = await app.inject({ method: 'POST', url: '/v1/faturamento/notas', headers: { authorization: token('faturista') }, payload: { pedido_id: PEDIDO, idempotencia: 'emissao-producao-1' } });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.body).toContain('RN-FAT-04');
    expect(chamadas).toContain('ambiente');
    expect(chamadas).not.toContain('reservarNumero');
  });
});

describe('carga de cadastros no portal /config montada na API (T-0058, ADR 0013, adendo de 23/11/2026)', () => {
  const C = CAMINHOS_CARGAS_PLATAFORMA;
  const rotasCarga = (plugins: ReturnType<typeof pluginsPlataforma>) =>
    plugins.flatMap((p) => p.rotas).filter((r) => r.acao === 'plataforma.cadastros.carga');

  it('pluginsPlataforma: as rotas POST da carga com multipart de um arquivo (10 MiB)', () => {
    const rotas = rotasCarga(pluginsPlataforma(modulosDeTeste(), { chaveIntegracao: null, outbox: new OutboxMemoria() }));
    for (const r of rotas.filter((r) => r.metodo === 'POST')) {
      expect(r.multipart).toEqual({
        arquivos: [{ campo: CAMPO_ARQUIVO_CARGA_PORTAL, tamanhoMaximo: MAX_BYTES_ARQUIVO_CARGA_PORTAL, quantidadeMaxima: 1 }],
        tamanhoMaximoTotal: MAX_BYTES_ARQUIVO_CARGA_PORTAL,
      });
    }
    // Sem dependências (os testes de isolamento só listam as rotas): as mesmas rotas, com os padrões de produção.
    expect(rotasCarga(pluginsPlataforma(modulosDeTeste())).map((r) => r.caminho).sort()).toEqual(rotas.map((r) => r.caminho).sort());
  });

  /** Rotas da carga que o /config chama (método × chave do `CAMINHOS_CARGAS_PLATAFORMA`); `previa` e `zerar` entram na v0.3.6. */
  const ROTAS_CARGA_PORTAL = [
    { method: 'GET', chave: 'situacao' },
    { method: 'GET', chave: 'modelo' },
    { method: 'POST', chave: 'validar' },
    { method: 'POST', chave: 'erros' },
    { method: 'POST', chave: 'gravar' },
  ] as const satisfies ReadonlyArray<{ method: 'GET' | 'POST'; chave: keyof typeof CAMINHOS_CARGAS_PLATAFORMA }>;

  const appProducao = async () => {
    const producao = montarDependenciasProducao({
      banco: new BancoMemoria(),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: SEGREDO, cookieSeguro: true, segredoBff: null },
      bancoPlataforma: {} as never,
    });
    return montar([], undefined, producao.modulos, { plataforma: producao.plataforma!, idempotencia: new IdempotenciaMemoria() });
  };

  it.each(ROTAS_CARGA_PORTAL)('montarDependenciasProducao: $method $chave da carga sobe no portal', async ({ method, chave }) => {
    const app = await appProducao();
    expect(app.hasRoute({ method, url: `${PREFIXO_PLATAFORMA}${C[chave]}` })).toBe(true);
  });

  it('montarDependenciasProducao: a rota de teste da integração FDV sobe no portal ao lado da carga', async () => {
    const app = await appProducao();
    expect(app.hasRoute({ method: 'POST', url: `${PREFIXO_PLATAFORMA}${CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.testar}` })).toBe(true);
  });

  it('montarDependenciasProducao: as rotas do "Zerar dados" (RN-CAD-10) sobem no portal, previa e zerar por POST', async () => {
    const producao = montarDependenciasProducao({
      banco: new BancoMemoria(),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: SEGREDO, cookieSeguro: true, segredoBff: null },
      bancoPlataforma: {} as never,
    });
    const app = await montar([], undefined, producao.modulos, { plataforma: producao.plataforma!, idempotencia: new IdempotenciaMemoria() });
    for (const caminho of [C.previa, C.zerar]) expect(app.hasRoute({ method: 'POST', url: `${PREFIXO_PLATAFORMA}${caminho}` })).toBe(true);
  });

  it('T-0093: o "Zerar pedidos não faturados" sobe no portal, prévia e zerar por POST', async () => {
    const app = await appProducao();
    for (const caminho of Object.values(CAMINHOS_ZERAR_PEDIDOS)) expect(app.hasRoute({ method: 'POST', url: `${PREFIXO_PLATAFORMA}${caminho}` })).toBe(true);
  });
});
