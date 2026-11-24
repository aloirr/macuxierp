import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AlterarModulosEntrada,
  CABECALHOS_SENHA_PROVISORIA,
  CodigoEmpresa,
  CriarEmpresaEntrada,
  EmailPrimeiroAdminResposta,
  EmailUsuario,
  EmpresaPlataforma,
  EntrarPlataformaEntrada,
  EuPlataforma,
  PADRAO_CODIGO_EMPRESA,
  PADRAO_SLUG_EMPRESA,
  PrimeiroAdminEntrada,
  PrimeiroAdminResposta,
  SessaoPlataformaResposta,
  SituacaoEmpresaEntrada,
  TrocarSenhaPlataformaEntrada,
  codigoDaEmpresa,
  codigoParaSlug,
  conferirModulosPlataforma,
  modulosAtivosApos,
} from './portal-config';
import { TrocarSenhaEntrada } from './eu';

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
    expect(CriarEmpresaEntrada.parse({ slug: 'acme-1', nome: '  ACME Ltda ' })).toEqual({ slug: 'acme-1', uf: null, nome: 'ACME Ltda', fuso: 'America/Manaus' });
    for (const slug of ['A', 'acme_1', '-acme', 'a', 'x'.repeat(41), 'Acme']) expect(() => CriarEmpresaEntrada.parse({ slug, nome: 'ACME' }), slug).toThrow();
    expect(() => CriarEmpresaEntrada.parse({ slug: 'referencia', nome: 'ACME' })).toThrow();
    expect(() => CriarEmpresaEntrada.parse({ slug: 'acme', nome: 'A' })).toThrow();
    expect(() => CriarEmpresaEntrada.parse({ slug: 'acme', nome: 'ACME', fuso: 'Manaus' })).toThrow();
  });

  it('RN-CORE-11: CodigoEmpresa = UF + 4 dígitos do FDV, aparado e em maiúsculas', () => {
    for (const c of ['AM2808', 'am2808', ' Am2808 ']) expect(CodigoEmpresa.parse(c), c).toBe('AM2808');
    for (const c of ['XX1234', 'AM123', 'AM12345', 'A12808', 'AM28O8', '']) {
      const r = CodigoEmpresa.safeParse(c);
      expect(r.success, c).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('Código do FDV: UF + 4 dígitos, ex.: AM2808');
    }
  });

  it('RN-CORE-11: o código cabe no CHECK do slug (0002) e volta em maiúsculas', () => {
    expect(codigoParaSlug('AM2808')).toBe('am2808');
    expect(PADRAO_SLUG_EMPRESA.test(codigoParaSlug('AM2808'))).toBe(true);
    expect(codigoDaEmpresa('am2808')).toBe('AM2808');
    expect(codigoDaEmpresa('demo')).toBeNull();
    expect(codigoDaEmpresa('thathyany')).toBeNull();
    expect(codigoDaEmpresa('xx1234')).toBeNull();
    expect(codigoDaEmpresa('am28080')).toBeNull();
    expect(PADRAO_CODIGO_EMPRESA.test('am2808')).toBe(true);
  });

  it('RN-CORE-11: CriarEmpresaEntrada (fase 2) com o código do FDV, o slug legado ou só a UF (sorteio, slug null)', () => {
    expect(CriarEmpresaEntrada.parse({ codigo: ' am2808 ', nome: 'ACME' })).toEqual({ slug: 'am2808', uf: null, nome: 'ACME', fuso: 'America/Manaus' });
    expect(CriarEmpresaEntrada.parse({ codigo: 'AM2808', uf: 'AM', nome: 'ACME' })).toEqual({ slug: 'am2808', uf: 'AM', nome: 'ACME', fuso: 'America/Manaus' });
    expect(CriarEmpresaEntrada.parse({ slug: 'acme-1', nome: 'ACME' })).toEqual({ slug: 'acme-1', uf: null, nome: 'ACME', fuso: 'America/Manaus' });
    // a saída reenviada (apps/web → API) continua válida e igual
    const saida = CriarEmpresaEntrada.parse({ codigo: 'RR0001', nome: 'ACME' });
    expect(CriarEmpresaEntrada.parse(saida)).toEqual(saida);
    // só a UF: o core sorteia o código; a saída vem com slug null e também pode ser reenviada
    const sorteio = CriarEmpresaEntrada.parse({ uf: 'RR', nome: 'ACME' });
    expect(sorteio).toEqual({ slug: null, uf: 'RR', nome: 'ACME', fuso: 'America/Manaus' });
    expect(CriarEmpresaEntrada.parse(sorteio)).toEqual(sorteio);
    expect(CriarEmpresaEntrada.safeParse({ codigo: 'XX1234', nome: 'ACME' }).success).toBe(false);
    expect(CriarEmpresaEntrada.safeParse({ codigo: 'AM2808', uf: 'XX', nome: 'ACME' }).success).toBe(false);

    const problema = (e: unknown) => {
      const r = CriarEmpresaEntrada.safeParse(e);
      expect(r.success).toBe(false);
      return r.error?.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
    };
    expect(problema({ nome: 'ACME' })).toEqual([{ campo: 'codigo', mensagem: 'Informe o código do FDV ou a UF para sortear' }]);
    expect(problema({ slug: null, uf: null, nome: 'ACME' })).toEqual([{ campo: 'codigo', mensagem: 'Informe o código do FDV ou a UF para sortear' }]);
    expect(problema({ codigo: 'AM2808', uf: 'RR', nome: 'ACME' })).toEqual([{ campo: 'uf', mensagem: 'A UF precisa ser a do código' }]);
    expect(problema({ codigo: 'AM2808', slug: 'acme', nome: 'ACME' })?.map((p) => p.campo)).toEqual(['slug']);
    expect(problema({ slug: 'acme', uf: 'AM', nome: 'ACME' })).toEqual([{ campo: 'uf', mensagem: 'A UF precisa ser a do código' }]);
  });

  it('EmpresaPlataforma: código opcional e anulável (contrato antigo continua válido)', () => {
    expect(EmpresaPlataforma.parse({ ...empresa, slug: 'am2808', codigo: 'AM2808' }).codigo).toBe('AM2808');
    expect(EmpresaPlataforma.parse({ ...empresa, codigo: null }).codigo).toBeNull();
    expect(EmpresaPlataforma.parse(empresa).codigo).toBeUndefined();
  });

  it('EmpresaPlataforma: só ativo, suspenso ou encerrado (o tenant de referência nunca aparece); 1º admin sem e-mail nem nome', () => {
    expect(EmpresaPlataforma.parse(empresa).situacao).toBe('ativo');
    expect(() => EmpresaPlataforma.parse({ ...empresa, situacao: 'referencia' })).toThrow();
    const comAdmin = EmpresaPlataforma.parse({ ...empresa, primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false, email: 'a@b.c' } });
    expect(comAdmin.primeiro_admin).toEqual({ id: ADMIN, ativo: true, bloqueado: false });
    expect(() => EmpresaPlataforma.parse({ ...empresa, modulos: [{ modulo: 'compras', ativo: true, valido_ate: null }] })).toThrow();
  });

  it('EmpresaPlataforma (T-0050): razão social, CNPJ, cidade/UF e e-mail mascarado do 1º admin são opcionais e anuláveis', () => {
    // contrato antigo (sem os campos novos) continua válido
    expect(EmpresaPlataforma.parse(empresa)).not.toHaveProperty('cnpj');
    expect(EmpresaPlataforma.parse({ ...empresa, primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false } }).primeiro_admin).toEqual({ id: ADMIN, ativo: true, bloqueado: false });
    // todos nulos
    const nulos = { razao_social: null, cnpj: null, cidade: null, uf: null };
    expect(EmpresaPlataforma.parse({ ...empresa, ...nulos, primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false, email_mascarado: null } })).toMatchObject(nulos);
    // preenchidos: CNPJ numérico e alfanumérico, sem máscara (formato do domínio plataforma.cnpj)
    const cheia = EmpresaPlataforma.parse({
      ...empresa,
      razao_social: 'ACME Comércio Ltda',
      cnpj: '11222333000181',
      cidade: 'Boa Vista',
      uf: 'RR',
      primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false, email_mascarado: 'ad****@acme.com.br' },
    });
    expect(cheia).toMatchObject({ razao_social: 'ACME Comércio Ltda', cnpj: '11222333000181', cidade: 'Boa Vista', uf: 'RR' });
    expect(cheia.primeiro_admin?.email_mascarado).toBe('ad****@acme.com.br');
    expect(EmpresaPlataforma.parse({ ...empresa, cnpj: '12ABC34501DE35' }).cnpj).toBe('12ABC34501DE35');
    expect(EmpresaPlataforma.parse({ ...empresa, primeiro_admin: { id: ADMIN, ativo: true, bloqueado: false, email_mascarado: '*****@a.co' } }).primeiro_admin?.email_mascarado).toBe('*****@a.co');
    // inválidos
    for (const uf of ['RRR', 'R', 'rr']) expect(() => EmpresaPlataforma.parse({ ...empresa, uf }), uf).toThrow();
    // resposta: DV errado mas no formato passa (o DV é conferido no cadastro, RN-CAD-01)
    expect(EmpresaPlataforma.parse({ ...empresa, cnpj: '11222333000182' }).cnpj).toBe('11222333000182');
    // formato errado falha: 13 caracteres, minúscula, máscara, DV com letra
    for (const cnpj of ['1122233300018', '12abc34501de35', '11.222.333/0001-81', '12ABC34501DEAB']) expect(() => EmpresaPlataforma.parse({ ...empresa, cnpj }), cnpj).toThrow();
  });

  it('EmailPrimeiroAdminResposta (revelação auditada): e-mail completo, aparado e minúsculo', () => {
    expect(EmailPrimeiroAdminResposta.parse({ email: '  Admin@Acme.COM.br ' })).toEqual({ email: 'admin@acme.com.br' });
    expect(() => EmailPrimeiroAdminResposta.parse({ email: 'sem-arroba' })).toThrow();
    expect(() => EmailPrimeiroAdminResposta.parse({})).toThrow();
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
    expect(TrocarSenhaPlataformaEntrada).toBe(TrocarSenhaEntrada);
    expect(TrocarSenhaPlataformaEntrada.parse({ senha_nova: 'abcdef1!' })).toEqual({ senha_nova: 'abcdef1!' });
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
