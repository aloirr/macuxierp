import { describe, expect, it } from 'vitest';
import { MENSAGEM_FILIAL_DO_USUARIO, UsuarioCriar, UsuarioCriarCorpo, UsuarioEditar, UsuarioEditarCorpo } from './index';

const base = { nome: 'Pessoa Teste', email: 'pessoa@exemplo.test', perfil: 'gerente' as const };
const F = '11111111-1111-4111-8111-111111111111';

describe('RN-CORE-40: contratos do usuário e o mínimo de uma filial', () => {
  it('o schema de cliente recusa filial vazia com o texto da regra; o corpo da API deixa passar para o domain devolver 422', () => {
    const r = UsuarioCriar.safeParse({ ...base, filial_ids: [] });
    expect(r.success ? '' : r.error.issues[0]?.message).toBe(MENSAGEM_FILIAL_DO_USUARIO);
    expect(UsuarioEditar.safeParse({ filial_ids: [] }).success).toBe(false);
    expect(UsuarioCriarCorpo.safeParse({ ...base, filial_ids: [] }).success).toBe(true);
    expect(UsuarioCriarCorpo.parse(base).filial_ids).toEqual([]);
    expect(UsuarioEditarCorpo.safeParse({ filial_ids: [] }).success).toBe(true);
  });
  it('editar sem o campo filial_ids é válido nos dois; com uma filial também', () => {
    expect(UsuarioEditar.safeParse({ nome: 'Nome Novo' }).success).toBe(true);
    expect(UsuarioEditarCorpo.parse({ nome: 'Nome Novo' })).not.toHaveProperty('filial_ids');
    expect(UsuarioCriar.safeParse({ ...base, filial_ids: [F] }).success).toBe(true);
  });
});
