/** Busca das listas que filtram ao digitar (Empresas, Usuários): sem acento, sem caixa e sem espaço nas pontas. */
export const semAcento = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
