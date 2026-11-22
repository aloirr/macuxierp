/** Arquivos que o shell repassa da API (parte pura): só os caminhos que uma tela declarou como download. */
import { PAGINAS_FATURAMENTO } from '@macuxierp/faturamento/web';
import { UUID_PADRAO } from './uuid';

/** Raiz da API do faturamento (`/v1/faturamento`), tirada da rota da lista de notas declarada pelo módulo. */
export const BASE_API = (PAGINAS_FATURAMENTO.find((p) => p.id === 'notas')?.api ?? '/v1/faturamento/notas').replace(/\/notas$/, '');

const PERMITIDOS: readonly RegExp[] = [new RegExp(`^${BASE_API}/notas/${UUID_PADRAO}/(xml|danfe)$`)];

/** `/v1/faturamento/notas/<uuid>/xml` ou `/danfe`; qualquer outro caminho (outra rota, `..`, consulta) é recusado. */
export const arquivoPermitido = (caminho: string): boolean => PERMITIDOS.some((p) => p.test(caminho));
