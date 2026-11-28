'use client';
import type { LoteEntradaResumo } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import type { ReactNode } from 'react';
import { rotuloDoLote } from '@/lib/config/ligacoes';

/** Quantos lotes a tabela mostra: os mais recentes (a API manda até 50). */
export const LIMITE_ENVIOS_RECENTES = 8;

/**
 * "Envios recentes" da aba Integrações (simulação aprovada 445e459): o que o sistema do cliente mandou ao ERP, do mais novo para o mais
 * antigo, na largura toda, com a barra do bloco embaixo (o Atualizar). Só contagens: sem dado de cadastro.
 */
export function EnviosRecentes({ lotes, fuso, barra, retorno }: { lotes: readonly LoteEntradaResumo[]; fuso: string; barra: ReactNode; retorno?: ReactNode }) {
  const linhas = [...lotes].sort((a, b) => Date.parse(b.recebido_em) - Date.parse(a.recebido_em)).slice(0, LIMITE_ENVIOS_RECENTES);
  const colunas: ColunaTabela<LoteEntradaResumo>[] = [
    { id: 'quando', titulo: 'Quando', tipo: 'data', celula: (l) => formatarDataHora(l.recebido_em, fuso) },
    { id: 'cadastro', titulo: 'Cadastro', celula: (l) => rotuloDoLote(l.entidade) },
    { id: 'registros', titulo: 'Registros', tipo: 'numero', celula: (l) => l.recebidos },
    { id: 'comErro', titulo: 'Com erro', tipo: 'numero', celula: (l) => (l.com_erro > 0 ? <strong className="erro-numero">{l.com_erro}</strong> : l.com_erro) },
  ];
  return (
    <section className="bloco envios-recentes" aria-labelledby="h-envios-recentes">
      <h2 id="h-envios-recentes">Envios recentes</h2>
      <div className="cartao-ligacao">
        <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
          <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.lote_id} textoVazio="Nenhum envio ainda." legenda="Envios recentes" />
        </div>
        <div className="barra-acoes barra-bloco">{barra}</div>
        {retorno}
      </div>
    </section>
  );
}
