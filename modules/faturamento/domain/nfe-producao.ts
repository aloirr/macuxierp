import type { Ambiente, StatusNota } from '../contracts';

/**
 * RN-CORE-16: status em que a nota já foi protocolada (autorizada) pela SEFAZ. `cancelada` entra porque só se cancela nota autorizada
 * (RN-FAT-02; CHECK `nota_protocolada`): o CNPJ já foi usado em produção. `emitida_contingencia` fica de fora (ainda sem protocolo).
 * Fonte única: a consulta SQL do `api` recebe esta lista como parâmetro.
 */
export const STATUS_NFE_AUTORIZADA_EM_PRODUCAO: readonly StatusNota[] = ['autorizada_guarda_pendente', 'autorizada', 'cancelada'];

/** RN-CORE-16: a nota (ambiente e status) conta como "a empresa teve NF-e autorizada em produção". Homologação nunca conta. */
export function teveNfeAutorizadaEmProducao(ambiente: Ambiente, status: StatusNota): boolean {
  return ambiente === 'producao' && STATUS_NFE_AUTORIZADA_EM_PRODUCAO.includes(status);
}
