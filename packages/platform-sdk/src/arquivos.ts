/**
 * Arquivos no mesmo S3 do FDV, sempre sob `macuxierp/<tenant>/...` (doc 04, "Arquivos").
 * `guardarArquivo` grava o conteúdo ANTES do catálogo (`plataforma.arquivo`): o XML autorizado é guardado antes de
 * qualquer outra coisa (RN-FAT-03). Imutável = gravado uma vez (If-None-Match: *); regravar o mesmo conteúdo é
 * idempotente, conteúdo diferente é conflito.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Transacao } from './banco';
import { erros } from './erros';

export const PREFIXO_ARQUIVOS = 'macuxierp';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Chave do objeto: `macuxierp/<tenant>/<partes...>`. Recusa tenant fora de UUID e parte com `..`, `/` ou vazia. */
export function chaveArquivo(tenantId: string, ...partes: string[]): string {
  if (!UUID.test(tenantId)) throw new RangeError('chaveArquivo: tenant não é UUID');
  if (partes.length === 0) throw new RangeError('chaveArquivo: informe ao menos uma parte');
  for (const p of partes) {
    if (!PARTE.test(p) || p.includes('..')) throw new RangeError(`chaveArquivo: parte inválida "${p}"`);
  }
  return [PREFIXO_ARQUIVOS, tenantId.toLowerCase(), ...partes].join('/');
}

export class ArquivoJaExiste extends Error {
  override readonly name = 'ArquivoJaExiste';
}

/** Porta do armazenamento (S3 em produção; memória nos testes). */
export interface Armazenamento {
  /** `imutavel`: falha com `ArquivoJaExiste` se a chave já existe. */
  gravar(chave: string, corpo: Uint8Array, opcoes: { tipo: string; imutavel: boolean }): Promise<void>;
  ler(chave: string): Promise<Uint8Array | null>;
  urlAssinada(chave: string, segundos: number): Promise<string>;
}

export class ArmazenamentoMemoria implements Armazenamento {
  readonly objetos = new Map<string, { corpo: Uint8Array; tipo: string; imutavel: boolean }>();

  async gravar(chave: string, corpo: Uint8Array, opcoes: { tipo: string; imutavel: boolean }): Promise<void> {
    const atual = this.objetos.get(chave);
    if (atual && (opcoes.imutavel || atual.imutavel)) throw new ArquivoJaExiste(chave);
    this.objetos.set(chave, { corpo: Uint8Array.from(corpo), ...opcoes });
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    return this.objetos.get(chave)?.corpo ?? null;
  }

  async urlAssinada(chave: string, segundos: number): Promise<string> {
    return `memoria://${chave}?expira=${segundos}`;
  }
}

/** Linha de `plataforma.arquivo`. */
export interface RegistroArquivo {
  id: string;
  tenant_id: string;
  chave_s3: string;
  tipo: string;
  sha256: string;
  tamanho: number;
  imutavel: boolean;
  guarda_ate: Date | null;
}

export interface CatalogoArquivos {
  inserir(tx: Transacao, registro: RegistroArquivo): Promise<void>;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export interface PedidoGuarda {
  armazenamento: Armazenamento;
  catalogo: CatalogoArquivos;
  tx: Transacao;
  tenantId: string;
  partes: string[];
  corpo: Uint8Array;
  tipo: string;
  imutavel: boolean;
  /** Guarda mínima em anos (fiscal: 5, regra 7); `null` = sem prazo. */
  guardaAnos: number | null;
  agora: Date;
}

export async function guardarArquivo(p: PedidoGuarda): Promise<RegistroArquivo> {
  const chave = chaveArquivo(p.tenantId, ...p.partes);
  const hash = sha256(p.corpo);
  try {
    await p.armazenamento.gravar(chave, p.corpo, { tipo: p.tipo, imutavel: p.imutavel });
  } catch (e) {
    if (!(e instanceof ArquivoJaExiste)) throw e;
    const existente = await p.armazenamento.ler(chave);
    if (!existente || sha256(existente) !== hash) throw erros.conflito('Arquivo imutável já gravado com outro conteúdo');
  }
  let guardaAte: Date | null = null;
  if (p.guardaAnos !== null) {
    guardaAte = new Date(p.agora.getTime());
    guardaAte.setUTCFullYear(guardaAte.getUTCFullYear() + p.guardaAnos);
  }
  const registro: RegistroArquivo = {
    id: randomUUID(),
    tenant_id: p.tenantId,
    chave_s3: chave,
    tipo: p.tipo,
    sha256: hash,
    tamanho: p.corpo.byteLength,
    imutavel: p.imutavel,
    guarda_ate: guardaAte,
  };
  await p.catalogo.inserir(p.tx, registro);
  return registro;
}
