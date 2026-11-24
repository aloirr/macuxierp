// Pacote Windows do Conector: windows/macuxi-conector.xml (WinSW) é o mesmo XML que `conector instalar-servico` gera para a
// instalação padrão em C:\ProgramData\Macuxi\Conector, e o LEIAME-WINDOWS.md fixa as versões e os SHA-256 dos binários de terceiros.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gerarXmlWinSW } from '../src/servico';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const BASE = 'C:\\ProgramData\\Macuxi\\Conector';

describe('windows/macuxi-conector.xml (WinSW)', () => {
  it('é o XML gerado pelo instalar-servico para a pasta padrão (serviço MacuxiConector, sem segredo)', () => {
    const esperado = gerarXmlWinSW({
      executavel: 'C:\\Program Files\\nodejs\\node.exe',
      argumentos: [`${BASE}\\conector.mjs`, 'rodar', '--config', `${BASE}\\conector.json`],
      diretorioTrabalho: `${BASE}\\servico`,
      pastaLogs: `${BASE}\\dados\\logs`,
    });
    const xml = ler('windows/macuxi-conector.xml');
    expect(xml).toBe(esperado);
    expect(xml).toContain('<id>MacuxiConector</id>');
    expect(xml).not.toMatch(/senha|password|token|<env /i);
  });
});

describe('windows/LEIAME-WINDOWS.md', () => {
  const doc = ler('windows/LEIAME-WINDOWS.md');

  it('fixa o Node portátil e o WinSW com versão, URL e SHA-256', () => {
    expect(doc).toContain('https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip');
    expect(doc).toContain('158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541');
    expect(doc).toContain('https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe');
    expect(doc).toContain('05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da');
  });

  it('traz install, start e status do WinSW e a atualização manual', () => {
    for (const cmd of ['macuxi-conector.exe install', 'macuxi-conector.exe start', 'macuxi-conector.exe status']) expect(doc).toContain(cmd);
    expect(doc).toMatch(/## Atualização \(manual\)/);
  });
});
