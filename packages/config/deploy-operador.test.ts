/**
 * scripts/deploy/producao/operador.sh criar-empresa (T-0024, primeiro acesso) com um `docker` falso no PATH (molde do
 * deploy-banco.test.ts). O empresa.mjs de verdade contra o PostgreSQL migrado e o login real da API ficam no
 * apps/api/src/operador-empresa.db.test.ts. Dados fictícios (admin@exemplo.invalid).
 *
 *  - argumento inválido: sai 2 e não chama o docker;
 *  - sem --confirmar: chama só a simulação (sem --confirmar no empresa.mjs), sem senha no ambiente e sem imprimir senha;
 *  - com --confirmar: a senha (16 caracteres do alfabeto da API, com maiúscula, minúscula, dígito e especial, T-0052) vai só por `-e` (o
 *    valor nunca no argv), e o terminal a mostra só quando o contêiner responde `estado: usuario-criado`;
 *  - nome da empresa (de MEI pode ser dado pessoal), e-mail e nome da pessoa também só pelo ambiente (-e), nunca no
 *    argv nem na saída; o script vai pelo stdin.
 *
 * O mesmo vale para `criar-superadmin` e `superadmin --desativar|--reativar|--destravar` (T-0050, ADR 0012 §5), que
 * mandam o superadmin.mjs (o de verdade no PG fica no apps/api/src/operador-superadmin.db.test.ts); a senha só aparece
 * com `estado: superadmin-criado`, e o `superadmin` nunca gera senha.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'deploy', 'producao');
const OPERADOR_SH = join(PRODUCAO, 'operador.sh');
const EMAIL = 'admin@exemplo.invalid';
/** As 4 classes do gerador do operador.sh (iguais às da API: o apps/api/src/operador-senha.test.ts trava). */
const FONTE_OPERADOR = readFileSync(OPERADOR_SH, 'utf8');
const CLASSES_SH = ['MAIUSCULAS', 'MINUSCULAS', 'DIGITOS', 'SIMBOLOS'].map((nome) => {
  const m = new RegExp(`^${nome}='([^']+)'$`, 'm').exec(FONTE_OPERADOR);
  if (!m) throw new Error(`${nome} não encontrado em operador.sh`);
  return m[1]!;
});
const ALFABETO_SH = CLASSES_SH.join('');

/** Senha provisória (T-0052): 16 do alfabeto do operador.sh, com maiúscula, minúscula, dígito e especial. */
function conferirSenhaProvisoria(senha: string): void {
  expect(senha).toHaveLength(16);
  expect([...senha].every((c) => ALFABETO_SH.includes(c))).toBe(true);
  for (const classe of CLASSES_SH) expect([...senha].some((c) => classe.includes(c))).toBe(true);
}

describe('operador.sh: alfabeto da senha', () => {
  it('ALFABETO do operador.sh é a soma das 4 classes', () => {
    expect(FONTE_OPERADOR).toMatch(/^ALFABETO="\$MAIUSCULAS\$MINUSCULAS\$DIGITOS\$SIMBOLOS"$/m);
  });
});

// Pasta da VM falsa e o docker falso, compartilhados pelos comandos criar-empresa, criar-superadmin e superadmin.
const pasta = mkdtempSync(join(tmpdir(), 'macuxierp-operador-sh-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
const bin = join(pasta, 'bin');
const erp = join(pasta, 'macuxierp');
const registro = join(pasta, 'chamadas.txt');
const ambiente = join(pasta, 'ambiente.txt');
const entrada = join(pasta, 'entrada.txt');
for (const d of [bin, erp]) mkdirSync(d, { recursive: true });
for (const f of ['.env', 'gerados.env', 'banco.env', 'admin.env', 'imagens.env']) writeFileSync(join(erp, f), 'MACUXIERP_FALSO=1\n');
// Registra o argv, o ambiente que o compose repassaria (-e NOME) e o stdin; responde RESPOSTA_FALSA e sai SAIDA_FALSA.
writeFileSync(
  join(bin, 'docker'),
  [
    '#!/usr/bin/env bash',
    'cat > "$ENTRADA"',
    'printf "%s\\n" "$*" >> "$REGISTRO"',
    '{ printf "SENHA=%s\\n" "${MACUXIERP_SENHA_INICIAL-<ausente>}"; printf "EMAIL=%s\\n" "${MACUXIERP_ADMIN_EMAIL-<ausente>}";',
    '  printf "NOME=%s\\n" "${MACUXIERP_ADMIN_NOME-<ausente>}"; printf "EMPRESA=%s\\n" "${MACUXIERP_EMPRESA_NOME-<ausente>}";',
    '  printf "SA_EMAIL=%s\\n" "${MACUXIERP_SUPERADMIN_EMAIL-<ausente>}"; printf "SA_NOME=%s\\n" "${MACUXIERP_SUPERADMIN_NOME-<ausente>}"; } > "$AMBIENTE"',
    'printf "%b" "$RESPOSTA_FALSA"',
    'exit "${SAIDA_FALSA:-0}"',
    '',
  ].join('\n'),
);
chmodSync(join(bin, 'docker'), 0o755);

function roda(args: string[], resposta = '', saida = 0) {
  for (const f of [registro, ambiente, entrada]) writeFileSync(f, '');
  const r = spawnSync('bash', [OPERADOR_SH, ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: pasta,
      MACUXIERP_DIR: erp,
      REGISTRO: registro,
      AMBIENTE: ambiente,
      ENTRADA: entrada,
      RESPOSTA_FALSA: resposta,
      SAIDA_FALSA: String(saida),
    },
    input: '',
    encoding: 'utf8',
    timeout: 30_000,
  });
  const amb = Object.fromEntries(
    readFileSync(ambiente, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  ) as Record<string, string>;
  return { status: r.status, stdout: r.stdout, saida: `${r.stdout}${r.stderr}`, chamadas: readFileSync(registro, 'utf8'), amb, entrada: readFileSync(entrada, 'utf8') };
}
describe('operador.sh criar-empresa com um docker falso', () => {
  const base = ['criar-empresa', '--codigo', 'am2808', '--nome', 'Empresa Fictícia Ltda', '--admin-email', EMAIL, '--operador', 'alexandre'];
  const criado = '[empresa] APLICADO\\n  administrador: criado (id 00000000-0000-4000-8000-000000000001)\\nestado: usuario-criado\\n';
  const semCodigo = base.filter((a) => a !== '--codigo' && a !== 'am2808');

  it.each([
    ['sem comando', []],
    ['comando desconhecido', ['apagar-empresa', '--codigo', 'AM2808']],
    ['código com 3 dígitos', base.map((a) => (a === 'am2808' ? 'AM280' : a))],
    ['código com 5 dígitos', base.map((a) => (a === 'am2808' ? 'AM28080' : a))],
    ['código sem UF', base.map((a) => (a === 'am2808' ? '122808' : a))],
    ['UF com 3 letras', ['criar-empresa', '--uf', 'AMZ', ...semCodigo.slice(1)]],
    ['--codigo e --uf juntos', [...base, '--uf', 'AM']],
    ['nem --codigo nem --uf', semCodigo],
    ['e-mail inválido', base.map((a) => (a === EMAIL ? 'sem-arroba' : a))],
    ['sem --operador', base.slice(0, -2)],
    ['opção desconhecida', [...base, '--senha', 'x']],
    ['opção sem valor', [...base, '--admin-nome']],
  ])('%s: sai 2 e não chama o docker', (_nome, args) => {
    const r = roda(args);
    expect(r.status).toBe(2);
    expect(r.chamadas).toBe('');
  });

  it('RN-CORE-11: --slug saiu (fase 2): erro de uso com o caminho novo, sem chamar o docker', () => {
    const r = roda(['criar-empresa', '--slug', 'thathyany', ...semCodigo.slice(1)]);
    expect(r.status).toBe(2);
    expect(r.chamadas).toBe('');
    expect(r.saida).toContain('--slug saiu: use --codigo <código do FDV, ex.: AM2808> ou --uf <UF> para sortear');
  });

  it('RN-CORE-11: --uf vai ao empresa.mjs (o sorteio é lá)', () => {
    const r = roda(['criar-empresa', '--uf', 'rr', ...semCodigo.slice(1)], '[empresa] SIMULAÇÃO: nada gravado.\\nestado: simulacao\\n');
    expect(r.status).toBe(0);
    expect(r.chamadas.trim()).toMatch(/ psql node --input-type=module - --uf rr --operador alexandre$/);
  });

  it('sem --confirmar: só a simulação, sem senha no ambiente nem no terminal', () => {
    const r = roda(base, '[empresa] SIMULAÇÃO: nada gravado.\\nestado: simulacao\\n');
    expect(r.status).toBe(0);
    const chamadas = r.chamadas.trim().split('\n');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatch(/ --profile ferramentas run --rm --no-deps -T -e MACUXIERP_EMPRESA_NOME -e MACUXIERP_ADMIN_EMAIL -e MACUXIERP_ADMIN_NOME psql node --input-type=module - --codigo am2808 --operador alexandre$/);
    expect(chamadas[0]).not.toContain('Fictícia');
    expect(r.amb.EMPRESA).toBe('Empresa Fictícia Ltda');
    expect(chamadas[0]).not.toContain('--confirmar');
    expect(chamadas[0]).not.toContain('SENHA');
    expect(r.amb.SENHA).toBe('<ausente>');
    expect(r.saida).toContain('SIMULAÇÃO');
    expect(r.saida).not.toMatch(/[Ss]enha provisória/);
    // o empresa.mjs vai pelo stdin
    expect(r.entrada).toBe(readFileSync(join(PRODUCAO, 'empresa.mjs'), 'utf8'));
  });

  it('com --confirmar e estado usuario-criado: senha forte só por -e e impressa uma vez', () => {
    const r = roda([...base, '--confirmar'], criado);
    expect(r.status).toBe(0);
    const chamada = r.chamadas.trim();
    expect(chamada).toContain('-e MACUXIERP_SENHA_INICIAL psql node --input-type=module - ');
    expect(chamada).toMatch(/--operador alexandre --confirmar$/);
    const senha = r.amb.SENHA!;
    conferirSenhaProvisoria(senha);
    // nem senha, nem e-mail, nem nome da pessoa no argv do docker
    expect(chamada).not.toContain(senha);
    expect(chamada).not.toContain(EMAIL);
    expect(chamada).not.toContain('Administrador');
    expect(r.amb.EMAIL).toBe(EMAIL);
    expect(r.amb.NOME).toBe('Administrador');
    expect(r.stdout.split(senha)).toHaveLength(2); // exatamente uma vez, no stdout
    expect(r.stdout).toContain('Senha provisória do administrador');
  });

  it('senha nova a cada execução', () => {
    const a = roda([...base, '--confirmar'], criado).amb.SENHA;
    const b = roda([...base, '--confirmar'], criado).amb.SENHA;
    expect(a).not.toBe(b);
  });

  it('nome legal de MEI (acento e pontuação): só no ambiente via -e, nunca no argv nem na saída', () => {
    const nome = 'José Ávila Comércio, Ind. e Serv. - ME/EPP.';
    const args = base.map((a) => (a === 'Empresa Fictícia Ltda' ? nome : a));
    for (const [resposta, saida, esperado] of [
      ['[empresa] SIMULAÇÃO: nada gravado.\\nestado: simulacao\\n', 0, 0],
      [criado, 0, 0],
      ['', 1, 1],
    ] as const) {
      const r = roda(resposta === criado ? [...args, '--confirmar'] : args, resposta, saida);
      expect(r.status).toBe(esperado);
      expect(r.amb.EMPRESA).toBe(nome);
      expect(r.chamadas).toContain(' -e MACUXIERP_EMPRESA_NOME ');
      expect(r.chamadas).not.toMatch(/José|Ávila|ME\/EPP|--nome/);
      expect(r.saida).not.toMatch(/José|Ávila|ME\/EPP/);
    }
  });

  it('--nome: 120 caracteres acentuados passam; 121, vazio ou com quebra de linha saem 2 sem docker e sem ecoar o nome', () => {
    const com = (nome: string) => base.map((a) => (a === 'Empresa Fictícia Ltda' ? nome : a));
    expect(roda(com('Á'.repeat(120)), '[empresa] SIMULAÇÃO\\nestado: simulacao\\n').status).toBe(0);
    for (const nome of ['Á'.repeat(121), 'É', 'Empresa\nFictícia']) {
      const r = roda(com(nome));
      expect(r.status).toBe(2);
      expect(r.chamadas).toBe('');
      expect(r.saida).not.toContain(nome);
    }
  });

  it('--admin-nome vai pelo ambiente', () => {
    const r = roda([...base, '--admin-nome', 'Pessoa Fictícia', '--confirmar'], criado);
    expect(r.amb.NOME).toBe('Pessoa Fictícia');
    expect(r.chamadas).not.toContain('Pessoa Fictícia');
  });

  it.each([
    ['estado usuario-existia', '[empresa] APLICADO\\nestado: usuario-existia\\n', 0, 0],
    ['sem linha de estado', '[empresa] algo\\n', 0, 1],
    ['contêiner falhou', '', 1, 1],
    ['estado criado com saída != 0', 'estado: usuario-criado\\n', 1, 1],
  ])('com --confirmar e %s: não imprime senha', (_nome, resposta, saida, esperado) => {
    const r = roda([...base, '--confirmar'], resposta, saida);
    expect(r.status).toBe(esperado);
    const senha = r.amb.SENHA!;
    expect(senha).toHaveLength(16);
    expect(r.saida).not.toContain(senha);
    expect(r.saida).not.toMatch(/Senha provisória/);
  });

  it('pasta da VM incompleta: sai 2 antes do docker', () => {
    rmSync(join(erp, 'admin.env'));
    try {
      const r = roda([...base, '--confirmar'], criado);
      expect(r.status).toBe(2);
      expect(r.chamadas).toBe('');
    } finally {
      writeFileSync(join(erp, 'admin.env'), 'MACUXIERP_FALSO=1\n');
    }
    expect(existsSync(join(erp, 'admin.env'))).toBe(true);
  });
});

describe('operador.sh criar-superadmin e superadmin com um docker falso (T-0050, ADR 0012 §5)', () => {
  const SA_EMAIL = 'superadmin@exemplo.invalid';
  const criar = ['criar-superadmin', '--email', SA_EMAIL, '--operador', 'alexandre'];
  const criado = '[superadmin] APLICADO\\n  superadmin: criado (id 00000000-0000-4000-8000-000000000002)\\nestado: superadmin-criado\\n';
  const sufixoSimulacao = 'psql node --input-type=module - --acao criar --operador alexandre';

  it.each([
    ['criar sem e-mail', ['criar-superadmin', '--operador', 'alexandre']],
    ['criar com e-mail inválido', ['criar-superadmin', '--email', 'sem-arroba', '--operador', 'alexandre']],
    ['criar sem --operador', criar.slice(0, -2)],
    ['criar com nome curto', [...criar, '--nome', 'X']],
    ['criar com nome de 81 caracteres', [...criar, '--nome', 'Á'.repeat(81)]],
    ['criar com nome com quebra de linha', [...criar, '--nome', 'Pessoa\nFictícia']],
    ['criar com --senha', [...criar, '--senha', 'x']],
    ['criar com --desativar', [...criar, '--desativar']],
    ['superadmin sem ação', ['superadmin', '--email', SA_EMAIL, '--operador', 'alexandre']],
    ['superadmin com duas ações', ['superadmin', '--email', SA_EMAIL, '--desativar', '--destravar', '--operador', 'alexandre']],
    ['superadmin com --nome', ['superadmin', '--email', SA_EMAIL, '--nome', 'Pessoa', '--desativar', '--operador', 'alexandre']],
    ['superadmin com e-mail inválido', ['superadmin', '--email', 'a@b', '--desativar', '--operador', 'alexandre']],
  ])('%s: sai 2, não chama o docker e não ecoa e-mail nem nome', (_n, args) => {
    const r = roda(args);
    expect(r.status).toBe(2);
    expect(r.chamadas).toBe('');
    expect(r.saida).not.toContain(SA_EMAIL);
    expect(r.saida).not.toMatch(/Fictícia|ÁÁ/);
  });

  it('criar sem --confirmar: só a simulação, e-mail e nome só por -e, sem senha', () => {
    const r = roda(criar, '[superadmin] SIMULAÇÃO: nada gravado.\\nestado: simulacao\\n');
    expect(r.status).toBe(0);
    const chamadas = r.chamadas.trim().split('\n');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatch(new RegExp(` --profile ferramentas run --rm --no-deps -T -e MACUXIERP_SUPERADMIN_EMAIL -e MACUXIERP_SUPERADMIN_NOME ${sufixoSimulacao}$`));
    expect(chamadas[0]).not.toContain(SA_EMAIL);
    expect(r.amb).toMatchObject({ SA_EMAIL, SA_NOME: 'Superadmin', SENHA: '<ausente>', EMAIL: '<ausente>', EMPRESA: '<ausente>' });
    expect(r.saida).toContain('SIMULAÇÃO');
    expect(r.saida).not.toMatch(/[Ss]enha provisória/);
    expect(r.saida).not.toContain(SA_EMAIL);
    expect(r.entrada).toBe(readFileSync(join(PRODUCAO, 'superadmin.mjs'), 'utf8'));
  });

  it('criar com --confirmar e estado superadmin-criado: senha forte só por -e e impressa uma vez', () => {
    const r = roda([...criar, '--nome', 'Pessoa Fictícia', '--confirmar'], criado);
    expect(r.status).toBe(0);
    const chamada = r.chamadas.trim();
    expect(chamada).toContain('-e MACUXIERP_SENHA_INICIAL psql node --input-type=module - --acao criar --operador alexandre --confirmar');
    const senha = r.amb.SENHA!;
    conferirSenhaProvisoria(senha);
    for (const proibido of [senha, SA_EMAIL, 'Pessoa Fictícia']) expect(chamada).not.toContain(proibido);
    expect(r.amb).toMatchObject({ SA_EMAIL, SA_NOME: 'Pessoa Fictícia' });
    expect(r.stdout.split(senha)).toHaveLength(2);
    expect(r.stdout).toContain('Senha provisória do superadmin');
    expect(r.saida).not.toContain(SA_EMAIL);
    expect(r.saida).not.toContain('Pessoa Fictícia');
    expect(roda([...criar, '--confirmar'], criado).amb.SENHA).not.toBe(senha);
  });

  it.each([
    ['estado superadmin-existia', '[superadmin] APLICADO\\nestado: superadmin-existia\\n', 0, 0],
    ['sem linha de estado', '[superadmin] algo\\n', 0, 1],
    ['contêiner falhou', '', 1, 1],
    ['estado criado com saída != 0', 'estado: superadmin-criado\\n', 1, 1],
    ['estado de outro comando', 'estado: usuario-criado\\n', 0, 1],
  ])('criar com --confirmar e %s: não imprime senha', (_n, resposta, saida, esperado) => {
    const r = roda([...criar, '--confirmar'], resposta, saida);
    expect(r.status).toBe(esperado);
    const senha = r.amb.SENHA!;
    expect(senha).toHaveLength(16);
    expect(r.saida).not.toContain(senha);
    expect(r.saida).not.toMatch(/Senha provisória/);
  });

  it.each(['desativar', 'reativar', 'destravar'])('superadmin --%s: só o e-mail por -e, nunca senha; --confirmar repassado', (acao) => {
    for (const confirmar of [false, true]) {
      const args = ['superadmin', '--email', SA_EMAIL, `--${acao}`, '--operador', 'alexandre', ...(confirmar ? ['--confirmar'] : [])];
      const estado = confirmar ? 'estado: alterado' : 'estado: simulacao';
      const r = roda(args, `[superadmin] ok\\n${estado}\\n`);
      expect(r.status).toBe(0);
      const chamada = r.chamadas.trim();
      expect(chamada).toMatch(
        new RegExp(` -T -e MACUXIERP_SUPERADMIN_EMAIL psql node --input-type=module - --acao ${acao} --operador alexandre${confirmar ? ' --confirmar' : ''}$`),
      );
      expect(chamada).not.toContain(SA_EMAIL);
      expect(r.amb).toMatchObject({ SA_EMAIL, SA_NOME: '<ausente>', SENHA: '<ausente>' });
      expect(r.saida).not.toMatch(/[Ss]enha/);
      expect(r.entrada).toBe(readFileSync(join(PRODUCAO, 'superadmin.mjs'), 'utf8'));
    }
  });

  it.each([
    ['sem mudança', 'estado: sem-mudanca\\n', 0, 0],
    ['estado de criação', 'estado: superadmin-criado\\n', 0, 1],
    ['contêiner falhou', '', 1, 1],
  ])('superadmin --desativar --confirmar e %s', (_n, resposta, saida, esperado) => {
    const r = roda(['superadmin', '--email', SA_EMAIL, '--desativar', '--operador', 'alexandre', '--confirmar'], resposta, saida);
    expect(r.status).toBe(esperado);
    expect(r.saida).not.toMatch(/Senha provisória/);
  });
});
