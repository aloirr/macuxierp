/**
 * Ativo da marca usado no rodapé do DANFE: `docs/marca/ativos/2026-11-22-v1/macuxi-erp-a-mono-preto-400.png` (do design-de-marca, não é
 * copiado para o módulo). Lido por caminho em tempo de execução: `MACUXI_ATIVOS_MARCA` (pasta dos ativos) ou, sem ela, subindo a partir
 * deste arquivo até achar `docs/marca/ativos`. Ausente, `lerAssinaturaDaMarca` devolve `null`; quem gera o DANFE NÃO pode seguir sem o ativo
 * (a rota responde 503, o boot da API falha em `verificarAtivosDanfe` e a geração de amostras dá erro): rodapé omitido em silêncio é regressão.
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
 * Boot da API (ligado pelo engenheiro-software, que faz o log warn só com os nomes em `faltando`): confere se o PNG do rodapé está na imagem.
 * Diretório: `opcoes.diretorio`, depois `MACUXI_ATIVOS_MARCA`, depois `docs/marca/ativos/2026-11-22-v1`. NUNCA lança.
 * O resultado vai a `criarPluginFaturamento({ ativosDanfe })`: com `ok: false` a rota `/danfe` responde 503.
 */
export async function verificarAtivosDanfe(opcoes: { diretorio?: string } = {}): Promise<ResultadoAtivosDanfe> {
  try {
    const png = await lerAssinaturaDaMarca(opcoes.diretorio);
    return png ? { ok: true } : { ok: false, faltando: [ARQUIVO_ASSINATURA] };
  } catch {
    return { ok: false, faltando: [ARQUIVO_ASSINATURA] };
  }
}

/** Amostras e testes: o ativo é obrigatório, sem ele é ERRO (nunca um PDF sem rodapé). */
export async function exigirAssinaturaDaMarca(diretorio?: string): Promise<Uint8Array> {
  const png = await lerAssinaturaDaMarca(diretorio);
  if (!png) throw new Error(`${MENSAGEM_ATIVO_AUSENTE}: ${ARQUIVO_ASSINATURA}`);
  return png;
}
