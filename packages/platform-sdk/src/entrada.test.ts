import { describe, expect, it } from 'vitest';
import {
  CAMINHOS_ENTRADA,
  CAMINHOS_ENTRADA_PLATAFORMA,
  ChaveEntrada,
  ConectorIdEntrada,
  CriarCredencialEntrada,
  CredencialEntradaCriada,
  CredencialEntradaResumo,
  IdempotencyKeyEntrada,
  LIMITE_LOTES_PORTAL_ENTRADA,
  LoteEntradaResumo,
  PortalEntradaLeitura,
  PREFIXO_ENTRADA,
  prefixoChaveEntrada,
} from './entrada';

const T = '2026-11-27T01:00:00.000Z';
const LOTE = '7c2e9a14-5d3b-4e86-9f01-3a8b64d2c7e5';
const CHAVE = 'a'.repeat(43);

describe('T-0057 (ADR 0014 §3, corte de 26/11): contrato da /entrada/v1', () => {
  it('rotas: os caminhos do Hub sob o prefixo próprio (o cliente HTTP do Conector só troca o prefixo), congelados', () => {
    expect(Object.values(CAMINHOS_ENTRADA).map((c) => `${PREFIXO_ENTRADA}${c}`)).toEqual(['/entrada/v1/lotes', '/entrada/v1/lotes/:id', '/entrada/v1/cursores/:entidade', '/entrada/v1/sinal']);
    expect(Object.isFrozen(CAMINHOS_ENTRADA)).toBe(true);
    expect(Object.isFrozen(CAMINHOS_ENTRADA_PLATAFORMA)).toBe(true);
  });

  it('conector_id e Idempotency-Key: formato fechado, sem espaço nem controle', () => {
    expect(ConectorIdEntrada.safeParse('thathyany-erp').success).toBe(true);
    expect(ConectorIdEntrada.safeParse('a'.repeat(100)).success).toBe(true);
    for (const x of ['', ' a', 'a b', 'a'.repeat(101), 'a\nb', '-a']) expect(ConectorIdEntrada.safeParse(x).success).toBe(false);
    expect(IdempotencyKeyEntrada.safeParse('lote:produto:2026-11-27T01:00:00Z').success).toBe(true);
    for (const x of ['', 'curta', 'a b', 'x'.repeat(129)]) expect(IdempotencyKeyEntrada.safeParse(x).success).toBe(false);
  });

  it('chave: 32 bytes em base64url (43 caracteres); o prefixo exibido tem 8', () => {
    expect(ChaveEntrada.safeParse(CHAVE).success).toBe(true);
    expect(ChaveEntrada.safeParse('a'.repeat(42)).success).toBe(false);
    expect(ChaveEntrada.safeParse(`${'a'.repeat(42)}=`).success).toBe(false);
    expect(prefixoChaveEntrada(`abcdefgh${'z'.repeat(35)}`)).toBe('abcdefgh');
  });

  it('portal: o corpo de criar a credencial é fechado', () => {
    expect(CriarCredencialEntrada.parse({ conector_id: 'thathyany-erp' })).toEqual({ conector_id: 'thathyany-erp' });
    expect(CriarCredencialEntrada.safeParse({ conector_id: 'x y' }).success).toBe(false);
    expect(CriarCredencialEntrada.safeParse({ conector_id: 'abc', extra: 1 }).success).toBe(false);
  });

  it('a chave aparece só na resposta da criação; o resumo nunca leva chave nem hash', () => {
    expect(CredencialEntradaCriada.parse({ conector_id: 'abc', chave: CHAVE, prefixo: 'aaaaaaaa', criada_em: T })).toMatchObject({ chave: CHAVE });
    const resumo = { conector_id: 'abc', prefixo: 'aaaaaaaa', criada_em: T, revogada_em: null };
    expect(CredencialEntradaResumo.parse(resumo)).toEqual(resumo);
    expect(CredencialEntradaResumo.safeParse({ ...resumo, chave: CHAVE }).success).toBe(false);
    expect(CredencialEntradaResumo.safeParse({ ...resumo, chave_hmac: 'x' }).success).toBe(false);
    // RD-2319 (36 A): o "Último uso" saiu da tela; a tela mostra o último sinal.
    expect(CredencialEntradaResumo.safeParse({ ...resumo, ultimo_uso_em: null }).success).toBe(false);
  });

  it('leitura do portal: credenciais, último sinal e até 50 lotes recentes, só contagens', () => {
    const lote = { lote_id: LOTE, entidade: 'produto', modo: 'delta', status: 'concluido_com_erros', recebidos: 10, com_erro: 2, recebido_em: T, concluido_em: T };
    expect(LoteEntradaResumo.parse(lote)).toEqual(lote);
    expect(LoteEntradaResumo.safeParse({ ...lote, com_erro: 11 }).success).toBe(false);
    expect(LoteEntradaResumo.safeParse({ ...lote, entidade: 'titulo' }).success).toBe(false);
    const leitura = { credenciais: [], ultimo_sinal: null, lotes: Array.from({ length: LIMITE_LOTES_PORTAL_ENTRADA }, () => lote) };
    expect(PortalEntradaLeitura.parse(leitura).lotes).toHaveLength(50);
    expect(PortalEntradaLeitura.safeParse({ ...leitura, lotes: [...leitura.lotes, lote] }).success).toBe(false);
    expect(PortalEntradaLeitura.parse({ ...leitura, ultimo_sinal: { em: T, versao_conector: '1.5.0', conector_id: 'abc' } }).ultimo_sinal).toMatchObject({ versao_conector: '1.5.0' });
  });
});
