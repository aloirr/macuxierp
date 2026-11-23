import { describe, expect, it } from 'vitest';
import { TIPO_CSV } from './listas';
import { ACOES_PLATAFORMA } from './plataforma-rotas';
import { ENTIDADES_ENVIO_FDV } from './portal-integracao';
import {
  CADASTROS_CARGA_PORTAL,
  CAMINHOS_CARGAS_PLATAFORMA,
  CODIGOS_DETALHE_CARGA_PORTAL,
  DEPENDENCIAS_CARGA_PORTAL,
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
  ModoCargaQuery,
  SQLSTATES_CARGA_PORTAL,
  SituacaoCargasPlataforma,
  TIPO_DOWNLOAD_CARGA,
  ValidarCargaPlataformaResposta,
  ZerarDadosPlataformaEntrada,
  dependenciaPendente,
  efeitoSubstituir,
  normalizarFrase,
  rotuloCadastroCarga,
  situacaoCarga,
  type CadastroCargaPortal,
  type SituacaoCarga,
} from './portal-cargas';
import * as sdk from './index';

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const AGORA = '2026-11-23T19:00:00.000Z';

/** Linhas da aba a partir das situações (o resto não carregado), com a dependência e o liberado derivados. */
function linhas(situacoes: Partial<Record<CadastroCargaPortal, SituacaoCarga>> = {}) {
  return CADASTROS_CARGA_PORTAL.map((c) => {
    const situacao = situacoes[c.cadastro] ?? 'nao_carregado';
    const depende_de = dependenciaPendente(c.cadastro, situacoes);
    return {
      numero: c.numero,
      cadastro: c.cadastro,
      situacao,
      erros: situacao === 'com_erro' ? 3 : 0,
      ultima_carga: situacao === 'nao_carregado' ? null : { em: AGORA, quantidade: 10 },
      depende_de,
      liberado: depende_de === null,
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
  it('ordem do D13, a mesma do Hub, numerada de 1 a 10', () => {
    expect(ENTIDADES_CARGA_PORTAL).toEqual(ENTIDADES_ENVIO_FDV);
    expect(CADASTROS_CARGA_PORTAL.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('cada dependência vem antes na ordem; só as unidades são opcionais e ninguém depende delas', () => {
    for (const [i, c] of CADASTROS_CARGA_PORTAL.entries()) {
      for (const d of c.depende_de) expect(ENTIDADES_CARGA_PORTAL.indexOf(d)).toBeLessThan(i);
    }
    expect(CADASTROS_CARGA_PORTAL.filter((c) => c.opcional).map((c) => c.cadastro)).toEqual(['produto_unidade']);
    expect(Object.values(DEPENDENCIAS_CARGA_PORTAL).flat()).not.toContain('produto_unidade');
    expect(DEPENDENCIAS_CARGA_PORTAL.cliente).toEqual(['filial', 'vendedor', 'prazo_pagamento', 'preco']);
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
  it('situacaoCarga: erro vence; registro ativo = carregado; nada = não carregado', () => {
    expect(situacaoCarga({ ativos: 5, erros: 2 })).toBe('com_erro');
    expect(situacaoCarga({ ativos: 5, erros: 0 })).toBe('carregado');
    expect(situacaoCarga({ ativos: 0, erros: 0 })).toBe('nao_carregado');
  });

  it('dependenciaPendente: a primeira não carregada, na ordem da carga; com erro não bloqueia', () => {
    expect(dependenciaPendente('cliente', { filial: 'carregado' })).toBe('vendedor');
    expect(dependenciaPendente('cliente', { filial: 'carregado', vendedor: 'com_erro', prazo_pagamento: 'carregado', preco: 'carregado' })).toBeNull();
    expect(dependenciaPendente('filial', {})).toBeNull();
  });

  it('aceita as 10 linhas com a dependência e o liberado derivados', () => {
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: linhas({ filial: 'carregado', produto: 'com_erro' }) }).success).toBe(true);
  });

  it('recusa ordem trocada, linha faltando, dependência inventada, liberado incoerente e erros fora do com_erro', () => {
    const l = linhas();
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: [l[1], l[0], ...l.slice(2)] }).success).toBe(false);
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: l.slice(1) }).success).toBe(false);
    const semDep = linhas().map((x) => (x.cadastro === 'vendedor' ? { ...x, depende_de: null } : x));
    expect(SituacaoCargasPlataforma.safeParse({ ...situacaoBase, cadastros: semDep }).success).toBe(false);
    const liberadoErrado = linhas().map((x) => (x.cadastro === 'vendedor' ? { ...x, liberado: true } : x));
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
    expect(GravarCargaPlataformaEntrada.safeParse({ modo: 'adicionar' }).success).toBe(true);
    expect(GravarCargaPlataformaEntrada.safeParse({ modo: 'adicionar', frase: FRASE_SUBSTITUIR_TUDO }).success).toBe(false);
  });

  it('substituir_tudo com a frase, com e sem ponto, em maiúsculas e com espaços', () => {
    for (const frase of ['autorizo substituir tudo', 'autorizo substituir tudo.', 'AUTORIZO SUBSTITUIR TUDO.', '  autorizo  substituir tudo  ']) {
      expect(GravarCargaPlataformaEntrada.safeParse({ modo: 'substituir_tudo', frase }).success).toBe(true);
    }
  });

  it('substituir_tudo sem frase ou com frase errada: erro no campo frase (400 VALIDACAO)', () => {
    for (const frase of [undefined, '', 'autorizo substituir', FRASE_ZERAR_DADOS]) {
      const r = GravarCargaPlataformaEntrada.safeParse({ modo: 'substituir_tudo', frase });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['frase'], message: MENSAGEM_FRASE_SUBSTITUIR });
    }
  });

  it('recusa modo desconhecido', () => {
    expect(GravarCargaPlataformaEntrada.safeParse({ modo: 'completo' }).success).toBe(false);
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
});

describe('ZerarDadosPlataformaEntrada (RN-CAD-10, v0.3.5b)', () => {
  it('aceita a frase com e sem ponto, em maiúsculas e com espaços', () => {
    for (const frase of ['autorizo zerar os dados', 'autorizo zerar os dados.', 'AUTORIZO ZERAR OS DADOS', ' autorizo   zerar os dados. ']) {
      expect(ZerarDadosPlataformaEntrada.safeParse({ frase }).success).toBe(true);
    }
  });

  it('recusa frase errada, o código da empresa (regra antiga) e a outra frase', () => {
    for (const frase of ['autorizo zerar', 'AM2808', FRASE_SUBSTITUIR_TUDO]) {
      const r = ZerarDadosPlataformaEntrada.safeParse({ frase });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['frase'], message: MENSAGEM_FRASE_ZERAR });
    }
    expect(ZerarDadosPlataformaEntrada.safeParse({}).success).toBe(false);
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

  it('downloads em CSV com o tipo do SDK; ações novas no ACOES_PLATAFORMA', () => {
    expect(TIPO_DOWNLOAD_CARGA).toBe(TIPO_CSV);
    expect(ACOES_PLATAFORMA).toContain('plataforma.cadastros.carga');
    expect(ACOES_PLATAFORMA).toContain('plataforma.cadastros.zerar');
  });

  it('SQLSTATE próprios: MXC01, MXC03 e MXC04 (o MXC02 saiu); nada_a_gravar fica', () => {
    expect(Object.values(SQLSTATES_CARGA_PORTAL)).toEqual(['MXC01', 'MXC03', 'MXC04']);
    expect(new Set(CODIGOS_DETALHE_CARGA_PORTAL).size).toBe(CODIGOS_DETALHE_CARGA_PORTAL.length);
    expect(CODIGOS_DETALHE_CARGA_PORTAL).toContain('nada_a_gravar');
    expect(CODIGOS_DETALHE_CARGA_PORTAL).toContain('carga_em_andamento');
  });

  it('o índice do SDK reexporta', () => {
    expect(sdk.CAMINHOS_CARGAS_PLATAFORMA).toBe(CAMINHOS_CARGAS_PLATAFORMA);
    expect(sdk.normalizarFrase).toBe(normalizarFrase);
    expect(sdk.efeitoSubstituir).toBe(efeitoSubstituir);
  });
});
