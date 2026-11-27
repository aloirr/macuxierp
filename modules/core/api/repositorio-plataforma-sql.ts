/**
 * Adaptador SQL do `RepositorioPlataforma` (ADR 0012, seção 4): chama só as funções SECURITY DEFINER de lista fechada da
 * 0033 e da 0035, dentro da transação de plataforma (`BancoPlataforma.comPlataforma`: papel `macuxierp_config` e a sessão do
 * superadmin na configuração local). Nenhum SELECT em tabela: o banco revalida a sessão e grava a auditoria.
 * O unique_violation (23505) de slug ou e-mail repetido vira `null` (409 na rota); os demais SQLSTATE seguem para a apps/api.
 */
import { DETALHE_CODIGO_RESERVADO, erros, MENSAGEM_CODIGO_RESERVADO, type EmpresaPlataforma, type Licenca, type SituacaoEmpresaEntrada, type Transacao } from '@macuxierp/platform-sdk';
import type { CampoContato, CnaeDescrito, FichaReceitaPlana, FichaReceitaPlanaMascarada, MotivoBloqueioCnpj } from '../contracts';
import { codigosParaDescrever, descreverFicha, MENSAGEM_SEM_CNPJ } from '../domain';
import { sqlstate } from './erro-pg';
import type { RepositorioPlataforma } from './plataforma';

/** SQLSTATE da `empresa_trocar_cnpj` que viram bloqueio tratado (RN-CORE-16). */
const BLOQUEIOS_TROCA_CNPJ: Record<string, MotivoBloqueioCnpj> = {
  '23514': 'cnpj_invalido',
  MXC05: 'nfe_autorizada_producao',
  MXC06: 'cnpj_igual',
  '23505': 'cnpj_em_uso',
};

const repetido = (e: unknown): boolean => sqlstate(e) === '23505';

async function semRepetido<R>(fn: () => Promise<R>): Promise<R | null> {
  try {
    return await fn();
  } catch (e) {
    if (repetido(e)) return null;
    throw e;
  }
}

/** A função de plataforma devolve sempre uma linha; sem ela, o erro é de programação (500). */
async function primeiraLinha<L>(tx: Transacao, sql: string, parametros: readonly unknown[]): Promise<L> {
  const [l] = await tx.consultar<L>(sql, parametros);
  if (!l) throw new Error('função de plataforma sem retorno');
  return l;
}

/**
 * Descrição do CNAE e nome do município na ficha mascarada (0066): as duas funções de plataforma numa query só, na mesma
 * transação da leitura. Sem códigos, nenhuma consulta. Falha do banco segue para a apps/api (a ficha não sai pela metade).
 */
async function comDescricoes(tx: Transacao, ficha: FichaReceitaPlanaMascarada | null | undefined): Promise<FichaReceitaPlanaMascarada | null> {
  if (!ficha) return null;
  const { cnaes, municipios } = codigosParaDescrever(ficha);
  if (cnaes.length === 0 && municipios.length === 0) return descreverFicha(ficha, [], []);
  const [l] = await tx.consultar<{ c: CnaeDescrito[] | null; m: { codigo: string; nome: string | null }[] | null }>(
    'SELECT plataforma.cnae_descricoes($1::text[]) c, plataforma.municipio_nomes($2::text[]) m',
    [cnaes, municipios],
  );
  return descreverFicha(ficha, l?.c, l?.m);
}

/**
 * Erros das funções da ficha (0063) em HTTP, com mensagem fixa (o texto do banco nunca sai: pode trazer nome de campo
 * ou valor): 23514 = ficha recusada (422), P0002 = sem a empresa ou sem o dado (404), 55000 = sem core.empresa (409).
 * MXS01 (sessão inválida, 401) segue para o mapa de erros da apps/api, o mesmo das demais funções de plataforma.
 */
async function comErrosDaFicha<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    switch (sqlstate(e)) {
      case '23514':
      case '22001': // string_data_right_truncation: estourar o tamanho é erro, nunca NULL silencioso
        throw erros.regra('RN-CORE-14', 'A ficha da Receita foi recusada', { ficha: 'Dados inválidos' });
      case 'P0002':
        throw erros.naoEncontrado('Dado da empresa');
      case '55000':
        throw erros.conflito(MENSAGEM_SEM_CNPJ);
      default:
        throw e;
    }
  }
}

const empresa = async (tx: Transacao, sql: string, parametros: readonly unknown[]): Promise<EmpresaPlataforma> =>
  (await primeiraLinha<{ e: EmpresaPlataforma }>(tx, sql, parametros)).e;

export class RepositorioPlataformaSql implements RepositorioPlataforma {
  async listarEmpresas(tx: Transacao, p: { busca?: string; cursor?: string; limite: number }): Promise<EmpresaPlataforma[]> {
    const ls = await tx.consultar<{ e: EmpresaPlataforma }>('SELECT e FROM plataforma.empresas_listar($1, $2::uuid, $3) e', [
      p.busca ?? null,
      p.cursor ?? null,
      p.limite,
    ]);
    return ls.map((l) => l.e);
  }

  /** A linha do `empresa_ler`: a empresa e, na chave `ficha` (0063), a ficha mascarada ainda sem descrições. */
  private async lerLinha(tx: Transacao, id: string): Promise<(EmpresaPlataforma & { ficha?: FichaReceitaPlanaMascarada | null }) | null> {
    const [l] = await tx.consultar<{ e: (EmpresaPlataforma & { ficha?: FichaReceitaPlanaMascarada | null }) | null }>('SELECT plataforma.empresa_ler($1::uuid) e', [id]);
    return l?.e ?? null;
  }

  async lerEmpresa(tx: Transacao, id: string): Promise<EmpresaPlataforma | null> {
    const e = await this.lerLinha(tx, id);
    if (!e) return null;
    if (!e.ficha) return e;
    return { ...e, ficha: await comDescricoes(tx, e.ficha) } as EmpresaPlataforma;
  }

  criarEmpresa(tx: Transacao, p: { slug: string | null; uf: string | null; nome: string; fuso: string; request_id: string }): Promise<EmpresaPlataforma | null> {
    // 0037: `p_uf` no fim; slug nulo = sorteio pela UF. 23514 (check) = código ou UF inválido (texto do RAISE, sem dado pessoal).
    return semRepetido(async () => {
      try {
        return await empresa(tx, 'SELECT plataforma.empresa_criar($1, $2, $3, $4, $5) e', [p.slug, p.nome, p.fuso, p.request_id, p.uf]);
      } catch (e) {
        if (sqlstate(e) !== '23514') throw e;
        // 0037: textos do RAISE 'uf invalida', 'uf difere do codigo', 'fuso desconhecido' e 'slug reservado'. O texto do
        // banco não é repassado: cada caso vira mensagem fixa no campo (`uf`, `fuso` ou `codigo`). Sorteio sem vaga dá 23505.
        // 0049: o CHECK do código reservado (MACUXI) traz o DETAIL `DETALHE_CODIGO_RESERVADO`; vira a mensagem do SDK no campo `codigo`.
        if ((e as { detail?: unknown } | null)?.detail === DETALHE_CODIGO_RESERVADO) {
          throw erros.regra('RN-CORE-11', MENSAGEM_CODIGO_RESERVADO, { codigo: MENSAGEM_CODIGO_RESERVADO });
        }
        const msg = String((e as { message?: unknown }).message ?? '');
        const [campo, texto] = /\buf difere\b/i.test(msg)
          ? ['uf', 'A UF precisa ser a do código']
          : /\buf\b/i.test(msg)
            ? ['uf', 'UF inválida']
            : /\bfuso\b/i.test(msg)
              ? ['fuso', 'Fuso desconhecido']
              : ['codigo', 'Código inválido'];
        throw erros.regra('RN-CORE-11', texto, { [campo]: texto });
      }
    });
  }

  alterarSituacao(tx: Transacao, p: { id: string; situacao: SituacaoEmpresaEntrada['situacao']; motivo: string; request_id: string }): Promise<EmpresaPlataforma> {
    return empresa(tx, 'SELECT plataforma.empresa_situacao($1::uuid, $2, $3, $4) e', [p.id, p.situacao, p.motivo, p.request_id]);
  }

  alterarModulos(tx: Transacao, p: { id: string; modulos: Licenca[]; request_id: string }): Promise<EmpresaPlataforma> {
    const modulos = p.modulos.map((m) => ({ modulo: m.modulo, ativo: m.ativo, valido_ate: m.valido_ate ? m.valido_ate.toISOString() : null }));
    return empresa(tx, 'SELECT plataforma.empresa_modulos($1::uuid, $2::jsonb, $3) e', [p.id, JSON.stringify(modulos), p.request_id]);
  }

  criarPrimeiroAdmin(
    tx: Transacao,
    p: { id: string; email: string; nome: string; senha_hash: string; request_id: string },
  ): Promise<{ usuario_id: string } | null> {
    return semRepetido(() =>
      primeiraLinha<{ usuario_id: string }>(tx, 'SELECT plataforma.empresa_primeiro_admin_criar($1::uuid, $2, $3, $4, $5) usuario_id', [
        p.id,
        p.email,
        p.nome,
        p.senha_hash,
        p.request_id,
      ]),
    );
  }

  redefinirSenhaPrimeiroAdmin(tx: Transacao, p: { id: string; senha_hash: string; request_id: string }): Promise<{ usuario_id: string }> {
    return primeiraLinha(tx, 'SELECT plataforma.empresa_primeiro_admin_senha($1::uuid, $2, $3) usuario_id', [p.id, p.senha_hash, p.request_id]);
  }

  async lerEmpresaComFicha(tx: Transacao, id: string): Promise<{ empresa: EmpresaPlataforma; ficha: FichaReceitaPlanaMascarada | null } | null> {
    const e = await this.lerLinha(tx, id);
    if (!e) return null;
    const { ficha, ...empresa } = e;
    // Sem descrições: o Revelar e a /receita só precisam da ficha para decidir; quem devolve a ficha descreve (descreverFicha).
    return { empresa, ficha: ficha ?? null };
  }

  async descreverFicha(tx: Transacao, ficha: FichaReceitaPlanaMascarada): Promise<FichaReceitaPlanaMascarada> {
    return (await comDescricoes(tx, ficha)) ?? ficha;
  }

  async gravarReceita(tx: Transacao, p: { id: string; ficha: FichaReceitaPlana; request_id: string }): Promise<{ ficha: FichaReceitaPlanaMascarada | null; alterados: string[] }> {
    return comErrosDaFicha(async () =>
      primeiraLinha<{ r: { ficha: FichaReceitaPlanaMascarada | null; alterados: string[] } }>(tx, 'SELECT plataforma.empresa_gravar_receita($1::uuid, $2::jsonb, $3) r', [
        p.id,
        JSON.stringify(p.ficha),
        p.request_id,
      ]).then(async (l) => ({ ...l.r, ficha: await comDescricoes(tx, l.r.ficha) })),
    );
  }

  async revelarContato(tx: Transacao, p: { id: string; campo: CampoContato; request_id: string }): Promise<string> {
    return comErrosDaFicha(async () =>
      (await primeiraLinha<{ v: string }>(tx, 'SELECT plataforma.empresa_contato_revelar($1::uuid, $2, $3) v', [p.id, p.campo, p.request_id])).v,
    );
  }

  async salvarFicha(tx: Transacao, p: { id: string; ficha: FichaReceitaPlana; request_id: string }): Promise<{ ficha: FichaReceitaPlanaMascarada | null; alterados: string[] }> {
    // RN-CORE-16: p_ficha é a ficha plana direta; o banco calcula e audita os alterados (só nomes).
    return comErrosDaFicha(async () =>
      primeiraLinha<{ r: { ficha: FichaReceitaPlanaMascarada | null; alterados: string[] } }>(tx, 'SELECT plataforma.empresa_salvar_ficha($1::uuid, $2::jsonb, $3) r', [
        p.id,
        JSON.stringify(p.ficha),
        p.request_id,
      ]).then(async (l) => ({ ...l.r, ficha: await comDescricoes(tx, l.r.ficha) })),
    );
  }

  /** O evento sai na empresa_trocar_cnpj (0077), mesma transação; o cadastros consome e atualiza a filial padrão (RN-CORE-14). */
  async trocarCnpj(tx: Transacao, p: { id: string; cnpj: string; request_id: string }): Promise<{ cnpj: string; event_id: string } | { bloqueado: MotivoBloqueioCnpj }> {
    try {
      const l = await primeiraLinha<{ r: { cnpj: string; event_id: string } }>(tx, 'SELECT plataforma.empresa_trocar_cnpj($1::uuid, $2, $3) r', [p.id, p.cnpj, p.request_id]);
      return { cnpj: l.r.cnpj, event_id: l.r.event_id };
    } catch (e) {
      const motivo = BLOQUEIOS_TROCA_CNPJ[String(sqlstate(e))];
      if (motivo) return { bloqueado: motivo };
      return comErrosDaFicha(() => Promise.reject(e));
    }
  }

  async revelarEmailPrimeiroAdmin(tx: Transacao, p: { id: string; request_id: string }): Promise<string> {
    return (await primeiraLinha<{ email: string }>(tx, 'SELECT plataforma.empresa_primeiro_admin_email($1::uuid, $2) email', [p.id, p.request_id])).email;
  }
}
