/** Peças comuns do transmissor (autorização) e do processador de eventos: destino do log, medição da chamada à SEFAZ e A1 aberto só em memória. */
import { ErroCertificadoA1 } from '@macuxierp/nfe-emissor';
import type { SefazTransporte } from '@macuxierp/nfe-sefaz';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import type { A1DaFilial, TransmissaoRegistrada } from './portas';

export const destinoDoLog = (t: SefazTransporte): TransmissaoRegistrada['destino'] => (t.destino.tipo === 'simulador' ? 'simulador' : t.destino.modo === 'normal' ? 'sefaz_am' : 'svc');

type LinhaDeChamada = Omit<TransmissaoRegistrada, 'nota_id' | 'servico'>;

/** Faz a chamada, mede o tempo e acrescenta a linha do log (sem XML, sem dado pessoal); `base` traz o serviço e a referência (nota, evento ou inutilização). */
export async function medir<T extends { cStat: string; xMotivo: string }, B extends object>(
  agora: () => Date, t: SefazTransporte, chamar: () => Promise<T>, base: B, log: (B & LinhaDeChamada)[],
): Promise<T> {
  const inicio = agora();
  const r = await chamar();
  const fim = agora();
  log.push({ ...base, destino: destinoDoLog(t), cStat: r.cStat, xMotivo: r.xMotivo.slice(0, 255), enviada_em: inicio.toISOString(), respondida_em: fim.toISOString(), duracao_ms: Math.max(0, fim.getTime() - inicio.getTime()) });
  return r;
}

/** Grava (e esvazia) o log das chamadas já feitas, na tx que o chamador abriu. */
export async function descarregar<L>(log: L[], gravar: (l: L) => Promise<void>): Promise<void> {
  for (const l of log.splice(0)) await gravar(l);
}

/**
 * Um único ponto zera o pfx: tudo que não entrega o A1 ao chamador (retorno cedo, exceção, falha do commit) cai no finally.
 * `abrirA1` devolve `null` para filial sem A1 ativo e deixa passar o `ErroCertificadoA1` (vencido, senha) para o chamador decidir.
 */
export async function comA1<T extends { a1?: A1DaFilial }>(
  banco: Banco,
  lerA1: (tx: Transacao, filial_id: string) => Promise<A1DaFilial | null>,
  tenant_id: string,
  corpo: (tx: Transacao, abrirA1: (filial_id: string) => Promise<A1DaFilial | null>) => Promise<T>,
): Promise<T> {
  let aberto: A1DaFilial | null = null;
  let entregue = false;
  try {
    const p = await banco.comTenant(tenant_id, (tx) =>
      corpo(tx, async (filial_id) => {
        aberto = await lerA1(tx, filial_id);
        return aberto;
      }));
    entregue = p.a1 !== undefined;
    return p;
  } finally {
    if (!entregue) (aberto as A1DaFilial | null)?.credencial.pfx.fill(0);
  }
}

/** Como `abrirA1`, mas A1 inválido (`ErroCertificadoA1`) vira `null`: em evento não há motivo a gravar na nota. */
export async function abrirA1OuNulo(abrirA1: (filial_id: string) => Promise<A1DaFilial | null>, filial_id: string): Promise<A1DaFilial | null> {
  try {
    return await abrirA1(filial_id);
  } catch (e) {
    if (!(e instanceof ErroCertificadoA1)) throw e;
    return null;
  }
}
