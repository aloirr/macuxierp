import { describe, expect, it } from 'vitest';
import { EU_FALSO } from '../falso';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import { PAGINAS_REGISTRADAS, casarRota, paginaVisivel, paginasDoMenu } from '../paginas';
import { escritaPermitida, resultadoDaResposta } from './escrita';
import { caminhoDaFonte, rotuloDaOpcao } from './fontes';
import { aposResposta, chaveParaEnvio, ehRespostaDefinitiva, novoEstado } from './idempotencia';
import { rotuloDaCelula } from './lista';
import { escritaDeclarada } from '../telas';
import { urlProxima } from '../listas-url';
import { validarAcao } from '../telas/pedido';
import type { AcaoVista } from './tipos';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';

describe('rota do pedido no shell (T-0015)', () => {
  it('as três páginas estão registradas e só a lista entra no menu', () => {
    expect(PAGINAS_REGISTRADAS.filter((p) => p.modulo === 'pedido').map((p) => [p.rota, Boolean(p.ocultaNoMenu)])).toEqual([
      ['/pedido/pedidos', false], ['/pedido/pedidos/novo', true], ['/pedido/pedidos/:id', true],
    ]);
    expect(paginasDoMenu('pedido', 'Pedidos').map((p) => p.rota)).toEqual(['/pedido/pedidos']);
  });
  it('/novo vence /:id; o id vira parâmetro; rota com barra a mais não casa', () => {
    expect(casarRota('/pedido/pedidos/novo')?.pagina.rota).toBe('/pedido/pedidos/novo');
    const c = casarRota(`/pedido/pedidos/${ID}`);
    expect(c?.pagina.rota).toBe('/pedido/pedidos/:id');
    expect(c?.params).toEqual({ id: ID });
    expect(casarRota(`/pedido/pedidos/${ID}/x`)).toBeUndefined();
    expect(casarRota('/pedido/pedidos/%E0%A4%A')).toBeUndefined();
  });
  it('o menu aponta para a lista e a resolução exige licença, perfil e `ver` da página', () => {
    const menu = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'gerente');
    expect(menu.find((g) => g.modulo === 'pedido')?.itens).toEqual([{ rotulo: 'Pedidos', href: '/pedido/pedidos' }]);
    expect(resolverPagina(menu, `/pedido/pedidos/${ID}`, 'gerente')?.params).toEqual({ id: ID });
    // O shell só pergunta ao SDK (`paginaVisivel`); a regra de quem lança é do módulo.
    const novo = PAGINAS_REGISTRADAS.find((p) => p.rota === '/pedido/pedidos/novo')!;
    expect(resolverPagina(menu, novo.rota, 'gerente') !== undefined).toBe(paginaVisivel(novo, 'gerente'));
    expect(resolverPagina(montarMenu(EU_FALSO.modulos, MANIFESTOS, 'leitura'), novo.rota, 'leitura')).toBeUndefined();
  });
  it('módulo sem licença: nada resolve', () => {
    const semPedido = montarMenu(EU_FALSO.modulos.filter((m) => m.id !== 'pedido'), MANIFESTOS, 'administrador');
    expect(resolverPagina(semPedido, '/pedido/pedidos', 'administrador')).toBeUndefined();
  });
});

describe('escrita pelo shell: licença e perfil', () => {
  const eu = (perfil: string, modulos: string[]) => ({ ...EU_FALSO, usuario: { ...EU_FALSO.usuario, perfil }, modulos: modulos.map((id) => ({ id, menus: [] })) }) as unknown as typeof EU_FALSO;
  it('só /v1/<modulo licenciado>/... com perfil do manifesto', () => {
    expect(escritaPermitida('POST', `/v1/pedido/pedidos/${ID}/aprovar`, eu('gerente', ['core', 'pedido']), MANIFESTOS)).toBe('pedido');
    expect(escritaPermitida('POST', '/v1/pedido/pedidos', eu('gerente', ['core']), MANIFESTOS)).toBeNull();
    expect(escritaPermitida('POST', '/v1/pedido/pedidos', eu('fiscal', ['pedido']), MANIFESTOS)).toBeNull();
    expect(escritaPermitida('GET', '/v1/pedido/pedidos', eu('gerente', ['pedido']), MANIFESTOS)).toBeNull();
    expect(escritaPermitida('POST', '/v1/pedido/../core/x', eu('gerente', ['pedido', 'core']), MANIFESTOS)).toBeNull();
    expect(escritaPermitida('POST', 'https://x.invalid/v1/pedido/a', eu('gerente', ['pedido']), MANIFESTOS)).toBeNull();
    expect(escritaPermitida('POST', '/v1/pedido/a?x=1', eu('gerente', ['pedido']), MANIFESTOS)).toBeNull();
  });
  it('resposta: sucesso traz o id; erro usa a mensagem da API só abaixo de 500 e nunca o corpo cru', () => {
    expect(resultadoDaResposta(201, true, { id: ID })).toEqual({ ok: true, mensagem: 'Feito.', id: ID });
    expect(resultadoDaResposta(422, false, { mensagem: 'Há pendência bloqueante (RN-PED-03).' })).toMatchObject({ ok: false, mensagem: 'Há pendência bloqueante (RN-PED-03).' });
    expect(resultadoDaResposta(500, false, { mensagem: 'stack com dado' }).mensagem).toMatch(/Não foi possível concluir/);
    expect(resultadoDaResposta(412, false, null)).toMatchObject({ ok: false, desatualizado: true });
    expect(resultadoDaResposta(400, false, { mensagem: 'x', campos: { a: 'ruim', b: 3 } }).campos).toEqual({ a: 'ruim' });
  });
});

describe('diálogo de ação: a regra é do módulo (validarAcao do adaptador)', () => {
  const recusar: AcaoVista = { id: 'recusar', rotulo: 'Recusar', metodo: 'POST', caminho: '/v1/pedido/pedidos/x/recusar', entrada: 'motivo', motivos: [{ codigo: 'cliente_bloqueado', rotulo: 'Cliente bloqueado' }, { codigo: 'outro', rotulo: 'Outro' }] };
  it('motivo é obrigatório, "outro" exige o texto e o texto só segue em "outro"', () => {
    expect(validarAcao(recusar, { motivo: '', texto: '' })).toMatchObject({ ok: false });
    expect(validarAcao(recusar, { motivo: 'outro', texto: '  ' })).toMatchObject({ ok: false });
    expect(validarAcao(recusar, { motivo: 'cliente_bloqueado', texto: 'ignorado' })).toEqual({ ok: true, corpo: { motivo_codigo: 'cliente_bloqueado', motivo_texto: null } });
    expect(validarAcao(recusar, { motivo: 'outro', texto: ' sem acordo ' })).toEqual({ ok: true, corpo: { motivo_codigo: 'outro', motivo_texto: 'sem acordo' } });
  });
  it('aprovar com pendência não bloqueante pede justificativa; sem pendência segue sem corpo', () => {
    const aprovar: AcaoVista = { id: 'aprovar', rotulo: 'Aprovar', metodo: 'POST', caminho: '/v1/pedido/pedidos/x/aprovar', entrada: 'justificativa', justificativaObrigatoria: true };
    expect(validarAcao(aprovar, { texto: '' })).toMatchObject({ ok: false });
    expect(validarAcao(aprovar, { texto: ' ok ' })).toEqual({ ok: true, corpo: { justificativa: 'ok' } });
    expect(validarAcao({ ...aprovar, id: 'revalidar', entrada: 'nenhum' }, { texto: '' })).toEqual({ ok: true });
  });
});

describe('escrita só no que um descritor declarou', () => {
  it('ações do detalhe (com UUID) e API do formulário; o resto é recusado', () => {
    expect(escritaDeclarada('POST', `/v1/pedido/pedidos/${ID}/aprovar`)).toBe(true);
    expect(escritaDeclarada('POST', '/v1/pedido/pedidos')).toBe(true);
    expect(escritaDeclarada('POST', `/v1/pedido/pedidos/${ID}/faturar`)).toBe(false);
    expect(escritaDeclarada('POST', '/v1/pedido/pedidos/x/aprovar')).toBe(false);
    expect(escritaDeclarada('DELETE', `/v1/pedido/pedidos/${ID}/aprovar`)).toBe(false);
    expect(escritaDeclarada('POST', '/v1/core/empresa')).toBe(false);
  });
});

describe('Idempotency-Key', () => {
  let n = 0;
  const gerar = () => `k${++n}`;
  it('mesmo corpo reusa a chave; corpo novo depois de 4xx definitivo renova; depois de erro de rede não', () => {
    let e = novoEstado(gerar);
    const k0 = e.chave;
    e = chaveParaEnvio(e, { a: 1 }, gerar);
    expect(e.chave).toBe(k0);
    e = aposResposta(e, ehRespostaDefinitiva(422));
    expect(chaveParaEnvio(e, { a: 1 }, gerar).chave).toBe(k0);
    expect(chaveParaEnvio(e, { a: 2 }, gerar).chave).not.toBe(k0);
    const rede = aposResposta(e, false);
    expect(chaveParaEnvio(rede, { a: 2 }, gerar).chave).toBe(k0);
    expect([ehRespostaDefinitiva(400), ehRespostaDefinitiva(408), ehRespostaDefinitiva(429), ehRespostaDefinitiva(500)]).toEqual([true, false, false, false]);
  });
});

describe('fontes de opções (cadastros) e formulário', () => {
  it('a fonte só lê /v1/cadastros/<recurso>', () => {
    expect(caminhoDaFonte('/v1/cadastros/clientes')).toBe('/v1/cadastros/clientes');
    expect(() => caminhoDaFonte('/v1/pedido/pedidos')).toThrow();
    expect(() => caminhoDaFonte('/v1/cadastros/clientes?x=1')).toThrow();
  });
  it('rótulo da opção por recurso', () => {
    expect(rotuloDaOpcao('/v1/cadastros/produtos', { codigo: 'P1', descricao: 'Água 500 ml' })).toBe('P1 · Água 500 ml');
    expect(rotuloDaOpcao('/v1/cadastros/filiais', { nome: 'Matriz Manaus' })).toBe('Matriz Manaus');
    expect(rotuloDaOpcao('/v1/cadastros/clientes', { razao_social: 'Bar Ltda', documento: '11222333000181' })).toBe('Bar Ltda · 11222333000181');
  });
});

describe('lista genérica', () => {
  it('próxima página só com cursor e mantém os filtros', () => {
    expect(urlProxima('/pedido/pedidos', { status: 'aprovado' }, null)).toBeNull();
    expect(urlProxima('/pedido/pedidos', { status: 'aprovado' }, 'abc')).toBe('/pedido/pedidos?cursor=abc&status=aprovado');
  });
  it('UUID de filial vira o rótulo do cadastro quando há opção', () => {
    expect(rotuloDaCelula(ID, new Map([[ID, 'Matriz']]))).toBe('Matriz');
    expect(rotuloDaCelula(ID, undefined)).toBe(ID);
  });
});
