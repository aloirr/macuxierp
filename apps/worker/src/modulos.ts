/**
 * Executores e rotinas montados no worker (T-0029). `registrarExecutores` confere no arranque: tipo `<modulo>.<tarefa>`
 * de módulo da v1 e um executor por tipo.
 *
 * Ligação pendente (com os adaptadores que faltam; lista no desenho T-0002, seção "Worker da F1"):
 * - `cadastros.consultar_ie` (D5): `criarExecutorConsultaIe` de `@macuxierp/cadastros/api`, com a porta da
 *   Consulta Cadastro da SEFAZ (A1 da filial; spike T-0018);
 * - `core.exportar_dados` (RF-CORE-06): `criarExecutorExportacao` com a porta da `core.exportacao` e os exportadores
 *   de cada módulo, mais o armazenamento S3 (T-0024);
 * - rotina `core.alerta_a1` (RF-CORE-04): `criarRotinaAlertaA1` com a lista de tenants, os certificados e os avisos.
 */
import { PADRAO_TIPO_TRABALHO, type ExecutorTrabalho } from '@macuxierp/platform-sdk';

export class RegistroExecutoresInvalido extends Error {
  override readonly name = 'RegistroExecutoresInvalido';
}

export function registrarExecutores(executores: readonly ExecutorTrabalho[]): readonly ExecutorTrabalho[] {
  const tipos = new Set<string>();
  for (const e of executores) {
    if (!PADRAO_TIPO_TRABALHO.test(e.tipo)) throw new RegistroExecutoresInvalido(`tipo de trabalho "${e.tipo}" fora de <modulo>.<tarefa>`);
    if (tipos.has(e.tipo)) throw new RegistroExecutoresInvalido(`dois executores para "${e.tipo}"`);
    tipos.add(e.tipo);
  }
  return Object.freeze([...executores]);
}
