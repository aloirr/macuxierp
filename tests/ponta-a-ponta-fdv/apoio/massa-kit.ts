/**
 * T-0012: massa do perfil `thathyany-seguro` — os dados IDÊNTICOS aos do kit da thathyany (mesmos `external_id` e mesmos
 * valores), vindos da carga da T-0026, num arquivo JSON fora do repositório (`MACUXI_HUB_MASSA_KIT`). Decisão do
 * Alexandre, 21/11/2026 23h12 de Manaus: na thathyany, nada inventado; dado novo fica só no dublê.
 *
 * Formato do arquivo (docs/testes/T-0012.md, "Perfis do alvo"):
 *   { "fonte": "kit" | "T-0026", "registros": { "<entidade do Hub>": [ { "external_id": "...", "alterado_em": "...Z", ... } ] } }
 *
 * A `fonte` é DECLARADA pelo próprio arquivo: o arnês confere o valor, não a origem. Quem monta o arquivo responde por
 * ele ter vindo do kit/T-0026; a carga idêntica (lote-sonda primeiro) é a conferência possível contra o FDV.
 *
 * O arquivo tem dado de cliente: fica fora do repositório (a leitura recusa caminho dentro dele) e nenhuma mensagem
 * daqui cita valor de campo, só entidade, índice e quantidade.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_HORA_UTC, ORDEM_CARGA_HUB, type EntidadeHub, type RegistroHub } from './contrato-hub';

export const FONTES_MASSA_KIT = ['kit', 'T-0026'] as const;
export type FonteMassaKit = (typeof FONTES_MASSA_KIT)[number];
/** Teto do arquivo: a massa do modo seguro é pequena por definição (lotes de até 100). */
export const LIMITE_BYTES_MASSA_KIT = 50 * 1024 * 1024;

export const RAIZ_REPOSITORIO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export class ErroMassaKit extends Error {
  override readonly name = 'ErroMassaKit';
}

export interface MassaKit {
  fonte: FonteMassaKit;
  /** Caminho absoluto do arquivo (não é segredo; o conteúdo é). */
  caminho: string;
  registros: Partial<Record<EntidadeHub, RegistroHub[]>>;
  /** O arquivo é lido uma vez; `toJSON`/`inspect` não despejam o conteúdo. */
  toJSON(): Record<string, unknown>;
}

const ehEntidade = (e: string): e is EntidadeHub => (ORDEM_CARGA_HUB as readonly string[]).includes(e);

/** Dentro do repositório = dentro da raiz (o arquivo com dado de cliente nunca pode ir num commit). */
export function dentroDoRepositorio(caminho: string, raiz = RAIZ_REPOSITORIO): boolean {
  const rel = relative(raiz, resolve(caminho));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Valida a estrutura sem citar valor; devolve a massa congelada. */
export function validarMassaKit(bruto: unknown, caminho: string): MassaKit {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto))
    throw new ErroMassaKit('massa do kit: o arquivo deve ser um objeto JSON.');
  const o = bruto as Record<string, unknown>;
  if (typeof o.fonte !== 'string' || !(FONTES_MASSA_KIT as readonly string[]).includes(o.fonte)) {
    throw new ErroMassaKit(
      'massa do kit: "fonte" deve ser "kit" ou "T-0026" (dados idênticos aos do kit, nada inventado).',
    );
  }
  const regs = o.registros;
  if (!regs || typeof regs !== 'object' || Array.isArray(regs))
    throw new ErroMassaKit('massa do kit: "registros" deve ser um objeto por entidade.');
  const registros: Partial<Record<EntidadeHub, RegistroHub[]>> = {};
  for (const [entidade, lista] of Object.entries(regs as Record<string, unknown>)) {
    if (!ehEntidade(entidade))
      throw new ErroMassaKit(
        `massa do kit: entidade desconhecida no Hub (${entidade.slice(0, 40).replace(/[^a-z_]/g, '?')}).`,
      );
    if (!Array.isArray(lista)) throw new ErroMassaKit(`massa do kit: "${entidade}" deve ser uma lista.`);
    const vistos = new Set<string>();
    lista.forEach((r: unknown, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r))
        throw new ErroMassaKit(`massa do kit: ${entidade}[${i}] não é um objeto.`);
      const x = r as Record<string, unknown>;
      if (typeof x.external_id !== 'string' || x.external_id.length < 1 || x.external_id.length > 200) {
        throw new ErroMassaKit(`massa do kit: ${entidade}[${i}] sem external_id (até 200 caracteres).`);
      }
      if (typeof x.alterado_em !== 'string' || !DATA_HORA_UTC.test(x.alterado_em))
        throw new ErroMassaKit(`massa do kit: ${entidade}[${i}] sem alterado_em UTC (ISO 8601 com Z).`);
      if (vistos.has(x.external_id))
        throw new ErroMassaKit(`massa do kit: ${entidade}[${i}] repete um external_id da mesma entidade.`);
      vistos.add(x.external_id);
    });
    registros[entidade] = Object.freeze(
      lista.map((r) => Object.freeze({ ...(r as RegistroHub) })),
    ) as RegistroHub[];
  }
  const fonte = o.fonte as FonteMassaKit;
  const contagem = Object.fromEntries(Object.entries(registros).map(([e, l]) => [e, l?.length ?? 0]));
  return Object.freeze({
    fonte,
    caminho,
    registros: Object.freeze(registros),
    toJSON: () => ({ fonte, caminho, registros: contagem }),
  });
}

/** Lê `MACUXI_HUB_MASSA_KIT`: JSON fora do repositório, até 50 MiB. */
export function lerMassaKit(caminho: string, raiz = RAIZ_REPOSITORIO): MassaKit {
  if (!caminho)
    throw new ErroMassaKit(
      'MACUXI_HUB_MASSA_KIT ausente: o perfil thathyany-seguro só envia os dados do kit (T-0026).',
    );
  if (!caminho.toLowerCase().endsWith('.json'))
    throw new ErroMassaKit('MACUXI_HUB_MASSA_KIT deve apontar para um arquivo .json.');
  const absoluto = resolve(caminho);
  if (dentroDoRepositorio(absoluto, raiz))
    throw new ErroMassaKit(
      'MACUXI_HUB_MASSA_KIT dentro do repositório: o arquivo tem dado de cliente e fica fora dele (LGPD).',
    );
  let tamanho: number;
  try {
    const s = statSync(absoluto);
    if (!s.isFile()) throw new Error('não é arquivo');
    tamanho = s.size;
  } catch {
    throw new ErroMassaKit('MACUXI_HUB_MASSA_KIT não aponta para um arquivo legível.');
  }
  if (tamanho > LIMITE_BYTES_MASSA_KIT)
    throw new ErroMassaKit('MACUXI_HUB_MASSA_KIT passa de 50 MiB: o modo seguro usa lotes pequenos.');
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(absoluto, 'utf8')) as unknown;
  } catch {
    // a mensagem do JSON.parse pode citar um trecho do arquivo: não sai daqui
    throw new ErroMassaKit('MACUXI_HUB_MASSA_KIT não é um JSON válido.');
  }
  return validarMassaKit(json, absoluto);
}
