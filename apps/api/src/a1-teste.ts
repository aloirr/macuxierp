/**
 * A1 DE TESTE da filial emissora pelo operador (T-0080, ADR 0005 e ADR 0008). Quem chama é o `operador.sh a1-teste`,
 * DENTRO do contêiner `api` (a chave MACUXIERP_CHAVE_A1 e o papel `macuxierp_app` só existem lá), pela entrada
 * `a1-teste-main.ts` (empacotada em `dist/a1-teste.mjs` no Dockerfile da API).
 *
 * Gera um A1 autoassinado com o CNPJ e a razão social da filial emissora (cadastros) e o grava cifrado como o
 * certificado ativo da filial, com origem 'teste', pelo MESMO caminho do upload do core (`LeitorPfxTls`,
 * `RepositorioCoreSql.substituirCertificado`, auditoria e `core.certificado.alterado@1`). O autoassinado só serve ao
 * simulador da SEFAZ (a SEFAZ real recusa, 283/293): por isso a trava de homologação (CLAUDE.md regra 7, RN-CORE-08,
 * `podeUsarCertificadoNoAmbiente`) é conferida NA MESMA transação da gravação; o banco repete a trava (migração 0047).
 *
 * Sem `confirmar`, a transação é READ ONLY e só devolve o plano. Idempotente: a filial que já tem A1 de teste fora da
 * janela de alerta (RF-CORE-04) não ganha outro. O A1 do cliente ('upload') ainda válido só é substituído com
 * `substituir`. Saída e auditoria só com ids, estados e datas: nunca CNPJ, razão social, senha, PFX ou chave.
 */
import { randomUUID } from 'node:crypto';
import { repositoriosSql } from '@macuxierp/cadastros/api';
import { ListaConsulta } from '@macuxierp/cadastros/contracts';
import { cifrarColunasA1, LeitorPfxTls, RepositorioCoreSql } from '@macuxierp/core/api';
import { DIAS_ALERTA_A1, EVENTO_CERTIFICADO, EventoCertificadoAlterado } from '@macuxierp/core/contracts';
import { gerarA1DeTeste } from '@macuxierp/nfe-sefaz/a1-de-teste';
import {
  criarEvento,
  LIMITE_MAXIMO,
  PADRAO_CODIGO_EMPRESA,
  PADRAO_UUID,
  podeUsarCertificadoNoAmbiente,
  UFS,
  type Banco,
  type OrigemCertificado,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { AuditoriaPg, OutboxPg } from '@macuxierp/platform-sdk/pg';

const DIA_MS = 86_400_000;
/** O mesmo do operador.sh e do scripts/plataforma/comum.mjs (o teste operador-a1-teste.test.ts trava). */
export const PADRAO_OPERADOR = /^[a-z][a-z0-9._-]{1,39}$/;
/** Validade do A1 de teste: um dia para trás (relógios desencontrados) e um ano para a frente. */
const VALIDO_ANTES_MS = DIA_MS;
const VALIDO_DEPOIS_MS = 365 * DIA_MS;
/** O CN do X.509 tem até 64 caracteres: nome + ':' + 14 do CNPJ. */
const NOME_NO_CN = 48;

export interface ArgsA1Teste {
  empresa: string;
  filial: string | null;
  operador: string;
  confirmar: boolean;
  substituir: boolean;
}

/** Erro de uso (saída 2). Mensagem fixa, sem valor recebido. */
export class ErroUsoA1Teste extends Error {
  override readonly name = 'ErroUsoA1Teste';
}

/** Recusa de negócio (saída 1, nada gravado). Mensagem só com ids e estados. */
export class RecusaA1Teste extends Error {
  override readonly name = 'RecusaA1Teste';
}

export function lerArgsA1Teste(argv: readonly string[]): ArgsA1Teste {
  const a: ArgsA1Teste = { empresa: '', filial: null, operador: '', confirmar: false, substituir: false };
  for (let i = 0; i < argv.length; i++) {
    const op = argv[i];
    if (op === '--confirmar') a.confirmar = true;
    else if (op === '--substituir') a.substituir = true;
    else if (op === '--empresa' || op === '--filial' || op === '--operador') {
      const v = argv[++i];
      if (v === undefined) throw new ErroUsoA1Teste(`${op} exige um valor`);
      if (op === '--empresa') a.empresa = v;
      else if (op === '--filial') a.filial = v;
      else a.operador = v;
    } else throw new ErroUsoA1Teste('opção desconhecida (use --empresa, --filial, --operador, --substituir e --confirmar)');
  }
  // RN-CORE-11: código da empresa = código da licença do FDV (UF + 4 dígitos), sem diferenciar maiúsculas
  if (!PADRAO_CODIGO_EMPRESA.test(a.empresa) || !(UFS as readonly string[]).includes(a.empresa.slice(0, 2).toUpperCase())) throw new ErroUsoA1Teste('--empresa: código da empresa, UF + 4 dígitos, ex.: AM2808');
  if (a.filial !== null && !PADRAO_UUID.test(a.filial)) throw new ErroUsoA1Teste('--filial: id (UUID) da filial emissora');
  if (!PADRAO_OPERADOR.test(a.operador)) throw new ErroUsoA1Teste('--operador exige o nome de quem executa (ex.: alexandre)');
  a.empresa = a.empresa.toLowerCase();
  a.filial = a.filial?.toLowerCase() ?? null;
  return a;
}

/** Razão social como o ICP-Brasil grava no titular: sem acento, maiúscula, só letras, dígitos e pontuação simples. */
export function nomeNoTitular(razaoSocial: string): string {
  const nome = razaoSocial
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 &.,/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOME_NO_CN)
    .trim();
  return nome.length >= 2 ? nome : 'EMPRESA DE TESTE';
}

/** Novo certificado no formato do repositório do core: `origem` opcional (omitida = 'upload'); aqui sempre 'teste'. */
type NovoCertificado = Parameters<RepositorioCoreSql['substituirCertificado']>[1];

export interface ResultadoA1Teste {
  estado: 'simulacao' | 'gerado' | 'sem-mudanca';
  /** O que a execução confirmada faria (na simulação) ou fez. */
  acao: 'gerar' | 'manter';
  tenant_id: string;
  filial_id: string;
  /** Sempre homologação: em produção a execução é recusada antes de devolver. */
  ambiente: 'homologacao' | 'producao';
  anterior: { id: string; origem: OrigemCertificado; valido_ate: Date } | null;
  certificado_id: string | null;
  valido_ate: Date | null;
}

export interface DependenciasA1Teste {
  /** No papel `macuxierp_app` (RLS do tenant). */
  banco: Banco;
  chaveA1: Buffer;
  agora: () => Date;
  repo?: RepositorioCoreSql;
  leitor?: LeitorPfxTls;
  novoId?: () => string;
}

const recusa = (m: string): never => {
  throw new RecusaA1Teste(`${m}; nada foi gravado`);
};

export async function executarA1Teste(d: DependenciasA1Teste, a: ArgsA1Teste): Promise<ResultadoA1Teste> {
  const repo = d.repo ?? new RepositorioCoreSql();
  const leitor = d.leitor ?? new LeitorPfxTls();
  const novoId = d.novoId ?? randomUUID;
  const tenantId = await d.banco.semTenant(async (tx) => {
    const [l] = await tx.consultar<{ id: string | null }>('SELECT plataforma.tenant_por_slug($1) AS id', [a.empresa]);
    return l?.id ?? null;
  });
  if (!tenantId) return recusa('empresa não encontrada ou não ativa (confira o código)');

  return d.banco.comTenant(tenantId, async (tx) => {
    // A simulação não grava nada: a transação inteira fica só de leitura (vale ligar depois do set_config do tenant).
    if (!a.confirmar) await tx.consultar('SET LOCAL transaction_read_only = on');
    // um a1-teste por vez no servidor (dois operadores ao mesmo tempo)
    await tx.consultar("SELECT pg_advisory_xact_lock(hashtext('macuxierp.operador.a1-teste'))");
    const agora = d.agora();

    const filial = await filialEmissora(tx, a.filial);
    // RN-CORE-08, regra 7: sem linha = homologação. Conferido na mesma transação da gravação (o banco repete, 0047).
    const ambiente = (await repo.ambientes(tx, filial.id))[0]?.ambiente ?? 'homologacao';
    if (!podeUsarCertificadoNoAmbiente('teste', ambiente)) {
      return recusa(`a filial ${filial.id} está em produção fiscal: o A1 de teste é só para homologação (RN-CORE-08, ADR 0008)`);
    }

    const ativo = (await repo.certificados(tx, filial.id)).find((c) => c.ativo);
    const anterior = ativo ? { id: ativo.id, origem: ativo.origem, valido_ate: ativo.valido_ate } : null;
    const base = { tenant_id: tenantId, filial_id: filial.id, ambiente, anterior } as const;
    const foraDoAlerta = (v: Date) => v.getTime() - agora.getTime() > DIAS_ALERTA_A1 * DIA_MS;
    if (anterior?.origem === 'teste' && foraDoAlerta(anterior.valido_ate)) {
      return { ...base, estado: a.confirmar ? 'sem-mudanca' : 'simulacao', acao: 'manter', certificado_id: anterior.id, valido_ate: anterior.valido_ate };
    }
    if (anterior?.origem === 'upload' && anterior.valido_ate.getTime() > agora.getTime() && !a.substituir) {
      return recusa(`a filial ${filial.id} tem o A1 do cliente válido (${anterior.id}); para trocá-lo pelo de teste, repita com --substituir`);
    }
    if (!a.confirmar) return { ...base, estado: 'simulacao', acao: 'gerar', certificado_id: null, valido_ate: null };

    const gerado = gerarA1DeTeste({
      cnpj: filial.cnpj,
      nome: nomeNoTitular(filial.razao_social),
      cnpjNoTitular: 'cn-e-san',
      validoDe: new Date(agora.getTime() - VALIDO_ANTES_MS),
      validoAte: new Date(agora.getTime() + VALIDO_DEPOIS_MS),
    });
    try {
      // O mesmo leitor do upload (RN-CORE-06): titular, CNPJ do ICP-Brasil, validade e impressão digital.
      const dados = await leitor.abrir(gerado.pfx, gerado.senha);
      if (dados.cnpj !== filial.cnpj) recusa('o A1 gerado não leva o CNPJ da filial');
      const id = novoId();
      const cifrado = cifrarColunasA1({ chave: d.chaveA1, tenantId, pfx: gerado.pfx, senha: gerado.senha });
      const novo: NovoCertificado = { id, filial_id: filial.id, ...dados, ...cifrado, chave_versao: 1, origem: 'teste' };
      await repo.substituirCertificado(tx, novo, agora);
      const requestId = `operador-${randomUUID()}`;
      await new AuditoriaPg().inserir(tx, {
        tenant_id: tenantId,
        usuario_id: null,
        acao: 'core.certificado.teste_gerado',
        entidade: 'certificado',
        entidade_id: id,
        antes: anterior ? { certificado_id: anterior.id, origem: anterior.origem, valido_ate: anterior.valido_ate.toISOString() } : null,
        depois: {
          filial_id: filial.id,
          origem: 'teste',
          ambiente,
          valido_ate: dados.valido_ate.toISOString(),
          impressao_digital: dados.impressao_digital,
          operador: a.operador,
          motivo: 'operador.sh a1-teste',
        },
        request_id: requestId,
        ocorrido_em: agora,
      });
      const payload = EventoCertificadoAlterado.parse({ id, filial_id: filial.id, cnpj: dados.cnpj, valido_ate: dados.valido_ate.toISOString(), impressao_digital: dados.impressao_digital, ativo: true });
      await new OutboxPg().gravar(
        tx,
        criarEvento({ nome: EVENTO_CERTIFICADO, tenant_id: tenantId, agregado_id: id, versao: agora.getTime(), ator: 'sistema', request_id: requestId, payload }, agora),
      );
      return { ...base, estado: 'gerado', acao: 'gerar', certificado_id: id, valido_ate: dados.valido_ate };
    } finally {
      gerado.pfx.fill(0);
    }
  });
}

/** A filial pedida (ativa e emissora) ou, sem `--filial`, a única filial emissora ativa do tenant. */
async function filialEmissora(tx: Transacao, id: string | null) {
  const filiais = repositoriosSql(tx).filiais;
  if (id) {
    const f = await filiais.obter(id);
    if (!f || f.inativo) return recusa(`filial ${id} não encontrada ou inativa nesta empresa`);
    if (!f.emissora) return recusa(`a filial ${id} não é emissora de NF-e`);
    return f;
  }
  const pagina = await filiais.listar(ListaConsulta.parse({ limite: LIMITE_MAXIMO }));
  const emissoras = pagina.itens.filter((f) => f.emissora && !f.inativo);
  if (emissoras.length === 1 && pagina.proximo_cursor === null) return emissoras[0]!;
  return recusa(emissoras.length === 0 ? 'a empresa não tem filial emissora ativa' : 'a empresa tem mais de uma filial emissora: informe --filial <id>');
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Linhas da saída: só ids, estados e datas (UTC). A última é a linha de estado que o operador.sh lê. */
export function linhasA1Teste(r: ResultadoA1Teste): string[] {
  const anterior = r.anterior ? `${r.anterior.id} (origem ${r.anterior.origem}, válido até ${dia(r.anterior.valido_ate)})` : 'nenhum';
  const cabeca =
    r.estado === 'simulacao'
      ? '[a1-teste] SIMULAÇÃO: nada gravado (transação só de leitura).'
      : r.estado === 'gerado'
        ? '[a1-teste] APLICADO e auditado (plataforma.auditoria, core.certificado.teste_gerado).'
        : '[a1-teste] nada a fazer: a filial já tem A1 de teste válido (nada auditado).';
  const plano =
    r.acao === 'manter'
      ? `mantido ${r.certificado_id} (válido até ${r.valido_ate ? dia(r.valido_ate) : '?'})`
      : r.estado === 'gerado'
        ? `gerado ${r.certificado_id} (origem teste, válido até ${r.valido_ate ? dia(r.valido_ate) : '?'}; só homologação e simulador)`
        : 'seria gerado (origem teste, só homologação e simulador)';
  return [
    cabeca,
    `  empresa: ${r.tenant_id}`,
    `  filial: ${r.filial_id} (ambiente ${r.ambiente})`,
    `  certificado anterior: ${anterior}`,
    `  A1 de teste: ${plano}`,
    `estado: ${r.estado}`,
  ];
}
