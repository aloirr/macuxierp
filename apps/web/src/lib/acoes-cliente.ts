import { comVersao } from './acao-versao';
import { alterarModulosAcao as alterarModulosBruta, criarEmpresaAcao as criarEmpresaBruta, maisEmpresasAcao as maisEmpresasBruta, redefinirSenhaAdminAcao as redefinirSenhaAdminBruta, situacaoAcao as situacaoBruta } from '@/app/config/(portal)/empresas/acoes';
import { criarUsuarioAcao as criarUsuarioBruta, editarUsuarioAcao as editarUsuarioBruta, excluirUsuarioAcao as excluirUsuarioBruta, inativarUsuarioAcao as inativarUsuarioBruta, reativarUsuarioAcao as reativarUsuarioBruta, redefinirSenhaUsuarioAcao as redefinirSenhaUsuarioBruta } from '@/app/config/(portal)/empresas/acoes-usuarios';
import { gerarChaveEntradaAcao as gerarChaveBruta, revogarChaveEntradaAcao as revogarChaveBruta } from '@/app/config/(portal)/empresas/acoes-entrada';
import { previaReceitaAcao as previaReceitaBruta, revelarContatoAcao as revelarContatoBruta, salvarFichaAcao as salvarFichaBruta, trocarCnpjAcao as trocarCnpjBruta } from '@/app/config/(portal)/empresas/acoes-ficha';
import { cargaCompletaFdvAcao as cargaCompletaBruta, configurarFdvAcao as configurarFdvBruta, lerLogFdvAcao as lerLogFdvAcaoBruta, lerMonitorFdvAcao as lerMonitorBruta, reprocessarFdvAcao as reprocessarBruta, retomarFdvAcao as retomarBruta, salvarCredencialFdvAcao as salvarCredencialBruta, testarConexaoFdvAcao as testarConexaoBruta } from '@/app/config/(portal)/empresas/acoes-integracao-fdv';
import { trocarSenhaAcao as trocarSenhaConfigBruta } from '@/app/config/senha/acoes';
import { entrarConfigAction as entrarConfigBruta } from '@/app/(shell)/entrar-config';
import { ler as lerBruta, escrever as escreverBruta } from '@/app/(shell)/[modulo]/[...pagina]/acoes';
import { lerLogFdv as lerLogFdvBruta } from '@/app/(shell)/[modulo]/[...pagina]/acoes-log-fdv';
import { pedirEsqueciAction as pedirEsqueciBruta } from '@/app/login/esqueci';
import { trocarSenhaBkoAction as trocarSenhaBkoBruta } from '@/app/senha/acoes';

/**
 * ÚNICA porta das Server Actions chamadas por componente de cliente (BKO e /config): cada uma passa por `comVersao`
 * (lib/acao-versao.ts), que trata a action de um build anterior (recarga única e aviso). O login (`entrarAction`) usa
 * `chamarAcao` direto no formulário, que guarda só o e-mail antes da recarga. Os botões Sair são `<form action>` de componente de servidor e ficam de fora. Importe daqui, não do arquivo `'use server'`.
 */
export const pedirEsqueciAction = comVersao(() => pedirEsqueciBruta);
export const lerLogFdv = comVersao(() => lerLogFdvBruta);
export const ler = comVersao(() => lerBruta);
export const escrever = comVersao(() => escreverBruta);
export const entrarConfigAction = comVersao(() => entrarConfigBruta);
export const trocarSenhaBkoAction = comVersao(() => trocarSenhaBkoBruta);
export const trocarSenhaAcao = comVersao(() => trocarSenhaConfigBruta);

export const criarEmpresaAcao = comVersao(() => criarEmpresaBruta);
export const alterarModulosAcao = comVersao(() => alterarModulosBruta);
export const situacaoAcao = comVersao(() => situacaoBruta);
export const redefinirSenhaAdminAcao = comVersao(() => redefinirSenhaAdminBruta);
export const maisEmpresasAcao = comVersao(() => maisEmpresasBruta);

export const criarUsuarioAcao = comVersao(() => criarUsuarioBruta);
export const editarUsuarioAcao = comVersao(() => editarUsuarioBruta);
export const redefinirSenhaUsuarioAcao = comVersao(() => redefinirSenhaUsuarioBruta);
export const inativarUsuarioAcao = comVersao(() => inativarUsuarioBruta);
export const reativarUsuarioAcao = comVersao(() => reativarUsuarioBruta);
export const excluirUsuarioAcao = comVersao(() => excluirUsuarioBruta);

export const gerarChaveEntradaAcao = comVersao(() => gerarChaveBruta);
export const revogarChaveEntradaAcao = comVersao(() => revogarChaveBruta);

export const previaReceitaAcao = comVersao(() => previaReceitaBruta);
export const salvarFichaAcao = comVersao(() => salvarFichaBruta);
export const trocarCnpjAcao = comVersao(() => trocarCnpjBruta);
export const revelarContatoAcao = comVersao(() => revelarContatoBruta);

export const salvarCredencialFdvAcao = comVersao(() => salvarCredencialBruta);
export const testarConexaoFdvAcao = comVersao(() => testarConexaoBruta);
export const configurarFdvAcao = comVersao(() => configurarFdvBruta);
export const cargaCompletaFdvAcao = comVersao(() => cargaCompletaBruta);
export const reprocessarFdvAcao = comVersao(() => reprocessarBruta);
export const lerMonitorFdvAcao = comVersao(() => lerMonitorBruta);
export const lerLogFdvAcao = comVersao(() => lerLogFdvAcaoBruta);
export const retomarFdvAcao = comVersao(() => retomarBruta);
