/**
 * Porta `CriadorClienteFdv` (T-0059 §4): o `integracao-fdv` chama `decidir(tx, tenant, pre)` na transação do tenant que ele
 * abre, para cada pré-cadastro de cliente que o FDV mandou. Ator `sistema`. Ligada pelo `apps/worker`. O cadastros não
 * importa o `integracao-fdv`: a interface é esta, tipada pelo contrato do SDK (mesmo molde do `RecebedorPedidoFdv`).
 * - A regra é do domain (`validarPreCadastroFdv`, todas as recusas juntas); aqui só as consultas e a gravação.
 * - Recusado: nada é gravado (nem evento nem auditoria); `motivo` = mensagens do catálogo, sem o valor recusado.
 * - Aceito: passa pelas mesmas regras do POST `/v1/cadastros/clientes` (`validarClienteNovo`), grava pelo mesmo repositório e emite
 *   o evento `cadastros.cliente.alterado@1`, com limite de crédito 0 e sem condição; a carteira segue `vincularVendedorFdv` (RN-INT-23: vendedor inexistente ou inativo recusa o pré-cadastro, antes de gravar). Auditoria `cliente.criar` com `origem: 'fdv_pre_cadastro'`, sem dado
 *   pessoal. O `external_id` devolvido é a chave do Hub do cliente (ADR 0010: `external_id ?? id`), nunca o `codigo_fdv`.
 * - Corrida no documento (índice único): vira `documento_ja_cadastrado`, sem abortar a transação (SAVEPOINT).
 */
import {
  auditar, criarEvento, type ClienteParaErpFdv, type DecisaoPreCadastroFdv, type DestinoAuditoria, type ErroCampoClienteFdv, type Outbox, type Relogio, type Transacao,
} from '@macuxierp/platform-sdk';
import { ClienteDados } from '../contracts';
import {
  chavesDoPreCadastroFdv, erroPreCadastroFdv, motivoDaRecusaFdv, validarPreCadastroFdv, vendedorExternoFdv, vincularVendedorFdv,
  type CodigoPreCadastroFdv, type ConferenciaVendedorFdv, type ContextoPreCadastroFdv, type Violacao,
} from '../domain';
import { eventoCliente } from './eventos';
import type { Dependencias } from './portas';
import { validarClienteNovo } from './validar-cliente';

/** Decisão do ERP sobre um pré-cadastro: a do SDK (a que o `integracao-fdv` grava em `cliente_recebido`) com o `cliente_id` no vinculado. */
export type DecisaoCriadorClienteFdv =
  | (Extract<DecisaoPreCadastroFdv, { status: 'vinculado' }> & { cliente_id: string })
  | Extract<DecisaoPreCadastroFdv, { status: 'rejeitado_erp' }>;

export interface CriadorClienteFdv {
  decidir(tx: Transacao, tenant: string, pre: ClienteParaErpFdv): Promise<DecisaoCriadorClienteFdv>;
}

/**
 * Porta do espelho do vendedor do FDV, injetada, por tipagem estrutural: o worker passa o `criarConsultaVendedorFdv()` do
 * `integracao-fdv/api`. `null` ou `vendedor_id` ausente = não encontrado; `ativo: false` = inativo.
 */
export interface ConsultaVendedorFdvInjetada {
  vendedorPorExternalId(tx: Transacao, tenant: string, externalId: string): Promise<ConferenciaVendedorFdv & { ativo: boolean } | null>;
}

export interface DependenciasCriadorClienteFdv {
  /** Ausente = vendedor não consultado: o cliente nasce sem carteira e sem aviso. */
  consultaVendedorFdv?: ConsultaVendedorFdvInjetada;
  repositorios: Dependencias['repositorios'];
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  relogio: Relogio;
}

const rejeitar = (erros: readonly ErroCampoClienteFdv[]): DecisaoCriadorClienteFdv => ({ status: 'rejeitado_erp', motivo: motivoDaRecusaFdv(erros), erros });

/** Violação das regras do cadastro (as mesmas do POST) → erro por campo do contrato do FDV, com a mensagem do catálogo. */
function erroDaViolacao(v: Violacao): ErroCampoClienteFdv {
  const por: Record<string, [string, CodigoPreCadastroFdv]> = {
    'RN-CAD-01': ['documento', 'documento_invalido'], 'RN-CAD-02': ['inscricao_estadual', 'ie_invalida'],
    'RN-CAD-03': ['cidade', 'municipio_nao_encontrado'], REF: ['filial_external_id', 'filial_nao_encontrada'],
  };
  const [campo, codigo] = por[v.rn] ?? [v.campo, 'dado_invalido' as const];
  return erroPreCadastroFdv(campo, codigo);
}

export function criarCriadorClienteFdv(d: DependenciasCriadorClienteFdv): CriadorClienteFdv {
  return {
    async decidir(tx, tenant, pre) {
      const r = d.repositorios(tx);
      const agora = d.relogio.agora();
      const hoje = agora.toISOString().slice(0, 10);

      const { documento, uf, filialExterna } = chavesDoPreCadastroFdv(pre);
      const existente = documento === '' ? null : await r.clientes.porCampo('documento', documento);
      const municipiosDaUf = uf === '' ? [] : await r.oficiais.municipiosDaUf(uf, hoje);
      const filial = filialExterna !== '' ? await r.filiais.porExternalId(filialExterna) : await r.filiais.padrao();

      const ctx: ContextoPreCadastroFdv = {
        documentoJaCadastrado: existente !== null && !existente.inativo,
        municipiosDaUf,
        filialId: filial && !filial.inativo ? filial.id : null,
      };
      const v = validarPreCadastroFdv(pre, ctx);
      if (!v.ok) return rejeitar(v.erros);
      // as regras do POST /clientes (documento, endereço, município, IE e referências): o que sobrar vira erro por campo
      const vendedorExterno = vendedorExternoFdv(pre.vendedor_external_id);
      const conferencia = vendedorExterno !== null && d.consultaVendedorFdv ? await d.consultaVendedorFdv.vendedorPorExternalId(tx, tenant, vendedorExterno) : undefined;
      const vendedorErp = conferencia?.vendedor_id ? await r.vendedores.obter(conferencia.vendedor_id) : null;
      const vinculo = vincularVendedorFdv(vendedorExterno, conferencia, vendedorErp);
      if (vinculo.resultado === 'recusa') return rejeitar([erroPreCadastroFdv('vendedor_external_id', vinculo.codigo)]); // RN-INT-23
      const dados = ClienteDados.parse({ ...v.dados, vendedor_id: vinculo.resultado === 'vinculo' ? vinculo.vendedor_id : null });
      const violacoes = await validarClienteNovo(r, dados);
      if (violacoes.length > 0) return rejeitar(violacoes.map(erroDaViolacao));

      let criado;
      try {
        criado = await r.carga.comSavepoint(async () => {
          const c = await r.clientes.inserir(dados);
          if (v.contato) await r.clientes.contatos.inserir(c.id, v.contato); // RN-INF-08: o telefone vira contato, na mesma transação
          return c;
        });
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          return rejeitar([erroPreCadastroFdv('documento', 'documento_ja_cadastrado')]);
        }
        throw e;
      }

      const requestId = `fdv-cliente-${pre.cliente_uuid}`;
      const ev = await eventoCliente(r, criado);
      await d.outbox.gravar(tx, criarEvento({ nome: ev.nome, tenant_id: tenant, agregado_id: ev.agregado_id, ator: 'sistema', request_id: requestId, payload: ev.payload }, agora));
      await auditar(d.auditoria, tx, { tenant_id: tenant, usuario_id: null, request_id: requestId }, {
        acao: 'cliente.criar', entidade: 'cliente', entidade_id: criado.id,
        depois: { origem: 'fdv_pre_cadastro', cliente_uuid: pre.cliente_uuid, limite_credito_centavos: 0, vendedor_vinculado: dados.vendedor_id !== null },
      }, agora);
      return { status: 'vinculado', cliente_id: criado.id, external_id: criado.external_id ?? criado.id };
    },
  };
}
