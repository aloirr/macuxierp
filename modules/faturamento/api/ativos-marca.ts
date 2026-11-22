/**
 * Ativo da marca usado no rodapé do DANFE: `docs/marca/ativos/2026-11-22-v1/macuxi-erp-a-mono-preto-400.png` (do design-de-marca, não é
 * copiado para o módulo). Lido por caminho em tempo de execução: `MACUXI_ATIVOS_MARCA` (pasta dos ativos) ou, sem ela, subindo a partir
 * deste arquivo até achar `docs/marca/ativos`. Ausente, `lerAssinaturaDaMarca` devolve `null`; quem gera o DANFE NÃO pode seguir sem o ativo:
 * `verificarAtivosDanfe` só informa `faltando` (log do boot); quem garante é a rota (503) e o renderizador, que exige
 * `assinaturaMarca` e lança sem ela. Rodapé omitido em silêncio é regressão.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARQUIVO_ASSINATURA = 'macuxi-erp-a-mono-preto-400.png';
const VERSAO_ATIVOS = '2026-11-22-v1';

async function pastaDosAtivos(diretorio?: string): Promise<string | null> {
  const env = diretorio ?? process.env.MACUXI_ATIVOS_MARCA;
  if (env) return env;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidata = path.join(dir, 'docs/marca/ativos', VERSAO_ATIVOS);
    if (await stat(candidata).then((s) => s.isDirectory(), () => false)) return candidata;
    dir = path.dirname(dir);
  }
  return null;
}

export async function lerAssinaturaDaMarca(diretorio?: string): Promise<Uint8Array | null> {
  const pasta = await pastaDosAtivos(diretorio);
  if (!pasta) return null;
  return readFile(path.join(pasta, ARQUIVO_ASSINATURA)).then((b) => new Uint8Array(b), () => null);
}

export const MENSAGEM_ATIVO_AUSENTE = 'Ativo de marca do DANFE não encontrado';
export type ResultadoAtivosDanfe = { ok: true } | { ok: false; faltando: string[] };

/**
 * Boot da API: confere se o PNG do rodapé está na imagem (uso e instrução de boot: docs/modulos/faturamento/README.md, seção apps/api). NUNCA lança.
 * Diretório: `opcoes.diretorio`, depois `MACUXI_ATIVOS_MARCA`, depois `docs/marca/ativos/2026-11-22-v1`.
 */
export async function verificarAtivosDanfe(opcoes: { diretorio?: string } = {}): Promise<ResultadoAtivosDanfe> {
  const png = await lerAssinaturaDaMarca(opcoes.diretorio);
  return png ? { ok: true } : { ok: false, faltando: [ARQUIVO_ASSINATURA] };
}

/** Amostras e testes: o ativo é obrigatório, sem ele é ERRO (nunca um PDF sem rodapé). */
export async function exigirAssinaturaDaMarca(diretorio?: string): Promise<Uint8Array> {
  const png = await lerAssinaturaDaMarca(diretorio);
  if (!png) throw new Error(`${MENSAGEM_ATIVO_AUSENTE}: ${ARQUIVO_ASSINATURA}`);
  return png;
}
