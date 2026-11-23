import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODIGO_ZERAGEM_BLOQUEADA, MAX_BYTES_ARQUIVO_CARGA_PORTAL } from '@macuxierp/platform-sdk';

const estado = vi.hoisted(() => ({ cookie: 'tok-config' as string | undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'mx_config' && estado.cookie ? { value: estado.cookie } : undefined), delete: vi.fn() }) }));
vi.mock('next/navigation', () => ({ redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));

import { tratarCarga, tratarPreviaZerar, tratarZerar } from './cargas-rotas';

const EMP = '11111111-1111-4111-8111-111111111111';
const CHAVE = '33333333-3333-4333-8333-333333333333';
const chamadas: { url: string; metodo: string; h: Record<string, string>; corpo: unknown }[] = [];
let resposta: () => Response;
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const conferencia = { cadastro: 'produto', modo: 'adicionar', prontas: 44, com_erro: 0, linhas: [], linhas_omitidas: 0 };
const zeragem = (extra: Record<string, unknown> = {}) => ({ empresa_id: EMP, simulado: false, efetivos: ['produto'], apagados: [{ tabela: 'produto', quantidade: 3 }], anulados: [], mantidos: [], bloqueios: [], sem_chave: 5, ...extra });
const gravada = { cadastro: 'produto', modo: 'adicionar', gravadas: 44, com_erro: 0 };
const multipart = (extra: Record<string, string> = {}, tamanho = 30, headers: Record<string, string> = {}) => {
  const f = new FormData();
  f.append('arquivo', new File(['a'.repeat(tamanho)], 'produto.csv', { type: 'text/csv' }));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return new Request('http://portal.invalid/x', { method: 'POST', body: f, headers });
};
// o Request com FormData já traz content-type e, no Node, content-length só com Blob: o corpo vai como Blob para termos o tamanho
async function comTamanho(req: Request, headers: Record<string, string> = {}, query = ''): Promise<Request> {
  const b = await req.arrayBuffer();
  return new Request(req.url + query, { method: 'POST', body: b, headers: { 'content-type': req.headers.get('content-type') ?? '', 'content-length': String(b.byteLength), ...headers } });
}

beforeEach(() => {
  estado.cookie = 'tok-config';
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  vi.stubGlobal('fetch', async (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
    chamadas.push({ url, metodo: init.method, h: init.headers, corpo: init.body });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('route handlers da aba Cargas (T-0058)', () => {
  it('validar: leva o cookie do superadmin, o anti-CSRF e o modo na query, e devolve só a conferência', async () => {
    resposta = () => json(conferencia);
    const r = await tratarCarga(await comTamanho(multipart(), {}, '?modo=adicionar'), EMP, 'produto', 'validar');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, conferencia: { prontas: 44 } });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${EMP}/cadastros/cargas/produto/validar?modo=adicionar`);
    expect(chamadas[0]?.metodo).toBe('POST');
    expect(chamadas[0]?.h.cookie).toBe('macuxierp_config=tok-config');
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    expect((chamadas[0]?.corpo as FormData).get('arquivo')).toBeInstanceOf(Blob);
  });
  it('validar em substituir_tudo devolve o efeito; modo desconhecido é 400 sem chamar a API', async () => {
    resposta = () => json({ ...conferencia, modo: 'substituir_tudo', efeito: { total: 266, a_inativar: 120, percentual: (120 * 100) / 266, acima_limite_fdv: true } });
    const r = await tratarCarga(await comTamanho(multipart(), {}, '?modo=substituir_tudo'), EMP, 'produto', 'validar');
    expect(await r.json()).toMatchObject({ ok: true, conferencia: { efeito: { a_inativar: 120 } } });
    expect(chamadas[0]?.url).toContain('validar?modo=substituir_tudo');
    expect((await tratarCarga(await comTamanho(multipart(), {}, '?modo=apagar'), EMP, 'produto', 'validar')).status).toBe(400);
    expect(chamadas).toHaveLength(1);
  });
  it('gravar: repassa o modo e a Idempotency-Key; sem a chave, 400 sem chamar a API', async () => {
    resposta = () => json(gravada);
    const r = await tratarCarga(await comTamanho(multipart(), { 'idempotency-key': CHAVE }, '?modo=adicionar'), EMP, 'produto', 'gravar');
    expect(await r.json()).toMatchObject({ ok: true, gravacao: { gravadas: 44 } });
    expect(chamadas[0]?.url).toContain('/cargas/produto/gravar?modo=adicionar');
    expect(chamadas[0]?.h['idempotency-key']).toBe(CHAVE);
    expect((chamadas[0]?.corpo as FormData).has('frase')).toBe(false);
    const sem = await tratarCarga(await comTamanho(multipart(), {}, '?modo=adicionar'), EMP, 'produto', 'gravar');
    expect(sem.status).toBe(400);
    expect(chamadas).toHaveLength(1);
  });
  it('gravar: adicionar com frase e substituir_tudo sem frase certa são 400; a frase certa passa, mesmo em maiúsculas e com ponto', async () => {
    resposta = () => json({ ...gravada, modo: 'substituir_tudo', inativadas: 0, efeito: { total: 44, a_inativar: 0, percentual: 0, acima_limite_fdv: false } });
    const k = { 'idempotency-key': CHAVE };
    expect((await tratarCarga(await comTamanho(multipart({ frase: 'x' }), k, '?modo=adicionar'), EMP, 'produto', 'gravar')).status).toBe(400);
    expect((await tratarCarga(await comTamanho(multipart(), k, '?modo=substituir_tudo'), EMP, 'produto', 'gravar')).status).toBe(400);
    expect((await tratarCarga(await comTamanho(multipart({ frase: 'autorizo substituir' }), k, '?modo=substituir_tudo'), EMP, 'produto', 'gravar')).status).toBe(400);
    expect(chamadas).toHaveLength(0);
    const ok = await tratarCarga(await comTamanho(multipart({ frase: '  AUTORIZO  substituir TUDO. ' }), k, '?modo=substituir_tudo'), EMP, 'produto', 'gravar');
    expect(ok.status).toBe(200);
    expect((chamadas[0]?.corpo as FormData).get('frase')).toBe('  AUTORIZO  substituir TUDO. ');
    expect(chamadas[0]?.url).toContain('gravar?modo=substituir_tudo');
  });
  it('gravar: 409 (dependência pendente ou carga em andamento) mantém o 409 e a mensagem da API', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'Já há uma carga em andamento nesta empresa; aguarde terminar.' }, 409);
    const r = await tratarCarga(await comTamanho(multipart(), { 'idempotency-key': CHAVE }, '?modo=adicionar'), EMP, 'produto', 'gravar');
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ ok: false, erro: 'Já há uma carga em andamento nesta empresa; aguarde terminar.' });
  });
  it('sem sessão do /config: 401 com o destino do login e nenhuma chamada à API', async () => {
    estado.cookie = undefined;
    const r = await tratarCarga(await comTamanho(multipart()), EMP, 'produto', 'validar');
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ ok: false, redirecionar: '/config/entrar' });
    expect(chamadas).toHaveLength(0);
  });
  it('API devolve 401: a resposta pede novo login', async () => {
    resposta = () => json({ codigo: 'NAO_AUTENTICADO', mensagem: 'x' }, 401);
    const r = await tratarCarga(await comTamanho(multipart()), EMP, 'produto', 'validar');
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ redirecionar: '/config/entrar' });
  });
  it('arquivo recusado pela API: a mensagem curta da API chega à tela; corpo cru e conteúdo do arquivo nunca', async () => {
    resposta = () => json({ codigo: 'VALIDACAO', mensagem: 'Cabeçalho inválido: falta a coluna codigo.', detalhe: 'SEGREDO-DO-CORPO' }, 422);
    const r = await tratarCarga(await comTamanho(multipart()), EMP, 'produto', 'validar');
    expect(r.status).toBe(422);
    const t = await r.text();
    expect(t).toContain('Cabeçalho inválido: falta a coluna codigo.');
    expect(t).not.toContain('SEGREDO-DO-CORPO');
  });
  it('cadastro desconhecido, ação desconhecida e empresa que não é UUID: 404 sem chamar a API', async () => {
    expect((await tratarCarga(await comTamanho(multipart()), EMP, 'rota', 'validar')).status).toBe(404);
    expect((await tratarCarga(await comTamanho(multipart()), EMP, 'produto', 'apagar')).status).toBe(404);
    expect((await tratarCarga(await comTamanho(multipart()), '../x', 'produto', 'validar')).status).toBe(404);
    expect(chamadas).toHaveLength(0);
  });
  it('arquivo acima do limite: 413 antes de chamar a API', async () => {
    const grande = new Request('http://portal.invalid/x', { method: 'POST', body: 'x', headers: { 'content-type': 'multipart/form-data; boundary=a', 'content-length': String(MAX_BYTES_ARQUIVO_CARGA_PORTAL + 1_000_000) } });
    expect((await tratarCarga(grande, EMP, 'produto', 'validar')).status).toBe(413);
    expect(chamadas).toHaveLength(0);
  });
  it('origem de outro site é recusada', async () => {
    const r = await tratarCarga(await comTamanho(multipart(), { origin: 'https://outro.invalid', host: 'erp.exemplo.invalid' }), EMP, 'produto', 'validar');
    expect(r.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });
  it('erros: POST com o mesmo arquivo; o CSV volta como anexo erros-<cadastro>.csv', async () => {
    resposta = () => new Response('linha;motivo\r\n46;x\r\n', { headers: { 'content-type': 'text/csv; charset=utf-8' } });
    const r = await tratarCarga(await comTamanho(multipart()), EMP, 'produto', 'erros');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('erros-produto.csv');
    expect(await r.text()).toContain('46;x');
    expect(chamadas[0]?.url).toContain('/cargas/produto/erros');
    expect(chamadas[0]?.metodo).toBe('POST');
    expect((await tratarCarga(new Request('http://portal.invalid/x'), EMP, 'produto', 'erros')).status).toBe(405);
  });
  it('modelo: GET como anexo', async () => {
    resposta = () => new Response('codigo;nome\r\n', { headers: { 'content-type': 'text/csv; charset=utf-8' } });
    const r = await tratarCarga(new Request('http://portal.invalid/x'), EMP, 'preco', 'modelo');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('modelo-preco.csv');
    expect(chamadas[0]?.url).toContain('/cadastros/cargas/preco/modelo');
  });
  it('modelo: se a API falhar, volta uma página com a mensagem e o status, nunca um anexo', async () => {
    resposta = () => json({ codigo: 'NAO_ENCONTRADO', mensagem: 'Empresa <b>não</b> encontrada.' }, 404);
    const r = await tratarCarga(new Request('http://portal.invalid/x'), EMP, 'preco', 'modelo');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-disposition')).toBeNull();
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).not.toContain('<b>');
  });
  it('modelo: sessão vencida leva ao login (303) e não gera anexo', async () => {
    estado.cookie = undefined;
    const r = await tratarCarga(new Request('http://portal.invalid/x'), EMP, 'preco', 'modelo');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toContain('/config/entrar');
    expect(r.headers.get('content-disposition')).toBeNull();
  });
  it('422 RN-CORE-02 (MXC04, empresa sem licença): mantém o 422 e a mensagem da API', async () => {
    resposta = () => json({ codigo: 'RN-CORE-02', mensagem: 'A empresa não está ativa ou não tem o módulo Cadastros.' }, 422);
    const r = await tratarCarga(await comTamanho(multipart(), { 'idempotency-key': CHAVE }, '?modo=adicionar'), EMP, 'produto', 'gravar');
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ ok: false, erro: 'A empresa não está ativa ou não tem o módulo Cadastros.' });
  });
  it('409 por dependência pendente (MXC03) mantém o 409 e a mensagem da API', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'Carregue Produtos antes de Preços.' }, 409);
    const r = await tratarCarga(await comTamanho(multipart(), { 'idempotency-key': CHAVE }, '?modo=adicionar'), EMP, 'preco', 'gravar');
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ erro: 'Carregue Produtos antes de Preços.' });
  });
  it('400 VALIDACAO da API continua 400 (o status não vira 422)', async () => {
    resposta = () => json({ codigo: 'VALIDACAO', mensagem: 'Modo inválido.' }, 400);
    const r = await tratarCarga(await comTamanho(multipart(), {}, '?modo=adicionar'), EMP, 'produto', 'validar');
    expect(r.status).toBe(400);
  });
  it('403 TROCAR_SENHA: pede a troca de senha e não é "sem permissão"', async () => {
    resposta = () => json({ codigo: 'TROCAR_SENHA', mensagem: 'x' }, 403);
    const r = await tratarCarga(await comTamanho(multipart()), EMP, 'produto', 'validar');
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ ok: false, redirecionar: '/config/senha' });
  });
  it('o content-length mente: o corpo real passa do limite e o stream é cortado com 413, sem chamar a API', async () => {
    const bloco = new Uint8Array(1024 * 1024);
    let enviados = 0;
    const corpo = new ReadableStream<Uint8Array>({ pull(c) { if (enviados > 12) return c.close(); enviados += 1; c.enqueue(bloco); } });
    const req = new Request('http://portal.invalid/x', { method: 'POST', body: corpo, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=a', 'content-length': '100' } } as RequestInit);
    expect((await tratarCarga(req, EMP, 'produto', 'validar')).status).toBe(413);
    expect(enviados).toBeLessThan(13);
    expect(chamadas).toHaveLength(0);
  });
  const reqZerar = (corpo: unknown, chave: string | null = CHAVE) => new Request('http://portal.invalid/x', { method: 'POST', body: JSON.stringify(corpo), headers: chave ? { 'idempotency-key': chave } : {} });
  it('zerar: leva cadastros, frase, a Idempotency-Key e o CSRF', async () => {
    resposta = () => json(zeragem());
    const r = await tratarZerar(reqZerar({ cadastros: ['produto', 'cliente'], frase: 'AUTORIZO ZERAR OS DADOS.' }), EMP);
    expect(await r.json()).toEqual({ ok: true, mantidos: 0 });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${EMP}/cadastros/zerar`);
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBe(CHAVE);
    expect(JSON.parse(chamadas[0]?.corpo as string)).toEqual({ cadastros: ['produto', 'cliente'], frase: 'AUTORIZO ZERAR OS DADOS.' });
  });
  it('prévia do zerar: POST em zerar/previa com os cadastros escolhidos, sem chave, e devolve a prévia; outro método dá 405', async () => {
    resposta = () => json(zeragem({ simulado: true }));
    const r = await tratarPreviaZerar(reqZerar({ cadastros: ['produto'] }, null), EMP);
    expect(await r.json()).toMatchObject({ ok: true, previa: { simulado: true, sem_chave: 5, efetivos: ['produto'] } });
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${EMP}/cadastros/zerar/previa`);
    expect(JSON.parse(chamadas[0]?.corpo as string)).toEqual({ cadastros: ['produto'] });
    expect((await tratarPreviaZerar(new Request('http://portal.invalid/x', { method: 'GET' }), EMP)).status).toBe(405);
  });
  it('seleção mínima: prévia e zerar sem cadastro, ou com cadastro desconhecido, são 400 e não chegam à API', async () => {
    expect((await tratarPreviaZerar(reqZerar({ cadastros: [] }, null), EMP)).status).toBe(400);
    expect((await tratarPreviaZerar(reqZerar({ cadastros: ['empresa'] }, null), EMP)).status).toBe(400);
    expect((await tratarZerar(reqZerar({ cadastros: [], frase: 'autorizo zerar os dados' }), EMP)).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });
  it('zerar sem frase ou sem chave: 400 e nada é apagado', async () => {
    expect((await tratarZerar(reqZerar({ cadastros: ['produto'], frase: '' }), EMP)).status).toBe(400);
    expect((await tratarZerar(reqZerar({ cadastros: ['produto'], frase: 'AUTORIZO ZERAR OS DADOS.' }, null), EMP)).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });
  it('zerar: a mensagem da API volta; frase errada nem chega à API', async () => {
    resposta = () => json({ codigo: 'VALIDACAO', mensagem: 'A frase não confere.' }, 400);
    const r = await tratarZerar(reqZerar({ cadastros: ['produto'], frase: 'autorizo zerar os dados' }), EMP);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, erro: 'A frase não confere.' });
    expect((await tratarZerar(reqZerar({ cadastros: ['produto'], frase: 'ERRADO' }), EMP)).status).toBe(400);
    expect(chamadas).toHaveLength(1);
  });
  it('422 zeragem_bloqueada: devolve o código e os bloqueios (só strings cadastro:motivo)', async () => {
    resposta = () => json({ codigo: 'RN-CAD-10', mensagem: 'x', detalhes: { codigo: CODIGO_ZERAGEM_BLOQUEADA, bloqueios: ['preco:integracao_ligada', 'produto:lote_em_andamento', 'lixo qualquer', 7], segredo: 'nao' } }, 422);
    const r = await tratarZerar(reqZerar({ cadastros: ['preco'], frase: 'autorizo zerar os dados' }), EMP);
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ ok: false, erro: 'Há integração ligada ou lote em andamento; resolva antes de zerar.', codigo: CODIGO_ZERAGEM_BLOQUEADA, bloqueios: ['preco:integracao_ligada', 'produto:lote_em_andamento'], chaveNova: true });
  });
  it.each(['em_uso', 'sumiu', 'anular_fora_do_plano', 'referencia'])('409 MXC03 no zerar (%s): "Os dados mudaram. Confira de novo." com o código para refazer a prévia', async (codigo) => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'x', detalhes: { codigo } }, 409);
    const r = await tratarZerar(reqZerar({ cadastros: ['produto'], frase: 'autorizo zerar os dados' }), EMP);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, erro: 'Os dados mudaram. Confira de novo.', codigo: 'dados_mudaram', chaveNova: true });
  });
  it('409 com outro código no zerar não vira "dados mudaram"', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'x', detalhes: { codigo: 'dependencia_pendente' } }, 409);
    const r = await tratarZerar(reqZerar({ cadastros: ['produto'], frase: 'autorizo zerar os dados' }), EMP);
    expect((await r.json()).codigo).not.toBe('dados_mudaram');
  });
});
