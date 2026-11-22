import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gerarCssBotoes } from './estilos.js';
import { SHA256_APPLE_TOUCH_ICON, appleTouchIconPngBase64 } from './marca.js';

const fonte = (nome: string) => readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8');
const tsx = readdirSync(new URL('./', import.meta.url)).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'));

describe('hover dos botões (T-0021)', () => {
  const css = gerarCssBotoes();
  it('principal: fundo e borda em grafite; secundário: fundo névoa; só desabilitado fica de fora', () => {
    const bloco = (sel: string) => css.split(sel + ' {')[1]!.split('}')[0]!;
    const p = bloco('.mx-botao:hover:not(:disabled)');
    expect(p).toContain('background: var(--mx-cor-grafite);');
    expect(p).toContain('border: 1px solid var(--mx-cor-grafite);');
    expect(bloco('.mx-botao-secundario:hover:not(:disabled)')).toContain('background: var(--mx-cor-nevoa);');
  });
  it('sem brightness', () => {
    expect(css).not.toMatch(/brightness/);
  });
});

describe('apple-touch-icon (T-0021)', () => {
  const png = Buffer.from(appleTouchIconPngBase64, 'base64');
  it('o SHA-256 dos bytes confere', () => {
    expect(createHash('sha256').update(png).digest('hex')).toBe(SHA256_APPLE_TOUCH_ICON);
  });
  it('é PNG de 180x180', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });
});

describe('subpath marca sem hook (T-0021)', () => {
  const marca = fonte('marca.tsx');
  it('não usa hook nem importa o barrel', () => {
    for (const h of ['useState', 'useEffect', 'useId', 'useRef']) expect(marca).not.toContain(h);
    expect(marca).not.toContain("from './index");
  });
  it('a assinatura tem um caminho só: fora do barrel', () => {
    expect(fonte('index.ts')).not.toContain('AssinaturaErp');
  });
});

describe('rádio do DialogoMotivo (T-0021)', () => {
  const src = fonte('DialogoMotivo.tsx');
  const radio = src.split('const radioEstilo')[1]!.split('});')[0]!;
  it('sem accentColor e sem anel externo; appearance none com borda de campo', () => {
    expect(src).not.toContain('accentColor');
    expect(radio).toContain("appearance: 'none'");
    expect(radio).toContain("cor('bordaCampo')");
    expect(radio).toContain('margin: 0');
    expect(radio).toContain("borderRadius: '50%'");
  });
  it('o marcado é azul-noite com ponto branco interno', () => {
    expect(radio).toContain("background: marcado ? cor('azulNoite')");
    expect(radio).toContain("inset 0 0 0 4px ${cor('branco')}");
  });
});

describe("diretiva 'use client' (T-0021)", () => {
  it('todo .tsx que usa hook começa com a diretiva; os demais, não', () => {
    for (const n of tsx) {
      const s = fonte(n);
      const semComentarios = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const usaHook = /\buse[A-Z]\w*\s*[(<]/.test(semComentarios);
      expect(s.startsWith("'use client';\n"), n).toBe(usaHook);
    }
  });
});
