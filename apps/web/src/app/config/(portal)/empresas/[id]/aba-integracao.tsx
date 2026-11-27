'use client';
import type { IntegracaoFdvPlataforma, MonitorConectorFdv, PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { ResultadoAcao, useResultado } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { maisRecente, textoAtualizado } from '@/lib/config/operacao-fdv';
import { resultadoErro } from '@/lib/resultado-acao';
import { lerMonitorFdvAcao } from '@/lib/acoes-cliente';
import { LigacaoEntrada } from './ligacao-entrada';
import { LigacaoSaida } from './ligacao-saida';

const ERRO_ATUALIZAR = 'Não foi possível atualizar. Tente de novo.';

/**
 * Aba "Integração" da ficha da empresa (v0.3.24, R-20261127-101915, docs/design/integracao-duas-ligacoes). Só duas ligações, lado a
 * lado no computador e uma embaixo da outra abaixo de 900 px: "Sistema do cliente → ERP" e "ERP → Força de vendas". As tabelas
 * (cadastros recebidos e enviados) ficam na aba Dados. Um único "Atualizar" no topo relê as duas ligações (o Monitor e a ficha).
 */
export function AbaIntegracao({ empresaId, dados, fuso, monitor: monitorInicial = null, entrada = null }: { empresaId: string; dados: IntegracaoFdvPlataforma; fuso: string; monitor?: MonitorConectorFdv | null; entrada?: PortalEntradaLeitura | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [rAtualizar, kAtualizar, mostrarAtualizar, limparAtualizar] = useResultado();
  const [lido, setLido] = useState<MonitorConectorFdv | null>(null);
  const monitor = maisRecente(monitorInicial, lido);

  /** Atualizar: relê o Monitor (com `lido_em`) e a ficha (`router.refresh`, que traz a entrada, os cadastros e o último sinal). */
  const atualizar = () =>
    iniciar(async () => {
      limparAtualizar();
      const r = await lerMonitorFdvAcao(empresaId);
      if (r.ok) setLido(r.valor);
      else mostrarAtualizar(resultadoErro(r.erro || ERRO_ATUALIZAR));
      router.refresh();
    });

  return (
    <>
      <div className="cabeca-ligacoes">
        {monitor && <span className="apoio" data-testid="atualizado-as" aria-live="polite">{textoAtualizado(monitor.lido_em, fuso)}</span>}
        <button type="button" className="mx-botao-secundario" disabled={pendente} onClick={atualizar}>Atualizar</button>
      </div>
      <ResultadoAcao resultado={rAtualizar} chave={kAtualizar} />
      <div className="ligacoes">
        <LigacaoEntrada empresaId={empresaId} dados={entrada} fuso={fuso} />
        <LigacaoSaida empresaId={empresaId} dados={dados} monitor={monitor} fuso={fuso} />
      </div>
    </>
  );
}
