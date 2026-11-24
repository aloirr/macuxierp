/**
 * Consulta de cadastros para o faturamento (T-0021) com o adaptador em memória: cada método da porta, o inativo
 * devolvido, série diferente dando null e o município do endereço. O mesmo cenário roda no PostgreSQL em `consulta-faturamento.db.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarConsultaParaFaturamento } from './consulta-faturamento';
import { CNPJ_A, CNPJ_B, ENDERECO_AM, clienteValido, filialValida } from './fixtures-teste';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';

describe('consulta de cadastros para o faturamento (memória)', () => {
  const m = dependenciasEmMemoria();
  const consulta = criarConsultaParaFaturamento(m.deps.repositorios);
  const tx = { consultar: async () => [] };
  const adm = sessaoDe('administrador');
  const gerente = sessaoDe('gerente');
  const ids: Record<string, string> = {};
  let a: ReturnType<typeof criarAmbiente>;

  beforeAll(async () => {
    m.repos.oficiais.municipios.set('1302603', 'Manaus');
    m.repos.oficiais.municipios.set('1301902', 'Itacoatiara');
    a = criarAmbiente(criarPluginCadastros(m.deps));
    const post = async (rota: string, corpo: unknown, sessao = adm) => {
      const r = await a.chamar('POST', rota, { sessao, corpo });
      expect(r.status, rota).toBe(201);
      return r.corpo as { id: string };
    };
    ids.filial = (await post('/filiais', filialValida({ nfe_serie: 2, nfe_numero_inicial: 150 }))).id;
    ids.filialSemSerie = (await post('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false, nfe_serie: null, nfe_numero_inicial: null, ie: null }))).id;
    ids.condicao = (await post('/condicoes-pagamento', { codigo: '30D', descricao: '30 dias', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 }, gerente)).id;
    ids.cartao = (await post('/condicoes-pagamento', { codigo: 'CC3', descricao: 'Cartão 3x', forma_tpag: '03', prazos_dias: [30, 60, 90], prazo_medio_dias: 60 }, gerente)).id;
    ids.cliente = (await post('/clientes', clienteValido(ids.filial, {
      email_nfe: 'nfe@cliente.com.br', ind_ie_dest: '9', ie: null,
      enderecos: [{ ...ENDERECO_AM, tipo: 'entrega', numero: '1' }, { ...ENDERECO_AM, tipo: 'principal', numero: '2', municipio_ibge: '1301902' }],
    }))).id;
    ids.clienteSemEmail = (await post('/clientes', clienteValido(ids.filial, { documento: CNPJ_A }))).id;
  });

  it('filial: dados da nota com CRT numérico, endereço com o nome do município e sem pais_bacen', async () => {
    const f = await consulta.filial(tx, ids.filial as string);
    expect(f).toEqual({
      id: ids.filial, cnpj: CNPJ_A, razao_social: 'Thathyany Comercio Ltda', nome_fantasia: 'Thathyany', ie: '012345679', crt: 1, emissora: true, nfe_serie: 2,
      industrial_ipi: false, regime_pis_cofins: null,
      endereco: { logradouro: 'Av. Djalma Batista', numero: '100', complemento: null, bairro: 'Chapada', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69050010' },
    });
    expect(await consulta.filial(tx, randomUUID())).toBeNull();
  });

  it('filial: município fora da tabela do IBGE dá municipio_nome null; sem IE vira texto vazio; inativa também volta', async () => {
    m.repos.oficiais.municipios.delete('1302603');
    expect((await consulta.filial(tx, ids.filial as string))?.endereco.municipio_nome).toBeNull();
    m.repos.oficiais.municipios.set('1302603', 'Manaus');
    expect((await consulta.filial(tx, ids.filialSemSerie as string))?.ie).toBe('');
    expect((await a.chamar('DELETE', `/filiais/${ids.filialSemSerie}`, { sessao: adm })).status).toBeLessThan(300);
    expect(await consulta.filial(tx, ids.filialSemSerie as string)).toMatchObject({ id: ids.filialSemSerie, nfe_serie: null });
  });

  it('cliente: endereço principal (não o primeiro), município, indIEDest numérico e e-mail da NF-e; sem e-mail dá null', async () => {
    const c = await consulta.cliente(tx, ids.cliente as string);
    expect(c).toMatchObject({ id: ids.cliente, documento: CNPJ_B, nome: 'Cliente Exemplo Ltda', ind_ie_dest: 9, ie: null, email: 'nfe@cliente.com.br' });
    expect(c?.endereco).toMatchObject({ numero: '2', municipio_ibge: '1301902', municipio_nome: 'Itacoatiara' });
    expect(Object.keys(c as object).sort()).toEqual(['documento', 'email', 'endereco', 'id', 'ie', 'ind_ie_dest', 'nome']);
    expect(Object.keys(c?.endereco as object)).not.toContain('pais_bacen');
    expect((await consulta.cliente(tx, ids.clienteSemEmail as string))).toMatchObject({ ind_ie_dest: 1, email: null });
    expect(await consulta.cliente(tx, randomUUID())).toBeNull();
  });

  const post2 = async (documento = '44555666000181', email_nfe: string | null = null): Promise<string> => {
    const r = await a.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(ids.filial as string, { documento, email_nfe, ind_ie_dest: '2', ie: null }) });
    expect(r.status).toBe(201);
    return (r.corpo as { id: string }).id;
  };

  it('cliente sem endereço principal dá null; indIEDest 2 e CRT 3 saem como número', async () => {
    const c2 = await post2();
    expect(await consulta.cliente(tx, c2)).toMatchObject({ ind_ie_dest: 2 });
    for (const e of m.repos.clientes.enderecos.linhas) if (e.pai === c2) e.tipo = 'entrega';
    expect(await consulta.cliente(tx, c2)).toBeNull();
    const f3 = await a.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: '44555666000181', padrao: false, emissora: false, crt: '3', regime_pis_cofins: 'cumulativo' }) });
    expect(f3.status).toBe(201);
    expect((await consulta.filial(tx, (f3.corpo as { id: string }).id))?.crt).toBe(3);
  });

  it('RN-CAD-10: principal inativado pelo Substituir tudo com a entrega ativa devolve o principal e o email_nfe, nunca a entrega', async () => {
    const c = await post2('44555666000262', 'x@c.com.br');
    const ends = m.repos.clientes.enderecos.linhas.filter((e) => e.pai === c);
    m.repos.clientes.enderecos.linhas.push({ ...ends[0]!, id: randomUUID(), tipo: 'entrega', numero: '99', inativo: false });
    ends[0]!.inativo = true;
    const r = await consulta.cliente(tx, c);
    expect(r?.endereco).toMatchObject({ numero: ends[0]!.numero });
    expect(r?.email).toBe('x@c.com.br');
  });

  it('RN-CAD-10: cliente inativado com todos os endereços devolve o principal e o email_nfe', async () => {
    const c = await post2('44555666000343', 'y@c.com.br');
    for (const e of m.repos.clientes.enderecos.linhas) if (e.pai === c) e.inativo = true;
    expect((await a.chamar('DELETE', `/clientes/${c}`, { sessao: adm })).status).toBeLessThan(300);
    const r = await consulta.cliente(tx, c);
    expect(r).toMatchObject({ id: c, email: 'y@c.com.br' });
    expect(r?.endereco.logradouro).toBe(ENDERECO_AM.logradouro);
  });

  it('cliente inativo também volta', async () => {
    expect((await a.chamar('DELETE', `/clientes/${ids.clienteSemEmail}`, { sessao: adm })).status).toBeLessThan(300);
    expect((await consulta.cliente(tx, ids.clienteSemEmail as string))?.id).toBe(ids.clienteSemEmail);
  });

  it('condicao: tPag, prazos, parcelas do cartão e a classe da forma; inexistente dá null', async () => {
    expect(await consulta.condicao(tx, ids.condicao as string)).toEqual({ forma_tpag: '15', prazos_dias: [30, 60], parcelas_cartao: null, classe: 'boleto' });
    expect(await consulta.condicao(tx, ids.cartao as string)).toEqual({ forma_tpag: '03', prazos_dias: [30, 60, 90], parcelas_cartao: 3, classe: 'cartao' });
    expect(await consulta.condicao(tx, randomUUID())).toBeNull();
  });

  it('numeroInicial: o da filial quando a série confere; série diferente, filial sem série ou inexistente dá null', async () => {
    expect(await consulta.numeroInicial(tx, ids.filial as string, 2)).toBe(150);
    expect(await consulta.numeroInicial(tx, ids.filial as string, 1)).toBeNull();
    expect(await consulta.numeroInicial(tx, ids.filialSemSerie as string, 1)).toBeNull();
    expect(await consulta.numeroInicial(tx, randomUUID(), 2)).toBeNull();
  });
});
