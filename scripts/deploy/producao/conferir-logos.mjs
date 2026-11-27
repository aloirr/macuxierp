/**
 * Logos do e-mail pelo domínio (v0.3.20, pedido do Alexandre): o producao-publicar confere, depois do deploy, que cada
 * logo que o modelo do e-mail da senha temporária cita responde 200 com `image/png`. Em produção, um 404 vira o "?" no topo
 * do Gmail, porque o cliente de e-mail busca a imagem no endereço publicado.
 * A lista sai do próprio modelo (packages/platform-sdk/src/email-senha-temporaria-html.ts): logo novo no modelo entra aqui sem editar nada.
 * Uso: node scripts/deploy/producao/conferir-logos.mjs [arquivo do modelo]. Saída 0 = todos ok; 1 = algum falhou; 2 = nenhum logo no modelo.
 * Roda no runner, sem segredo e sem dado de cadastro: só HEAD em URL pública.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const MODELO_PADRAO = new URL('../../../packages/platform-sdk/src/email-senha-temporaria-html.ts', import.meta.url);

/** As URLs https dos PNGs que o modelo cita, sem repetição e na ordem em que aparecem. */
export function logosDoModelo(texto) {
  return [...new Set(texto.match(/https:\/\/[a-z0-9.-]+\/email\/[a-z0-9-]+\.png/g) ?? [])];
}

/** Um HEAD por logo, com novas tentativas (o túnel pode levar alguns segundos depois do compose up). */
export async function conferirLogo(url, { buscar = fetch, tentativas = 5, esperaMs = 3000 } = {}) {
  let ultimo = '';
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await buscar(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (r.status === 200 && tipo === 'image/png') return { ok: true, url, detalhe: `200 ${tipo}` };
      ultimo = `${r.status} ${tipo || '(sem content-type)'}`;
    } catch (e) {
      ultimo = `sem resposta (${e?.name ?? 'erro'})`;
    }
    if (i < tentativas) await new Promise((r) => setTimeout(r, esperaMs));
  }
  return { ok: false, url, detalhe: ultimo };
}

export async function main(argv = process.argv.slice(2), opcoes = {}) {
  const logos = logosDoModelo(readFileSync(argv[0] ?? MODELO_PADRAO, 'utf8'));
  if (logos.length === 0) {
    console.error('[logos] nenhum logo https://…/email/*.png no modelo do e-mail');
    return 2;
  }
  let falhas = 0;
  for (const url of logos) {
    const r = await conferirLogo(url, opcoes);
    if (r.ok) console.log(`[logos] ok: ${url} (${r.detalhe})`);
    else {
      falhas++;
      console.error(`::error::[logos] ${url} respondeu ${r.detalhe}; o e-mail mostra "?" no lugar do logo (a imagem do BKO leva o apps/web/public?)`);
    }
  }
  return falhas ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
