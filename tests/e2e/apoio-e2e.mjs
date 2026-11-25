/** Apoio comum dos e2e (`bko-cadastro.mjs`, `portal-integracao.mjs`, `render-telas.mjs`) e dos servidores que eles usam (`api-real.ts`, `apoio-api.ts`). */
import { join } from 'node:path';

/** Valor de `--<nome> <valor>` na linha de comando, ou `padrao`. */
export function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

/**
 * Login único (`/login`, RN-CORE-12): abre a tela, preenche empresa, e-mail e senha de `u` e clica em Entrar. Quem chama
 * espera o destino (BKO, /config ou o alerta de recusa). O superadmin usa o código da plataforma como empresa.
 */
export async function entrar(pagina, base, u) {
  await pagina.goto(`${base}/login`);
  await pagina.getByLabel('Empresa').fill(u.empresa);
  await pagina.getByLabel('E-mail').fill(u.email);
  // exact: o botão "Mostrar senha" também casa com "Senha".
  await pagina.getByLabel('Senha', { exact: true }).fill(u.senha);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
}

export function exigir(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Registro dos passos e prints de um e2e; `mascarar` limpa a mensagem de erro (ex.: tira a chave). */
export function criarRoteiro(saida, mascarar = (s) => s) {
  const resultados = [];
  const prints = [];
  async function passo(nome, fn) {
    const ini = Date.now();
    try {
      await fn();
      resultados.push({ nome, ok: true });
    } catch (e) {
      resultados.push({ nome, ok: false, erro: mascarar(String(e?.message ?? e).split('\n')[0]) });
    }
    console.error(`[e2e] ${resultados.at(-1).ok ? 'ok   ' : 'FALHA'} ${nome} (${Date.now() - ini} ms)`);
  }
  async function print(pagina, arquivo, recorte) {
    // O selo "N" do next dev não é do produto: some do print para a revisão de marca.
    await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    // Só o viewport (sem fullPage); tela densa vai recortada: cada PNG fica abaixo de 250 KB (RD-0068).
    await pagina.screenshot({ path: join(saida, arquivo), fullPage: false, ...(recorte ? { clip: recorte } : {}) });
    prints.push(arquivo);
  }
  return { resultados, prints, passo, print };
}
