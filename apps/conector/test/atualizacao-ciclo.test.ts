import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DependenciasAtualizacao } from '../src/atualizacao/atualizador';
import { cicloAtualizacao, ultimoResultadoAtualizacao } from '../src/atualizacao/ciclo';
import { AtualizacaoConfig, MENSAGEM_ATUALIZACAO_DESLIGADA } from '../src/config/esquema';
import { Executor } from '../src/executor';
import { guardarPolitica } from '../src/politica';
import { formatarStatus, montarStatus } from '../src/status';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.encerrar();
  amb = undefined;
});

const PACOTE = { versao: '9.9.9', url: 'https://pacotes.exemplo.invalid/c.zip', sha256: 'a'.repeat(64), assinatura: 'x', chave_publica_id: 'teste' };
const politicaComPacote = () => ({ versao_minima: '1.0.0', versao_recomendada: '9.9.9', pacote: PACOTE });

function dependencias(baixou: string[]): DependenciasAtualizacao {
  return {
    baixador: { baixar: async (p) => { baixou.push(p.versao); throw new Error('bucket fora do ar'); } },
    extrator: { extrair: async () => undefined },
    servico: { parar: async () => undefined, iniciar: async () => undefined },
    saude: { consultar: async () => null },
  };
}

/**
 * ADR 0014 §6 item 3: no Macuxi ERP o esquema recusa `atualizacao.ativa: true`. O código da atualização continua no pacote; para
 * os testes do caminho "ligada" seguirem valendo, a configuração é ligada direto no contexto, por fora do esquema.
 */
async function ambienteLigado(): Promise<Ambiente> {
  const a = await criarAmbiente();
  // Pasta temporária do ambiente (apagada no encerrar): um caminho do Windows aqui virava pasta relativa no Linux.
  a.ctx.config.atualizacao = { ...AtualizacaoConfig.parse({}), ativa: true, pasta: join(a.dir, 'atualizacao-conector') };
  return a;
}

describe('T-0116: atualização automática ligada ao executor (desligada por padrão)', () => {
  it('RN-INT-11: por padrão fica desligada: nem entra na agenda do executor nem baixa nada', async () => {
    amb = await criarAmbiente();
    expect(AtualizacaoConfig.parse({}).ativa).toBe(false);
    const baixou: string[] = [];
    amb.ctx.atualizacao = dependencias(baixou);
    guardarPolitica(amb.ctx.store, politicaComPacote(), amb.relogio.agora());
    expect(await cicloAtualizacao(amb.ctx)).toBe('desligada');
    amb.relogio.avancar(2 * 3_600_000);
    expect(await new Executor(amb.ctx).ciclo()).not.toContain('atualizacao');
    expect(baixou).toEqual([]);
  });

  it('ADR 0014 §6: o esquema do Macuxi ERP recusa ativa=true (com ou sem pasta), com a mensagem da troca manual', () => {
    for (const cfg of [{ ativa: true }, { ativa: true, pasta: 'C:\\Macuxi\\Conector' }]) {
      const r = AtualizacaoConfig.safeParse(cfg);
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.message)).toContain(MENSAGEM_ATUALIZACAO_DESLIGADA);
    }
    expect(AtualizacaoConfig.safeParse({ ativa: false }).success).toBe(true);
  });

  it('ligada sem o download do pacote (T-0098): só avisa no log e não troca nada', async () => {
    amb = await ambienteLigado();
    guardarPolitica(amb.ctx.store, politicaComPacote(), amb.relogio.agora());
    expect(await cicloAtualizacao(amb.ctx)).toBe('sem_dependencias');
    expect(amb.logs.join('\n')).toContain('atualizacao_sem_dependencias');
    expect(ultimoResultadoAtualizacao(amb.ctx.store)).toBeNull();
  });

  it('ligada: o executor agenda a verificação, a política oferece pacote mais novo e a falha do download vira aviso no status, sem derrubar o laço', async () => {
    amb = await ambienteLigado();
    const baixou: string[] = [];
    amb.ctx.atualizacao = dependencias(baixou);
    guardarPolitica(amb.ctx.store, politicaComPacote(), amb.relogio.agora());
    const exec = new Executor(amb.ctx);
    amb.relogio.avancar(2 * 60_000); // depois do primeiro minuto de carência
    expect(await exec.ciclo()).toContain('atualizacao');
    expect(baixou).toEqual(['9.9.9']);
    const r = ultimoResultadoAtualizacao(amb.ctx.store);
    expect(r).toMatchObject({ resultado: 'mantido', motivo: 'falha_no_download', oferecida: '9.9.9' });
    const s = montarStatus(amb.ctx.store, amb.ctx.config);
    expect(s.atualizacao?.resultado).toBe('mantido');
    expect(formatarStatus(s)).toContain('ATUALIZAÇÃO AUTOMÁTICA');
    expect(JSON.stringify(s.atualizacao)).not.toContain('pacotes.exemplo');
  });

  it('sem pacote na política é verificação de rotina: não grava resultado nem vira aviso', async () => {
    amb = await ambienteLigado();
    const baixou: string[] = [];
    amb.ctx.atualizacao = dependencias(baixou);
    guardarPolitica(amb.ctx.store, { versao_minima: '1.0.0', versao_recomendada: '1.0.0' }, amb.relogio.agora());
    expect(await cicloAtualizacao(amb.ctx)).toBe('executada');
    expect(baixou).toEqual([]);
    expect(ultimoResultadoAtualizacao(amb.ctx.store)).toBeNull();
  });
});
