import { ErroApi, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { RepositorioPlataformaSql } from './repositorio-plataforma-sql';

const txQueLanca = (code: string, message: string): Transacao => ({
  consultar: async () => {
    throw Object.assign(new Error(message), { code });
  },
});
const criar = (tx: Transacao) => new RepositorioPlataformaSql().criarEmpresa(tx, { slug: 'am2808', uf: 'AM', nome: 'Xis', fuso: 'America/Manaus', request_id: 'r' });

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

  it('RN-CORE-11: 23505 (repetido ou sorteio sem vaga) vira null', async () => {
    expect(await criar(txQueLanca('23505', 'duplicate'))).toBeNull();
  });
});
