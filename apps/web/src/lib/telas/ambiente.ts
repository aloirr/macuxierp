import type { AmbienteFiscal } from '@macuxierp/core/contracts';

/**
 * Filial sem linha de ambiente vale homologação (RN-CORE-08; a API faz o mesmo na consulta por filial). A lista da API traz só as filiais
 * com linha gravada, então o quadro parte das filiais do cadastro e completa as que faltam, para não dizer "nenhuma filial" com a Matriz cadastrada.
 */
export function ambientesComPadrao(ambientes: readonly AmbienteFiscal[], filiaisDoCadastro: readonly string[]): AmbienteFiscal[] {
  const com = new Set(ambientes.map((a) => a.filial_id));
  const faltam = filiaisDoCadastro.filter((id) => !com.has(id)).map((filial_id): AmbienteFiscal => ({ filial_id, ambiente: 'homologacao', recado_aprovacao: null }));
  return [...ambientes, ...faltam];
}
