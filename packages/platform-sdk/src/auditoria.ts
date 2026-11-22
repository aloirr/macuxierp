/**
 * Auditoria (RF-CORE-05): `auditar()` grava em `plataforma.auditoria` (só inserção) as ações marcadas com (A) no
 * desenho T-0002. Segredo nunca entra: campos de senha, token, certificado e cifra viram "[omitido]" (regra 9).
 */
import type { Transacao } from './banco';

export interface RegistroAuditoria {
  tenant_id: string;
  /** `null` = operador ou sistema (ex.: scripts/plataforma/licenca.mjs). */
  usuario_id: string | null;
  acao: string;
  entidade: string;
  entidade_id: string;
  antes: unknown;
  depois: unknown;
  request_id: string;
  ocorrido_em: Date;
}

export interface DestinoAuditoria {
  inserir(tx: Transacao, registro: RegistroAuditoria): Promise<void>;
}

export const OMITIDO = '[omitido]';
const CAMPO_SECRETO = /senha|segredo|token|refresh|pfx|cifrad|nonce|_hash$|^hash_/i;

/** Copia o valor trocando o conteúdo de campos secretos por "[omitido]", em qualquer profundidade. */
export function semSegredos(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semSegredos);
  if (valor instanceof Date) return valor.toISOString();
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, CAMPO_SECRETO.test(k) ? OMITIDO : semSegredos(v)]),
    );
  }
  return valor;
}

export interface ContextoAuditoria {
  tenant_id: string;
  usuario_id: string | null;
  request_id: string;
}

export interface DadosAuditoria {
  acao: string;
  entidade: string;
  entidade_id: string;
  antes?: unknown;
  depois?: unknown;
}

/** Grava a auditoria na transação corrente (a mesma da escrita auditada). */
export async function auditar(
  destino: DestinoAuditoria,
  tx: Transacao,
  ctx: ContextoAuditoria,
  dados: DadosAuditoria,
  agora: Date,
): Promise<RegistroAuditoria> {
  const registro: RegistroAuditoria = {
    ...ctx,
    acao: dados.acao,
    entidade: dados.entidade,
    entidade_id: dados.entidade_id,
    antes: semSegredos(dados.antes ?? null),
    depois: semSegredos(dados.depois ?? null),
    ocorrido_em: agora,
  };
  await destino.inserir(tx, registro);
  return registro;
}
