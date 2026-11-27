import { describe, expect, it } from 'vitest';
import { MOTIVO_PRAZO_MEDIO_FAIXA } from '../domain';
import { criarPluginCadastros } from './index';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { CNPJ_A, CNPJ_B, ENDERECO_AM, clienteValido, filialValida, produtoValido } from './fixtures-teste';
import { dependenciasEmMemoria } from './memoria';

function montar(opcoes: Parameters<typeof dependenciasEmMemoria>[0] = {}) {
  const m = dependenciasEmMemoria(opcoes);
  const amb = criarAmbiente(criarPluginCadastros(m.deps));
  return { ...m, ...amb };
}
const adm = sessaoDe('administrador');
const gerente = sessaoDe('gerente');
const faturista = sessaoDe('faturista');

async function comFilial(t: ReturnType<typeof montar>) {
  const r = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() });
  expect(r.status).toBe(201);
  t.eventos.length = 0;
  t.auditoria.length = 0;
  return r.corpo.id as string;
}

describe('plugin', () => {
  it('declara só rotas do módulo, sem repetir método e caminho', () => {
    const { deps } = dependenciasEmMemoria();
    expect(() => criarPluginCadastros(deps)).not.toThrow();
  });
  it('RF-CAD-10: as tabelas oficiais são só leitura (nenhuma rota de escrita)', () => {
    const { deps } = dependenciasEmMemoria();
    const rotas = criarPluginCadastros(deps).rotas.filter((r) => r.caminho.startsWith('/oficiais'));
    expect(rotas.length).toBeGreaterThan(0);
    expect(rotas.every((r) => r.metodo === 'GET')).toBe(true);
  });
});

describe('filiais (RF-CAD-08)', () => {
  it('cria a filial, publica cadastros.filial.alterada@1 e audita (A)', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() });
    expect(r.status).toBe(201);
    expect(r.corpo.cnpj).toBe(CNPJ_A);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.filial.alterada@1', agregado_id: r.corpo.id, versao: 1, payload: { inativo: false, nfe_serie: 1 } });
    expect(t.auditoria[0]).toMatchObject({ acao: 'filial.criar', entidade: 'filial', entidade_id: r.corpo.id });
  });
  it('C-1: o evento da filial traz endereco.municipio_nome do IBGE', async () => {
    const t = montar();
    t.repos.oficiais.municipios.set('1302603', 'Manaus');
    await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() });
    expect(t.eventos[0]?.payload.endereco).toMatchObject({ municipio_ibge: '1302603', municipio_nome: 'Manaus' });
  });
  it('só o administrador edita filial', async () => {
    const t = montar();
    expect((await t.chamar('POST', '/filiais', { sessao: gerente, corpo: filialValida() })).status).toBe(403);
    expect((await t.chamar('GET', '/filiais', { sessao: sessaoDe('vendedor') })).status).toBe(200);
  });
  it('RN-CAD-01: CNPJ da filial com dígito errado é recusado (400)', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: '11222333000182' }) });
    expect(r.status).toBe(400);
  });
  it('RN-CAD-03: município de outra UF é 422 RN-CAD-03', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ endereco: { ...ENDERECO_AM, uf: 'SP' } }) });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-03' } });
  });
  it('RN-CAD-02: IE da filial com dígito errado é 422 RN-CAD-02', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ ie: '012345678' }) });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-02' } });
  });
  it('D8: série sem número inicial é 400 e a filial guarda só série e número inicial', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ nfe_numero_inicial: null }) });
    expect(r.status).toBe(400);
    expect(Object.keys(filialValida())).not.toContain('nfe_numero_atual');
  });
  it('CNPJ repetido é 409', async () => {
    const t = montar();
    await comFilial(t);
    expect((await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ padrao: false }) })).status).toBe(409);
  });
  it('RN-CAD-08: excluir inativa (nunca apaga) e publica o evento com inativo; a padrão não inativa', async () => {
    const t = montar();
    const padrao = await comFilial(t);
    expect(await t.chamar('DELETE', `/filiais/${padrao}`, { sessao: adm })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-08' } });
    const outra = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_B, padrao: false, ie: null, emissora: false, nfe_serie: null, nfe_numero_inicial: null }) });
    expect(outra.status).toBe(201);
    t.eventos.length = 0;
    const d = await t.chamar('DELETE', `/filiais/${outra.corpo.id}`, { sessao: adm });
    expect(d.corpo.inativo).toBe(true);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.filial.alterada@1', payload: { inativo: true } });
    expect((await t.chamar('GET', `/filiais/${outra.corpo.id}`, { sessao: adm })).status).toBe(200); // continua no banco
    const lista = await t.chamar('GET', '/filiais', { sessao: adm });
    expect(lista.corpo.itens.map((f: { id: string }) => f.id)).toEqual([padrao]);
  });
  it('RN-FIS-02: PATCH de CRT 3 com regime para CRT 1 sem limpar o regime é 422; com regime null é 200', async () => {
    const t = montar();
    const criada = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ crt: '3', regime_pis_cofins: 'nao_cumulativo' }) });
    expect(criada.status).toBe(201);
    const id = criada.corpo.id as string;
    expect(await t.chamar('PATCH', `/filiais/${id}`, { sessao: adm, corpo: { crt: '1' } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-FIS-02' } });
    const ok = await t.chamar('PATCH', `/filiais/${id}`, { sessao: adm, corpo: { crt: '1', regime_pis_cofins: null } });
    expect(ok.status).toBe(200);
    expect(ok.corpo).toMatchObject({ crt: '1', regime_pis_cofins: null });
  });
  it('RN-FIS-02: POST e PATCH dão 422 para CRT 3 sem regime (criar, trocar de CRT 1 para 3 e regime null)', async () => {
    const t = montar();
    const sem = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ crt: '3' }) });
    expect(sem).toMatchObject({ status: 422, corpo: { codigo: 'RN-FIS-02' } });
    expect((await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ crt: '3', regime_pis_cofins: null }) })).status).toBe(422);
    const c1 = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ crt: '1' }) });
    expect(c1.status).toBe(201);
    expect(await t.chamar('PATCH', `/filiais/${c1.corpo.id}`, { sessao: adm, corpo: { crt: '3' } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-FIS-02' } });
    const c3 = await t.chamar('PATCH', `/filiais/${c1.corpo.id}`, { sessao: adm, corpo: { crt: '3', regime_pis_cofins: 'cumulativo' } });
    expect(c3.status).toBe(200);
    expect(await t.chamar('PATCH', `/filiais/${c1.corpo.id}`, { sessao: adm, corpo: { regime_pis_cofins: null } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-FIS-02' } });
  });
  it('trocar a padrão desmarca a anterior', async () => {
    const t = montar();
    const a = await comFilial(t);
    const b = await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_B, ie: null, emissora: false, nfe_serie: null, nfe_numero_inicial: null }) });
    expect(b.corpo.padrao).toBe(true);
    expect((await t.chamar('GET', `/filiais/${a}`, { sessao: adm })).corpo.padrao).toBe(false);
  });
});

describe('localização do endereço do cliente (T-0096)', () => {
  const novo = async (lat: unknown, lon: unknown) => {
    const t = montar();
    const f = await comFilial(t);
    const r = await t.chamar('POST', '/clientes', { sessao: faturista, corpo: clienteValido(f, { enderecos: [{ ...ENDERECO_AM, tipo: 'principal', latitude: lat, longitude: lon }] }) });
    return { t, r };
  };
  it('T-0096: POST do cliente com coordenada válida devolve os valores', async () => {
    const { r } = await novo(-3.1, -60.02);
    expect(r.status).toBe(201);
    expect(r.corpo.enderecos[0]).toMatchObject({ latitude: -3.1, longitude: -60.02 });
  });
  it('T-0096: POST do cliente fora da faixa grava nulo, sem recusar', async () => {
    const { r } = await novo(95, -60);
    expect(r.status).toBe(201);
    expect(r.corpo.enderecos[0]).toMatchObject({ latitude: null, longitude: null });
  });
  it('T-0096: POST e PATCH do endereço normalizam; o PATCH reavalia o par com o valor gravado', async () => {
    const { t, r } = await novo(null, null);
    const base = `/clientes/${r.corpo.id}/enderecos`;
    const criado = await t.chamar('POST', base, { sessao: faturista, corpo: { ...ENDERECO_AM, tipo: 'entrega', latitude: -3.1, longitude: -60.02 } });
    expect(criado.status).toBe(201);
    expect(criado.corpo).toMatchObject({ latitude: -3.1, longitude: -60.02 });
    const fora = await t.chamar('POST', base, { sessao: faturista, corpo: { ...ENDERECO_AM, tipo: 'cobranca', latitude: 91, longitude: -60 } });
    expect(fora.corpo).toMatchObject({ latitude: null, longitude: null });
    const ok = await t.chamar('PATCH', `${base}/${criado.corpo.id}`, { sessao: faturista, corpo: { latitude: -10.5, longitude: -50.25 } });
    expect(ok.corpo).toMatchObject({ latitude: -10.5, longitude: -50.25 });
    const so1 = await t.chamar('PATCH', `${base}/${criado.corpo.id}`, { sessao: faturista, corpo: { longitude: 181 } });
    expect(so1.status).toBe(200);
    expect(so1.corpo).toMatchObject({ latitude: null, longitude: null });
    const semMexer = await t.chamar('PATCH', `${base}/${ok.corpo.id}`, { sessao: faturista, corpo: { numero: '999' } });
    expect(semMexer.corpo).toMatchObject({ numero: '999' });
  });
});

describe('clientes (RF-CAD-01)', () => {
  it('cria PJ com endereço, publica o evento com enderecos e vendedor_id', async () => {
    const t = montar();
    const f = await comFilial(t);
    const r = await t.chamar('POST', '/clientes', { sessao: faturista, corpo: clienteValido(f) });
    expect(r.status).toBe(201);
    expect(r.corpo.enderecos).toHaveLength(1);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.cliente.alterado@1', payload: { documento: CNPJ_B, vendedor_id: null, inativo: false } });
    expect((t.eventos[0]?.payload.enderecos as unknown[]).length).toBe(1);
  });
  it('C-1 e C-3: o evento do cliente traz enderecos[].id e municipio_nome (null se o IBGE não está na tabela oficial)', async () => {
    const t = montar();
    t.repos.oficiais.municipios.set('1302603', 'Manaus');
    const f = await comFilial(t);
    const r = await t.chamar('POST', '/clientes', { sessao: faturista, corpo: clienteValido(f) });
    const [end] = t.eventos[0]?.payload.enderecos as Record<string, unknown>[];
    expect(end).toMatchObject({ id: r.corpo.enderecos[0].id, municipio_ibge: '1302603', municipio_nome: 'Manaus', tipo: 'principal' });
    t.repos.oficiais.municipios.clear();
    t.eventos.length = 0;
    await t.chamar('POST', `/clientes/${r.corpo.id}/enderecos`, { sessao: adm, corpo: { ...ENDERECO_AM, tipo: 'entrega' } });
    expect((t.eventos[0]?.payload.enderecos as Record<string, unknown>[]).map((e) => e.municipio_nome)).toEqual([null, null]);
  });
  it('RN-CAD-01: CNPJ inválido (dígito) em cliente PJ é 422 RN-CAD-01; CPF válido em PF passa', async () => {
    const t = montar();
    const f = await comFilial(t);
    // passa no formato (14 dígitos) mas não no dígito verificador de PJ: mandamos um CPF no lugar do CNPJ
    const ruim = await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { documento: '52998224725' }) });
    expect(ruim).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-01' } });
    const pf = await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { tipo_pessoa: 'PF', documento: '529.982.247-25', ie: null, ind_ie_dest: '9' }) });
    expect(pf.status).toBe(201);
    expect(pf.corpo.documento).toBe('52998224725');
  });
  it('RN-CAD-02: contribuinte sem IE válida e não contribuinte com IE são 422', async () => {
    const t = montar();
    const f = await comFilial(t);
    expect(await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { ie: '012345678' }) })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-02' } });
    expect(await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { ind_ie_dest: '9' }) })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-02' } });
  });
  it('RN-CAD-03: endereço com município de outra UF é 422; sem endereço principal também', async () => {
    const t = montar();
    const f = await comFilial(t);
    const outraUf = clienteValido(f, { enderecos: [{ ...ENDERECO_AM, uf: 'SP', tipo: 'principal' }] });
    expect(await t.chamar('POST', '/clientes', { sessao: adm, corpo: outraUf })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-03' } });
    const semPrincipal = clienteValido(f, { enderecos: [{ ...ENDERECO_AM, tipo: 'entrega' }] });
    expect(await t.chamar('POST', '/clientes', { sessao: adm, corpo: semPrincipal })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-03' } });
  });
  it('limite de crédito: só administrador e gerente (faturista edita o cliente, mas não o limite)', async () => {
    const t = montar();
    const f = await comFilial(t);
    const cria = await t.chamar('POST', '/clientes', { sessao: faturista, corpo: clienteValido(f, { limite_credito_centavos: 100_000 }) });
    expect(cria.status).toBe(403);
    const ok = await t.chamar('POST', '/clientes', { sessao: gerente, corpo: clienteValido(f, { limite_credito_centavos: 100_000 }) });
    expect(ok.status).toBe(201);
    expect((await t.chamar('PATCH', `/clientes/${ok.corpo.id}`, { sessao: faturista, corpo: { limite_credito_centavos: 5 } })).status).toBe(403);
    expect((await t.chamar('PATCH', `/clientes/${ok.corpo.id}`, { sessao: faturista, corpo: { nome_fantasia: 'Novo' } })).status).toBe(200);
    // PATCH do faturista sem a chave mantém o limite gravado pelo gerente.
    expect((await t.chamar('GET', `/clientes/${ok.corpo.id}`, { sessao: gerente })).corpo.limite_credito_centavos).toBe(100_000);
    expect((await t.chamar('PATCH', `/clientes/${ok.corpo.id}`, { sessao: gerente, corpo: { limite_credito_centavos: 5 } })).corpo.limite_credito_centavos).toBe(5);
  });
  it('limite de crédito (A): a troca do limite é auditada, com só o campo; outra alteração do cliente não', async () => {
    const t = montar();
    const f = await comFilial(t);
    const ok = await t.chamar('POST', '/clientes', { sessao: gerente, corpo: clienteValido(f, { limite_credito_centavos: 100_000 }) });
    expect(t.auditoria.map((a) => a.acao)).toContain('cliente.limite_credito_centavos.alterar');
    t.auditoria.length = 0;
    await t.chamar('PATCH', `/clientes/${ok.corpo.id}`, { sessao: faturista, corpo: { nome_fantasia: 'Novo' } });
    expect(t.auditoria).toHaveLength(0);
    await t.chamar('PATCH', `/clientes/${ok.corpo.id}`, { sessao: gerente, corpo: { limite_credito_centavos: 5 } });
    expect(t.auditoria).toHaveLength(1);
    expect(t.auditoria[0]).toMatchObject({
      acao: 'cliente.limite_credito_centavos.alterar', entidade: 'cliente', entidade_id: ok.corpo.id,
      antes: { limite_credito_centavos: 100_000 }, depois: { limite_credito_centavos: 5 },
    });
  });
  it('escrita idempotente: o mesmo external_id devolve o cadastro existente sem duplicar nem republicar', async () => {
    const t = montar();
    const f = await comFilial(t);
    const a = await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { external_id: 'ext-1' }) });
    const b = await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { external_id: 'ext-1' }) });
    expect(b.status).toBe(200);
    expect(b.corpo.id).toBe(a.corpo.id);
    expect(t.eventos).toHaveLength(1);
  });
  describe('RN-CORE-05: external_id imutável (ADR 0010, item 3)', () => {
    async function com(ext: string | null = 'K1') {
      const t = montar();
      const f = await comFilial(t);
      const c = (await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, ext ? { external_id: ext } : {}) })).corpo.id as string;
      t.eventos.length = 0;
      t.auditoria.length = 0;
      return { t, f, c };
    }
    it('RN-CORE-05: preencher um external_id nulo pelo PATCH é livre e o evento traz external_id_anterior nulo', async () => {
      const { t, c } = await com(null);
      const r = await t.chamar('PATCH', `/clientes/${c}`, { sessao: adm, corpo: { external_id: 'K9' } });
      expect(r.status).toBe(200);
      expect(t.eventos[0]?.payload).toMatchObject({ external_id: 'K9', external_id_anterior: null });
    });
    it('RN-CORE-05: adotar pelo PATCH um external_id que outro registro já usa é 409', async () => {
      const { t, f, c } = await com(null);
      await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { external_id: 'K7', documento: CNPJ_A, tipo_pessoa: 'PJ', ie: null, ind_ie_dest: '9' }) });
      t.eventos.length = 0;
      expect((await t.chamar('PATCH', `/clientes/${c}`, { sessao: adm, corpo: { external_id: 'K7' } })).status).toBe(409);
      expect(t.eventos).toHaveLength(0);
    });
    it('RN-CORE-05: repetir o mesmo valor passa e não marca external_id_anterior', async () => {
      const { t, c } = await com();
      expect((await t.chamar('PATCH', `/clientes/${c}`, { sessao: adm, corpo: { external_id: 'K1' } })).status).toBe(200);
      expect(t.eventos[0]?.payload.external_id_anterior).toBeUndefined();
    });
    it('RN-CORE-05: trocar por outro valor ou por nulo pelo PATCH comum é 422 sem ecoar valores', async () => {
      const { t, c } = await com();
      for (const novo of ['K2', null]) {
        const r = await t.chamar('PATCH', `/clientes/${c}`, { sessao: adm, corpo: { external_id: novo } });
        expect(r.status).toBe(422);
        expect(r.corpo.codigo).toBe('RN-CORE-05');
        expect(JSON.stringify(r.corpo)).not.toContain('K1');
      }
      expect(t.eventos).toHaveLength(0);
    });
    it('RN-CORE-05: a troca controlada pelo administrador é 200, audita com o motivo e publica external_id_anterior', async () => {
      const { t, c } = await com();
      const r = await t.chamar('POST', `/clientes/${c}/external-id`, { sessao: adm, corpo: { external_id: 'K2', motivo: 'Correção da chave de origem' } });
      expect(r.status).toBe(200);
      expect(r.corpo.external_id).toBe('K2');
      expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.cliente.alterado@1', payload: { external_id: 'K2', external_id_anterior: 'K1' } });
      expect(t.auditoria[0]).toMatchObject({ acao: 'cliente.external_id.trocar', antes: { external_id: 'K1' }, depois: { external_id: 'K2', motivo: 'Correção da chave de origem' } });
    });
    it('RN-CORE-05: só o administrador troca (gerente 403) e o motivo é obrigatório', async () => {
      const { t, c } = await com();
      expect((await t.chamar('POST', `/clientes/${c}/external-id`, { sessao: gerente, corpo: { external_id: 'K2', motivo: 'x' } })).status).toBe(403);
      expect((await t.chamar('POST', `/clientes/${c}/external-id`, { sessao: adm, corpo: { external_id: 'K2' } })).status).toBe(400);
    });
    it('RN-CORE-05: a troca para o id de outro registro é 422 (RD-0317) e para external_id já usado é 409', async () => {
      const { t, f, c } = await com();
      const outro = (await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { external_id: 'K3', documento: CNPJ_A, tipo_pessoa: 'PJ', ie: null, ind_ie_dest: '9' }) })).corpo.id as string;
      const r = await t.chamar('POST', `/clientes/${c}/external-id`, { sessao: adm, corpo: { external_id: outro, motivo: 'x' } });
      expect(r.status).toBe(422);
      expect(r.corpo.codigo).toBe('RN-CORE-05');
      expect((await t.chamar('POST', `/clientes/${c}/external-id`, { sessao: adm, corpo: { external_id: 'K3', motivo: 'x' } })).status).toBe(409);
    });
    it('RN-CORE-05: a mesma regra vale nas outras entidades (produto)', async () => {
      const t = montar();
      t.repos.oficiais.ncms.add('22021000');
      const p = await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ external_id: 'P1' }) });
      expect(p.status).toBe(201);
      expect((await t.chamar('PATCH', `/produtos/${p.corpo.id}`, { sessao: adm, corpo: { external_id: 'P2' } })).status).toBe(422);
      const r = await t.chamar('POST', `/produtos/${p.corpo.id}/external-id`, { sessao: adm, corpo: { external_id: 'P2', motivo: 'Ajuste' } });
      expect(r.status).toBe(200);
    });
  });
  it('RN-CAD-01: documento repetido é 409', async () => {
    const t = montar();
    const f = await comFilial(t);
    await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f) });
    expect((await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f) })).status).toBe(409);
  });
  it('endereços e contatos: cria, edita e inativa; mudança de endereço republica o cliente', async () => {
    const t = montar();
    const f = await comFilial(t);
    const c = (await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f) })).corpo.id as string;
    t.eventos.length = 0;
    const end = await t.chamar('POST', `/clientes/${c}/enderecos`, { sessao: adm, corpo: { ...ENDERECO_AM, tipo: 'entrega', numero: '9' } });
    expect(end.status).toBe(201);
    expect(t.eventos[0]?.nome).toBe('cadastros.cliente.alterado@1');
    expect((t.eventos[0]?.payload.enderecos as unknown[]).length).toBe(2);
    expect((await t.chamar('POST', `/clientes/${c}/enderecos`, { sessao: adm, corpo: { ...ENDERECO_AM, uf: 'SP', tipo: 'cobranca' } })).status).toBe(422);
    const ct = await t.chamar('POST', `/clientes/${c}/contatos`, { sessao: adm, corpo: { nome: 'Maria', telefone: '92999990000' } });
    expect(ct.status).toBe(201);
    expect((await t.chamar('PATCH', `/clientes/${c}/contatos/${ct.corpo.id}`, { sessao: adm, corpo: { papel: 'compras' } })).corpo.papel).toBe('compras');
    expect((await t.chamar('DELETE', `/clientes/${c}/contatos/${ct.corpo.id}`, { sessao: adm })).status).toBe(200);
    expect((await t.chamar('GET', `/clientes/${c}/contatos`, { sessao: adm })).corpo.itens).toHaveLength(0);
  });
  it('perfil leitura não edita cliente', async () => {
    const t = montar();
    expect((await t.chamar('POST', '/clientes', { sessao: sessaoDe('leitura'), corpo: {} })).status).toBe(403);
  });
});

describe('carteira do vendedor (D7)', () => {
  async function cenario() {
    const t = montar();
    const f = await comFilial(t);
    const uA = '33333333-3333-4333-8333-333333333333';
    const uB = '44444444-4444-4444-8444-444444444444';
    const vA = (await t.chamar('POST', '/vendedores', { sessao: gerente, corpo: { codigo: 'V1', nome: 'Ana', filial_id: f, usuario_id: uA } })).corpo.id as string;
    const vB = (await t.chamar('POST', '/vendedores', { sessao: gerente, corpo: { codigo: 'V2', nome: 'Beto', filial_id: f, usuario_id: uB } })).corpo.id as string;
    const cA = (await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { vendedor_id: vA }) })).corpo.id as string;
    const cB = (await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { documento: CNPJ_A, vendedor_id: vB, razao_social: 'Outro Cliente' }) })).corpo.id as string;
    const semDono = (await t.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f, { documento: '04252011000110', razao_social: 'Sem Dono' }) })).corpo.id as string;
    t.eventos.length = 0;
    return { t, f, uA, uB, vA, vB, cA, cB, semDono };
  }
  it('RF-CAD-07: o vendedor vê só os clientes da própria carteira', async () => {
    const { t, uA, cA } = await cenario();
    const r = await t.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', uA) });
    expect(r.corpo.itens.map((c: { id: string }) => c.id)).toEqual([cA]);
    expect(r.corpo.proximo_cursor).toBeNull();
  });
  it('RF-CAD-07: o vendedor não abre cliente de outra carteira nem os endereços e contatos dele (404)', async () => {
    const { t, uA, cA, cB, semDono } = await cenario();
    const eu = sessaoDe('vendedor', uA);
    expect((await t.chamar('GET', `/clientes/${cA}`, { sessao: eu })).status).toBe(200);
    expect((await t.chamar('GET', `/clientes/${cB}`, { sessao: eu })).status).toBe(404);
    expect((await t.chamar('GET', `/clientes/${semDono}`, { sessao: eu })).status).toBe(404);
    expect((await t.chamar('GET', `/clientes/${cB}/enderecos`, { sessao: eu })).status).toBe(404);
    expect((await t.chamar('GET', `/clientes/${cB}/contatos`, { sessao: eu })).status).toBe(404);
  });
  it('RF-CAD-07: o filtro vendedor_id da URL não alarga o escopo do vendedor', async () => {
    const { t, uA, vB } = await cenario();
    const r = await t.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', uA), consulta: { vendedor_id: vB } });
    expect(r.corpo.itens).toEqual([]);
  });
  it('RF-CAD-07: usuário vendedor sem cadastro de vendedor não vê cliente nenhum', async () => {
    const { t } = await cenario();
    const r = await t.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', '55555555-5555-4555-8555-555555555555') });
    expect(r.corpo.itens).toEqual([]);
  });
  it('RF-CAD-07: gerente e administrador veem a carteira inteira', async () => {
    const { t } = await cenario();
    expect((await t.chamar('GET', '/clientes', { sessao: gerente })).corpo.itens).toHaveLength(3);
    expect((await t.chamar('GET', '/clientes', { sessao: adm })).corpo.itens).toHaveLength(3);
  });
  it('listas: paginação por cursor (limite, proximo_cursor e id > cursor), sem pagina, por_pagina nem total', async () => {
    const { t, cA, cB, semDono } = await cenario();
    const todos = [cA, cB, semDono].sort();
    const p1 = await t.chamar('GET', '/clientes', { sessao: adm, consulta: { limite: '2' } });
    expect(p1.corpo.itens.map((c: { id: string }) => c.id)).toEqual(todos.slice(0, 2));
    expect(p1.corpo.proximo_cursor).toBe(todos[1]);
    expect(p1.corpo).not.toHaveProperty('total');
    const p2 = await t.chamar('GET', '/clientes', { sessao: adm, consulta: { limite: '2', cursor: p1.corpo.proximo_cursor } });
    expect(p2.corpo).toMatchObject({ itens: [{ id: todos[2] }], proximo_cursor: null });
    expect((await t.chamar('GET', '/clientes', { sessao: adm, consulta: { limite: '201' } })).status).toBe(400);
    expect((await t.chamar('GET', '/clientes', { sessao: adm, consulta: { cursor: 'abc' } })).status).toBe(400);
  });
  it('D7: transferir carteira move os clientes, publica carteira e cliente, e audita', async () => {
    const { t, vA, vB, cA } = await cenario();
    const r = await t.chamar('POST', '/carteira/transferir', { sessao: gerente, corpo: { de: vA, para: vB } });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ de: vA, para: vB, total: 1, cliente_ids: [cA] });
    expect((await t.chamar('GET', `/clientes/${cA}`, { sessao: gerente })).corpo.vendedor_id).toBe(vB);
    expect(t.eventos.map((e) => e.nome)).toEqual(['cadastros.cliente.alterado@1', 'cadastros.carteira.alterada@1']);
    expect(t.eventos[0]?.payload.vendedor_id).toBe(vB);
    expect(t.eventos[1]).toMatchObject({ agregado_id: vB, payload: { de: vA, para: vB, cliente_ids: [cA] } });
    expect(t.auditoria[0]).toMatchObject({ acao: 'carteira.transferir', entidade: 'vendedor', entidade_id: vB });
  });
  it('D7: transferir exige adm ou gerente; origem igual ao destino é recusada; cliente fora da carteira também', async () => {
    const { t, vA, vB, cB } = await cenario();
    expect((await t.chamar('POST', '/carteira/transferir', { sessao: faturista, corpo: { de: vA, para: vB } })).status).toBe(403);
    expect((await t.chamar('POST', '/carteira/transferir', { sessao: gerente, corpo: { de: vA, para: vA } })).status).toBe(400);
    expect((await t.chamar('POST', '/carteira/transferir', { sessao: gerente, corpo: { de: vA, para: vB, cliente_ids: [cB] } })).status).toBe(400);
  });
});

describe('produtos (RF-CAD-04, RN-CAD-04)', () => {
  it('RN-CAD-04: NCM inexistente é 422; existente e sem ST, passa sem CEST', async () => {
    const t = montar();
    expect(await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-04' } });
    t.repos.oficiais.ncms.add('22021000');
    const r = await t.chamar('POST', '/produtos', { sessao: faturista, corpo: produtoValido() });
    expect(r.status).toBe(201);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.produto.alterado@1', payload: { custo_centavos: 450, unidades: [] } });
  });
  it('RN-CAD-04: NCM com ST exige CEST, e o CEST precisa ser do NCM', async () => {
    const t = montar();
    t.repos.oficiais.ncms.add('22021000');
    t.repos.oficiais.cests.set('22021000', ['0300100']);
    t.repos.oficiais.todosCests.add('0300100').add('0300200');
    expect(await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).toMatchObject({ status: 422, corpo: { campos: { cest: expect.any(String) } } });
    expect(await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300200' }) })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-04' } });
    expect((await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300100' }) })).status).toBe(201);
  });
  it('o custo não aparece para vendedor e leitura, mas aparece para quem edita produto', async () => {
    const t = montar();
    t.repos.oficiais.ncms.add('22021000');
    const id = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).corpo.id as string;
    expect((await t.chamar('GET', `/produtos/${id}`, { sessao: gerente })).corpo.custo_centavos).toBe(450);
    expect((await t.chamar('GET', `/produtos/${id}`, { sessao: sessaoDe('vendedor') })).corpo.custo_centavos).toBeNull();
    expect((await t.chamar('GET', '/produtos', { sessao: sessaoDe('leitura') })).corpo.itens[0].custo_centavos).toBeNull();
  });
  it('alterar a descrição não reconfere o NCM; mudar o NCM sim', async () => {
    const t = montar();
    t.repos.oficiais.ncms.add('22021000');
    const id = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).corpo.id as string;
    t.repos.oficiais.ncms.clear(); // o NCM saiu da vigência depois
    expect((await t.chamar('PATCH', `/produtos/${id}`, { sessao: adm, corpo: { descricao: 'Novo nome' } })).status).toBe(200);
    expect((await t.chamar('PATCH', `/produtos/${id}`, { sessao: adm, corpo: { ncm: '22021000' } })).status).toBe(422);
  });
  it('unidades: criar republica o produto com as unidades', async () => {
    const t = montar();
    t.repos.oficiais.ncms.add('22021000');
    const id = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).corpo.id as string;
    t.eventos.length = 0;
    const u = await t.chamar('POST', `/produtos/${id}/unidades`, { sessao: adm, corpo: { unidade: 'CX', fator: 120_000, ean: '7891234567895' } });
    expect(u.status).toBe(201);
    expect(t.eventos[0]?.payload.unidades).toHaveLength(1);
    expect((await t.chamar('POST', `/produtos/${id}/unidades`, { sessao: adm, corpo: { unidade: 'CX', fator: 0 } })).status).toBe(400);
  });
  it('RN-CAD-17: fator fracionário só em KG e M (422 no campo fator); no PATCH também', async () => {
    const t = montar();
    t.repos.oficiais.ncms.add('22021000');
    const id = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).corpo.id as string;
    const recusada = await t.chamar('POST', `/produtos/${id}/unidades`, { sessao: adm, corpo: { unidade: 'CX', fator: 15_000 } });
    expect(recusada).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-17' } });
    expect(JSON.stringify(recusada.corpo)).toContain('fator');
    expect((await t.chamar('POST', `/produtos/${id}/unidades`, { sessao: adm, corpo: { unidade: 'KG', fator: 15_000 } })).status).toBe(201);
    const cx = (await t.chamar('POST', `/produtos/${id}/unidades`, { sessao: adm, corpo: { unidade: 'CX', fator: 120_000 } })).corpo.id as string;
    expect((await t.chamar('PATCH', `/produtos/${id}/unidades/${cx}`, { sessao: adm, corpo: { fator: 125_000 } })).status).toBe(422);
  });
});

describe('tabelas de preço (RF-CAD-05, RN-CAD-06)', () => {
  async function cenario() {
    const t = montar();
    const f1 = await comFilial(t);
    const f2 = (await t.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_B, ie: null, emissora: false, nfe_serie: null, nfe_numero_inicial: null, padrao: false }) })).corpo.id as string;
    t.repos.oficiais.ncms.add('22021000');
    const p = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).corpo.id as string;
    const tab = (await t.chamar('POST', '/tabelas-preco', { sessao: gerente, corpo: { nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31' } })).corpo.id as string;
    t.eventos.length = 0;
    t.auditoria.length = 0;
    return { t, f1, f2, p, tab };
  }
  it('só administrador e gerente editam preço; criar a tabela é auditado (A)', async () => {
    const t = montar();
    expect((await t.chamar('POST', '/tabelas-preco', { sessao: faturista, corpo: { nome: 'X', vigencia_inicio: '2026-01-01' } })).status).toBe(403);
    await t.chamar('POST', '/tabelas-preco', { sessao: gerente, corpo: { nome: 'X', vigencia_inicio: '2026-01-01' } });
    expect(t.auditoria[0]?.acao).toBe('tabela_preco.criar');
  });
  it('RN-CAD-06: fim de vigência antes do início é 422', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/tabelas-preco', { sessao: gerente, corpo: { nome: 'X', vigencia_inicio: '2026-05-01', vigencia_fim: '2026-04-01' } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-06' } });
  });
  it('ADR 0010: o PUT de itens ignora external_id no corpo e o evento preco.alterado mantém a chave gravada pela carga', async () => {
    const { t, f1, p, tab } = await cenario();
    await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f1, produto_id: p, preco_centavos: 1000 }] } });
    await t.repos.carga.gravarItemPreco({ tabelaId: tab, filialId: f1, produtoId: p, preco_centavos: 1000, desconto_maximo_bp: 0, desconto_herdado: true, externalId: 'PR-1', inativo: false });
    t.eventos.length = 0;
    const r = await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f1, produto_id: p, preco_centavos: 1500, external_id: 'OUTRA' }] } });
    expect(r.corpo).toEqual({ recebidos: 1, alterados: 1 });
    expect(t.eventos).toHaveLength(1);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.preco.alterado@1', payload: { preco_centavos: 1500, external_id: 'PR-1' } });
  });
  it('PUT em lote grava e publica um evento por item alterado; repetir o mesmo lote não publica nada', async () => {
    const { t, f1, f2, p, tab } = await cenario();
    const itens = [{ filial_id: f1, produto_id: p, preco_centavos: 1000, desconto_maximo_bp: 500 }, { filial_id: f2, produto_id: p, preco_centavos: 1200 }];
    const r = await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens } });
    expect(r.corpo).toEqual({ recebidos: 2, alterados: 2 });
    expect(t.eventos).toHaveLength(2);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.preco.alterado@1', payload: { preco_centavos: 1000, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', inativo: false } });
    expect(t.auditoria[0]).toMatchObject({ acao: 'tabela_preco.itens_lote', depois: { recebidos: 2, alterados: 2 } });
    t.eventos.length = 0;
    expect((await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens } })).corpo.alterados).toBe(0);
    expect(t.eventos).toHaveLength(0);
    const lista = await t.chamar('GET', `/tabelas-preco/${tab}/itens`, { sessao: sessaoDe('leitura') });
    expect(lista.corpo).toMatchObject({ itens: [{ preco_centavos: expect.any(Number), id: expect.any(String) }, {}], proximo_cursor: null });
    const p1 = await t.chamar('GET', `/tabelas-preco/${tab}/itens`, { sessao: sessaoDe('leitura'), consulta: { limite: '1' } });
    expect(p1.corpo.itens).toHaveLength(1);
    const p2 = await t.chamar('GET', `/tabelas-preco/${tab}/itens`, { sessao: sessaoDe('leitura'), consulta: { limite: '1', cursor: p1.corpo.proximo_cursor } });
    expect(p2.corpo.itens).toHaveLength(1);
    expect(p2.corpo.itens[0].id).not.toBe(p1.corpo.itens[0].id);
    expect(p2.corpo.proximo_cursor).toBeNull();
  });
  it('PUT em lote aceita 5.000 itens e recusa 5.001 (400)', async () => {
    const { t, f1, tab } = await cenario();
    const gera = (n: number) => Array.from({ length: n }, (_, i) => ({ filial_id: f1, produto_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, preco_centavos: 1, desconto_maximo_bp: 0 }));
    expect((await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: gera(5001) } })).status).toBe(400);
    // 5.000 itens passam no esquema; produtos inexistentes caem na checagem de referência (400), nunca em 5.001
    const cinco = await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: gera(5000) } });
    expect(cinco.corpo.campos).toEqual({ produto_id: 'Produto inexistente' });
  });
  it('RN-CAD-06: produto repetido na mesma filial dentro do lote é 422', async () => {
    const { t, f1, p, tab } = await cenario();
    const i = { filial_id: f1, produto_id: p, preco_centavos: 1, desconto_maximo_bp: 0 };
    expect(await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: [i, i] } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-06' } });
  });
  it('RN-CAD-06: preço vigente da filial, com queda na filial padrão e erro fora da vigência', async () => {
    const { t, f1, f2, p, tab } = await cenario();
    await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f1, produto_id: p, preco_centavos: 1000 }] } });
    const consulta = { produto_id: p, filial_id: f2, tabela_preco_id: tab, data: '2026-06-01' };
    const r = await t.chamar('GET', '/precos/vigente', { sessao: sessaoDe('vendedor'), consulta });
    expect(r.corpo).toMatchObject({ preco_centavos: 1000, origem_filial_id: f1, filial_id: f1 });
    await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f2, produto_id: p, preco_centavos: 1300 }] } });
    expect((await t.chamar('GET', '/precos/vigente', { sessao: adm, consulta })).corpo).toMatchObject({ preco_centavos: 1300, origem_filial_id: f2 });
    expect(await t.chamar('GET', '/precos/vigente', { sessao: adm, consulta: { ...consulta, data: '2027-02-01' } })).toMatchObject({ status: 404, corpo: { codigo: 'FORA_DA_VIGENCIA' } });
  });
  it('mudar a vigência da tabela republica os itens', async () => {
    const { t, f1, p, tab } = await cenario();
    await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f1, produto_id: p, preco_centavos: 1000 }] } });
    t.eventos.length = 0;
    await t.chamar('PATCH', `/tabelas-preco/${tab}`, { sessao: gerente, corpo: { vigencia_fim: '2027-06-30' } });
    const precos = t.eventos.filter((e) => e.nome === 'cadastros.preco.alterado@1');
    expect(precos).toHaveLength(1);
    expect(precos[0]?.payload.vigencia_fim).toBe('2027-06-30');
  });
  it('C-2: a criação e a alteração da tabela publicam cadastros.tabela_preco.alterada@1 (agregado = tabela)', async () => {
    const t = montar();
    const criada = await t.chamar('POST', '/tabelas-preco', { sessao: gerente, corpo: { nome: 'Atacado', vigencia_inicio: '2026-01-01' } });
    expect(t.eventos).toHaveLength(1);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.tabela_preco.alterada@1', agregado_id: criada.corpo.id, versao: 1, payload: { id: criada.corpo.id, nome: 'Atacado', inativo: false } });
    t.eventos.length = 0;
    await t.chamar('PATCH', `/tabelas-preco/${criada.corpo.id}`, { sessao: gerente, corpo: { nome: 'Atacado 2' } });
    expect(t.eventos).toHaveLength(1);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.tabela_preco.alterada@1', agregado_id: criada.corpo.id, payload: { nome: 'Atacado 2' } });
  });
});

describe('estoque (RF-CAD-06, RN-CAD-07)', () => {
  async function cenario() {
    const t = montar();
    const f = await comFilial(t);
    t.repos.oficiais.ncms.add('22021000');
    const p = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).corpo.id as string;
    t.eventos.length = 0;
    return { t, f, p };
  }
  it('D-05: GET /estoque segue o contrato de listas: { itens, proximo_cursor }, limite, cursor e busca', async () => {
    const { t, f, p } = await cenario();
    const p2 = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ codigo: 'P2', descricao: 'Guaraná lata' }) })).corpo.id as string;
    for (const prod of [p, p2]) await t.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: { filial_id: f, produto_id: prod, tipo: 'entrada', quantidade: 5_0000, motivo: 'Compra' } });
    const um = await t.chamar('GET', '/estoque', { sessao: sessaoDe('leitura'), consulta: { limite: 1 } });
    expect(Object.keys(um.corpo).sort()).toEqual(['itens', 'proximo_cursor']);
    expect(um.corpo.itens).toHaveLength(1);
    expect(um.corpo.proximo_cursor).toBe(um.corpo.itens[0].id);
    const dois = await t.chamar('GET', '/estoque', { sessao: sessaoDe('leitura'), consulta: { limite: 1, cursor: um.corpo.proximo_cursor } });
    expect(dois.corpo.itens).toHaveLength(1);
    expect(dois.corpo.itens[0].id).not.toBe(um.corpo.itens[0].id);
    expect(dois.corpo.proximo_cursor).toBeNull();
    const achado = await t.chamar('GET', '/estoque', { sessao: sessaoDe('leitura'), consulta: { busca: 'guaraná' } });
    expect(achado.corpo.itens.map((i: { produto_id: string }) => i.produto_id)).toEqual([p2]);
  });
  it('entrada e saída atualizam o saldo (× 10^4) e publicam cadastros.estoque.alterado@1', async () => {
    const { t, f, p } = await cenario();
    const e = await t.chamar('POST', '/estoque/movimentos', { sessao: faturista, corpo: { filial_id: f, produto_id: p, tipo: 'entrada', quantidade: 100_0000, motivo: 'Compra' } });
    expect(e).toMatchObject({ status: 201, corpo: { quantidade: 100_0000 } });
    const s = await t.chamar('POST', '/estoque/movimentos', { sessao: faturista, corpo: { filial_id: f, produto_id: p, tipo: 'saida', quantidade: 30_0000, motivo: 'Perda' } });
    expect(s.corpo.quantidade).toBe(70_0000);
    expect(t.eventos[1]).toMatchObject({ nome: 'cadastros.estoque.alterado@1', payload: { filial_id: f, produto_id: p, quantidade: 70_0000 } });
    expect((await t.chamar('GET', '/estoque', { sessao: sessaoDe('leitura'), consulta: { filial_id: f } })).corpo.itens[0].quantidade).toBe(70_0000);
  });
  it('RN-CAD-17: movimento fracionário em produto de unidade UN é 422 no campo quantidade', async () => {
    const { t, f, p } = await cenario();
    const r = await t.chamar('POST', '/estoque/movimentos', { sessao: faturista, corpo: { filial_id: f, produto_id: p, tipo: 'entrada', quantidade: 1_5000, motivo: 'Compra' } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-17' } });
    expect(JSON.stringify(r.corpo)).toContain('quantidade');
  });
  it('RN-CAD-17: PATCH que troca a unidade comercial para uma sem fração, com saldo fracionário, é 422 no campo unidade_comercial', async () => {
    const { t, f } = await cenario();
    const kg = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ codigo: 'P-KG', unidade_comercial: 'KG', unidade_tributavel: 'KG' }) })).corpo.id as string;
    await t.chamar('POST', '/estoque/movimentos', { sessao: faturista, corpo: { filial_id: f, produto_id: kg, tipo: 'entrada', quantidade: 1_5000, motivo: 'Compra' } });
    const r = await t.chamar('PATCH', `/produtos/${kg}`, { sessao: adm, corpo: { unidade_comercial: 'UN' } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-17' } });
    expect(JSON.stringify(r.corpo)).toContain('unidade_comercial');
    expect((await t.chamar('PATCH', `/produtos/${kg}`, { sessao: adm, corpo: { unidade_comercial: 'M' } })).status).toBe(200); // M também aceita fração
  });
  it('RN-CAD-17: PATCH da unidade comercial com saldo inteiro passa', async () => {
    const { t, f } = await cenario();
    const kg = (await t.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ codigo: 'P-KG', unidade_comercial: 'KG', unidade_tributavel: 'KG' }) })).corpo.id as string;
    await t.chamar('POST', '/estoque/movimentos', { sessao: faturista, corpo: { filial_id: f, produto_id: kg, tipo: 'entrada', quantidade: 2_0000, motivo: 'Compra' } });
    expect((await t.chamar('PATCH', `/produtos/${kg}`, { sessao: adm, corpo: { unidade_comercial: 'UN' } })).status).toBe(200);
  });
  it('RN-CAD-07: o faturista não deixa o saldo negativo; o gerente deixa', async () => {
    const { t, f, p } = await cenario();
    const saida = { filial_id: f, produto_id: p, tipo: 'saida', quantidade: 1_0000, motivo: 'Venda' };
    expect(await t.chamar('POST', '/estoque/movimentos', { sessao: faturista, corpo: saida })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-07' } });
    expect((await t.chamar('POST', '/estoque/movimentos', { sessao: gerente, corpo: saida })).corpo.quantidade).toBe(-1_0000);
  });
  it('escrita idempotente: o mesmo external_id não lança de novo', async () => {
    const { t, f, p } = await cenario();
    const mov = { filial_id: f, produto_id: p, tipo: 'entrada', quantidade: 5_0000, motivo: 'Inventário', external_id: 'mov-1' };
    const a = await t.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: mov });
    const b = await t.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: mov });
    expect(b.status).toBe(200);
    expect(b.corpo.quantidade).toBe(5_0000);
    expect(a.status).toBe(201);
    expect(t.eventos).toHaveLength(1);
  });
  it('vendedor não movimenta estoque; filial ou produto inexistente é 400', async () => {
    const { t, f, p } = await cenario();
    expect((await t.chamar('POST', '/estoque/movimentos', { sessao: sessaoDe('vendedor'), corpo: { filial_id: f, produto_id: p, tipo: 'entrada', quantidade: 1, motivo: 'x' } })).status).toBe(403);
    const lixo = '99999999-9999-4999-8999-999999999999';
    expect((await t.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: { filial_id: lixo, produto_id: p, tipo: 'entrada', quantidade: 1, motivo: 'x' } })).status).toBe(400);
  });
});

describe('condições de pagamento (RF-CAD-09)', () => {
  it('cria, valida prazos e publica o evento; gerente edita, faturista não', async () => {
    const t = montar();
    const corpo = { codigo: '30/60', descricao: '30 e 60 dias', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 };
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: faturista, corpo })).status).toBe(403);
    const r = await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo });
    expect(r.status).toBe(201);
    expect(t.eventos[0]).toMatchObject({ nome: 'cadastros.condicao_pagamento.alterada@1', payload: { prazos_dias: [30, 60], prazo_medio_dias: 45, inativo: false } });
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, codigo: 'X', prazos_dias: [] } })).status).toBe(400);
    expect((await t.chamar('GET', '/condicoes-pagamento', { sessao: sessaoDe('vendedor') })).corpo.itens).toHaveLength(1);
  });

  it('RN-CAD-15 (decisões 14 A e 17 B): vazio na criação é calculado; fora de 0 a 365 é 400; no PATCH, calculado recalcula e digitado fica', async () => {
    const t = montar();
    const corpo = { codigo: 'P1', descricao: 'Prazo 1', forma_tpag: '15', prazos_dias: [30] };
    const sem = await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, codigo: 'PV', prazos_dias: [30, 45] } });
    expect(sem).toMatchObject({ status: 201, corpo: { prazo_medio_dias: 38, prazo_medio_calculado: true } });
    expect(t.eventos.at(-1)).toMatchObject({ payload: { prazo_medio_dias: 38 } });
    const zero = await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, codigo: 'PZ', prazos_dias: [0, 60], prazo_medio_dias: 0 } });
    expect(zero.corpo).toMatchObject({ prazo_medio_dias: 0, prazo_medio_calculado: false });
    // PATCH (a conta e os casos da marca estão no domain): calculado recalcula; digitado fica
    const id1 = (sem.corpo as { id: string }).id;
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id1}`, { sessao: gerente, corpo: { prazos_dias: [30, 90] } })).corpo).toMatchObject({ prazo_medio_dias: 60, prazo_medio_calculado: true });
    const id0 = (zero.corpo as { id: string }).id;
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id0}`, { sessao: gerente, corpo: { prazos_dias: [0, 120] } })).corpo).toMatchObject({ prazo_medio_dias: 0, prazo_medio_calculado: false });
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, prazo_medio_dias: 366 } })).status).toBe(400);
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, prazo_medio_dias: -1 } })).status).toBe(400);
    const id = ((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, prazo_medio_dias: 30 } })).corpo as { id: string }).id;
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { descricao: 'Prazo um' } })).corpo).toMatchObject({ prazo_medio_dias: 30, descricao: 'Prazo um' });
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazos_dias: [30, 60], prazo_medio_dias: 45 } })).corpo).toMatchObject({ prazo_medio_dias: 45 });
  });

  it('RN-CAD-15 (T-0112): POST e PATCH fora da faixa das parcelas dão 422; PATCH vazio sobre um gravado fora da faixa dá 200; DELETE inativa', async () => {
    const t = montar();
    const corpo = { codigo: 'FX', descricao: 'Faixa', forma_tpag: '15', prazos_dias: [28, 56] };
    const fora = await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, prazo_medio_dias: 57 } });
    expect(fora.status).toBe(422);
    expect(fora.corpo).toMatchObject({ codigo: 'RN-CAD-15', campos: { prazo_medio_dias: MOTIVO_PRAZO_MEDIO_FAIXA } });
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...corpo, prazo_medio_dias: 56 } })).status).toBe(201);
    const id = (await t.repos.condicoesPagamento.inserir({ codigo: 'FG', descricao: 'Fora', forma_tpag: '15', prazos_dias: [28, 56], parcelas_cartao: null, prazo_medio_dias: 90 } as never) as { id: string }).id;
    const p = await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazo_medio_dias: 57 } });
    expect(p.status).toBe(422);
    expect(p.corpo).toMatchObject({ codigo: 'RN-CAD-15', campos: { prazo_medio_dias: MOTIVO_PRAZO_MEDIO_FAIXA } });
    // RN-CAD-15 (v0.3.18): sem mudar parcelas nem prazo médio (só a descrição, p.ex.), a faixa não é conferida, como na carga
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { descricao: 'Outra' } })).status).toBe(200);
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { forma_tpag: '03' } })).status).toBe(200);
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: {} })).status).toBe(200);
    expect((await t.chamar('DELETE', `/condicoes-pagamento/${id}`, { sessao: gerente })).status).toBe(200);
    expect((await t.chamar('GET', `/condicoes-pagamento/${id}`, { sessao: gerente })).corpo).toMatchObject({ inativo: true, prazo_medio_dias: 90 });
  });

  it('RN-CAD-15: descrição em branco é 422 no campo descricao', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'P1', descricao: '   ', forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30 } });
    expect([400, 422]).toContain(r.status);
    expect(JSON.stringify(r.corpo)).toContain('descricao');
  });

  it('RN-CAD-15: legado sem prazo médio aceita PATCH que não toca no prazo médio e o completa quando o campo vem', async () => {
    const t = montar();
    const velho = (await t.repos.condicoesPagamento.inserir({ codigo: 'L1', descricao: 'Legado', forma_tpag: '15', prazos_dias: [30], parcelas_cartao: null, prazo_medio_dias: null } as never)) as { id: string };
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${velho.id}`, { sessao: gerente, corpo: { descricao: 'Legado 30' } })).corpo).toMatchObject({ prazo_medio_dias: null });
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${velho.id}`, { sessao: gerente, corpo: { prazo_medio_dias: 30 } })).corpo).toMatchObject({ prazo_medio_dias: 30 });
  });

  it('RN-CAD-15: forma à vista com parcela maior que 0 ou prazo médio diferente de 0 é 422 na criação e na alteração (resultado mesclado)', async () => {
    const t = montar();
    const base = { codigo: 'AV', descricao: 'À vista', forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 0 };
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...base, codigo: 'AV2', prazos_dias: [0, 30] } }))).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-15' } });
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...base, codigo: 'AV3', prazo_medio_dias: 5 } }))).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-15' } });
    expect((await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...base, codigo: 'BO', forma_tpag: '15', prazos_dias: [0] } })).status).toBe(201);
    const criada = await t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: base });
    expect(criada.status).toBe(201);
    const id = (criada.corpo as { id: string }).id;
    expect(await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazos_dias: [30] } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-15' } });
    expect((await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30 } })).status).toBe(200);
    expect(await t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { forma_tpag: '17' } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-15' } });
  });
});

describe('RN-CAD-09 nas rotas: classe da forma', () => {
  const post = (t: ReturnType<typeof montar>, corpo: Record<string, unknown>) => t.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { descricao: 'D', prazo_medio_dias: 30, ...corpo } });
  const forma = { forma_external_id: 'f1' };

  it('RN-CAD-09 (emenda RN-CAD-15): cartão tem os dias digitados; 1 e 12 parcelas passam; 13 e parcelas vazias são recusadas; parcelas_cartao é derivada', async () => {
    const t = montar();
    expect((await post(t, { codigo: 'C3', forma_tpag: '03', prazos_dias: [7, 21, 45], ...forma })).corpo).toMatchObject({ prazos_dias: [7, 21, 45], parcelas_cartao: 3 });
    expect((await post(t, { codigo: 'C1', forma_tpag: '03', prazos_dias: [30] })).corpo).toMatchObject({ prazos_dias: [30], parcelas_cartao: 1 });
    expect((await post(t, { codigo: 'C12', forma_tpag: '03', prazos_dias: Array(12).fill(30) })).status).toBe(201);
    expect(await post(t, { codigo: 'C13', forma_tpag: '03', prazos_dias: Array(13).fill(30) })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-09' } });
    expect((await post(t, { codigo: 'CS', forma_tpag: '03', parcelas_cartao: 3 })).status).toBe(400);
  });

  it('RN-CAD-09: débito [0] passa; parcelas_cartao fora do cartão é ignorada (derivada nula); cheque e tPag 99 são recusados', async () => {
    const t = montar();
    expect((await post(t, { codigo: 'D0', forma_tpag: '04', prazos_dias: [0], prazo_medio_dias: 0 })).status).toBe(201);
    expect((await post(t, { codigo: 'B3', forma_tpag: '15', prazos_dias: [30], parcelas_cartao: 3 })).corpo).toMatchObject({ parcelas_cartao: null });
    const ch = await post(t, { codigo: 'CH', forma_tpag: '02', prazos_dias: [0] });
    expect(ch).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-09' } });
    expect(JSON.stringify(ch.corpo)).toContain('forma não aceita: use Dinheiro, PIX, Cartão ou Boleto');
    expect((await post(t, { codigo: 'N', forma_tpag: '99', prazos_dias: [0] })).status).toBe(422);
  });

  it('RN-CAD-09: PATCH valida o MESCLADO e deriva parcelas_cartao: trocar 03 para 15 zera; mudar os dias do cartão muda as parcelas', async () => {
    const t = montar();
    const id = (await post(t, { codigo: 'C3', forma_tpag: '03', prazos_dias: [30, 60, 90] })).corpo.id as string;
    const patch = (corpo: Record<string, unknown>) => t.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo });
    expect((await patch({ prazos_dias: [7, 14], prazo_medio_dias: 10 })).corpo).toMatchObject({ prazos_dias: [7, 14], parcelas_cartao: 2 });
    expect((await patch({ prazos_dias: Array(13).fill(30) })).status).toBe(422);
    expect((await patch({ forma_tpag: '15' })).corpo).toMatchObject({ forma_tpag: '15', parcelas_cartao: null });
    expect(t.eventos.at(-1)).toMatchObject({ nome: 'cadastros.condicao_pagamento.alterada@1', payload: { parcelas_cartao: null } });
  });

  it('RN-CAD-09: POST /condicoes-pagamento/desativar-formas-recusadas: administrador 200 com contagem e ids, gerente 403, idempotente, só as recusadas e o cartão sem parcelas (RN-CAD-09 emendada pela RN-CAD-15: dias digitados como [7,21,45] preenchem, não desativam)', async () => {
    const t = montar();
    const ok = (await post(t, { codigo: 'OK', forma_tpag: '15', prazos_dias: [30] })).corpo.id as string;
    // condições antigas (anteriores à regra) gravadas direto no repositório
    const velhas = await Promise.all(['02', '16', '99'].map((f, i) => t.repos.condicoesPagamento.inserir({ codigo: `V${i}`, descricao: 'Velha', forma_tpag: f, prazos_dias: [0], parcelas_cartao: null } as never)));
    // cartão ativo sem parcelas: prazos válidos (1 a 12 parcelas, dias digitados, RN-CAD-09 emendada pela RN-CAD-15) preenchem; fora disso desativa
    const preencher = (await t.repos.condicoesPagamento.inserir({ codigo: 'K3', descricao: 'K', forma_tpag: '03', prazos_dias: [30, 60, 90], parcelas_cartao: null } as never)) as { id: string };
    const cartaoRuim = (await t.repos.condicoesPagamento.inserir({ codigo: 'K7', descricao: 'K', forma_tpag: '03', prazos_dias: Array(13).fill(30), parcelas_cartao: null } as never)) as { id: string };
    const preencherDias = (await t.repos.condicoesPagamento.inserir({ codigo: 'K8', descricao: 'K', forma_tpag: '03', prazos_dias: [7, 21, 45], parcelas_cartao: null } as never)) as { id: string };
    t.eventos.length = 0;
    t.auditoria.length = 0;
    const rota = '/condicoes-pagamento/desativar-formas-recusadas';
    expect((await t.chamar('POST', rota, { sessao: gerente })).status).toBe(403);
    expect((await t.chamar('POST', rota, { sessao: faturista })).status).toBe(403);
    const r = await t.chamar('POST', rota, { sessao: adm });
    expect(r.status).toBe(200);
    expect(r.corpo.desativadas.total).toBe(4);
    expect([...r.corpo.desativadas.ids].sort()).toEqual([...velhas.map((v) => (v as { id: string }).id), cartaoRuim.id].sort());
    expect(r.corpo.preenchidas).toEqual({ total: 2, ids: [preencher.id, preencherDias.id] });
    expect(r.corpo.desativadas.ids).not.toContain(preencherDias.id);
    expect(t.auditoria.filter((a) => a.acao === 'condicao_pagamento.inativar')).toHaveLength(4);
    expect(t.auditoria.filter((a) => a.acao === 'condicao_pagamento.preencher_parcelas')).toHaveLength(2);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.inativo === true)).toHaveLength(4);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.id === preencher.id && e.payload.parcelas_cartao === 3)).toHaveLength(1);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.id === preencherDias.id && e.payload.parcelas_cartao === 3)).toHaveLength(1);
    expect((await t.chamar('GET', `/condicoes-pagamento/${ok}`, { sessao: adm })).corpo.inativo).toBe(false);
    expect((await t.chamar('POST', rota, { sessao: adm })).corpo).toEqual({ desativadas: { total: 0, ids: [] }, preenchidas: { total: 0, ids: [] } });
  });
});

