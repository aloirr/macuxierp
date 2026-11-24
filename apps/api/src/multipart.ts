/**
 * Leitura do `multipart/form-data` das rotas declaradas (tenant em `app.ts` e portal `/config` em `plataforma/rotas.ts`,
 * T-0058): os mesmos limites por arquivo, quantidade e total da rota; os bytes ficam só em memória.
 */
import { ArquivoRecebido, erros, tamanhoMaximoTotal, type ArquivoEsperado, type MultipartRota } from '@macuxierp/platform-sdk';
import type { FastifyRequest } from 'fastify';

/**
 * Lê o `multipart/form-data` da rota: campos de texto (validados depois pelo `corpo` da rota) e os arquivos declarados,
 * cada um com o próprio limite (413 `ARQUIVO_GRANDE`), a quantidade do campo e o total da rota (413 `ARQUIVO_GRANDE`
 * em `_`). Campo de texto repetido, arquivo não declarado ou acima da quantidade é 400 `VALIDACAO`. Limite da rota igual
 * ao teto global: o `@fastify/multipart` corta antes e o 413 dele vira `ARQUIVO_GRANDE` do campo.
 */
export async function lerMultipart(req: FastifyRequest, m: MultipartRota) {
  if (!req.isMultipart()) throw erros.validacao({ _: 'envie multipart/form-data' });
  const porCampo = new Map(m.arquivos.map((a) => [a.campo, a]));
  const corpo: Record<string, unknown> = {};
  const todosArquivos: Record<string, ArquivoRecebido[]> = {};
  let lendo: ArquivoEsperado | undefined;
  try {
    await lerPartes(req, { porCampo, total: tamanhoMaximoTotal(m) }, corpo, todosArquivos, (a) => (lendo = a));
  } catch (e) {
    if (lendo && (e as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') throw erros.arquivoGrande(lendo.campo, lendo.tamanhoMaximo);
    throw e;
  }
  const faltando = m.arquivos.filter((a) => a.obrigatorio !== false && !todosArquivos[a.campo]);
  if (faltando.length) throw erros.validacao(Object.fromEntries(faltando.map((a) => [a.campo, 'arquivo obrigatório'])));
  return { corpo, todosArquivos };
}

async function lerPartes(
  req: FastifyRequest,
  limites: { porCampo: ReadonlyMap<string, ArquivoEsperado>; total: number },
  corpo: Record<string, unknown>,
  arquivos: Record<string, ArquivoRecebido[]>,
  lendo: (a: ArquivoEsperado) => void,
) {
  let totalLote = 0;
  for await (const parte of req.parts()) {
    if (parte.type === 'field') {
      if (parte.fieldname in corpo || limites.porCampo.has(parte.fieldname)) throw erros.validacao({ [parte.fieldname]: 'campo repetido ou no lugar de arquivo' });
      corpo[parte.fieldname] = parte.value;
      continue;
    }
    const esperado = limites.porCampo.get(parte.fieldname);
    const ja = arquivos[parte.fieldname] ?? [];
    if (!esperado || parte.fieldname in corpo) throw erros.validacao({ [parte.fieldname]: 'arquivo não esperado' });
    const maximo = esperado.quantidadeMaxima ?? 1;
    if (ja.length >= maximo) throw erros.validacao({ [parte.fieldname]: maximo === 1 ? 'arquivo repetido' : `no máximo ${maximo} arquivos` });
    lendo(esperado);
    const pedacos: Buffer[] = [];
    let total = 0;
    for await (const p of parte.file as AsyncIterable<Buffer>) {
      total += p.length;
      totalLote += p.length;
      if (total > esperado.tamanhoMaximo) throw erros.arquivoGrande(esperado.campo, esperado.tamanhoMaximo);
      if (totalLote > limites.total) throw erros.arquivoGrande('_', limites.total);
      pedacos.push(p);
    }
    if (total === 0) throw erros.validacao({ [esperado.campo]: 'arquivo vazio' });
    arquivos[esperado.campo] = [...ja, new ArquivoRecebido(esperado.campo, parte.filename, parte.mimetype, Buffer.concat(pedacos))];
  }
}
