import { describe, expect, it } from 'vitest';
import { criarPluginCadastros } from './index';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { BRASILAPI_CNPJ, CNPJ_A, filialValida, fonte } from './fixtures-teste';
import { criarExecutorConsultaIe } from './executor-ie';
import { fontesHttp } from './fontes-http';
import { dependenciasEmMemoria } from './memoria';
import type { Fontes } from './portas';

const adm = sessaoDe('administrador');

function montar(fontes: Fontes, certificado = false) {
  const m = dependenciasEmMemoria({ fontes, certificado });
  return { ...m, ...criarAmbiente(criarPluginCadastros(m.deps)) };
}

describe('consulta de CNPJ (RF-CAD-02, RN-CAD-05)', () => {
  it('RN-CAD-05: devolve só a sugestão com fonte e instante e não grava cadastro algum', async () => {
    const principal = fonte('brasilapi', BRASILAPI_CNPJ);
    const t = montar({ cnpj: [principal], cep: [] });
    const r = await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`, { sessao: sessaoDe('faturista') });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({
      fonte: 'brasilapi', consultado_em: '2026-11-21T15:00:00.000Z',
      sugestao: { cnpj: CNPJ_A, razao_social: 'ACME COMERCIO LTDA', endereco: { municipio_ibge: '1302603', uf: 'AM', cep: '69050010' } },
    });
    expect(t.repos.clientes.linhas).toHaveLength(0);
    expect(t.repos.filiais.linhas).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
  });
  it('RF-CAD-02: a sugestão leva CNAE secundário, porte, natureza, e-mail, telefone, Simples/MEI e data da situação (BrasilAPI)', async () => {
    const rica = { ...BRASILAPI_CNPJ, cnaes_secundarios: [{ codigo: 4712100, descricao: 'x' }, { codigo: 4713002, descricao: 'y' }, { codigo: 4713002, descricao: 'y' }], porte: 'DEMAIS', natureza_juridica: 'Sociedade Empresária Limitada', opcao_pelo_simples: true, opcao_pelo_mei: false, data_situacao_cadastral: '2005-11-03' };
    const t = montar({ cnpj: [fonte('brasilapi', rica)], cep: [] });
    const r = await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    expect(r.corpo.sugestao).toMatchObject({ cnae_secundarios: ['4713002'], porte: 'DEMAIS', natureza_juridica: 'Sociedade Empresária Limitada', email: 'contato@acme.com.br', telefone: '9233334444', opcao_simples: true, opcao_mei: false, data_situacao_cadastral: '2005-11-03' });
    expect(JSON.stringify(t.repos.consultaExterna.consultas)).not.toMatch(/acme\.com\.br|9233334444/);
  });
  it('RF-CAD-02: mapeia os campos novos da fonte de reserva (receita-aberta)', async () => {
    const reserva = fonte('receita-aberta', { razao_social: 'ACME LTDA', porte: { descricao: 'Micro Empresa' }, natureza_juridica: { descricao: 'Empresário (Individual)' }, simples: { simples: 'Sim', mei: 'Não' }, estabelecimento: { atividade_principal: { id: '4712100' }, atividades_secundarias: [{ id: '4713002' }], email: 'a@b.com', ddd1: '92', telefone1: '33334444', data_situacao_cadastral: '2010-05-01', estado: { sigla: 'AM' }, cidade: { nome: 'Manaus' } } });
    const t = montar({ cnpj: [fonte('brasilapi', new Error('x')), reserva], cep: [] });
    const r = await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    expect(r.corpo.sugestao).toMatchObject({ cnae_secundarios: ['4713002'], porte: 'Micro Empresa', natureza_juridica: 'Empresário (Individual)', email: 'a@b.com', telefone: '9233334444', opcao_simples: true, opcao_mei: false, data_situacao_cadastral: '2010-05-01' });
  });
  it('RN-CAD-03: sem IBGE da fonte, resolve pela tabela oficial; sem achar, fica sem', async () => {
    const sem = { ...BRASILAPI_CNPJ, codigo_municipio_ibge: undefined };
    const t = montar({ cnpj: [fonte('brasilapi', sem)], cep: [] });
    t.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
    expect((await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`)).corpo.sugestao.endereco.municipio_ibge).toBe('1302603');
    const t2 = montar({ cnpj: [fonte('brasilapi', sem)], cep: [] });
    expect((await t2.chamar('GET', `/consultas/cnpj/${CNPJ_A}`)).corpo.sugestao.endereco.municipio_ibge).toBeUndefined();
  });
  it('a fonte recebe o timeout de 5 s', async () => {
    const principal = fonte('brasilapi', BRASILAPI_CNPJ);
    const t = montar({ cnpj: [principal], cep: [] });
    await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    expect(principal.chamadas).toEqual([{ chave: CNPJ_A, timeoutMs: 5000 }]);
  });
  it('RN-CAD-05: o cache nunca guarda quadro de sócios, e-mail, telefone nem CPF', async () => {
    const mei = { ...BRASILAPI_CNPJ, razao_social: 'JOSE DA SILVA 52998224725' };
    const t = montar({ cnpj: [fonte('brasilapi', mei)], cep: [] });
    const r = await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    const guardado = JSON.stringify(t.repos.consultaExterna.consultas);
    expect(guardado).toContain('JOSE DA SILVA');
    expect(guardado).not.toMatch(/FULANO|qsa|socio|acme\.com\.br|9233334444|52998224725/i);
    expect(JSON.stringify(r.corpo)).not.toMatch(/FULANO|52998224725/);
  });
  it('cache de 24 h: a segunda consulta não vai à fonte; depois de 24 h vai', async () => {
    const principal = fonte('brasilapi', BRASILAPI_CNPJ);
    const t = montar({ cnpj: [principal], cep: [] });
    await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    const dentro = await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    expect(dentro.corpo.fonte).toBe('cache');
    expect(principal.chamadas).toHaveLength(1);
    t.relogio.agora = new Date('2026-11-22T15:00:00Z');
    expect((await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`)).corpo.fonte).toBe('brasilapi');
    expect(principal.chamadas).toHaveLength(2);
  });
  it('usa a fonte de reserva quando a principal falha (tempo esgotado)', async () => {
    const principal = fonte('brasilapi', new Error('timeout'));
    const reserva = fonte('receita-aberta', { razao_social: 'ACME COMERCIO LTDA', estabelecimento: { nome_fantasia: 'ACME', situacao_cadastral: 'Ativa', tipo_logradouro: 'AVENIDA', logradouro: 'DJALMA BATISTA', numero: '100', bairro: 'CHAPADA', cep: '69050010', estado: { sigla: 'AM' }, cidade: { nome: 'Manaus', ibge_id: 1302603 } }, socios: [{ nome: 'X' }] });
    const t = montar({ cnpj: [principal, reserva], cep: [] });
    const r = await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`);
    expect(r.corpo).toMatchObject({ fonte: 'receita-aberta', sugestao: { razao_social: 'ACME COMERCIO LTDA', endereco: { uf: 'AM', municipio_ibge: '1302603' } } });
    expect(JSON.stringify(t.repos.consultaExterna.consultas)).not.toMatch(/socios/);
  });
  it('as duas fontes fora: 422 FONTE_INDISPONIVEL, sem cache e sem cadastro', async () => {
    const t = montar({ cnpj: [fonte('brasilapi', new Error('x')), fonte('receita-aberta', new Error('y'))], cep: [] });
    expect(await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`)).toMatchObject({ status: 422, corpo: { codigo: 'FONTE_INDISPONIVEL' } });
    expect(t.repos.consultaExterna.consultas).toHaveLength(0);
  });
  it('CNPJ não encontrado na fonte é 404; CNPJ inválido é 422 RN-CAD-01 e nem chama a fonte', async () => {
    const principal = fonte('brasilapi', null);
    const t = montar({ cnpj: [principal], cep: [] });
    expect((await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`)).status).toBe(404);
    principal.chamadas.length = 0;
    expect(await t.chamar('GET', '/consultas/cnpj/11222333000182')).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-01' } });
    expect(principal.chamadas).toHaveLength(0);
  });
  it('quem não edita cliente nem filial (vendedor, leitura) não consulta', async () => {
    const t = montar({ cnpj: [fonte('brasilapi', BRASILAPI_CNPJ)], cep: [] });
    expect((await t.chamar('GET', `/consultas/cnpj/${CNPJ_A}`, { sessao: sessaoDe('vendedor') })).status).toBe(403);
    expect((await t.chamar('GET', '/consultas/cep/69050010', { sessao: sessaoDe('leitura') })).status).toBe(403);
  });
});

describe('consulta de CEP (RF-CAD-02)', () => {
  it('ViaCEP primeiro, com sugestão normalizada e IBGE', async () => {
    const via = fonte('viacep', { cep: '69050-010', logradouro: 'Avenida Djalma Batista', complemento: '', bairro: 'Chapada', localidade: 'Manaus', uf: 'AM', ibge: '1302603' });
    const t = montar({ cnpj: [], cep: [via] });
    const r = await t.chamar('GET', '/consultas/cep/69050-010');
    expect(r.corpo).toMatchObject({ fonte: 'viacep', sugestao: { cep: '69050010', municipio: 'Manaus', municipio_ibge: '1302603', uf: 'AM', complemento: null } });
    expect(t.repos.consultaExterna.consultas[0]?.chave).toBe('69050010');
  });
  it('cai na BrasilAPI quando o ViaCEP falha; CEP malformado é 400', async () => {
    const t = montar({ cnpj: [], cep: [fonte('viacep', new Error('fora')), fonte('brasilapi', { cep: '69050010', state: 'AM', city: 'Manaus', neighborhood: 'Chapada', street: 'Av. Djalma Batista' })] });
    expect((await t.chamar('GET', '/consultas/cep/69050010')).corpo).toMatchObject({ fonte: 'brasilapi', sugestao: { uf: 'AM', municipio_ibge: null } });
    expect((await t.chamar('GET', '/consultas/cep/123')).status).toBe(400);
  });
});

describe('fontes HTTP', () => {
  it('estoura no tempo dado e a reserva assume (fetch falso que respeita o AbortSignal)', async () => {
    const buscaTravada = (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abortado'))));
    const [principal] = fontesHttp(buscaTravada as never).cnpj;
    await expect(principal?.consultar(CNPJ_A, { timeoutMs: 20 })).rejects.toThrow();
  });
  it('404 vira "não encontrado"; 5xx vira falha; ViaCEP {erro:true} vira "não encontrado"', async () => {
    const resp = (status: number, json: unknown) => async () => ({ ok: status < 400, status, json: async () => json });
    expect(await fontesHttp(resp(404, {}) as never).cnpj[0]?.consultar(CNPJ_A, { timeoutMs: 50 })).toBeNull();
    await expect(fontesHttp(resp(503, {}) as never).cnpj[0]?.consultar(CNPJ_A, { timeoutMs: 50 })).rejects.toThrow(/503/);
    expect(await fontesHttp(resp(200, { erro: true }) as never).cep[0]?.consultar('69050010', { timeoutMs: 50 })).toBeNull();
  });
  it('monta as URLs das fontes oficiais (BrasilAPI e ViaCEP) só com CNPJ ou CEP', async () => {
    const urls: string[] = [];
    const busca = async (u: string) => (urls.push(u), { ok: true, status: 200, json: async () => ({}) });
    const f = fontesHttp(busca as never);
    await f.cnpj[0]?.consultar(CNPJ_A, { timeoutMs: 50 });
    await f.cep[0]?.consultar('69050010', { timeoutMs: 50 });
    expect(urls).toEqual([`https://brasilapi.com.br/api/cnpj/v1/${CNPJ_A}`, 'https://viacep.com.br/ws/69050010/json/']);
  });
});

describe('consulta de IE (RF-CAD-03, D5)', () => {
  const corpo = (filial_id: string) => ({ filial_id, uf: 'AM', documento: '012345679' });
  async function comFilial(t: ReturnType<typeof montar>) {
    return (await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() })).corpo.id as string;
  }
  it('RN-CORE-06: filial sem A1 válido é 422 e nada é enfileirado', async () => {
    const t = montar({ cnpj: [], cep: [] }, false);
    const f = await comFilial(t);
    expect(await t.chamar('POST', '/consultas/ie', { sessao: sessaoDe('faturista'), corpo: corpo(f) })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CORE-06' } });
    expect(t.trabalhos).toHaveLength(0);
    expect(t.certificados.chamadas).toEqual([f]);
  });
  it('com A1 válido responde 202, enfileira cadastros.consultar_ie e o GET acompanha até concluir', async () => {
    const t = montar({ cnpj: [], cep: [] }, true);
    const f = await comFilial(t);
    const r = await t.chamar('POST', '/consultas/ie', { sessao: sessaoDe('faturista'), corpo: corpo(f) });
    expect(r.status).toBe(202);
    expect(t.trabalhos).toHaveLength(1);
    expect(t.trabalhos[0]).toMatchObject({ tipo: 'cadastros.consultar_ie', payload: { filial_id: f, uf: 'AM', documento: '012345679' } });
    expect((await t.chamar('GET', `/consultas/ie/${r.corpo.id}`)).corpo).toEqual({ id: r.corpo.id, estado: 'pendente', resultado: null });

    const executor = criarExecutorConsultaIe({
      repositorios: () => t.repos, agora: () => new Date('2026-11-21T15:01:00Z'),
      sefaz: { consultar: async () => ({ situacao: 'Habilitado', ie: '012345679' }) },
    });
    await executor.executar({ ...t.trabalhos[0]!, tenant_id: 'x', tentativas: 0 }, { consultar: async () => [] });
    const pronto = await t.chamar('GET', `/consultas/ie/${r.corpo.id}`);
    expect(pronto.corpo).toMatchObject({ estado: 'concluida', resultado: { situacao: 'Habilitado', ie: '012345679', consultado_em: '2026-11-21T15:01:00.000Z' } });
    expect(executor.tipo).toBe('cadastros.consultar_ie');
  });
  it('nunca consulta CPF; filial inexistente é 400; consulta inexistente é 404; vendedor não consulta', async () => {
    const t = montar({ cnpj: [], cep: [] }, true);
    const f = await comFilial(t);
    expect((await t.chamar('POST', '/consultas/ie', { sessao: adm, corpo: { ...corpo(f), documento: '529.982.247-25' } })).status).toBe(400);
    expect((await t.chamar('POST', '/consultas/ie', { sessao: adm, corpo: corpo('99999999-9999-4999-8999-999999999999') })).status).toBe(400);
    expect((await t.chamar('GET', '/consultas/ie/99999999-9999-4999-8999-999999999999')).status).toBe(404);
    expect((await t.chamar('POST', '/consultas/ie', { sessao: sessaoDe('vendedor'), corpo: corpo(f) })).status).toBe(403);
    expect(t.trabalhos).toHaveLength(0);
  });
});

describe('tabelas oficiais (RF-CAD-10)', () => {
  it('lista só as seis tabelas; outra é 404; todos os perfis leem', async () => {
    const t = montar({ cnpj: [], cep: [] });
    for (const tab of ['ncm', 'cest', 'cfop', 'cst', 'municipios', 'classificacao-tributaria']) {
      expect((await t.chamar('GET', `/oficiais/${tab}`, { sessao: sessaoDe('vendedor') })).status).toBe(200);
    }
    expect((await t.chamar('GET', '/oficiais/usuarios')).status).toBe(404);
    expect((await t.chamar('GET', '/oficiais/municipios', { consulta: { uf: 'AM', busca: 'manaus' } })).corpo).toEqual({ itens: [], proximo_cursor: null });
  });
});
