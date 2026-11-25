import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { fontesHttp } from './fontes-http';
import type { Dependencias, PortaCertificados } from './portas';
import { criarRotas } from './rotas';
import { repositoriosSql } from './sql';

export { criarConsumidorEstoqueNota, externalDoMovimentoDaNota, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_CANCELADA } from './consumidor-estoque-nota';
export { criarConsumidorCargaInicial, criarExecutorCargaInicial } from './carga-inicial';
export { criarConsultaParaFaturamento } from './consulta-faturamento';
export type { ConsultaCadastrosParaFaturamento } from './consulta-faturamento';
export { criarConsultaParaFiscal } from './consulta-fiscal';
export type { ConsultaCadastrosParaFiscal, EmitenteParaFiscal } from './consulta-fiscal';
export { criarConsultaParaPedido } from './consulta-pedido';
export type { ConsultaCadastrosParaPedido } from './consulta-pedido';
export { criarExecutorConsultaIe, type PortaConsultaCadastro } from './executor-ie';
export { criarConsultaCnpjParaCore, type DependenciasConsultaCnpjParaCore } from './consulta-cnpj-core';
export { criarCriadorClienteFdv, type CriadorClienteFdv, type ConferirVendedorFdv, type DecisaoCriadorClienteFdv, type DependenciasCriadorClienteFdv } from './criador-cliente-fdv';
export { criarResolvedorChaveErp, type ResolvedorChaveErp } from './resolvedor-chave';
export { exportadorCadastros } from './exportador';
export { fontesHttp } from './fontes-http';
export type { Dependencias, FonteExterna, Fontes, PortaCertificados, RepoChaves, Repositorios, TabelaChave } from './portas';
export { exigirFraseSubstituir, gravarCargaPortal, validarCargaPortal, type EntradaCargaPortal } from './carga-portal';
export { criarPluginPlataformaCadastros, type DependenciasPlataformaCadastros } from './carga-portal-rotas';
export type { CadastroZeravel, ConsultaUsoCadastros, MotivoUso } from './zeragem-portas';
export { criarRotas } from './rotas';
export { repositoriosSql } from './sql';

/** Enquanto o core não entrega a porta do A1 (pedido da T-0007), nenhuma filial tem A1 válido: a IE responde 422 RN-CORE-06. */
const semCertificados: PortaCertificados = { filialTemA1Valido: async () => false };

export function criarPluginCadastros(deps: Dependencias): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}

/** Plugin de produção: adaptador SQL na transação do tenant e fontes HTTP reais. A API monta este plugin em `/v1/cadastros`. */
export const plugin: PluginModulo = criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: semCertificados });

export { criarPluginPlataformaCadastrosZerar } from './zeragem';
export type { DependenciasZeragemPlataforma, EstadoEntidadeIntegracao, EstadoIntegracaoPlataforma, RefsUso, UsoDaTabela, UsosCadastroPlataforma, UsuariosFiliaisPlataforma } from './zeragem-portas';
