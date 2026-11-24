// Pacote Linux do Conector (ADR 0014, seção 6 item 4): unidade systemd e instalar.sh no layout do tar.gz que o workflow
// .github/workflows/conector-montar.yml monta (pasta macuxi-conector-<versao>-linux/ com conector.mjs, exemplos/, linux/,
// LEIAME.md, VERSAO.txt e SHA256SUMS).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

/**
 * Conteúdo da pasta do tar.gz, como o passo "pacotes" do workflow (preparar_pasta ... linux): conector.mjs (do build),
 * exemplos/ inteira, linux/ inteira, LEIAME.md, VERSAO.txt e SHA256SUMS. Caminhos relativos à raiz da pasta extraída.
 */
function layoutDoTarGz(): Set<string> {
  const arquivos = new Set<string>(['conector.mjs', 'LEIAME.md', 'VERSAO.txt', 'SHA256SUMS']);
  for (const pasta of ['exemplos', 'linux']) {
    for (const nome of readdirSync(join(RAIZ, pasta))) arquivos.add(`${pasta}/${nome}`);
  }
  return arquivos;
}

describe('unidade systemd linux/macuxi-conector.service', () => {
  it('mantém as diretivas de segurança, o usuário próprio, os segredos fora e o ExecStart do conector.mjs', () => {
    const texto = ler('linux/macuxi-conector.service');
    const diretivas = new Map<string, string>();
    for (const linha of texto.split('\n')) {
      const m = /^([A-Za-z]+)=(.*)$/.exec(linha.trim());
      if (m) diretivas.set(m[1]!, m[2]!.trim());
    }
    const esperado: Record<string, string> = {
      User: 'macuxi-conector',
      Group: 'macuxi-conector',
      WorkingDirectory: '/var/lib/macuxi-conector',
      StateDirectory: 'macuxi-conector',
      EnvironmentFile: '/etc/macuxi-conector/segredos.env',
      ExecStart: '/usr/bin/node /opt/macuxi-conector/conector.mjs rodar --config /etc/macuxi-conector/conector.json',
      ProtectSystem: 'strict',
      ReadWritePaths: '/var/lib/macuxi-conector',
      NoNewPrivileges: 'yes',
      PrivateTmp: 'yes',
      ProtectHome: 'yes',
      ProtectKernelTunables: 'yes',
      ProtectKernelModules: 'yes',
      ProtectKernelLogs: 'yes',
      RestrictAddressFamilies: 'AF_INET AF_INET6 AF_UNIX',
      Restart: 'on-failure',
      RestartSec: '30',
      Documentation: 'file:///opt/macuxi-conector/LEIAME-LINUX.md',
    };
    for (const [chave, valor] of Object.entries(esperado)) expect(diretivas.get(chave), `diretiva ${chave}`).toBe(valor);
    expect(diretivas.get('ExecStart')).toContain('conector.mjs rodar --config');
    expect(diretivas.get('User')).not.toBe('root');
    expect(texto.replace(/segredos\.env/g, '')).not.toMatch(/SENHA|CHAVE|PASSWORD|SECRET/i);
    expect(texto).not.toMatch(/^Environment=.*(SENHA|CHAVE)/m);
  });
});

describe('linux/instalar.sh', () => {
  const sh = ler('linux/instalar.sh');

  it('cria o modelo de segredos vazio, não sobrescreve e liga o serviço com usuário de sistema sem login', () => {
    expect(sh).toMatch(/^set -euo pipefail$/m);
    expect(sh).toMatch(/^MACUXI_CONECTOR_ERP_SENHA=$/m);
    expect(sh).toMatch(/^MACUXI_CONECTOR_HUB_CHAVE=$/m);
    expect(sh).toMatch(/if \[\[ -e "\$\{DIR_CONF\}\/segredos\.env" \]\]/);
    expect(sh).toMatch(/chmod 0600 "\$\{DIR_CONF\}\/segredos\.env"/);
    expect(sh).toMatch(/useradd --system --no-create-home .*--shell \/usr\/sbin\/nologin/);
    expect(sh).toMatch(/systemctl enable --now macuxi-conector/);
  });

  it('espera o layout do tar.gz do workflow: roda de linux/ e acha conector.mjs, exemplos/ e linux/ na raiz da pasta extraída', () => {
    // ORIGEM = pasta do script (linux/); PACOTE = a pasta acima dela (raiz do tar.gz).
    expect(sh).toContain('ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    expect(sh).toContain('PACOTE="$(cd "${ORIGEM}/.." && pwd)"');
    expect(existsSync(join(RAIZ, 'linux/instalar.sh'))).toBe(true);

    const layout = layoutDoTarGz();
    // A lista conferida no passo 2 do instalador existe no tar.gz.
    const lista = /for f in (.+); do\n\s+\[\[ -f "\$\{PACOTE\}\/\$\{f\}" \]\]/.exec(sh)?.[1]?.split(/\s+/) ?? [];
    expect(lista).toEqual(expect.arrayContaining(['conector.mjs', 'exemplos/conector.thathyany.exemplo.json', 'linux/macuxi-conector.service']));
    for (const f of lista) expect(layout.has(f), `instalar.sh confere ${f}`).toBe(true);

    // Todo arquivo lido pelo instalador existe no layout: ${PACOTE}/x na raiz, ${ORIGEM}/x dentro de linux/.
    const usados = [...sh.matchAll(/"\$\{(PACOTE|ORIGEM)\}\/([^"$]+)"/g)].map(([, base, rel]) => (base === 'ORIGEM' ? posix.join('linux', rel!) : rel!));
    expect(usados.length).toBeGreaterThanOrEqual(5);
    for (const f of usados) expect(layout.has(f), `instalar.sh lê ${f}`).toBe(true);
    expect(sh).not.toMatch(/LEIA-ME/);
  });
});

describe('LEIAME do pacote', () => {
  it('o LEIAME.md (raiz dos dois pacotes) aponta os guias de cada plataforma, que existem', () => {
    const leiame = ler('LEIAME.md');
    for (const guia of ['linux/LEIAME-LINUX.md', 'windows/LEIAME-WINDOWS.md']) {
      expect(leiame).toContain(guia);
      expect(existsSync(join(RAIZ, guia)), guia).toBe(true);
    }
    expect(leiame).toContain('conector-montar.yml');
  });
});
