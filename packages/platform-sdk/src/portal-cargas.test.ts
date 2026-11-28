import { describe, expect, it } from 'vitest';
import { ACOES_PLATAFORMA } from './plataforma-rotas';
import {
  AVISOS_CARGA_PORTAL,
  CADASTROS_CARGA_PORTAL,
  CADASTROS_ZERAR_PORTAL,
  CODIGO_FRASE_NAO_CONFERE,
  CodigoDetalheCargaPortal,
  CODIGO_ZERAGEM_BLOQUEADA,
  CAMINHOS_CARGAS_PLATAFORMA,
  CODIGOS_DETALHE_CARGA_PORTAL,
  CODIGOS_ESTADO_MUDOU_ZERAR,
  ENTIDADES_CARGA_PORTAL,
  EfeitoSubstituir,
  FRASE_SUBSTITUIR_TUDO,
  FRASE_ZERAR_DADOS,
  GravarCargaPlataformaEntrada,
  GravarCargaPlataformaResposta,
  LIMITE_INATIVACAO_FDV_PCT,
  LIMITE_LINHAS_ERRO_VALIDACAO,
  MENSAGEM_FRASE_SUBSTITUIR,
  MENSAGEM_FRASE_ZERAR,
  MOTIVOS_USO,
  MENSAGEM_SUBSTITUIR_NAO_PERMITIDO,
  MENSAGENS_CARGA_PORTAL,
  ModoCargaQuery,
  PreviaZerarPlataformaEntrada,
  SQLSTATES_CARGA_PORTAL,
  SituacaoCargasPlataforma,
  TABELAS_ZERAGEM,
  ValidarCargaPlataformaEntrada,
  ValidarCargaPlataformaResposta,
  ZerarDadosPlataformaEntrada,
  ZeragemPlataformaResposta,
  TIPOS_ENDERECO_CLIENTE,
  dadosClienteDiferentes,
  efeitoSubstituir,
  normalizarFrase,
  rotuloCadastroCarga,
  situacaoCarga,
  substituirPermitido,
  type CadastroCargaPortal,
  SituacaoCarga,
} from './portal-cargas';
import * as sdk from './index';

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const AGORA = '2026-11-23T19:00:00.000Z';

/** Linhas da aba a partir das situações (o resto não carregado); `liberado` sempre true (v0.3.6). */
function linhas(situacoes: Partial<Record<CadastroCargaPortal, SituacaoCarga>> = {}) {
  return CADASTROS_CARGA_PORTAL.map((c) => {
    const situacao = situacoes[c.cadastro] ?? 'nao_carregado';
    return {
      numero: c.numero,
      cadastro: c.cadastro,
      situacao,
      erros: situacao === 'com_erro' ? 3 : 0,
      ultima_carga: situacao === 'nao_carregado' || situacao === 'manual' ? null : { em: AGORA, quantidade: 10 },
      liberado: true as const,
      opcional: c.opcional,
    };
  });
}
const situacaoBase = { empresa_id: EMPRESA, modulo_licenciado: true };

const validacao = (o: Record<string, unknown> = {}) => ({
  cadastro: 'produto',
  modo: 'substituir_tudo',
  prontas: 8,
  com_erro: 1,
  linhas: [{ linha: 3, motivo: 'NCM não existe na tabela vigente', acao: 'Corrija o NCM na planilha' }],
  linhas_omitidas: 0,
  efeito: efeitoSubstituir({ total: 10, a_inativar: 2 }),
  ...o,
});

describe('CADASTROS_CARGA_PORTAL (RF-CAD-11, D13 da T-0026)', () => {
  it('os 8 cadastros da v0.3.6 (R-20261123-160749), numerados de 1 a 8', () => {
    expect(ENTIDADES_CARGA_PORTAL).toEqual(['filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente']);
    expect(CADASTROS_CARGA_PORTAL.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rotuloCadastroCarga('condicao_pagamento')).toBe('Condições de pagamento');
  });

  it('sem dependência entre cargas; só as unidades são opcionais; só o estoque recusa o Substituir tudo', () => {
    for (const c of CADASTROS_CARGA_PORTAL) expect('depende_de' in c).toBe(false);
    expect(CADASTROS_CARGA_PORTAL.filter((c) => c.opcional).map((c) => c.cadastro)).toEqual(['produto_unidade']);
    expect(CADASTROS_CARGA_PORTAL.filter((c) => !c.substituir_permitido).map((c) => c.cadastro)).toEqual(['estoque']);
  });

  it('rótulo: "Unidades (opcional)"', () => {
    expect(rotuloCadastroCarga('produto_unidade')).toBe('Unidades (opcional)');
    expect(rotuloCadastroCarga('cliente')).toBe('Clientes');
  });
});

describe('frases (Alexandre, R-20261123-145123; RN-CAD-10)', () => {
  it('ignora maiúsculas, o ponto final e os espaços', () => {
    for (const f of ['autorizo substituir tudo', 'autorizo substituir tudo.', 'AUTORIZO SUBSTITUIR TUDO', '  Autorizo   substituir\ttudo .  ', 'autorizo substituir tudo...']) {
      expect(normalizarFrase(f)).toBe(FRASE_SUBSTITUIR_TUDO);
    }
    expect(normalizarFrase('Autorizo zerar os dados.')).toBe(FRASE_ZERAR_DADOS);
  });

  it('não aceita frase diferente, ponto no meio nem a outra frase', () => {
    expect(normalizarFrase('autorizo substituir')).not.toBe(FRASE_SUBSTITUIR_TUDO);
    expect(normalizarFrase('autorizo. substituir tudo')).not.toBe(FRASE_SUBSTITUIR_TUDO);
    expect(normalizarFrase(FRASE_ZERAR_DADOS)).not.toBe(FRASE_SUBSTITUIR_TUDO);
  });
});

describe('SituacaoCargasPlataforma', () => {
  it('situacaoCarga (decisão B do PO): erro vence; carregado só com data de carga; ativo sem carga = manual; nada = não carregado', () => {
    const carga = { em: AGORA };
    expect(situacaoCarga({ ativos: 5, erros: 2, ultima_carga: carga })).toBe('com_erro');
    expect(situacaoCarga({ ativos: 5, erros: 0, ultima_carga: carga })).toBe('carregado');
    expect(situacaoCarga({ ativos: 0, erros: 0, ultima_carga: carga })).toBe('carregado');
    expect(situacaoCarga({ ativos: 5, erros: 0, ultima_carga: null })).toBe('manual');
    expect(situacaoCarga({ ativos: 0, erros: 0, ultima_carga: null })).toBe('nao_carregado');
  });

  it('LinhaSituacaoCarga: o valor do enum, nunca texto; carregado exige ultima_carga; manual e não carregado sem ela', () => {
    expect(SituacaoCarga.options).toEqual(['carregado', 'com_erro', 'manual', 'nao_carregado']);
    expect(SituacaoCarga.safeParse('Cadastro manual').success).toBe(false);
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: linhas({ cliente: 'manual' }) }).success).toBe(true);
    const l = linhas({ filial: 'carregado' });
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: [{ ...l[0]!, ultima_carga: null }, ...l.slice(1)] }).success).toBe(false);
    const m = linhas({ filial: 'manual' });
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: [{ ...m[0]!, ultima_carga: { em: AGORA, quantidade: 1 } }, ...m.slice(1)] }).success).toBe(false);
  });

  it('aceita as 8 linhas, todas liberadas, em qualquer combinação de situações', () => {
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: linhas({ filial: 'carregado', produto: 'com_erro' }) }).success).toBe(true);
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: linhas({ cliente: 'carregado' }) }).success).toBe(true);
  });

  it('recusa ordem trocada, linha faltando, liberado false e erros fora do com_erro', () => {
    const l = linhas();
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: [l[1], l[0], ...l.slice(2)] }).success).toBe(false);
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: l.slice(1) }).success).toBe(false);
    const liberadoErrado = linhas().map((x) => (x.cadastro === 'vendedor' ? { ...x, liberado: false } : x));
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: liberadoErrado }).success).toBe(false);
    const errosSemSituacao = linhas().map((x) => (x.cadastro === 'filial' ? { ...x, erros: 2 } : x));
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: errosSemSituacao }).success).toBe(false);
    const opcionalErrado = linhas().map((x) => (x.cadastro === 'cliente' ? { ...x, opcional: true } : x));
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: opcionalErrado }).success).toBe(false);
  });

  it('sem estado de fila: em_andamento e operacao_em_andamento não existem mais', () => {
    const r = SituacaoCargasPlataforma.safeParse({ ...situacaoBase, operacao_em_andamento: true, cadastros: linhas() });
    expect(r.success && 'operacao_em_andamento' in r.data).toBe(false);
    expect(r.success && 'em_andamento' in (r.data.cadastros[0] ?? {})).toBe(false);
  });
});

describe('modo e efeito do Substituir tudo', () => {
  it('modo na query, padrão adicionar', () => {
    expect(ModoCargaQuery.parse({})).toEqual({ modo: 'adicionar' });
    expect(ModoCargaQuery.parse({ modo: 'substituir_tudo' })).toEqual({ modo: 'substituir_tudo' });
    expect(ModoCargaQuery.safeParse({ modo: 'completo' }).success).toBe(false);
  });

  it('limite de 30% do FDV: 30% passa, acima não; sem ativos não há limite', () => {
    expect(LIMITE_INATIVACAO_FDV_PCT).toBe(30);
    expect(efeitoSubstituir({ total: 10, a_inativar: 3 })).toEqual({ total: 10, a_inativar: 3, percentual: 30, acima_limite_fdv: false });
    expect(efeitoSubstituir({ total: 10, a_inativar: 4 }).acima_limite_fdv).toBe(true);
    expect(efeitoSubstituir({ total: 1000, a_inativar: 301 }).acima_limite_fdv).toBe(true);
    expect(efeitoSubstituir({ total: 0, a_inativar: 0 })).toEqual({ total: 0, a_inativar: 0, percentual: 0, acima_limite_fdv: false });
    expect(() => efeitoSubstituir({ total: 10, a_inativar: 11 })).toThrow(RangeError);
  });

  it('o Zod recusa percentual ou limite fora do cálculo e inativar mais que o total', () => {
    expect(EfeitoSubstituir.safeParse(efeitoSubstituir({ total: 10, a_inativar: 4 })).success).toBe(true);
    expect(EfeitoSubstituir.safeParse({ total: 10, a_inativar: 4, percentual: 40, acima_limite_fdv: false }).success).toBe(false);
    expect(EfeitoSubstituir.safeParse({ total: 10, a_inativar: 4, percentual: 25, acima_limite_fdv: false }).success).toBe(false);
    expect(EfeitoSubstituir.safeParse({ total: 10, a_inativar: 11, percentual: 100, acima_limite_fdv: true }).success).toBe(false);
  });

  it('sem_chave (registros do BKO sem external_id, fora da inativação) é opcional e repassado como veio', () => {
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, sem_chave: 5 })).toEqual({ total: 10, a_inativar: 2, percentual: 20, acima_limite_fdv: false, sem_chave: 5 });
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, sem_chave: 0 }).sem_chave).toBe(0);
    expect('sem_chave' in efeitoSubstituir({ total: 10, a_inativar: 2 })).toBe(false);
    expect(() => efeitoSubstituir({ total: 10, a_inativar: 2, sem_chave: -1 })).toThrow(RangeError);
    expect(() => efeitoSubstituir({ total: 10, a_inativar: 2, sem_chave: 1.5 })).toThrow(RangeError);
    expect(EfeitoSubstituir.safeParse(efeitoSubstituir({ total: 10, a_inativar: 4, sem_chave: 3 })).success).toBe(true);
    expect(EfeitoSubstituir.safeParse({ total: 10, a_inativar: 2, percentual: 20, acima_limite_fdv: false, sem_chave: -1 }).success).toBe(false);
  });

  it('enderecos_a_inativar (T-0070) é opcional, repassado como veio e não quebra a conferência do percentual', () => {
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, enderecos_a_inativar: 7 })).toEqual({ total: 10, a_inativar: 2, percentual: 20, acima_limite_fdv: false, enderecos_a_inativar: 7 });
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, enderecos_a_inativar: 0 }).enderecos_a_inativar).toBe(0);
    expect('enderecos_a_inativar' in efeitoSubstituir({ total: 10, a_inativar: 2 })).toBe(false);
    expect(() => efeitoSubstituir({ total: 10, a_inativar: 2, enderecos_a_inativar: -1 })).toThrow(RangeError);
    expect(() => efeitoSubstituir({ total: 10, a_inativar: 2, enderecos_a_inativar: 1.5 })).toThrow(RangeError);
    expect(EfeitoSubstituir.safeParse({ total: 10, a_inativar: 2, percentual: 20, acima_limite_fdv: false, enderecos_a_inativar: -1 }).success).toBe(false);
  });

  it('inativados_em_uso e enderecos_sem_chave (T-0075) são opcionais, repassados como vieram e só contagem inteira', () => {
    const base = { total: 10, a_inativar: 2, percentual: 20, acima_limite_fdv: false };
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, inativados_em_uso: 2, enderecos_sem_chave: 4 })).toEqual({ ...base, inativados_em_uso: 2, enderecos_sem_chave: 4 });
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, inativados_em_uso: 0 }).inativados_em_uso).toBe(0);
    const semCampos = efeitoSubstituir({ total: 10, a_inativar: 2 });
    expect('inativados_em_uso' in semCampos).toBe(false);
    expect('enderecos_sem_chave' in semCampos).toBe(false);
    for (const campo of ['inativados_em_uso', 'enderecos_sem_chave'] as const) {
      for (const v of [-1, 1.5]) {
        expect(() => efeitoSubstituir({ total: 10, a_inativar: 2, [campo]: v })).toThrow(RangeError);
        expect(EfeitoSubstituir.safeParse({ ...base, [campo]: v }).success).toBe(false);
      }
      expect(EfeitoSubstituir.safeParse({ ...base, [campo]: 2 }).success).toBe(true);
    }
  });

  it('inativados_em_uso ≤ a_inativar (T-0075, decisão do PO 23/11 21h57): RangeError no efeitoSubstituir e recusa no parse', () => {
    const base = { total: 10, a_inativar: 2, percentual: 20, acima_limite_fdv: false };
    expect(efeitoSubstituir({ total: 10, a_inativar: 2, inativados_em_uso: 2 }).inativados_em_uso).toBe(2);
    expect(() => efeitoSubstituir({ total: 10, a_inativar: 2, inativados_em_uso: 3 })).toThrow(RangeError);
    expect(EfeitoSubstituir.safeParse({ ...base, inativados_em_uso: 2 }).success).toBe(true);
    const acima = EfeitoSubstituir.safeParse({ ...base, inativados_em_uso: 3 });
    expect(acima.success).toBe(false);
    expect(acima.error?.issues.map((i) => i.path.join('.'))).toEqual(['inativados_em_uso']);
  });
});

describe('ValidarCargaPlataformaResposta', () => {
  it('aceita a resposta coerente, com efeito no substituir_tudo e sem ele no adicionar', () => {
    expect(ValidarCargaPlataformaResposta.safeParse(validacao()).success).toBe(true);
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ modo: 'adicionar', efeito: undefined })).success).toBe(true);
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ com_erro: 1, prontas: 0, linhas: [{ linha: null, motivo: 'Cabeçalho fora do modelo', acao: 'Baixe o modelo' }] })).success).toBe(true);
  });

  it('recusa efeito fora do modo, erros incoerentes, omitidas com lista curta e lista acima do limite', () => {
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ efeito: undefined })).success).toBe(false);
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ modo: 'adicionar' })).success).toBe(false);
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ com_erro: 0 })).success).toBe(false);
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ linhas_omitidas: 5 })).success).toBe(false);
    const cheia = Array.from({ length: LIMITE_LINHAS_ERRO_VALIDACAO + 1 }, (_, i) => ({ linha: i + 2, motivo: 'm', acao: 'a' }));
    expect(ValidarCargaPlataformaResposta.safeParse(validacao({ com_erro: cheia.length, linhas: cheia })).success).toBe(false);
  });

  it('sem validacao_id, chave de S3 nem validade', () => {
    const r = ValidarCargaPlataformaResposta.safeParse(validacao({ validacao_id: EMPRESA, arquivo_chave: 'x', valida_ate: AGORA }));
    expect(r.success).toBe(true);
    if (r.success) for (const k of ['validacao_id', 'arquivo_chave', 'valida_ate']) expect(k in r.data).toBe(false);
  });
});

describe('GravarCargaPlataformaEntrada', () => {
  it('adicionar sem frase', () => {
    expect(GravarCargaPlataformaEntrada.safeParse({ cadastro: 'produto', modo: 'adicionar' }).success).toBe(true);
    expect(GravarCargaPlataformaEntrada.safeParse({ cadastro: 'produto', modo: 'adicionar', frase: FRASE_SUBSTITUIR_TUDO }).success).toBe(false);
  });

  it('substituir_tudo com a frase, com e sem ponto, em maiúsculas e com espaços', () => {
    for (const frase of ['autorizo substituir tudo', 'autorizo substituir tudo.', 'AUTORIZO SUBSTITUIR TUDO.', '  autorizo  substituir tudo  ']) {
      expect(GravarCargaPlataformaEntrada.safeParse({ cadastro: 'produto', modo: 'substituir_tudo', frase }).success).toBe(true);
    }
  });

  it('substituir_tudo sem frase ou com frase errada: erro no campo frase (400 VALIDACAO)', () => {
    for (const frase of [undefined, '', 'autorizo substituir', FRASE_ZERAR_DADOS]) {
      const r = GravarCargaPlataformaEntrada.safeParse({ cadastro: 'produto', modo: 'substituir_tudo', frase });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['frase'], message: MENSAGEM_FRASE_SUBSTITUIR });
    }
  });

  it('recusa modo desconhecido', () => {
    expect(GravarCargaPlataformaEntrada.safeParse({ cadastro: 'produto', modo: 'completo' }).success).toBe(false);
  });
});

describe('estoque só aceita o Adicionar (decisão do PO, 23/11 15h49)', () => {
  const recusaNoModo = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => {
    expect(r.success).toBe(false);
    expect(r.error?.issues).toContainEqual(expect.objectContaining({ path: ['modo'], message: MENSAGEM_SUBSTITUIR_NAO_PERMITIDO }));
  };

  it('substituir_permitido: false só no estoque', () => {
    expect(CADASTROS_CARGA_PORTAL.filter((c) => !c.substituir_permitido).map((c) => c.cadastro)).toEqual(['estoque']);
    expect(substituirPermitido('estoque')).toBe(false);
    for (const c of ENTIDADES_CARGA_PORTAL.filter((x) => x !== 'estoque')) expect(substituirPermitido(c)).toBe(true);
    expect(() => substituirPermitido('nada' as CadastroCargaPortal)).toThrow(RangeError);
  });

  it('validar: substituir_tudo no estoque = 400 VALIDACAO no campo modo; adicionar passa', () => {
    recusaNoModo(ValidarCargaPlataformaEntrada.safeParse({ cadastro: 'estoque', modo: 'substituir_tudo' }));
    expect(ValidarCargaPlataformaEntrada.safeParse({ cadastro: 'estoque', modo: 'adicionar' }).success).toBe(true);
    expect(ValidarCargaPlataformaEntrada.safeParse({ cadastro: 'produto', modo: 'substituir_tudo' }).success).toBe(true);
  });

  it('gravar: substituir_tudo no estoque é recusado no campo modo, mesmo com a frase certa', () => {
    recusaNoModo(GravarCargaPlataformaEntrada.safeParse({ cadastro: 'estoque', modo: 'substituir_tudo', frase: FRASE_SUBSTITUIR_TUDO }));
    expect(GravarCargaPlataformaEntrada.safeParse({ cadastro: 'estoque', modo: 'adicionar' }).success).toBe(true);
  });

  it('respostas: estoque nunca volta em substituir_tudo', () => {
    const efeito = efeitoSubstituir({ total: 10, a_inativar: 2 });
    recusaNoModo(ValidarCargaPlataformaResposta.safeParse(validacao({ cadastro: 'estoque' })));
    recusaNoModo(GravarCargaPlataformaResposta.safeParse({ cadastro: 'estoque', modo: 'substituir_tudo', gravadas: 8, com_erro: 0, inativadas: 2, efeito }));
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'estoque', modo: 'adicionar', gravadas: 8, com_erro: 0 }).success).toBe(true);
  });
});

describe('GravarCargaPlataformaResposta (carga síncrona)', () => {
  const efeito = efeitoSubstituir({ total: 10, a_inativar: 2 });
  it('adicionar: só as contagens; substituir_tudo: inativadas e efeito', () => {
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'produto', modo: 'adicionar', gravadas: 8, com_erro: 1 }).success).toBe(true);
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'produto', modo: 'substituir_tudo', gravadas: 8, com_erro: 0, inativadas: 2, efeito }).success).toBe(true);
  });

  it('recusa inativadas ou efeito fora do modo e zero gravadas (é o 409 nada_a_gravar)', () => {
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'produto', modo: 'adicionar', gravadas: 8, com_erro: 0, inativadas: 2 }).success).toBe(false);
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'produto', modo: 'substituir_tudo', gravadas: 8, com_erro: 0, inativadas: 2 }).success).toBe(false);
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'produto', modo: 'substituir_tudo', gravadas: 8, com_erro: 0, efeito }).success).toBe(false);
    expect(GravarCargaPlataformaResposta.safeParse({ cadastro: 'produto', modo: 'adicionar', gravadas: 0, com_erro: 3 }).success).toBe(false);
  });

  describe('enderecos_inativados (T-0070): só no substituir_tudo do cliente', () => {
    const efeitoCliente = efeitoSubstituir({ total: 10, a_inativar: 2, enderecos_a_inativar: 5 });
    const cliente = { cadastro: 'cliente', modo: 'substituir_tudo', gravadas: 8, com_erro: 0, inativadas: 2 };
    const caminhoRecusado = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }, campo: string) => {
      expect(r.success).toBe(false);
      expect(r.error?.issues.some((i) => i.path.join('.') === campo)).toBe(true);
    };

    it('aceita o cliente com o campo (e com enderecos_a_inativar no efeito)', () => {
      expect(GravarCargaPlataformaResposta.safeParse({ ...cliente, efeito: efeitoCliente, enderecos_inativados: 5 }).success).toBe(true);
      expect(ValidarCargaPlataformaResposta.safeParse(validacao({ cadastro: 'cliente', efeito: efeitoCliente })).success).toBe(true);
    });

    it('aceita sem o campo (a API de hoje ainda não manda)', () => {
      expect(GravarCargaPlataformaResposta.safeParse({ ...cliente, efeito }).success).toBe(true);
      expect(ValidarCargaPlataformaResposta.safeParse(validacao({ cadastro: 'cliente' })).success).toBe(true);
    });

    it('recusa o produto com o campo', () => {
      caminhoRecusado(GravarCargaPlataformaResposta.safeParse({ ...cliente, cadastro: 'produto', efeito, enderecos_inativados: 5 }), 'enderecos_inativados');
      caminhoRecusado(GravarCargaPlataformaResposta.safeParse({ ...cliente, cadastro: 'produto', efeito: efeitoCliente }), 'efeito.enderecos_a_inativar');
      caminhoRecusado(ValidarCargaPlataformaResposta.safeParse(validacao({ efeito: efeitoCliente })), 'efeito.enderecos_a_inativar');
    });

    it('enderecos_sem_chave (T-0075): aceito no cliente, recusado fora dele no validar e no gravar', () => {
      const comSemChave = efeitoSubstituir({ total: 10, a_inativar: 2, sem_chave: 1, inativados_em_uso: 2, enderecos_sem_chave: 3 });
      expect(GravarCargaPlataformaResposta.safeParse({ ...cliente, efeito: comSemChave }).success).toBe(true);
      expect(ValidarCargaPlataformaResposta.safeParse(validacao({ cadastro: 'cliente', efeito: comSemChave })).success).toBe(true);
      caminhoRecusado(GravarCargaPlataformaResposta.safeParse({ ...cliente, cadastro: 'produto', efeito: comSemChave }), 'efeito.enderecos_sem_chave');
      caminhoRecusado(ValidarCargaPlataformaResposta.safeParse(validacao({ efeito: comSemChave })), 'efeito.enderecos_sem_chave');
      const recusa = GravarCargaPlataformaResposta.safeParse({ ...cliente, cadastro: 'produto', efeito: comSemChave });
      expect(recusa.error?.issues.find((i) => i.path.join('.') === 'efeito.enderecos_sem_chave')?.message).toBe(
        'Endereços só no Substituir tudo do cadastro cliente',
      );
      const semEnderecos = efeitoSubstituir({ total: 10, a_inativar: 2, sem_chave: 1, inativados_em_uso: 2 });
      expect(GravarCargaPlataformaResposta.safeParse({ ...cliente, cadastro: 'produto', efeito: semEnderecos }).success).toBe(true);
      expect(ValidarCargaPlataformaResposta.safeParse(validacao({ efeito: semEnderecos })).success).toBe(true);
    });

    it('recusa o adicionar com o campo', () => {
      caminhoRecusado(
        GravarCargaPlataformaResposta.safeParse({ cadastro: 'cliente', modo: 'adicionar', gravadas: 8, com_erro: 0, enderecos_inativados: 5 }),
        'enderecos_inativados',
      );
    });
  });
});

describe('cadastros e tabelas do zerar (RN-CAD-10, v0.3.5b)', () => {
  it('os mesmos 8 cadastros da carga, na mesma ordem (trava entre as listas)', () => {
    expect([...CADASTROS_ZERAR_PORTAL]).toEqual([...ENTIDADES_CARGA_PORTAL]);
  });

  it('as 12 tabelas do schema cadastros, sem repetição e sem as oficiais', () => {
    expect(TABELAS_ZERAGEM).toHaveLength(12);
    expect(new Set(TABELAS_ZERAGEM).size).toBe(12);
    expect(TABELAS_ZERAGEM).toContain('estoque_movimento');
    for (const t of ['ncm', 'cfop', 'municipio', 'consulta_externa']) expect(TABELAS_ZERAGEM).not.toContain(t);
  });
});

describe('PreviaZerarPlataformaEntrada e ZerarDadosPlataformaEntrada (RN-CAD-10, v0.3.5b)', () => {
  const cadastros = ['produto', 'preco'];

  it('prévia: de 1 a todos os cadastros, sem repetir e sem cadastro desconhecido', () => {
    expect(PreviaZerarPlataformaEntrada.safeParse({ cadastros }).success).toBe(true);
    expect(PreviaZerarPlataformaEntrada.safeParse({ cadastros: [...CADASTROS_ZERAR_PORTAL] }).success).toBe(true);
    expect(PreviaZerarPlataformaEntrada.safeParse({ cadastros: [] }).success).toBe(false);
    expect(PreviaZerarPlataformaEntrada.safeParse({ cadastros: ['produto', 'produto'] }).success).toBe(false);
    for (const antigo of ['forma_pagamento', 'forma_prazo', 'cliente_endereco']) {
      expect(PreviaZerarPlataformaEntrada.safeParse({ cadastros: [antigo] }).success).toBe(false);
    }
  });

  it('aceita a frase com e sem ponto, em maiúsculas e com espaços', () => {
    for (const frase of ['autorizo zerar os dados', 'autorizo zerar os dados.', 'AUTORIZO ZERAR OS DADOS', ' autorizo   zerar os dados. ']) {
      expect(ZerarDadosPlataformaEntrada.safeParse({ cadastros, frase }).success).toBe(true);
    }
  });

  it('recusa frase errada, o código da empresa (regra antiga), a outra frase e a falta de cadastros', () => {
    for (const frase of ['autorizo zerar', 'AM2808', FRASE_SUBSTITUIR_TUDO]) {
      const r = ZerarDadosPlataformaEntrada.safeParse({ cadastros, frase });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['frase'], message: MENSAGEM_FRASE_ZERAR });
    }
    expect(ZerarDadosPlataformaEntrada.safeParse({ cadastros }).success).toBe(false);
    expect(ZerarDadosPlataformaEntrada.safeParse({ frase: FRASE_ZERAR_DADOS }).success).toBe(false);
  });
});

describe('ZeragemPlataformaResposta (RN-CAD-10, v0.3.5b)', () => {
  const base = {
    empresa_id: EMPRESA,
    simulado: true,
    efetivos: ['produto', 'preco'],
    apagados: [
      { tabela: 'produto', quantidade: 10 },
      { tabela: 'tabela_preco_item', quantidade: 30 },
    ],
    anulados: [{ tabela: 'cliente', coluna: 'tabela_preco_id', quantidade: 4 }],
    mantidos: [{ cadastro: 'produto', motivo: 'pedido', quantidade: 2 }],
    bloqueios: [],
    sem_chave: 0,
  };

  it('aceita a prévia e o zerar sem bloqueio', () => {
    expect(ZeragemPlataformaResposta.safeParse(base).success).toBe(true);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, simulado: false }).success).toBe(true);
  });

  it('bloqueio só na prévia: no zerar é 422 zeragem_bloqueada', () => {
    const bloqueios = [{ cadastro: 'produto', motivo: 'lote_em_andamento' }];
    expect(ZeragemPlataformaResposta.safeParse({ ...base, bloqueios }).success).toBe(true);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, bloqueios: [{ cadastro: 'produto', motivo: 'integracao_ligada' }] }).success).toBe(false);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, simulado: false, bloqueios }).success).toBe(false);
    expect(CODIGO_ZERAGEM_BLOQUEADA).toBe('zeragem_bloqueada');
    expect(CODIGOS_DETALHE_CARGA_PORTAL).toContain(CODIGO_ZERAGEM_BLOQUEADA);
  });

  it('RN-CAD-10: CODIGO_FRASE_NAO_CONFERE está nos códigos de detalhe da carga', () => {
    expect(CODIGO_FRASE_NAO_CONFERE).toBe('frase_nao_confere');
    expect(CodigoDetalheCargaPortal.parse(CODIGO_FRASE_NAO_CONFERE)).toBe('frase_nao_confere');
  });

  it('aceita o motivo fiscal em mantidos: filial com A1 ou ambiente fiscal fica (decisão do PO, 23/11 16h18)', () => {
    expect(MOTIVOS_USO).toEqual(['pedido', 'titulo', 'nota', 'fiscal']);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, mantidos: [{ cadastro: 'filial', motivo: 'fiscal', quantidade: 1 }] }).success).toBe(true);
    expect(sdk.MOTIVOS_USO).toBe(MOTIVOS_USO);
  });

  it('36 A (RD-2328): a mensagem dos mantidos saiu do SDK; a tela monta o retorno', () => {
    expect(sdk).not.toHaveProperty('MENSAGEM_MANTIDOS_ZERAR');
    expect(sdk).not.toHaveProperty('AVISO_ZERAR_INATIVA_FDV');
  });

  it('recusa tabela fora do enum, coluna anulada desconhecida, motivo livre e repetição', () => {
    expect(ZeragemPlataformaResposta.safeParse({ ...base, apagados: [{ tabela: 'ncm', quantidade: 1 }] }).success).toBe(false);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, anulados: [{ tabela: 'cliente', coluna: 'filial_id', quantidade: 1 }] }).success).toBe(false);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, mantidos: [{ cadastro: 'produto', motivo: 'outro', quantidade: 1 }] }).success).toBe(false);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, efetivos: ['produto', 'produto'] }).success).toBe(false);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, apagados: [base.apagados[0], base.apagados[0]] }).success).toBe(false);
    expect(ZeragemPlataformaResposta.safeParse({ ...base, sem_chave: -1 }).success).toBe(false);
  });
});

describe('rotas, ações e erros', () => {
  it('caminhos sob /empresas/:id/cadastros, sem repetição e sem validacao_id', () => {
    const cs = Object.values(CAMINHOS_CARGAS_PLATAFORMA);
    expect(new Set(cs).size).toBe(cs.length);
    for (const c of cs) {
      expect(c.startsWith('/empresas/:id/cadastros/')).toBe(true);
      expect(c).not.toContain('validacao');
    }
  });

  it('prévia e zerar com caminhos próprios; ações novas no ACOES_PLATAFORMA', () => {
    expect(CAMINHOS_CARGAS_PLATAFORMA.previa).toBe('/empresas/:id/cadastros/zerar/previa');
    expect(CAMINHOS_CARGAS_PLATAFORMA.zerar).toBe('/empresas/:id/cadastros/zerar');
    expect(ACOES_PLATAFORMA).toContain('plataforma.cadastros.carga');
    expect(ACOES_PLATAFORMA).toContain('plataforma.cadastros.zerar');
  });

  it('SQLSTATE próprios: MXC01 e MXC04 (o MXC02 e o MXC03 saíram); nada_a_gravar fica', () => {
    expect(Object.values(SQLSTATES_CARGA_PORTAL)).toEqual(['MXC01', 'MXC04']);
    expect(new Set(CODIGOS_DETALHE_CARGA_PORTAL).size).toBe(CODIGOS_DETALHE_CARGA_PORTAL.length);
    expect(CODIGOS_DETALHE_CARGA_PORTAL).toContain('nada_a_gravar');
    expect(CODIGOS_DETALHE_CARGA_PORTAL).toContain('carga_em_andamento');
  });

  it('MXC03 do zerar (0043, RN-CAD-10): lista fechada de DETAIL, sem repetição e fora dos códigos da carga; mensagem própria', () => {
    expect(CODIGOS_ESTADO_MUDOU_ZERAR).toEqual(['em_uso', 'sumiu', 'anular_fora_do_plano', 'referencia']);
    expect(new Set(CODIGOS_ESTADO_MUDOU_ZERAR).size).toBe(CODIGOS_ESTADO_MUDOU_ZERAR.length);
    for (const c of CODIGOS_ESTADO_MUDOU_ZERAR) expect(CODIGOS_DETALHE_CARGA_PORTAL as readonly string[]).not.toContain(c);
    expect(MENSAGENS_CARGA_PORTAL.estadoMudouZerar).toBe('Os dados mudaram. Confira de novo.');
    expect(sdk.CODIGOS_ESTADO_MUDOU_ZERAR).toBe(CODIGOS_ESTADO_MUDOU_ZERAR);
  });

  it('carga do cliente: tipos de endereço e a mensagem de dados diferentes', () => {
    expect(TIPOS_ENDERECO_CLIENTE).toEqual(['principal', 'entrega', 'cobranca']);
    expect(dadosClienteDiferentes(3)).toBe('Dados do cliente diferentes da linha 3: deixe iguais em todas as linhas do cliente');
    expect(() => dadosClienteDiferentes(0)).toThrow(RangeError);
    expect(sdk.dadosClienteDiferentes).toBe(dadosClienteDiferentes);
    expect(sdk.TIPOS_ENDERECO_CLIENTE).toBe(TIPOS_ENDERECO_CLIENTE);
  });

  it('AVISOS_CARGA_PORTAL (T-0075): inativados com e sem em uso, singular, plural, 0 → null e RangeError fora de inteiro ≥ 0', () => {
    expect(Object.isFrozen(AVISOS_CARGA_PORTAL)).toBe(true);
    expect(AVISOS_CARGA_PORTAL.inativados(12, 3)).toBe('Inativados: 12 (3 em uso: continuam nos pedidos, títulos e notas)');
    expect(AVISOS_CARGA_PORTAL.inativados(1, 1)).toBe('Inativados: 1 (1 em uso: continuam nos pedidos, títulos e notas)');
    expect(AVISOS_CARGA_PORTAL.inativados(12, 0)).toBe('Inativados: 12');
    expect(AVISOS_CARGA_PORTAL.inativados(0, 0)).toBeNull();
    for (const [n, m] of [[-1, 0], [1.5, 0], [2, -1], [2, 0.5], [2, 3], [0, 1]] as [number, number][]) {
      expect(() => AVISOS_CARGA_PORTAL.inativados(n, m)).toThrow(RangeError);
    }
    expect(AVISOS_CARGA_PORTAL.semChave(1)).toBe('1 registro sem código ficou fora da substituição: dê um código a ele para entrar na próxima');
    expect(AVISOS_CARGA_PORTAL.semChave(3)).toBe('3 registros sem código ficaram fora da substituição: dê um código a eles para entrarem na próxima');
    expect(AVISOS_CARGA_PORTAL.enderecosSemChave(1)).toBe('1 endereço sem código ficou fora da substituição');
    expect(AVISOS_CARGA_PORTAL.enderecosSemChave(2)).toBe('2 endereços sem código ficaram fora da substituição');
    for (const f of [AVISOS_CARGA_PORTAL.semChave, AVISOS_CARGA_PORTAL.enderecosSemChave]) {
      expect(f(0)).toBeNull();
      expect(() => f(-1)).toThrow(RangeError);
      expect(() => f(1.5)).toThrow(RangeError);
    }
    expect(sdk.AVISOS_CARGA_PORTAL).toBe(AVISOS_CARGA_PORTAL);
  });

  it('o índice do SDK reexporta', () => {
    expect(sdk.CAMINHOS_CARGAS_PLATAFORMA).toBe(CAMINHOS_CARGAS_PLATAFORMA);
    expect(sdk.normalizarFrase).toBe(normalizarFrase);
    expect(sdk.efeitoSubstituir).toBe(efeitoSubstituir);
  });
});
