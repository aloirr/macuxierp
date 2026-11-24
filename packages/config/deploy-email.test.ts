/**
 * scripts/deploy/producao/email-env.sh (T-0076, "esqueci a senha" na v0.3.9): o producao-publicar.yml confere os 6
 * PROD_SMTP_* e grava /opt/macuxierp/email.env na VM pelo stdin do ssh. Aqui com um `ssh` falso no PATH que roda o
 * "email-env.sh gravar" de verdade numa pasta temporária (MACUXIERP_DIR). Só valores fictícios (smtp.exemplo.invalid).
 *
 *  - falta de cada secret: erro com o NOME e sem valor; quebra de linha, porta e TLS fora do formato: erro sem ssh;
 *  - gravação: as 7 chaves, modo 600, idempotente, nenhum valor no stdout/stderr (fora das linhas ::add-mask::), nada no
 *    argv do ssh; o "gravar" recusa entrada fora das 7 chaves sem trocar o arquivo;
 *  - formato do env_file: senha com $, #, aspas, espaço e barra invertida preservada (lida como o dotenv do Compose; com
 *    o `docker compose` instalado, conferida também pelo próprio `docker compose config`);
 *  - compose.yml: email.env só na macuxierp-api (texto do arquivo e, com o Compose instalado, o modelo resolvido).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EMAIL_SH = join(RAIZ, 'scripts', 'deploy', 'producao', 'email-env.sh');
const COMPOSE = join(RAIZ, 'compose.yml');

const SECRETS = {
  PROD_SMTP_HOST: 'smtp.exemplo.invalid',
  PROD_SMTP_PORTA: '587',
  PROD_SMTP_TLS: 'starttls',
  PROD_SMTP_USUARIO: 'nao-responda@exemplo.invalid',
  PROD_SMTP_SENHA: 'senha-ficticia',
  PROD_SMTP_REMETENTE: 'Macuxi ERP <nao-responda@exemplo.invalid>',
} as const;
type Secrets = Record<keyof typeof SECRETS, string>;
const CHAVES = ['MACUXI_SMTP_HOST', 'MACUXI_SMTP_PORTA', 'MACUXI_SMTP_TLS', 'MACUXI_SMTP_USUARIO', 'MACUXI_SMTP_SENHA', 'MACUXI_SMTP_REMETENTE', 'MACUXI_EMAIL_TRANSPORTE'];

const pasta = mkdtempSync(join(tmpdir(), 'macuxierp-email-env-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
const bin = join(pasta, 'bin');
const erp = join(pasta, 'macuxierp');
const temp = join(pasta, 'runner-temp');
const registro = join(pasta, 'ssh-argv.txt');
for (const d of [bin, erp, temp]) mkdirSync(d, { recursive: true });
// ssh falso: guarda o argv e entrega o stdin ao "gravar" de verdade (o comando remoto é conferido pelo argv)
writeFileSync(
  join(bin, 'ssh'),
  ['#!/usr/bin/env bash', 'printf "%s\\n" "$*" >> "$REGISTRO"', 'exec bash "$EMAIL_SH" gravar', ''].join('\n'),
);
chmodSync(join(bin, 'ssh'), 0o755);

const ARQUIVO = join(erp, 'email.env');
beforeEach(() => {
  rmSync(ARQUIVO, { force: true });
  writeFileSync(registro, '');
});

function roda(args: string[], secrets: Partial<Secrets> = SECRETS, input = '') {
  const r = spawnSync('bash', [EMAIL_SH, ...args], {
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: pasta, MACUXIERP_DIR: erp, RUNNER_TEMP: temp, REGISTRO: registro, EMAIL_SH, ...secrets },
    input,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const semMascara = `${r.stdout}${r.stderr}`
    .split('\n')
    .filter((l) => !l.startsWith('::add-mask::'))
    .join('\n');
  return { status: r.status, stdout: r.stdout, saida: `${r.stdout}${r.stderr}`, semMascara, ssh: readFileSync(registro, 'utf8') };
}

/** Leitura de uma linha do env_file como o dotenv do Compose (compose-go): aspas simples literais; duplas com \\ \" \$. */
function lerEnvFile(texto: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of texto.split('\n').filter(Boolean)) {
    const nome = l.slice(0, l.indexOf('='));
    const bruto = l.slice(l.indexOf('=') + 1);
    if (bruto.startsWith("'")) {
      expect(bruto.endsWith("'")).toBe(true);
      r[nome] = bruto.slice(1, -1);
    } else {
      expect(bruto.startsWith('"') && bruto.endsWith('"')).toBe(true);
      r[nome] = bruto.slice(1, -1).replace(/\\([\\"$])/g, '$1');
    }
  }
  return r;
}

const temCompose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

/** `docker compose config` (sem daemon) num compose mínimo que lê o env_file; o JSON escreve $ como $$. */
function composeLe(envFile: string): Record<string, string> {
  const d = mkdtempSync(join(pasta, 'compose-'));
  copyFileSync(envFile, join(d, 'email.env'));
  writeFileSync(join(d, 'compose.yml'), 'services:\n  a:\n    image: busybox\n    env_file: [email.env]\n');
  const r = spawnSync('docker', ['compose', '-f', join(d, 'compose.yml'), 'config', '--format', 'json'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  expect(r.status, r.stderr).toBe(0);
  const amb = (JSON.parse(r.stdout) as { services: { a: { environment: Record<string, string> } } }).services.a.environment;
  return Object.fromEntries(Object.entries(amb).map(([k, v]) => [k, v.replaceAll('$$', '$')]));
}

describe('email-env.sh conferir/enviar: secrets do environment PRODUCAO', () => {
  it.each(Object.keys(SECRETS) as (keyof Secrets)[])('sem %s: erro com o nome, sem valor e sem ssh', (nome) => {
    for (const vazio of [undefined, '']) {
      const secrets: Partial<Secrets> = { ...SECRETS };
      if (vazio === undefined) delete secrets[nome];
      else secrets[nome] = vazio;
      for (const cmd of [['conferir'], ['enviar', 'deploy']]) {
        const r = roda(cmd, secrets);
        expect(r.status).toBe(1);
        expect(r.saida).toContain(`::error::faltam secrets do e-mail no environment PRODUCAO: ${nome}`);
        for (const v of Object.values(secrets)) if (v) expect(r.saida).not.toContain(v);
        expect(r.ssh).toBe('');
      }
    }
  });

  it('vários faltando: lista só os nomes', () => {
    const r = roda(['conferir'], { PROD_SMTP_HOST: SECRETS.PROD_SMTP_HOST, PROD_SMTP_PORTA: '587' });
    expect(r.status).toBe(1);
    expect(r.saida).toContain('PROD_SMTP_TLS PROD_SMTP_USUARIO PROD_SMTP_SENHA PROD_SMTP_REMETENTE');
    expect(r.saida).not.toContain(SECRETS.PROD_SMTP_HOST);
  });

  it.each(Object.keys(SECRETS) as (keyof Secrets)[])('%s com quebra de linha (\\n ou \\r): erro sem o valor', (nome) => {
    for (const quebra of ['\n', '\r']) {
      const valor = `${SECRETS[nome]}${quebra}segunda-linha-ficticia`;
      const r = roda(['enviar', 'deploy'], { ...SECRETS, [nome]: valor });
      expect(r.status).toBe(1);
      expect(r.saida).toContain(`::error::${nome} tem quebra de linha`);
      expect(r.saida).not.toContain('segunda-linha-ficticia');
      expect(r.ssh).toBe('');
    }
  });

  it.each(['58a', '0', '65536', '99999', '-1', ' 587', '5 87', '587.0'])('PROD_SMTP_PORTA "%s": inválida', (porta) => {
    const r = roda(['enviar', 'deploy'], { ...SECRETS, PROD_SMTP_PORTA: porta });
    expect(r.status).toBe(1);
    expect(r.saida).toContain('::error::PROD_SMTP_PORTA inválida');
    expect(r.ssh).toBe('');
  });

  it.each(['true', 'STARTTLS', 'ssl', 'nenhum', 'tls '])('PROD_SMTP_TLS "%s": fora de starttls|tls', (tls) => {
    const r = roda(['conferir'], { ...SECRETS, PROD_SMTP_TLS: tls });
    expect(r.status).toBe(1);
    expect(r.saida).toContain('::error::PROD_SMTP_TLS inválido (starttls ou tls)');
  });

  it.each(['smtp.exemplo.invalid:587', 'smtp exemplo', 'smtp://exemplo.invalid'])('PROD_SMTP_HOST "%s": inválido', (host) => {
    const r = roda(['conferir'], { ...SECRETS, PROD_SMTP_HOST: host });
    expect(r.status).toBe(1);
    expect(r.saida).toContain('::error::PROD_SMTP_HOST inválido');
  });

  it('usuário de deploy inválido: sem ssh', () => {
    for (const u of [[], ['Deploy'], ['a;b']]) {
      const r = roda(['enviar', ...u]);
      expect(r.status).toBe(1);
      expect(r.ssh).toBe('');
    }
  });

  it('comando desconhecido: sai 2', () => {
    expect(roda([]).status).toBe(2);
    expect(roda(['apagar']).status).toBe(2);
  });
});

describe('email-env.sh enviar → gravar (ssh falso)', () => {
  it('grava as 7 chaves com 600, sem valor no log nem no argv do ssh, e apaga o temporário local', () => {
    const r = roda(['enviar', 'deploy']);
    expect(r.status, r.saida).toBe(0);
    expect(r.ssh.trim()).toBe("-l deploy prod bash ~/macuxierp-deploy/email-env.sh gravar");
    const texto = readFileSync(ARQUIVO, 'utf8');
    expect(texto.split('\n').filter(Boolean).map((l) => l.slice(0, l.indexOf('=')))).toEqual(CHAVES);
    expect(lerEnvFile(texto)).toEqual({
      MACUXI_SMTP_HOST: SECRETS.PROD_SMTP_HOST,
      MACUXI_SMTP_PORTA: SECRETS.PROD_SMTP_PORTA,
      MACUXI_SMTP_TLS: SECRETS.PROD_SMTP_TLS,
      MACUXI_SMTP_USUARIO: SECRETS.PROD_SMTP_USUARIO,
      MACUXI_SMTP_SENHA: SECRETS.PROD_SMTP_SENHA,
      MACUXI_SMTP_REMETENTE: SECRETS.PROD_SMTP_REMETENTE,
      MACUXI_EMAIL_TRANSPORTE: 'smtp',
    });
    expect(statSync(ARQUIVO).mode & 0o777).toBe(0o600);
    for (const v of Object.values(SECRETS)) {
      expect(r.semMascara).not.toContain(v);
      expect(r.ssh).not.toContain(v);
    }
    // cada valor (e a forma gravada) mascarado antes do ssh
    for (const v of Object.values(SECRETS)) expect(r.stdout).toContain(`::add-mask::${v}\n`);
    expect(r.stdout).toContain(`::add-mask::'${SECRETS.PROD_SMTP_SENHA}'\n`);
    expect(readdirSync(temp)).toEqual([]);
    expect(readdirSync(erp)).toEqual(['email.env']);
  });

  it('idempotente: a segunda publicação não troca o arquivo; secret novo troca', () => {
    expect(roda(['enviar', 'deploy']).status).toBe(0);
    const ino = statSync(ARQUIVO).ino;
    chmodSync(ARQUIVO, 0o644);
    const r = roda(['enviar', 'deploy']);
    expect(r.status).toBe(0);
    expect(r.saida).toContain('sem mudança');
    expect(statSync(ARQUIVO).ino).toBe(ino);
    expect(statSync(ARQUIVO).mode & 0o777).toBe(0o600);
    expect(roda(['enviar', 'deploy'], { ...SECRETS, PROD_SMTP_SENHA: 'senha-ficticia-2' }).status).toBe(0);
    expect(lerEnvFile(readFileSync(ARQUIVO, 'utf8')).MACUXI_SMTP_SENHA).toBe('senha-ficticia-2');
    expect(readdirSync(erp)).toEqual(['email.env']);
  });

  it('porta com zero à esquerda sai normalizada (0587 → 587)', () => {
    expect(roda(['enviar', 'deploy'], { ...SECRETS, PROD_SMTP_PORTA: '0587' }).status).toBe(0);
    expect(lerEnvFile(readFileSync(ARQUIVO, 'utf8')).MACUXI_SMTP_PORTA).toBe('587');
  });

  it.each([
    ['$, #, espaço e aspas duplas (aspas simples)', 'senha ficticia $HOME #1 "x" ${A:-b} $$'],
    ['aspa simples (aspas duplas escapadas)', "senha'ficticia $HOME \"x\""],
    ['barra invertida no meio e no fim', 'senha\\ficticia\\$x\\'],
    ['só aspas e barras', `'"\\'"\\`],
  ])('senha com %s preservada no formato do env_file', (_nome, senha) => {
    const r = roda(['enviar', 'deploy'], { ...SECRETS, PROD_SMTP_SENHA: senha, PROD_SMTP_REMETENTE: `Macuxi "ERP" <nao-responda@exemplo.invalid> ${senha}` });
    expect(r.status, r.saida).toBe(0);
    const texto = readFileSync(ARQUIVO, 'utf8');
    expect(texto.split('\n').filter(Boolean)).toHaveLength(7);
    const lido = lerEnvFile(texto);
    expect(lido.MACUXI_SMTP_SENHA).toBe(senha);
    expect(lido.MACUXI_SMTP_REMETENTE).toBe(`Macuxi "ERP" <nao-responda@exemplo.invalid> ${senha}`);
    expect(r.semMascara).not.toContain(senha);
    if (temCompose) {
      const doCompose = composeLe(ARQUIVO);
      expect(doCompose.MACUXI_SMTP_SENHA).toBe(senha);
      expect(doCompose.MACUXI_SMTP_REMETENTE).toBe(lido.MACUXI_SMTP_REMETENTE);
      expect(doCompose.MACUXI_EMAIL_TRANSPORTE).toBe('smtp');
    }
  });

  it('ssh que falha: erro, sem valor no log e sem temporário local', () => {
    const bin2 = join(pasta, 'bin-ssh-falha');
    mkdirSync(bin2, { recursive: true });
    writeFileSync(join(bin2, 'ssh'), '#!/usr/bin/env bash\ncat >/dev/null\nexit 255\n');
    chmodSync(join(bin2, 'ssh'), 0o755);
    const r = spawnSync('bash', [EMAIL_SH, 'enviar', 'deploy'], {
      env: { PATH: `${bin2}:${process.env.PATH ?? ''}`, HOME: pasta, RUNNER_TEMP: temp, ...SECRETS },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('::error::email.env não foi gravado na VM');
    expect(readdirSync(temp)).toEqual([]);
  });
});

describe('email-env.sh gravar (lado da VM)', () => {
  const valido = () => {
    expect(roda(['enviar', 'deploy']).status).toBe(0);
    return readFileSync(ARQUIVO, 'utf8');
  };

  it.each([
    ['vazio', () => ''],
    ['sem a senha', (t: string) => t.replace(/^MACUXI_SMTP_SENHA=.*\n/m, '')],
    ['sem o transporte', (t: string) => t.replace(/^MACUXI_EMAIL_TRANSPORTE=.*\n/m, '')],
    ['transporte diferente de smtp', (t: string) => t.replace("MACUXI_EMAIL_TRANSPORTE='smtp'", "MACUXI_EMAIL_TRANSPORTE='log'")],
    ['chave repetida', (t: string) => `${t}MACUXI_SMTP_HOST='outro.exemplo.invalid'\n`],
    ['chave estranha', (t: string) => `${t}OUTRA=1\n`],
  ])('entrada %s: erro e o email.env anterior fica', (_nome, mudar) => {
    const antes = valido();
    const r = roda(['gravar'], {}, mudar(antes));
    expect(r.status).toBe(1);
    expect(r.saida).toContain('nada foi trocado');
    expect(readFileSync(ARQUIVO, 'utf8')).toBe(antes);
    expect(readdirSync(erp)).toEqual(['email.env']);
  });

  it('pasta ausente: erro sem gravar', () => {
    const r = spawnSync('bash', [EMAIL_SH, 'gravar'], { env: { PATH: process.env.PATH ?? '', MACUXIERP_DIR: join(pasta, 'nao-existe') }, input: '', encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ausente ou sem escrita');
  });
});

describe('compose.yml: email.env só na macuxierp-api', () => {
  const texto = readFileSync(COMPOSE, 'utf8');
  /** Bloco de um serviço (2 espaços) ou de uma âncora de topo, até o próximo do mesmo nível. */
  function bloco(cabecalho: RegExp): string {
    const linhas = texto.split('\n');
    const i = linhas.findIndex((l) => cabecalho.test(l));
    expect(i, String(cabecalho)).toBeGreaterThanOrEqual(0);
    const recuo = /^ */.exec(linhas[i]!)![0].length;
    const fim = linhas.findIndex((l, j) => j > i && l.trim() !== '' && !l.trim().startsWith('#') && /^ */.exec(l)![0].length <= recuo);
    return linhas.slice(i, fim === -1 ? undefined : fim).filter((l) => !l.trim().startsWith('#')).join('\n');
  }

  it('texto: email.env aparece uma vez, no env_file da api, com required: true; fora do x-app e do worker', () => {
    const semComentario = texto.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(semComentario.match(/email\.env/g)).toHaveLength(1);
    expect(bloco(/^ {2}macuxierp-api:/)).toMatch(/env_file:\n\s+- path: segredos\.env\n\s+required: false\n\s+- path: email\.env\n\s+required: true\n/);
    expect(bloco(/^x-app:/)).not.toContain('email.env');
    expect(bloco(/^ {2}macuxierp-worker:/)).not.toContain('email.env');
    expect(bloco(/^ {2}macuxierp-worker:/)).toContain('<<: *app');
  });

  it.skipIf(!temCompose)('docker compose config: só a api recebe MACUXI_SMTP_*; o worker continua com segredos.env', () => {
    const d = mkdtempSync(join(pasta, 'compose-prod-'));
    copyFileSync(COMPOSE, join(d, 'compose.yml'));
    writeFileSync(join(d, 'email.env'), "MACUXI_SMTP_HOST='smtp.exemplo.invalid'\nMACUXI_EMAIL_TRANSPORTE='smtp'\n");
    writeFileSync(join(d, 'segredos.env'), "MACUXI_S3_CHAVE_ID='chave-ficticia'\n");
    for (const f of ['banco.env', 'admin.env']) writeFileSync(join(d, f), 'MACUXI_FALSO=1\n');
    // toda variável obrigatória (${NOME:?...}) do compose com um valor fictício
    const obrigatorias = Object.fromEntries([...texto.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((m) => [m[1]!, 'ficticio']));
    const config = (perfil: string[]) => {
      const r = spawnSync('docker', ['compose', '-f', join(d, 'compose.yml'), ...perfil, 'config', '--format', 'json'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', ...obrigatorias },
      });
      expect(r.status, r.stderr).toBe(0);
      return (JSON.parse(r.stdout) as { services: Record<string, { environment?: Record<string, string> }> }).services;
    };
    const servicos = { ...config([]), ...config(['--profile', 'ferramentas']) };
    const comEmail = Object.entries(servicos)
      .filter(([, s]) => Object.keys(s.environment ?? {}).some((k) => k.startsWith('MACUXI_SMTP_') || k === 'MACUXI_EMAIL_TRANSPORTE'))
      .map(([n]) => n);
    expect(comEmail).toEqual(['macuxierp-api']);
    expect(servicos['macuxierp-api']!.environment!.MACUXI_S3_CHAVE_ID).toBe('chave-ficticia');
    expect(servicos['macuxierp-worker']!.environment!.MACUXI_S3_CHAVE_ID).toBe('chave-ficticia');
    // required: true — sem o email.env o compose para
    rmSync(join(d, 'email.env'));
    const r = spawnSync('docker', ['compose', '-f', join(d, 'compose.yml'), 'config', '-q'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...obrigatorias } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('email.env');
  });
});
