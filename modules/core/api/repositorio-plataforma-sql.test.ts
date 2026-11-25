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
