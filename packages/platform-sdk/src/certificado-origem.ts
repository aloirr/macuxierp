/**
 * Origem do certificado A1 (T-0080). Espelha a coluna `core.certificado.origem` (migração 0047): 'upload' é o A1 do
 * cliente; 'teste' é o A1 gerado pela Macuxi para homologação com o simulador (ADR 0008), padrão 'upload'.
 *
 * Regra (CLAUDE.md regra 7, RN-CORE-08, RN-FAT-04, ADR 0005): homologação e produção separadas por tenant e filial
 * emissora; o A1 de teste nunca assina em produção. O banco tem a mesma trava; a API revalida com esta função.
 *
 * Sem Node: serve também ao web (subcaminho `@macuxierp/platform-sdk/certificado-origem`).
 */
import { z } from 'zod';

export const ORIGENS_CERTIFICADO = ['upload', 'teste'] as const;
export const OrigemCertificado = z.enum(ORIGENS_CERTIFICADO);
export type OrigemCertificado = z.infer<typeof OrigemCertificado>;

/** Padrão da coluna `core.certificado.origem`. */
export const ORIGEM_CERTIFICADO_PADRAO: OrigemCertificado = 'upload';

/** Texto fixo da tela do certificado quando a origem é 'teste'. */
export const AVISO_CERTIFICADO_DE_TESTE = 'Certificado de teste: só homologação' as const;

/** false só para A1 de teste em produção (CLAUDE.md regra 7, RN-CORE-08, ADR 0005/0008). */
export function podeUsarCertificadoNoAmbiente(
  origem: OrigemCertificado,
  ambiente: 'homologacao' | 'producao',
): boolean {
  return !(origem === 'teste' && ambiente === 'producao');
}
