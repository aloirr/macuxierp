// T-0080: provisório; trocar pelo import de @macuxierp/platform-sdk/certificado-origem
import { z } from 'zod';

export const ORIGENS_CERTIFICADO = ['upload', 'teste'] as const;
export const OrigemCertificado = z.enum(ORIGENS_CERTIFICADO);
export type OrigemCertificado = z.infer<typeof OrigemCertificado>;
export const ORIGEM_CERTIFICADO_PADRAO: OrigemCertificado = 'upload';
export const AVISO_CERTIFICADO_DE_TESTE = 'Certificado de teste: só homologação';
