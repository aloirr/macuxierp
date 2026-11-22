import type { Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { RepositorioCoreSql } from './repositorio-sql';

/**
 * Forma do SQL (sem banco): o teste contra o schema `core` (`*.db.test.ts`) entra quando o adaptador PostgreSQL da API
 * (T-0004b) estiver no main. Aqui se garante o que não pode regredir: o app nunca seleciona o cifrado (ADR 0005) e
 * toda inserção usa o tenant da sessão, nunca um valor vindo do chamador.
 */
function gravador() {
  const chamadas: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Transacao = {
    consultar: async <L,>(sql: string, params: readonly unknown[] = []) => {
      chamadas.push({ sql, params });
      return [{ id: 'x', n: '0' }] as unknown as L[];
    },
  };
  return { tx, chamadas };
}

describe('repositório SQL do core', () => {
  it('ADR 0005: as leituras de certificado nunca listam as colunas cifradas', async () => {
    const { tx, chamadas } = gravador();
    await new RepositorioCoreSql().certificados(tx);
    await new RepositorioCoreSql().certificados(tx, 'f');
    for (const c of chamadas) {
      expect(c.sql).not.toMatch(/pfx|senha|nonce|SELECT \*/i);
    }
  });

  it('RLS: as inserções usam plataforma.tenant_atual() e nenhuma recebe tenant_id por parâmetro', async () => {
    const { tx, chamadas } = gravador();
    const r = new RepositorioCoreSql();
    const agora = new Date('2026-11-21T15:00:00Z');
    await r.criarUsuario(tx, { id: 'u', nome: 'N', email: 'e@x.test', perfil: 'leitura', filial_ids: [], ativo: true, external_id: null, senha_hash: '$argon2id$x' });
    await r.substituirCertificado(tx, { id: 'c', filial_id: 'f', titular: 't', cnpj: '1', valido_de: agora, valido_ate: agora, impressao_digital: 'a', pfx_cifrado: Buffer.alloc(1), pfx_nonce: Buffer.alloc(12), senha_cifrada: Buffer.alloc(1), senha_nonce: Buffer.alloc(12), chave_versao: 1 }, agora);
    await r.gravarAmbiente(tx, { filial_id: 'f', ambiente: 'homologacao', recado_aprovacao: null, alterado_por: 'u' });
    await r.criarExportacao(tx, 'e', 'u');
    await r.gravarParametro(tx, 'a.b', { x: 1 });
    const inserts = chamadas.filter((c) => /INSERT INTO/.test(c.sql));
    expect(inserts).toHaveLength(5);
    for (const i of inserts) expect(i.sql).toContain('plataforma.tenant_atual()');
  });

  it('RF-CORE-01/02: com token, a condição updated_at vai no próprio UPDATE e sem linha afetada devolve null (409)', async () => {
    const chamadas: { sql: string; params: readonly unknown[] }[] = [];
    const tx: Transacao = {
      consultar: async <L,>(sql: string, params: readonly unknown[] = []) => {
        chamadas.push({ sql, params });
        return [] as L[];
      },
    };
    const token = new Date('2026-11-21T15:00:00.123Z');
    const agora = new Date('2026-11-21T15:00:00Z');
    const r = new RepositorioCoreSql();
    await expect(r.atualizarUsuario(tx, 'u', { nome: 'N' }, agora, token)).resolves.toBeNull();
    await expect(r.atualizarEmpresa(tx, { razao_social: 'R', nome_fantasia: null, ie: null, fuso: 'America/Manaus' }, agora, token)).resolves.toBeNull();
    for (const c of chamadas) {
      expect(c.sql).toMatch(/UPDATE[\s\S]*WHERE[\s\S]*date_trunc\('milliseconds', updated_at\) = date_trunc\('milliseconds', \$\d::timestamptz\)/);
      expect(c.params.at(-1)).toBe(token);
    }
  });

  it('RN-CORE-01: trava os administradores ativos com SELECT ... FOR UPDATE ordenado por id', async () => {
    const { tx, chamadas } = gravador();
    await new RepositorioCoreSql().travarAdministradoresAtivos(tx);
    expect(chamadas[0]?.sql).toMatch(/perfil = 'administrador' AND ativo ORDER BY id FOR UPDATE/);
  });

  it('RN-CORE-01: contar administradores exclui o próprio usuário e só conta os ativos', async () => {
    const { tx, chamadas } = gravador();
    await expect(new RepositorioCoreSql().contarAdministradoresAtivos(tx, 'u')).resolves.toBe(0);
    expect(chamadas[0]?.sql).toMatch(/perfil = 'administrador' AND ativo AND id <> \$1/);
    expect(chamadas[0]?.params).toEqual(['u']);
  });

  it('busca da lista escapa curingas do LIKE', async () => {
    const { tx, chamadas } = gravador();
    await new RepositorioCoreSql().listarUsuarios(tx, { limite: 10, busca: '50%_a', inativos: false });
    expect(chamadas[0]?.params[2]).toBe('50\\%\\_a');
  });
});
