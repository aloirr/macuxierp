import { describe, expect, it } from 'vitest';
import { CADASTROS_ZERAR_PORTAL, ZeragemPlataformaResposta } from './portal-cargas';
import { CAMINHOS_INTEGRACAO_FDV_PLATAFORMA, ENTIDADES_ENVIO_FDV } from './portal-integracao';
import {
  ATRASO_SINAL_FDV_MS,
  AVISO_ZERAR_INATIVA_FDV,
  CADASTRO_ZERAR_POR_ENTIDADE_FDV,
  CAMINHOS_INTEGRACAO_FDV_TENANT,
  InativacaoZerarFdv,
  LIMITE_ERROS_LOG_FDV,
  LogCadastroFdvPlataforma,
  LogCadastroFdvTenant,
  MonitorConectorFdv,
  REPROCESSAVEIS_FDV,
  ROTULO_ORIGEM_ENVIO_FDV,
  ROTULO_SITUACAO_ENVIO_FDV,
  RespostaReprocessarFdv,
  SITUACOES_REGISTRO_FDV,
  situacaoConectorFdv,
} from './portal-integracao-operacao';
import * as sdk from './index';

const AGORA = new Date('2026-11-24T21:00:00.000Z');
const LIDO = AGORA.toISOString();
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();

describe('situacaoConectorFdv e MonitorConectorFdv (T-0086 §2)', () => {
  const base = { credencial_ativa: true, habilitadas: 3, agora: AGORA };

  it('desativado sem credencial ou sem cadastro habilitado; atrasado sem sinal ou com sinal velho; senão em dia', () => {
    expect(situacaoConectorFdv({ ...base, credencial_ativa: false, ultimo_sinal_em: antes(0) })).toBe('desativado');
    expect(situacaoConectorFdv({ ...base, habilitadas: 0, ultimo_sinal_em: antes(0) })).toBe('desativado');
    expect(situacaoConectorFdv({ ...base, ultimo_sinal_em: null })).toBe('atrasado');
    expect(situacaoConectorFdv({ ...base, ultimo_sinal_em: antes(ATRASO_SINAL_FDV_MS + 1) })).toBe('atrasado');
    expect(situacaoConectorFdv({ ...base, ultimo_sinal_em: antes(ATRASO_SINAL_FDV_MS) })).toBe('em_dia');
  });

  const monitor = { identificador: 'erp-teste', situacao: 'em_dia', versao: '0.3.12', ultimo_sinal_em: antes(1000), fila: { lotes: 1, linhas: 40 }, lido_em: LIDO };

  it('aceita o Monitor; sem credencial só desativado; em dia exige sinal', () => {
    expect(MonitorConectorFdv.parse(monitor)).toEqual(monitor);
    expect(MonitorConectorFdv.safeParse({ ...monitor, identificador: null, versao: null }).success).toBe(false);
    expect(MonitorConectorFdv.safeParse({ ...monitor, identificador: null, versao: null, situacao: 'desativado' }).success).toBe(true);
    expect(MonitorConectorFdv.safeParse({ ...monitor, ultimo_sinal_em: null }).success).toBe(false);
    expect(MonitorConectorFdv.safeParse({ ...monitor, versao: 'v1' }).success).toBe(false);
  });
});

describe('Reprocessar (R-20261124-090216)', () => {
  it('só falhas e pendentes: nunca o integrado', () => {
    expect([...REPROCESSAVEIS_FDV].sort()).toEqual(['falha', 'pendente']);
    expect(SITUACOES_REGISTRO_FDV).toContain('integrado');
    expect(Object.isFrozen(REPROCESSAVEIS_FDV)).toBe(true);
  });

  it('resposta com as contagens e a hora do pedido', () => {
    const r = { entidade: 'preco', falhas: 2, pendentes: 0, pedido_em: LIDO };
    expect(RespostaReprocessarFdv.parse(r)).toEqual(r);
    expect(RespostaReprocessarFdv.safeParse({ ...r, falhas: -1 }).success).toBe(false);
    expect(RespostaReprocessarFdv.safeParse({ ...r, entidade: 'pedido' }).success).toBe(false);
  });
});

describe('Log por cadastro (R-20261124-085515, ADR 0013)', () => {
  const envio = { em: LIDO, origem: 'ciclo', situacao: 'com_erros', registros: 10, com_erro: 2 };
  const base = { entidade: 'vendedor', lido_em: LIDO, envios: [envio], total_erros: 2, motivo: 'erros_por_linha' };

  it('/config: só código, campo e contagem, sem dado do registro', () => {
    const l = { ...base, erros: [{ codigo: 'referencia_ausente', campo: 'filial_external_id', quantidade: 2 }] };
    expect(LogCadastroFdvPlataforma.parse(l)).toEqual(l);
    const comRegistro = { ...l, erros: [{ ...l.erros[0], registro_external_id: 'V-01' }] };
    expect(LogCadastroFdvPlataforma.parse(comRegistro).erros[0]).not.toHaveProperty('registro_external_id');
    expect(LogCadastroFdvPlataforma.safeParse({ ...l, erros: [{ ...l.erros[0], quantidade: 3 }] }).success).toBe(false);
    expect(LogCadastroFdvPlataforma.safeParse({ ...l, erros: [l.erros[0], l.erros[0]], total_erros: 4 }).success).toBe(false);
    expect(LogCadastroFdvPlataforma.safeParse({ ...l, envios: [{ ...envio, com_erro: 11 }] }).success).toBe(false);
  });

  it('BKO: o registro, o motivo, a ação e o link Corrigir (nulo quando apagado)', () => {
    const erro = { registro_external_id: 'V-01', nome_curto: 'Ana', campo: 'filial_external_id', codigo: 'referencia_ausente', motivo_texto: 'Filial não existe no FDV', acao_texto: 'Carregue Filiais antes', corrigir_href: '/cadastros/vendedores/V-01' };
    const l = { ...base, erros: [erro, { ...erro, registro_external_id: 'V-02', corrigir_href: null }] };
    expect(LogCadastroFdvTenant.parse(l)).toEqual(l);
    expect(LogCadastroFdvTenant.safeParse({ ...l, total_erros: 1 }).success).toBe(false);
    expect(LogCadastroFdvTenant.safeParse({ ...l, erros: Array(LIMITE_ERROS_LOG_FDV + 1).fill(erro), total_erros: 500 }).success).toBe(false);
  });

  it('caminhos do /config e do BKO', () => {
    const { monitor, reprocessar, log } = CAMINHOS_INTEGRACAO_FDV_PLATAFORMA;
    for (const c of [monitor, reprocessar, log]) expect(c.startsWith('/empresas/:id/integracao-fdv/')).toBe(true);
    expect(new Set([monitor, reprocessar, log]).size).toBe(3);
    for (const c of Object.values(CAMINHOS_INTEGRACAO_FDV_TENANT)) expect(c.startsWith('/integracao-fdv/')).toBe(true);
  });
});

describe('Zerar por cadastro inativa no FDV (R-20261124-170915-alexandre)', () => {
  it('toda entidade da F2 aponta para um cadastro do Zerar', () => {
    expect(Object.keys(CADASTRO_ZERAR_POR_ENTIDADE_FDV)).toEqual([...ENTIDADES_ENVIO_FDV]);
    for (const c of Object.values(CADASTRO_ZERAR_POR_ENTIDADE_FDV)) expect(CADASTROS_ZERAR_PORTAL).toContain(c);
    expect(AVISO_ZERAR_INATIVA_FDV).toBe('Os registros também serão inativados no Macuxi FDV.');
  });

  it('a resposta do zerar leva a inativação pendente por entidade (opcional)', () => {
    const r = { empresa_id: '11111111-1111-4111-8111-111111111111', simulado: false, efetivos: ['cliente'], apagados: [], anulados: [], mantidos: [], bloqueios: [], sem_chave: 0 };
    expect(ZeragemPlataformaResposta.safeParse(r).success).toBe(true);
    const inativacao_fdv = [{ entidade: 'cliente', quantidade: 5 }, { entidade: 'cliente_endereco', quantidade: 7 }];
    expect(ZeragemPlataformaResposta.parse({ ...r, inativacao_fdv }).inativacao_fdv).toEqual(inativacao_fdv);
    expect(InativacaoZerarFdv.safeParse([inativacao_fdv[0], inativacao_fdv[0]]).success).toBe(false);
    expect(InativacaoZerarFdv.safeParse([{ entidade: 'cliente', quantidade: 0 }]).success).toBe(false);
  });
});

it('é reexportado pelo índice do SDK; os rótulos do Log são imutáveis', () => {
  expect(Object.isFrozen(ROTULO_ORIGEM_ENVIO_FDV) && Object.isFrozen(ROTULO_SITUACAO_ENVIO_FDV)).toBe(true);
  expect(sdk.ROTULO_SITUACAO_ENVIO_FDV).toBe(ROTULO_SITUACAO_ENVIO_FDV);
  expect(sdk.MonitorConectorFdv).toBe(MonitorConectorFdv);
  expect(sdk.LogCadastroFdvTenant).toBe(LogCadastroFdvTenant);
  expect(sdk.CAMINHOS_INTEGRACAO_FDV_TENANT).toBe(CAMINHOS_INTEGRACAO_FDV_TENANT);
});
