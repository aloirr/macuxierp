/** Arquivos que o shell repassa da API (parte pura): só os caminhos que uma tela declarou como download. */
import { BASE_API } from '@macuxierp/faturamento/web';
import { UUID_PADRAO } from './uuid';

export { BASE_API };

const PERMITIDOS: readonly RegExp[] = [new RegExp(`^${BASE_API}/notas/${UUID_PADRAO}/(xml|danfe)$`)];

/** `/v1/faturamento/notas/<uuid>/xml` ou `/danfe`; qualquer outro caminho (outra rota, `..`, consulta) é recusado. */
export const arquivoPermitido = (caminho: string): boolean => PERMITIDOS.some((p) => p.test(caminho));
