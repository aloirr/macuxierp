/**
 * scripts/deploy/producao/operador.sh criar-empresa (T-0024, primeiro acesso) com um `docker` falso no PATH (molde do
 * deploy-banco.test.ts). O empresa.mjs de verdade contra o PostgreSQL migrado e o login real da API ficam no
 * apps/api/src/operador-empresa.db.test.ts. Dados fictícios (admin@exemplo.invalid).
 *
 *  - argumento inválido: sai 2 e não chama o docker;
 *  - sem --confirmar: chama só a simulação (sem --confirmar no empresa.mjs), sem senha no ambiente e sem imprimir senha;
 *  - com --confirmar: a senha (16 caracteres do alfabeto da API, com maiúscula, minúscula e dígito) vai só por `-e` (o
 *    valor nunca no argv), e o terminal a mostra só quando o contêiner responde `estado: usuario-criado`;
 *  - nome da empresa (de MEI pode ser dado pessoal), e-mail e nome da pessoa também só pelo ambiente (-e), nunca no
 *    argv nem na saída; o script vai pelo stdin.
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
/** Alfabeto da senha provisória da API, lido do fonte (as 4 constantes de modules/core/domain/usuarios.ts, que o
 *  turbo.json põe nos inputs do @macuxierp/config#test; molde do listaDoSdk de scripts/plataforma/licenca.test.mjs). */
const ALFABETO_API = (() => {
  const fonte = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'modules', 'core', 'domain', 'usuarios.ts'), 'utf8');
  return ['MAIUSCULAS', 'MINUSCULAS', 'DIGITOS', 'SIMBOLOS']
    .map((nome) => {
      const m = new RegExp(`const ${nome} = '([^']+)';`).exec(fonte);
      if (!m) throw new Error(`${nome} não encontrado em usuarios.ts`);
      return m[1]!;
    })
    .join('');
})();

describe('operador.sh: alfabeto da senha', () => {
  it("ALFABETO='...' do operador.sh é o alfabeto da API (core/domain/usuarios.ts)", () => {
    expect(ALFABETO_API).toHaveLength(64);
    expect(/^ALFABETO='([^']+)'$/m.exec(readFileSync(OPERADOR_SH, 'utf8'))?.[1]).toBe(ALFABETO_API);
  });
});

describe('operador.sh criar-empresa com um docker falso', () => {
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
      '  printf "NOME=%s\\n" "${MACUXIERP_ADMIN_NOME-<ausente>}"; printf "EMPRESA=%s\\n" "${MACUXIERP_EMPRESA_NOME-<ausente>}"; } > "$AMBIENTE"',
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
  const base = ['criar-empresa', '--slug', 'thathyany', '--nome', 'Empresa Fictícia Ltda', '--admin-email', EMAIL, '--operador', 'alexandre'];
  const criado = '[empresa] APLICADO\\n  administrador: criado (id 00000000-0000-4000-8000-000000000001)\\nestado: usuario-criado\\n';

  it.each([
    ['sem comando', []],
    ['comando desconhecido', ['apagar-empresa', '--slug', 'thathyany']],
    ['slug inválido', base.map((a) => (a === 'thathyany' ? 'Thathyany' : a))],
    ['e-mail inválido', base.map((a) => (a === EMAIL ? 'sem-arroba' : a))],
    ['sem --operador', base.slice(0, -2)],
    ['opção desconhecida', [...base, '--senha', 'x']],
    ['opção sem valor', [...base, '--admin-nome']],
  ])('%s: sai 2 e não chama o docker', (_nome, args) => {
    const r = roda(args);
    expect(r.status).toBe(2);
    expect(r.chamadas).toBe('');
  });

  it('sem --confirmar: só a simulação, sem senha no ambiente nem no terminal', () => {
    const r = roda(base, '[empresa] SIMULAÇÃO: nada gravado.\\nestado: simulacao\\n');
    expect(r.status).toBe(0);
    const chamadas = r.chamadas.trim().split('\n');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatch(/ --profile ferramentas run --rm --no-deps -T -e MACUXIERP_EMPRESA_NOME -e MACUXIERP_ADMIN_EMAIL -e MACUXIERP_ADMIN_NOME psql node --input-type=module - --slug thathyany --operador alexandre$/);
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
    expect(senha).toHaveLength(16);
    expect([...senha].every((c) => ALFABETO_API.includes(c))).toBe(true);
    expect(senha).toMatch(/[A-Z]/);
    expect(senha).toMatch(/[a-z]/);
    expect(senha).toMatch(/[2-9]/);
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
