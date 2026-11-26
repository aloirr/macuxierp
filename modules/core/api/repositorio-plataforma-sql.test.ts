import { DETALHE_CODIGO_RESERVADO, ErroApi, MENSAGEM_CODIGO_RESERVADO, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { RepositorioPlataformaSql } from './repositorio-plataforma-sql';

const txQueLanca = (code: string, message: string): Transacao => ({
  consultar: async () => {
    throw Object.assign(new Error(message), { code });
  },
});
const criar = (tx: Transacao) => new RepositorioPlataformaSql().criarEmpresa(tx, { slug: 'am2808', uf: 'AM', nome: 'Xis', fuso: 'America/Manaus', request_id: 'r' });

const ID = '00000000-0000-4000-8000-0000000000e1';
describe('adaptador SQL da plataforma: ficha da Receita (0063)', () => {
  const repo = new RepositorioPlataformaSql();
  const gravar = (tx: Transacao) => repo.gravarReceita(tx, { id: ID, ficha: {} as never, request_id: 'r' });
  const revelar = (tx: Transacao) => repo.revelarContato(tx, { id: ID, campo: 'email', request_id: 'r' });

  it.each([
    ['23514', 422],
    ['22001', 422],
    ['P0002', 404],
    ['55000', 409],
  ])('SQLSTATE %s vira HTTP %i com mensagem fixa, sem o texto do banco', async (code, status) => {
    for (const f of [gravar, revelar]) {
      const e = await f(txQueLanca(code, 'valor@pessoal.com.br')).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroApi);
      expect((e as ErroApi).status).toBe(status);
      expect(JSON.stringify([(e as ErroApi).message, (e as ErroApi).campos])).not.toContain('pessoal');
    }
  });

  it('MXS01 e erro desconhecido seguem sem conversão (a apps/api mapeia a sessão inválida em 401)', async () => {
    const e = await gravar(txQueLanca('MXS01', 'sessao')).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(ErroApi);
    expect((e as { code: string }).code).toBe('MXS01');
  });

  it('lê a ficha da chave `ficha` do empresa_ler e a tira do objeto da empresa', async () => {
    const tx: Transacao = { consultar: (async () => [{ e: { id: ID, nome: 'X', ficha: { uf: 'AM' } } }]) as never };
    const r = await repo.lerEmpresaComFicha(tx, ID);
    expect(r).toEqual({ empresa: { id: ID, nome: 'X' }, ficha: { uf: 'AM' } });
  });

  it('T-0106: uma query só para as duas funções (0066) e a ficha sai com a descrição e o nome', async () => {
    const chamadas: { sql: string; p: readonly unknown[] }[] = [];
    const ficha = { municipio_ibge: '1302603', uf: 'AM', cnae_principal: '0111301', cnae_secundarios: ['4712100'] };
    const tx: Transacao = {
      consultar: (async (sql: string, p: readonly unknown[] = []) => {
        chamadas.push({ sql, p });
        return sql.includes('empresa_ler')
          ? [{ e: { id: ID, nome: 'X', ficha } }]
          : [{ c: [{ codigo: '0111301', descricao: 'CULTIVO DE ARROZ' }], m: [{ codigo: '1302603', nome: 'Manaus', uf: 'AM' }] }];
      }) as never,
    };
    const lida = await repo.lerEmpresaComFicha(tx, ID);
    expect(chamadas).toHaveLength(1); // RD-2153: ler para decidir (Revelar, /receita) não descreve
    expect(lida?.ficha).toEqual(ficha);
    chamadas.length = 0;
    const r = { ficha: await repo.descreverFicha(tx, ficha as never) };
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.sql).toContain('plataforma.cnae_descricoes');
    expect(chamadas[0]!.sql).toContain('plataforma.municipio_nomes');
    expect(chamadas[0]!.p).toEqual([['0111301', '4712100'], ['1302603']]);
    expect(r.ficha).toMatchObject({ cnae_principal: '0111301', cnae_principal_descricao: 'CULTIVO DE ARROZ', municipio_nome: 'Manaus', cnae_secundarios_descritos: [{ codigo: '4712100', descricao: null }] });
  });

  it('T-0106: sem ficha não há consulta extra; lerEmpresa também descreve a ficha do detalhe', async () => {
    let n = 0;
    const tx: Transacao = { consultar: (async () => (n++, [{ e: { id: ID, nome: 'X', ficha: null } }])) as never };
    expect(await repo.lerEmpresa(tx, ID)).toEqual({ id: ID, nome: 'X', ficha: null });
    expect(n).toBe(1);
  });
});

describe('adaptador SQL da plataforma: empresa_criar (0037)', () => {
  it.each([
    ['uf invalida', 'uf', 'UF inválida'],
    ['uf difere do codigo', 'uf', 'A UF precisa ser a do código'],
    ['slug reservado', 'codigo', 'Código inválido'],
    ['fuso desconhecido', 'fuso', 'Fuso desconhecido'],
  ])("RN-CORE-11: 23514 '%s' vira 422 no campo %s com mensagem fixa", async (msg, campo, texto) => {
    const e = await criar(txQueLanca('23514', msg)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-11' });
    expect((e as ErroApi).campos).toEqual({ [campo]: texto });
  });

  it('RN-CORE-11: 23514 com DETAIL codigo_reservado_superadmin (0049) vira a mensagem do SDK no campo codigo', async () => {
    const tx: Transacao = {
      consultar: async () => {
        throw Object.assign(new Error('check violation'), { code: '23514', detail: DETALHE_CODIGO_RESERVADO });
      },
    };
    const e = await criar(tx).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-11' });
    expect((e as ErroApi).campos).toEqual({ codigo: MENSAGEM_CODIGO_RESERVADO });
  });

  it('RN-CORE-11: 23505 (repetido ou sorteio sem vaga) vira null', async () => {
    expect(await criar(txQueLanca('23505', 'duplicate'))).toBeNull();
  });
});
