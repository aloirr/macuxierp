/**
 * T-0008 (a): RN de cadastros de ponta a ponta na API real (`criarApp` + plugins de core e cadastros, repositórios em
 * memória). Só o que os testes do dono não cobrem pelo HTTP: o CNPJ alfanumérico pela rota (RN-CAD-01), o IBGE de 6
 * dígitos recusado pelo Zod (RN-CAD-03) e o `?inativos=true` depois da inativação (RN-CAD-08). O resto das RN de
 * cadastros está em modules/cadastros/api/rotas.test.ts, consultas.test.ts e modules/cadastros/domain/*.test.ts
 * (ver docs/testes/T-0008.md).
 */
import { describe, expect, it } from 'vitest';
import { ENDERECO_AM, clienteValido, filialValida } from '../../../modules/cadastros/api/fixtures-teste';
import { usarApiMemoria, type ApiMemoria } from '../../apoio/api-memoria';

const api = usarApiMemoria();
const URL = '/v1/cadastros';

async function post(a: ApiMemoria, caminho: string, payload: unknown) {
  return a.app.inject({ method: 'POST', url: `${URL}${caminho}`, headers: a.auth(), payload: payload as object });
}
async function comFilial(a: ApiMemoria) {
  const r = await post(a, '/filiais', filialValida());
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

describe('RN-CAD-01: CNPJ pelo dígito verificador', () => {
  it('RN-CAD-01: CNPJ alfanumérico (regra da Receita, 2026) é aceito pela rota; com DV errado, recusado', async () => {
    const a = await api();
    const f = await comFilial(a);
    const pj = (doc: string) => clienteValido(f, { documento: doc });
    expect((await post(a, '/clientes', pj('12.ABC.345/01DE-35'))).statusCode).toBe(201);
    expect((await post(a, '/clientes', pj('12ABC34501DE36'))).statusCode).not.toBe(201);
  });
});

describe('RN-CAD-03: município pelo IBGE', () => {
  it('RN-CAD-03: IBGE de 6 dígitos é recusado na entrada pelo Zod (400)', async () => {
    const a = await api();
    const r = await post(a, '/filiais', filialValida({ endereco: { ...ENDERECO_AM, municipio_ibge: '130260' } }));
    expect(r.statusCode).toBe(400);
  });
});

describe('RN-CAD-08: exclusão = inativação', () => {
  it('RN-CAD-08: o cliente inativado sai da lista padrão e volta com ?inativos=true', async () => {
    const a = await api();
    const f = await comFilial(a);
    const c = (await post(a, '/clientes', clienteValido(f))).json().id as string;
    expect((await a.app.inject({ method: 'DELETE', url: `${URL}/clientes/${c}`, headers: a.auth() })).statusCode).toBe(200);
    expect((await a.app.inject({ method: 'GET', url: `${URL}/clientes`, headers: a.auth() })).json().total).toBe(0);
    const inativos = await a.app.inject({ method: 'GET', url: `${URL}/clientes?inativos=true`, headers: a.auth() });
    expect(inativos.json().total).toBe(1);
  });
});
