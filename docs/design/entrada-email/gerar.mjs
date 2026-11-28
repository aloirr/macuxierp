// Gera entrada-email.html e os PNG (T-0133). Só tokens e CSS do packages/ui; SVG da marca lido de packages/ui/src/marca.tsx.
// Uso: node docs/design/entrada-email/gerar.mjs   (precisa do google-chrome)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '../../..');
const ler = (p) => readFileSync(join(raiz, p), 'utf8');
const marca = ler('packages/ui/src/marca.tsx');
const svgC = new Function(`return ${/export const assinaturaCNegativoAzulNoite = ('.*');/.exec(marca)[1]}`)();
const logo = 'data:image/svg+xml,' + encodeURIComponent(svgC);
const css = ler('packages/ui/src/tokens.css') + ler('packages/ui/src/botoes.css');

const olho = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/></svg>';

const base = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
body{font-family:var(--mx-fonte-texto);font-size:var(--mx-tamanho-base);background:var(--mx-cor-perola);color:var(--mx-cor-grafite);line-height:1.5}
a{color:var(--mx-cor-azul-noite)}
.cartao-central{background:var(--mx-cor-branco);border:1px solid var(--mx-cor-borda-tabela);border-radius:var(--mx-medida-canto-cartao);padding:32px;max-width:420px;margin:8vh auto}
@media(max-width:480px){.cartao-central{margin-left:16px;margin-right:16px}}
.cartao-central header{background:var(--mx-cor-azul-noite);margin:-32px -32px 24px;padding:24px 32px;border-radius:var(--mx-medida-canto-cartao) var(--mx-medida-canto-cartao) 0 0}
.cartao-central header img{display:block;height:100px;width:auto}
.cartao-central h1{font-size:var(--mx-tamanho-titulo-dialogo);font-weight:var(--mx-peso-titulo);margin:0 0 16px}
.campo{display:block;margin-bottom:16px}
.campo>span{display:block;font-weight:var(--mx-peso-rotulo-campo);font-size:var(--mx-tamanho-micro);margin-bottom:4px;color:var(--mx-cor-rotulo-destaque);text-transform:uppercase;letter-spacing:var(--mx-letras-caixa-alta)}
.campo input{width:100%;padding:0 12px;height:var(--mx-medida-altura-campo);border:1px solid var(--mx-cor-borda-campo);border-radius:6px;font:inherit;font-size:var(--mx-tamanho-texto);background:var(--mx-cor-branco);color:var(--mx-cor-grafite)}
.campo input[aria-invalid=true]{border-color:var(--mx-cor-erro-texto)}
.com-olho{position:relative}.com-olho input{padding-right:40px}
.mx-olho{position:absolute;top:0;right:0;width:var(--mx-medida-altura-campo);height:var(--mx-medida-altura-campo);display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--mx-cor-texto-secundario)}
.barra{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
.barra .mx-botao,.barra .mx-botao-secundario{flex:1}
.erro-login{color:var(--mx-cor-erro-texto);background:var(--mx-cor-erro-fundo);border:1px solid var(--mx-cor-erro-texto);border-radius:6px;padding:8px 12px;margin:16px 0 0;font-size:var(--mx-tamanho-texto)}
.aviso-sucesso{color:var(--mx-cor-ativo-texto);background:var(--mx-cor-ativo-fundo);border:1px solid var(--mx-cor-verde-sucesso);border-radius:6px;padding:8px 12px;margin:0 0 16px;font-size:var(--mx-tamanho-texto)}
.apoio{color:var(--mx-cor-texto-secundario);font-size:var(--mx-tamanho-pequeno);margin:16px 0 0}
.apoio.neutro{margin:0 0 16px}
button.link{background:none;border:0;padding:0;font:inherit;color:var(--mx-cor-azul-noite);text-decoration:underline;cursor:pointer}
`;

const topo = (t) => `<header><img src="${logo}" alt="Macuxi ERP"></header><h1>${t}</h1>`;
const campoEmail = (v = '', msg = '') => `<label class="campo"><span>E-mail</span><input type="email" value="${v}" autocomplete="username"${msg ? ' aria-invalid="true"' : ''}>${msg}</label>`;
const campoSenha = `<label class="campo"><span>Senha</span><div class="com-olho"><input type="password" value="" autocomplete="current-password"><button type="button" class="mx-olho" aria-label="Mostrar senha">${olho}</button></div></label>`;

const telas = {
  'login': `<main class="cartao-central">${topo('Acesse sua conta')}<form>${campoEmail()}${campoSenha}<div class="barra"><button class="mx-botao" type="submit">Entrar</button></div><p class="apoio"><button type="button" class="link">Esqueci a senha</button></p></form></main>`,
  'login-erro': `<main class="cartao-central">${topo('Acesse sua conta')}<form>${campoEmail('ana@empresa.com.br')}${campoSenha}<div class="barra"><button class="mx-botao" type="submit">Entrar</button></div><p class="erro-login" role="alert">E-mail ou senha inválidos.</p><p class="apoio"><button type="button" class="link">Esqueci a senha</button></p></form></main>`,
  'login-suspensa': `<main class="cartao-central">${topo('Acesse sua conta')}<form>${campoEmail('ana@empresa.com.br')}${campoSenha}<div class="barra"><button class="mx-botao" type="submit">Entrar</button></div><p class="erro-login suspensa" role="alert">Sua empresa está suspensa. Fale com o administrador da Macuxi.</p><p class="apoio"><button type="button" class="link">Esqueci a senha</button></p></form></main>`,
  'esqueci': `<main class="cartao-central">${topo('Esqueci a senha')}<form>${campoEmail('ana@empresa.com.br')}<div class="barra"><button class="mx-botao" type="submit">Enviar instruções</button><button class="mx-botao-secundario" type="button">Voltar para entrar</button></div></form></main>`,
  'esqueci-enviado': `<main class="cartao-central">${topo('Esqueci a senha')}<p class="aviso-sucesso" role="status">Se o e-mail estiver cadastrado, enviamos as instruções.</p><div class="barra"><button class="mx-botao-secundario" type="button">Voltar para entrar</button></div></main>`,
};

const html = (corpo, titulo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><style>${css}${base}</style></head><body>${corpo}</body></html>`;
const indice = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Entrada só com e-mail (T-0133)</title></head><body><h1>Entrada só com e-mail (T-0133)</h1><ul>${Object.keys(telas).map((k) => `<li><a href="${k}.html">${k}</a></li>`).join('')}</ul></body></html>`;
writeFileSync(join(aqui, 'index.html'), indice);

const chrome = process.env.CHROME ?? 'google-chrome';
for (const [nome, corpo] of Object.entries(telas)) {
  const arq = join(aqui, `${nome}.html`);
  writeFileSync(arq, html(corpo, `Entrada: ${nome}`));
  for (const [w, h] of [[1366, 768], [390, 800]]) {
    execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${join(aqui, `${nome}-${w}x${h}.png`)}`, pathToFileURL(arq).href], { stdio: 'ignore' });
  }
}
