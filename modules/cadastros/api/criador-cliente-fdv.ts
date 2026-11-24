/**
 * Porta `CriadorClienteFdv` (T-0059 §4): o `integracao-fdv` chama `decidir(tx, tenant, pre)` na transação do tenant que ele
 * abre, para cada pré-cadastro de cliente que o FDV mandou. Ator `sistema`. Ligada pelo `apps/worker`. O cadastros não
 * importa o `integracao-fdv`: a interface é esta, tipada pelo contrato do SDK (mesmo molde do `RecebedorPedidoFdv`).
 * - A regra é do domain (`validarPreCadastroFdv`, todas as recusas juntas); aqui só as consultas e a gravação.
 * - Recusado: nada é gravado (nem evento nem auditoria); `motivo` = mensagens do catálogo, sem o valor recusado.
 * - Aceito: cria pelo MESMO caminho do POST `/v1/cadastros/clientes` (repositório, evento `cadastros.cliente.alterado@1`),
 *   com limite de crédito 0, sem vendedor e sem condição. Auditoria `cliente.criar` com `origem: 'fdv_pre_cadastro'`, sem dado
 *   pessoal. O `external_id` devolvido é a chave do Hub do cliente (ADR 0010: `external_id ?? id`), nunca o `codigo_fdv`.
 * - Corrida no documento (índice único): vira `documento_ja_cadastrado`, sem abortar a transação (SAVEPOINT).
 */
import {
  auditar, criarEvento, normalizarDocumento, type ClienteParaErpFdv, type DestinoAuditoria, type ErroCampoClienteFdv, type Outbox, type Relogio, type Transacao,
} from '@macuxierp/platform-sdk';
import {
  MENSAGENS_PRE_CADASTRO_FDV, motivoDaRecusaFdv, ufDoPreCadastro, validarPreCadastroFdv, type ContextoPreCadastroFdv,
} from '../domain';
import { eventoCliente } from './eventos';
import type { Dependencias } from './portas';

/** Decisão do ERP sobre um pré-cadastro (a mesma forma que o `integracao-fdv` grava em `cliente_recebido`). */
export type DecisaoCriadorClienteFdv =
  | { status: 'vinculado'; cliente_id: string; external_id: string }
  | { status: 'rejeitado_erp'; motivo: string; erros: ErroCampoClienteFdv[] };

export interface CriadorClienteFdv {
  decidir(tx: Transacao, tenant: string, pre: ClienteParaErpFdv): Promise<DecisaoCriadorClienteFdv>;
}

export interface DependenciasCriadorClienteFdv {
  repositorios: Dependencias['repositorios'];
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  relogio: Relogio;
}

const rejeitar = (erros: ErroCampoClienteFdv[]): DecisaoCriadorClienteFdv => ({ status: 'rejeitado_erp', motivo: motivoDaRecusaFdv(erros), erros });

export function criarCriadorClienteFdv(d: DependenciasCriadorClienteFdv): CriadorClienteFdv {
  return {
    async decidir(tx, tenant, pre) {
      const r = d.repositorios(tx);
      const agora = d.relogio.agora();
      const hoje = agora.toISOString().slice(0, 10);

      const documento = normalizarDocumento((pre.documento ?? '').trim());
      const existente = documento === '' ? null : await r.clientes.porCampo('documento', documento);
      const uf = ufDoPreCadastro(pre.uf);
      const municipios = uf === '' ? [] : await r.oficiais.municipiosDaUf(uf, hoje);
      const externoFilial = (pre.filial_external_id ?? '').trim();
      const filial = externoFilial !== '' ? await r.filiais.porExternalId(externoFilial) : await r.filiais.padrao();

      const ctx: ContextoPreCadastroFdv = {
        documentoJaCadastrado: existente !== null && !existente.inativo,
        municipiosDaUf: () => municipios,
        filialId: filial && !filial.inativo ? filial.id : null,
      };
      const v = validarPreCadastroFdv(pre, ctx);
      if (!v.ok) return rejeitar(v.erros);

      let criado;
      try {
        criado = await r.carga.comSavepoint(() => r.clientes.inserir(v.dados));
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          return rejeitar([{ campo: 'documento', codigo: 'documento_ja_cadastrado', mensagem: MENSAGENS_PRE_CADASTRO_FDV.documento_ja_cadastrado }]);
        }
        throw e;
      }

      const requestId = `fdv-cliente-${pre.cliente_uuid}`;
      const ev = await eventoCliente(r, criado);
      await d.outbox.gravar(tx, criarEvento({ nome: ev.nome, tenant_id: tenant, agregado_id: ev.agregado_id, ator: 'sistema', request_id: requestId, payload: ev.payload }, agora));
      await auditar(d.auditoria, tx, { tenant_id: tenant, usuario_id: null, request_id: requestId }, {
        acao: 'cliente.criar', entidade: 'cliente', entidade_id: criado.id,
        depois: { origem: 'fdv_pre_cadastro', cliente_uuid: pre.cliente_uuid, limite_credito_centavos: 0 },
      }, agora);
      return { status: 'vinculado', cliente_id: criado.id, external_id: criado.external_id ?? criado.id };
    },
  };
}
