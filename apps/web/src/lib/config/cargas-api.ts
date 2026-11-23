import { type CadastroZerarPortal, CAMINHOS_CARGAS_PLATAFORMA, CAMPO_ARQUIVO_CARGA_PORTAL, CAMPO_FRASE_CARGA_PORTAL, GravarCargaPlataformaResposta, SituacaoCargasPlataforma, ValidarCargaPlataformaResposta, type CadastroCargaPortal, type ModoGravarCarga, ZeragemPlataformaResposta, type PreviaZerarPlataformaEntrada, type ZerarDadosPlataformaEntrada } from '@macuxierp/platform-sdk';
import { chamar, idEmpresa, recusar, validado } from './api';

/**
 * Cliente das rotas de carga da plataforma (T-0058, contrato `portal-cargas.ts` do SDK). Só no servidor: o token do superadmin não
 * chega ao navegador, e o arquivo da carga passa só pela memória (nada do conteúdo vai a log). Carga síncrona: o validar, o erros e
 * o gravar recebem o arquivo; o modo vai na query e a frase no multipart.
 */

/** O arquivo pode ser grande e a API confere linha a linha: tempo próprio, acima do padrão. */
const TIMEOUT_CARGA_MS = 130_000;

type Chave = keyof typeof CAMINHOS_CARGAS_PLATAFORMA;
/** Caminho já preenchido (sem o prefixo de plataforma). `id` e `cadastro` são validados por quem chama. */
const caminho = (chave: Chave, id: string, cadastro = ''): string => CAMINHOS_CARGAS_PLATAFORMA[chave].replace(':id', idEmpresa(id)).replace(':cadastro', cadastro);

const formularioDe = (arquivo: Blob, nome: string, frase?: string): FormData => {
  const f = new FormData();
  f.append(CAMPO_ARQUIVO_CARGA_PORTAL, arquivo, nome);
  if (frase !== undefined) f.append(CAMPO_FRASE_CARGA_PORTAL, frase);
  return f;
};

export async function lerCargas(token: string, id: string): Promise<SituacaoCargasPlataforma> {
  return validado(await chamar('GET', caminho('situacao', id), { token }), SituacaoCargasPlataforma);
}

export async function validarCarga(token: string, id: string, cadastro: CadastroCargaPortal, arquivo: Blob, modo: ModoGravarCarga): Promise<ValidarCargaPlataformaResposta> {
  const r = await chamar('POST', `${caminho('validar', id, cadastro)}?modo=${modo}`, { token, formulario: formularioDe(arquivo, `${cadastro}.csv`), timeoutMs: TIMEOUT_CARGA_MS });
  return validado(r, ValidarCargaPlataformaResposta);
}

export async function gravarCarga(token: string, id: string, cadastro: CadastroCargaPortal, arquivo: Blob, chave: string, modo: ModoGravarCarga, frase?: string): Promise<GravarCargaPlataformaResposta> {
  const f = formularioDe(arquivo, `${cadastro}.csv`, modo === 'substituir_tudo' ? frase ?? '' : undefined);
  return validado(await chamar('POST', `${caminho('gravar', id, cadastro)}?modo=${modo}`, { token, formulario: f, chave, timeoutMs: TIMEOUT_CARGA_MS }), GravarCargaPlataformaResposta);
}

/** Zerar (RN-CAD-10): `POST .../cadastros/zerar` com `{ cadastros, frase }` e `Idempotency-Key`; a resposta é a `ZeragemPlataformaResposta`. */
export async function zerarCargas(token: string, id: string, cadastros: CadastroZerarPortal[], frase: string, chave: string): Promise<ZeragemPlataformaResposta> {
  const corpo: ZerarDadosPlataformaEntrada = { cadastros, frase };
  return validado(await chamar('POST', caminho('zerar', id), { token, corpo, chave }), ZeragemPlataformaResposta);
}

/** Prévia do zerar: `POST .../cadastros/zerar/previa` (só lê, sem `Idempotency-Key`) com os cadastros escolhidos. */
export async function lerPreviaZerar(token: string, id: string, cadastros: CadastroZerarPortal[]): Promise<ZeragemPlataformaResposta> {
  const corpo: PreviaZerarPlataformaEntrada = { cadastros };
  return validado(await chamar('POST', caminho('previa', id), { token, corpo }), ZeragemPlataformaResposta);
}

export interface ArquivoBaixado {
  corpo: ReadableStream<Uint8Array>;
  tipo: string;
}

const comoBaixado = (r: Response): ArquivoBaixado | Promise<never> => (!r.ok || !r.body ? recusar(r) : { corpo: r.body, tipo: r.headers.get('content-type') ?? 'text/csv; charset=utf-8' });

/** Modelo do cadastro: o corpo segue como veio da API, sem ler nem guardar. */
export async function baixarModelo(token: string, id: string, cadastro: CadastroCargaPortal): Promise<ArquivoBaixado> {
  return comoBaixado(await chamar('GET', caminho('modelo', id, cadastro), { token, timeoutMs: TIMEOUT_CARGA_MS }));
}

/** CSV com todas as linhas com erro: POST com o mesmo arquivo do validar (nada fica guardado na API). */
export async function baixarErros(token: string, id: string, cadastro: CadastroCargaPortal, arquivo: Blob): Promise<ArquivoBaixado> {
  return comoBaixado(await chamar('POST', caminho('erros', id, cadastro), { token, formulario: formularioDe(arquivo, `${cadastro}.csv`), timeoutMs: TIMEOUT_CARGA_MS }));
}
