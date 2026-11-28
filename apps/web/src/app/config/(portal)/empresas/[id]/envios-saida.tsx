'use client';
import type { EnvioLigacao, LigacaoSaida } from '@macuxierp/integracao-fdv/contracts';
import { ROTULO_ENTIDADE, ROTULO_ESTADO_LOTE } from '@macuxierp/integracao-fdv/web';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { AVISO_ENVIOS_CORTADOS } from '@/lib/config/ligacoes';

/** Selo padrão da Situação: concluído é o ativo, com erros é o de aviso, falha e recusa o de erro; o resto, o neutro. */
const SELO_ESTADO: Readonly<Record<string, string>> = { concluido: 'selo-ativo', concluido_com_erros: 'selo-aviso', falhou: 'selo-erro', recusado: 'selo-erro' };

/**
 * Histórico de envios da ERP → Macuxi FDV (T-0131, C-6): do mais novo ao mais antigo, até 50, com o aviso quando a API cortou a lista
 * (`envios_cortados`). Só contagens e estados: nenhum dado de cadastro. Sem botão (o "Atualizar" é o do bloco de baixo).
 */
export function EnviosSaida({ saida, fuso }: { saida: LigacaoSaida; fuso: string }) {
  const quando = (e: EnvioLigacao) => e.concluido_em ?? e.enviado_em;
  const linhas = [...saida.envios].sort((a, b) => Date.parse(quando(b) ?? '') - Date.parse(quando(a) ?? ''));
  const nulo = (n: number | null) => (n === null ? '—' : n);
  const colunas: ColunaTabela<EnvioLigacao>[] = [
    { id: 'quando', titulo: 'Quando', tipo: 'data', celula: (e) => { const q = quando(e); return q ? formatarDataHora(q, fuso) : '—'; } },
    { id: 'cadastro', titulo: 'Cadastro', celula: (e) => ROTULO_ENTIDADE[e.entidade] },
    { id: 'estado', titulo: 'Situação', celula: (e) => <span className={`selo ${SELO_ESTADO[e.estado] ?? 'selo-inativo'}`}>{ROTULO_ESTADO_LOTE[e.estado]}</span> },
    { id: 'registros', titulo: 'Registros', tipo: 'numero', celula: (e) => e.registros },
    { id: 'aceitos', titulo: 'Aceitos', tipo: 'numero', celula: (e) => nulo(e.aceitos) },
    { id: 'comErro', titulo: 'Com erro', tipo: 'numero', celula: (e) => (e.com_erro ? <strong className="erro-numero">{e.com_erro}</strong> : nulo(e.com_erro)) },
  ];
  return (
    <section className="bloco envios-recentes" aria-labelledby="h-envios-saida">
      <h2 id="h-envios-saida">Envios ao Macuxi FDV</h2>
      <div className="cartao-ligacao">
        <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
          <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(e) => e.id} textoVazio="Nenhum envio ainda." legenda="Envios ao Macuxi FDV" />
        </div>
        {saida.envios_cortados && <p className="apoio" role="status">{AVISO_ENVIOS_CORTADOS(saida.envios.length)}</p>}
      </div>
    </section>
  );
}
