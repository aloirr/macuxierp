import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AlterarModulosEntrada,
  CABECALHOS_SENHA_PROVISORIA,
  CriarEmpresaEntrada,
  EmailUsuario,
  EmpresaPlataforma,
  EntrarPlataformaEntrada,
  EuPlataforma,
  PADRAO_SLUG_EMPRESA,
  PrimeiroAdminEntrada,
  PrimeiroAdminResposta,
  SessaoPlataformaResposta,
  SituacaoEmpresaEntrada,
  TrocarSenhaPlataformaEntrada,
  conferirModulosPlataforma,
  modulosAtivosApos,
} from './portal-config';

const ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const AGORA = '2026-11-23T12:00:00.000Z';

/** Os `depende` dos manifestos (modules/<id>/manifest.ts): o SDK recebe por parâmetro, não importa módulo. */
const MANIFESTOS = [
  { id: 'core', depende: [] },
  { id: 'cadastros', depende: ['core'] },
  { id: 'pedido', depende: ['core', 'cadastros'] },
  { id: 'fiscal', depende: ['core', 'cadastros'] },
  { id: 'faturamento', depende: ['core', 'cadastros', 'pedido', 'fiscal'] },
  { id: 'integracao-fdv', depende: ['core', 'cadastros'] },
] as const;

const empresa = {
  id: ID,
  slug: 'thathyany',
  nome: 'Empresa Teste Ltda',
  fuso: 'America/Manaus',
  situacao: 'ativo',
  modulos: [{ modulo: 'core', ativo: true, valido_ate: null }],
  primeiro_admin: null,
  created_at: AGORA,
  updated_at: AGORA,
};

describe('contratos do portal /config (ADR 0012)', () => {
  it('PADRAO_SLUG_EMPRESA é a mesma regex do CHECK do slug em db/migrations/0002_plataforma.sql', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0002_plataforma.sql', import.meta.url), 'utf8');
    const m = /slug text NOT NULL UNIQUE CHECK \(slug ~ '([^']+)'\)/.exec(sql);
    expect(m, 'CHECK do slug não encontrado em 0002_plataforma.sql').not.toBeNull();
    expect(PADRAO_SLUG_EMPRESA.source).toBe(m?.[1]);
  });

  it('EmailUsuario: aparado, minúsculo e até 254', () => {
    expect(EmailUsuario.parse('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com');
    expect(() => EmailUsuario.parse(`${'a'.repeat(250)}@x.co`)).toThrow();
    expect(() => EmailUsuario.parse('sem-arroba')).toThrow();
  });

  it('CriarEmpresaEntrada: slug no CHECK de plataforma.tenant (0002), nome de 2 a 120 aparado, fuso padrão Manaus', () => {
    expect(CriarEmpresaEntrada.parse({ slug: 'acme-1', nome: '  ACME Ltda ' })).toEqual({ slug: 'acme-1', nome: 'ACME Ltda', fuso: 'America/Manaus' });
    for (const slug of ['A', 'acme_1', '-acme', 'a', 'x'.repeat(41), 'Acme']) expect(() => CriarEmpresaEntrada.parse({ slug, nome: 'ACME' }), slug).toThrow();
    expect(() => CriarEmpresaEntrada.parse({ slug: 'referencia', nome: 'ACME' })).toThrow();
    expect(() => CriarEmpresaEntrada.parse({ slug: 'acme', nome: 'A' })).toThrow();
    expect(() => CriarEmpresaEntrada.parse({ slug: 'acme', nome: 'ACME', fuso: 'Manaus' })).toThrow();
  });

  it('EmpresaPlataforma: só ativo, suspenso ou encerrado (o tenant de referência nunca aparece); 1º admin sem e-mail nem nome', () => {
    expect(EmpresaPlataforma.parse(empresa).situacao).toBe('ativo');
    expect(() => EmpresaPlataforma.parse({ ...empresa, situacao: 'referencia' })).toThrow();
    const comAdmin = EmpresaPlataforma.parse({ ...empresa, primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false, email: 'a@b.c' } });
    expect(comAdmin.primeiro_admin).toEqual({ id: ADMIN, ativo: true, bloqueado: false });
    expect(() => EmpresaPlataforma.parse({ ...empresa, modulos: [{ modulo: 'compras', ativo: true, valido_ate: null }] })).toThrow();
  });

  it('AlterarModulosEntrada: módulo conhecido, sem repetição e sem desligar o core (MODULOS_BASE)', () => {
    expect(AlterarModulosEntrada.parse({ modulos: [{ modulo: 'fiscal', ativo: true }] }).modulos[0]).toEqual({ modulo: 'fiscal', ativo: true, valido_ate: null });
    expect(() => AlterarModulosEntrada.parse({ modulos: [] })).toThrow();
    expect(() => AlterarModulosEntrada.parse({ modulos: [{ modulo: 'compras', ativo: true }] })).toThrow();
    expect(() => AlterarModulosEntrada.parse({ modulos: [{ modulo: 'fiscal', ativo: true }, { modulo: 'fiscal', ativo: false }] })).toThrow();
    expect(() => AlterarModulosEntrada.parse({ modulos: [{ modulo: 'core', ativo: false }] })).toThrow();
    expect(() => AlterarModulosEntrada.parse({ modulos: [{ modulo: 'fiscal', ativo: true, valido_ate: '23/11/2026' }] })).toThrow();
  });

  it('PrimeiroAdminEntrada: e-mail normalizado (minúsculas, aparado) como o CHECK de plataforma.usuario; nome padrão "Administrador"', () => {
    expect(PrimeiroAdminEntrada.parse({ email: '  Admin@Acme.COM.br ' })).toEqual({ email: 'admin@acme.com.br', nome: 'Administrador' });
    expect(() => PrimeiroAdminEntrada.parse({ email: 'sem-arroba' })).toThrow();
    expect(() => PrimeiroAdminEntrada.parse({ email: 'a@b.co', nome: 'A' })).toThrow();
  });

  it('PrimeiroAdminResposta: a senha provisória sai uma vez, com Cache-Control no-store; nunca o hash', () => {
    const r = PrimeiroAdminResposta.parse({ usuario_id: ADMIN, senha_provisoria: 'Ab3$Ab3$Ab3$Ab3$', senha_hash: '$argon2id$x' });
    expect(r).toEqual({ usuario_id: ADMIN, senha_provisoria: 'Ab3$Ab3$Ab3$Ab3$' });
    expect(() => PrimeiroAdminResposta.parse({ usuario_id: ADMIN, senha_provisoria: 'curta' })).toThrow();
    expect(CABECALHOS_SENHA_PROVISORIA['cache-control']).toBe('no-store');
  });

  it('SituacaoEmpresaEntrada: só suspender ou reativar (encerrar fica fora do portal), com motivo curto', () => {
    expect(SituacaoEmpresaEntrada.parse({ situacao: 'suspenso', motivo: ' inadimplência ' }).motivo).toBe('inadimplência');
    expect(() => SituacaoEmpresaEntrada.parse({ situacao: 'encerrado', motivo: 'fim do contrato' })).toThrow();
    expect(() => SituacaoEmpresaEntrada.parse({ situacao: 'suspenso', motivo: 'x' })).toThrow();
    expect(() => SituacaoEmpresaEntrada.parse({ situacao: 'suspenso', motivo: 'x'.repeat(201) })).toThrow();
  });

  it('login, troca de senha, sessão e "eu" do superadmin: sem token no corpo (o token vai só no cookie)', () => {
    expect(EntrarPlataformaEntrada.parse({ email: ' Ops@Macuxi.com.br ', senha: 'x' }).email).toBe('ops@macuxi.com.br');
    expect(() => EntrarPlataformaEntrada.parse({ email: 'ops@macuxi.com.br', senha: '' })).toThrow();
    expect(() => TrocarSenhaPlataformaEntrada.parse({ senha_atual: 'a', senha_nova: 'curta' })).toThrow();
    expect(TrocarSenhaPlataformaEntrada.parse({ senha_atual: 'a', senha_nova: 'x'.repeat(14) }).senha_nova).toHaveLength(14);
    expect(SessaoPlataformaResposta.parse({ expira_em: AGORA, token: 'abc' })).toEqual({ expira_em: AGORA });
    const eu = EuPlataforma.parse({ superadmin: { id: ADMIN, nome: 'Operação' }, deve_trocar_senha: true, sessao_expira_em: AGORA });
    expect(eu.deve_trocar_senha).toBe(true);
    expect(() => EuPlataforma.parse({ ...eu, sessao_expira_em: 'amanhã' })).toThrow();
  });
});

describe('conferirModulosPlataforma (RN-CORE-02: o `depende` dos manifestos)', () => {
  const atuais = [
    { modulo: 'core', ativo: true, valido_ate: null },
    { modulo: 'cadastros', ativo: true, valido_ate: null },
    { modulo: 'pedido', ativo: true, valido_ate: null },
  ] as const;
  const agora = new Date(AGORA);

  it('aplica a mudança sobre as licenças atuais e mantém o core sempre ligado', () => {
    expect(modulosAtivosApos([], [], agora)).toEqual(['core']);
    expect(modulosAtivosApos(atuais, [{ modulo: 'fiscal', ativo: true, valido_ate: null }], agora)).toEqual(['core', 'cadastros', 'pedido', 'fiscal']);
    expect(modulosAtivosApos(atuais, [{ modulo: 'pedido', ativo: false, valido_ate: null }], agora)).toEqual(['core', 'cadastros']);
    expect(modulosAtivosApos([{ modulo: 'fiscal', ativo: true, valido_ate: new Date('2026-11-01T00:00:00Z') }], [], agora)).toEqual(['core']);
  });

  it('faturamento exige fiscal (e pedido): ligar sem a dependência é recusado, com o módulo que falta', () => {
    const v = conferirModulosPlataforma(atuais, [{ modulo: 'faturamento', ativo: true, valido_ate: null }], MANIFESTOS, agora);
    expect(v).toEqual([{ rn: 'RN-CORE-02', campo: 'modulos.faturamento', mensagem: 'O módulo faturamento exige o módulo fiscal ligado' }]);
    expect(conferirModulosPlataforma(atuais, [{ modulo: 'fiscal', ativo: true, valido_ate: null }, { modulo: 'faturamento', ativo: true, valido_ate: null }], MANIFESTOS, agora)).toEqual([]);
  });

  it('desligar uma dependência de módulo ligado é recusado (desligar o fiscal com o faturamento ligado)', () => {
    const tudo = MANIFESTOS.map((m) => ({ modulo: m.id, ativo: true, valido_ate: null }));
    const v = conferirModulosPlataforma(tudo, [{ modulo: 'fiscal', ativo: false, valido_ate: null }], MANIFESTOS, agora);
    expect(v.map((x) => x.campo)).toEqual(['modulos.faturamento']);
    expect(conferirModulosPlataforma(tudo, [{ modulo: 'faturamento', ativo: false, valido_ate: null }, { modulo: 'fiscal', ativo: false, valido_ate: null }], MANIFESTOS, agora)).toEqual([]);
  });

  it('a validade vencida conta como desligado na conferência', () => {
    const v = conferirModulosPlataforma(
      [...atuais, { modulo: 'fiscal', ativo: true, valido_ate: new Date('2026-11-01T00:00:00Z') }],
      [{ modulo: 'faturamento', ativo: true, valido_ate: null }],
      MANIFESTOS,
      agora,
    );
    expect(v).toHaveLength(1);
  });
});
