'use client';
import { TabelaDensa } from '@macuxierp/ui';
import { colunasStatusFdv, textoAlertaFalha, type LinhaStatusFdv, type VistaStatusFdv } from '@/lib/integracao-fdv';

/** Status da Integração FDV no BKO (T-0056): SÓ LEITURA. Nenhum botão, formulário nem chave: tudo isso é do /config (superadmin). */
export function VistaIntegracaoFdv({ vista }: { vista: VistaStatusFdv }) {
  const colunas = colunasStatusFdv<LinhaStatusFdv>({ falhaSobreNome: true });
  return (
    <div>
      <p className={`faixa-sinal faixa-sinal-${vista.sinal.tom}`} role="status" data-testid="sinal">
        <strong>Conexão com o FDV:</strong> {vista.sinal.texto}
      </p>
      {vista.comFalha > 0 && <p className="faixa-aviso" role="status" data-testid="alerta-falha">{textoAlertaFalha(vista.comFalha)}</p>}
      <section style={{ marginTop: 24 }} aria-labelledby="h-ent">
        <h2 id="h-ent">Cadastros enviados ao FDV</h2>
        {vista.conector && (
          <p className="apoio" data-testid="conector">Conector {vista.conector.id} · ambiente {vista.conector.ambiente}</p>
        )}
        <div className="tabela-rolavel com-sinal-rolagem tabela-fdv tabela-fdv-bko">
          <TabelaDensa colunas={colunas} linhas={vista.linhas} chaveLinha={(l) => l.entidade} textoVazio="Nenhum cadastro configurado ainda." legenda="Situação do envio por cadastro" />
        </div>
        <p className="apoio">A configuração, a credencial e a carga completa são feitas pela Macuxi.</p>
      </section>
    </div>
  );
}
