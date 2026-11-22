/**
 * Leitura do A1 decifrado da filial emissora, para o worker assinar a NF-e (T-0021; ADR 0005, RN-CORE-06).
 * Roda na `Transacao` do tenant (`comTenant`, RLS): o papel `macuxierp_worker` tem SELECT em `core.certificado`; o
 * `macuxierp_app` não lê as colunas cifradas. A chave mestra (`MACUXIERP_CHAVE_A1`) vem do secret do servidor.
 *
 * Segredos (regras 8 e 9): o PKCS#12 e a senha ficam só em memória. Nada é logado, nenhum erro os cita e o resultado
 * oculta os dois em `JSON.stringify`, `toString` e `util.inspect`. Quem recebe deve zerar o `pfx` ao terminar.
 */
import { inspect } from 'node:util';
import type { Transacao } from '@macuxierp/platform-sdk';
import { Id } from '../contracts';
import { decifrarA1 } from './cifra';

/** A1 decifrado de uma filial. `pfx` e `senha` são não enumeráveis e ocultos em serialização e inspeção. */
export interface A1DecifradoDaFilial {
  readonly certificado_id: string;
  readonly pfx: Buffer;
  readonly senha: string;
}

interface LinhaA1 {
  id: string;
  tenant_id: string;
  chave_versao: number;
  pfx_cifrado: Buffer;
  pfx_nonce: Buffer;
  senha_cifrada: Buffer;
  senha_nonce: Buffer;
}

/**
 * Devolve o A1 ativo e não excluído da filial, ou `null` quando não há (o worker trata como "sem certificado").
 * Id de filial inválido lança erro do Zod. Se a chave ou o tenant da linha não abrirem o cifrado, lança erro genérico
 * (sem o conteúdo).
 */
export async function lerA1DecifradoDaFilial(tx: Transacao, chave: Buffer, filialId: string): Promise<A1DecifradoDaFilial | null> {
  const filial = Id.parse(filialId);
  const [linha] = await tx.consultar<LinhaA1>(
    `SELECT id, tenant_id, chave_versao, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce
       FROM core.certificado WHERE filial_id = $1 AND ativo AND deleted_at IS NULL
      ORDER BY created_at DESC, id LIMIT 1`,
    [filial],
  );
  if (!linha) return null;
  if (linha.chave_versao !== 1) throw new Error('Versão da chave do A1 não suportada');
  let aberto: { pfx: Buffer; senha: string };
  try {
    aberto = decifrarA1({ chave, tenantId: linha.tenant_id, pfx_cifrado: linha.pfx_cifrado, pfx_nonce: linha.pfx_nonce, senha_cifrada: linha.senha_cifrada, senha_nonce: linha.senha_nonce });
  } catch {
    throw new Error('Não foi possível decifrar o A1 da filial (chave ou tenant não conferem)');
  }
  const rotulo = () => `A1DecifradoDaFilial(${linha.id})`;
  const r = { certificado_id: linha.id } as A1DecifradoDaFilial;
  Object.defineProperty(r, 'pfx', { value: aberto.pfx, enumerable: false });
  Object.defineProperty(r, 'senha', { value: aberto.senha, enumerable: false });
  Object.defineProperty(r, 'toJSON', { value: () => ({ certificado_id: linha.id }), enumerable: false });
  Object.defineProperty(r, 'toString', { value: rotulo, enumerable: false });
  Object.defineProperty(r, inspect.custom, { value: rotulo, enumerable: false });
  return r;
}
