'use client';
import { TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { colunasStatusFdv, textoAlertaFalha, type LinhaStatusFdv, type VistaStatusFdv } from '@/lib/integracao-fdv';
import { BotaoLog } from './log';

/** Status da Integração FDV no BKO (T-0056) e Log por cadastro (T-0086, D-4): a tela só lê; o botão "Log" abre o Log do cadastro. Credencial e ações são do /config. */
export function VistaIntegracaoFdv({ vista, podeVerLog = false, fuso = 'America/Manaus' }: { vista: VistaStatusFdv; podeVerLog?: boolean; fuso?: string }) {
  const colunas: ColunaTabela<LinhaStatusFdv>[] = colunasStatusFdv<LinhaStatusFdv>({ falhaSobreNome: true });
  if (podeVerLog) colunas.push({ id: 'log', titulo: '', celula: (l) => <BotaoLog entidade={l.entidade} fuso={fuso} /> });
  return (
    <div>
      <p className={`faixa-sinal faixa-sinal-${vista.sinal.tom}`} role="status" data-testid="sinal">
        <strong>Conexão com o FDV:</strong> {vista.sinal.texto}
      </p>
      {vista.comFalha > 0 && <p className="faixa-aviso" role="status" data-testid="alerta-falha">{textoAlertaFalha(vista.comFalha)}</p>}
      <section style={{ marginTop: 24 }} aria-labelledby="h-ent">
        <h2 id="h-ent">Cadastros enviados ao Macuxi FDV</h2>
        <div className="tabela-rolavel com-sinal-rolagem tabela-fdv tabela-fdv-bko">
          <TabelaDensa colunas={colunas} linhas={vista.linhas} chaveLinha={(l) => l.entidade} textoVazio="Nenhum cadastro configurado ainda." legenda="Situação do envio por cadastro" />
        </div>
      </section>
    </div>
  );
}
