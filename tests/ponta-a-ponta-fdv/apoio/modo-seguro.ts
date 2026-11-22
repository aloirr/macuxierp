/**
 * T-0012: os dois únicos cenários do perfil `thathyany-seguro` (decisão do Alexandre, 21/11/2026 23h12 de Manaus), com a
 * massa do kit (`massa-kit.ts`) e lotes pequenos:
 *  - carga idêntica: manda, em delta, os registros IDÊNTICOS aos do kit; o FDV não pode mudar nada (nenhuma nova,
 *    nenhuma atualizada, nenhum erro). Primeiro um lote-sonda de 1 registro por entidade (todas as entidades); só com
 *    todas as sondas sem mudança saem as fatias de até `limite` com o resto. O primeiro lote fora disso para a carga: o
 *    seguinte não sai. ATENÇÃO: o lote que dispara a parada JÁ FOI APLICADO no FDV (a sonda limita o estrago a 1
 *    registro quando a divergência está no 1º registro da entidade);
 *  - reenvio idempotente: reenvia cada lote aceito com o MESMO corpo e a MESMA `Idempotency-Key`; o Hub responde
 *    `Idempotent-Replay`, com o mesmo `lote_id` e as mesmas contagens.
 * Nenhum dos dois cria, inativa ou altera dado no FDV. O 422 `entidade_de_outro_conector` (o kit ainda é o dono) para o
 * arnês inteiro, sem insistir (`LadoErp.parado`).
 */
import { emFatias, type EntidadeHub, type RegistroHub } from './contrato-hub';
import type { LadoErp, LoteEnviado } from './lado-erp';
import type { MassaKit } from './massa-kit';

export type MotivoInterrupcao = 'topologia' | 'recusa' | 'mudaria_o_fdv' | 'erro_de_linha';

export interface ResultadoCargaIdentica {
  lotes: LoteEnviado[];
  porEntidade: Map<EntidadeHub, LoteEnviado[]>;
  /** Motivo do primeiro lote fora do esperado (o seguinte não sai); `null` = foi tudo. */
  interrompida: { motivo: MotivoInterrupcao; entidade: EntidadeHub } | null;
}

/** O lote não mudou nada no FDV: aceito, concluído sem erro, nada novo nem atualizado. */
export function loteSemMudanca(l: LoteEnviado): MotivoInterrupcao | null {
  if (l.pausada === 'topologia') return 'topologia';
  if (l.pausada || l.recusa || l.http !== 202 || !l.resultado) return 'recusa';
  const c = l.resultado.contagens;
  if (c.com_erro > 0 || l.resultado.erros.length > 0 || l.resultado.status !== 'concluido')
    return 'erro_de_linha';
  if (c.novas > 0 || c.atualizadas > 0) return 'mudaria_o_fdv';
  return null;
}

export async function cargaIdentica(
  erp: LadoErp,
  massa: MassaKit,
  entidades: readonly EntidadeHub[],
  limite: number,
): Promise<ResultadoCargaIdentica> {
  const lotes: LoteEnviado[] = [];
  const porEntidade = new Map<EntidadeHub, LoteEnviado[]>(entidades.map((e) => [e, []]));
  const registrosDe = (e: EntidadeHub): readonly RegistroHub[] => massa.registros[e] ?? [];
  /** Envia um lote e devolve o motivo da parada, ou `null` para seguir. */
  const enviar = async (entidade: EntidadeHub, registros: readonly RegistroHub[]) => {
    const enviados = await erp.publicar({ entidade, modo: 'delta', registros });
    lotes.push(...enviados);
    porEntidade.get(entidade)!.push(...enviados);
    for (const l of enviados) {
      const motivo = loteSemMudanca(l);
      if (motivo) return { motivo, entidade };
    }
    return erp.parado ? { motivo: 'topologia' as const, entidade } : null;
  };
  // 1) lote-sonda: o 1º registro de cada entidade, antes de qualquer fatia
  for (const entidade of entidades) {
    const sonda = registrosDe(entidade).slice(0, 1);
    if (!sonda.length) continue;
    const parada = await enviar(entidade, sonda);
    if (parada) return { lotes, porEntidade, interrompida: parada };
  }
  // 2) o resto, em fatias de até `limite`
  for (const entidade of entidades) {
    for (const fatia of emFatias(registrosDe(entidade).slice(1), limite)) {
      const parada = await enviar(entidade, fatia);
      if (parada) return { lotes, porEntidade, interrompida: parada };
    }
  }
  return { lotes, porEntidade, interrompida: null };
}

/** Reenvia cada lote aceito, um a um, com o mesmo corpo e a mesma chave. */
export async function reenvioIdempotente(
  erp: LadoErp,
  aceitos: readonly LoteEnviado[],
): Promise<{ original: LoteEnviado; reenvio: LoteEnviado }[]> {
  const pares: { original: LoteEnviado; reenvio: LoteEnviado }[] = [];
  for (const original of aceitos) {
    if (!original.loteId) continue;
    pares.push({ original, reenvio: await erp.reenviar(original) });
  }
  return pares;
}

/** Valores de texto da massa do kit (fora identificadores e `alterado_em`) para conferir que nenhum sai em log (LGPD). */
export function valoresDaMassa(massa: MassaKit): string[] {
  const vistos = new Set<string>();
  const coletar = (v: unknown): void => {
    if (typeof v === 'string' && v.length >= 4) vistos.add(v);
    else if (Array.isArray(v)) v.forEach(coletar);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(coletar);
  };
  for (const lista of Object.values(massa.registros)) {
    for (const r of lista ?? []) {
      // identificadores (o próprio e as referências `*_external_id`) podem sair no log; o resto, nunca
      for (const [campo, v] of Object.entries(r))
        if (campo !== 'alterado_em' && !campo.endsWith('external_id')) coletar(v);
    }
  }
  return [...vistos];
}
