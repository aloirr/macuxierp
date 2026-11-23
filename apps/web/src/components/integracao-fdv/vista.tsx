import { MensagemRecarregar } from '@/components/mensagem-recarregar';
import { FaixaPendencias, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { ROTULO_AMBIENTE, type LinhaConflito, type LinhaErro, type LinhaMonitor } from '@macuxierp/integracao-fdv/web';
import type { VistaIntegracaoFdv } from '@/lib/integracao-fdv';

/** Funções que a tela chama; a vista só desenha (e deixa o cliente cuidar de estado, confirmação e API). */
export interface AcoesDaVista {
  testar: () => void;
  tentarDeNovo: (entidades: string[]) => void;
  cargaCompleta: (entidade: string) => void;
  exportarErros: () => void;
  /** Lê o formulário na hora do envio; o valor da chave não fica em estado. Devolve true quando salvou (o formulário então é limpo). */
  salvarCredencial: (form: HTMLFormElement) => Promise<boolean>;
  salvarConfiguracao: (form: HTMLFormElement) => void;
}

export interface EstadoDaVista {
  ocupado: boolean;
  mensagem: { ok: boolean; texto: string } | null;
  erros: Record<string, string>;
}

const TOM_CLASSE = { ok: 'selo selo-ativo', aviso: 'selo selo-aviso', neutro: 'selo selo-inativo' } as const;
const secao = { marginTop: 24 } as const;

/** Tela Integração FDV (T-0011), sem estado próprio: botões de mudança só para quem pode configurar (a API checa de novo). */
export function VistaIntegracaoFdv({ vista, acoes, estado }: { vista: VistaIntegracaoFdv; acoes: AcoesDaVista; estado: EstadoDaVista }) {
  const { configurar } = vista.acoes;
  const colunasMonitor: ColunaTabela<LinhaMonitor>[] = [
    { id: 'rotulo', titulo: 'Cadastro', celula: (l) => l.rotulo },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => <span className={TOM_CLASSE[l.tom]}>{l.situacao}</span> },
    { id: 'pendentes', titulo: 'Esperando envio', tipo: 'numero', celula: (l) => l.pendentes },
    { id: 'erros', titulo: 'Erros abertos', tipo: 'numero', celula: (l) => l.erros },
    { id: 'ultimoEnvio', titulo: 'Último envio', tipo: 'data', celula: (l) => l.ultimoEnvio },
    { id: 'ultimoSucesso', titulo: 'Último sucesso', tipo: 'data', celula: (l) => l.ultimoSucesso },
    { id: 'motivoPausa', titulo: 'Motivo da pausa', celula: (l) => l.motivoPausa },
  ];
  if (configurar) {
    colunasMonitor.push({
      id: 'acoes',
      titulo: 'Ações',
      celula: (l) => (
        <span className="barra-acoes" style={{ margin: 0 }}>
          {l.podeRetomar && <button type="button" className="mx-botao-secundario" disabled={estado.ocupado} onClick={() => acoes.tentarDeNovo([l.entidade])} aria-label={`Tentar de novo: ${l.rotulo}`}>Tentar de novo</button>}
          {l.podeCargaCompleta && <button type="button" className="mx-botao-secundario" disabled={estado.ocupado} onClick={() => acoes.cargaCompleta(l.entidade)} aria-label={`Carga completa: ${l.rotulo}`}>Carga completa</button>}
        </span>
      ),
    });
  }
  const colunasErros: ColunaTabela<LinhaErro>[] = [
    { id: 'cadastro', titulo: 'Cadastro', celula: (e) => e.cadastro },
    { id: 'registro', titulo: 'Registro', celula: (e) => e.registro },
    { id: 'campo', titulo: 'Campo', celula: (e) => e.campo },
    { id: 'mensagem', titulo: 'O que houve', celula: (e) => e.mensagem },
  ];
  const colunasConflitos: ColunaTabela<LinhaConflito>[] = [
    { id: 'cadastro', titulo: 'Cadastro', celula: (c) => c.cadastro },
    { id: 'chave', titulo: 'Chave', celula: (c) => c.chave },
    { id: 'mensagem', titulo: 'O que houve', celula: (c) => c.mensagem },
    { id: 'detectadoEm', titulo: 'Detectado em', tipo: 'data', celula: (c) => c.detectadoEm },
  ];
  const e = estado.erros;
  return (
    <div>
      {/* faixa do sinal */}
      <p className={`faixa-sinal faixa-sinal-${vista.sinal.tom}`} role="status" data-testid="sinal">
        <strong>Conexão com o FDV:</strong> {vista.sinal.texto.replace(/\.$/, '')}.
        {vista.sinal.politica && <span className="apoio"> {vista.sinal.politica.replace(/\.$/, '')}.</span>}
      </p>
      <FaixaPendencias itens={vista.pendencias} />
      {estado.mensagem && <MensagemRecarregar texto={estado.mensagem.texto} className={estado.mensagem.ok ? 'faixa-aviso' : 'erro'} role={estado.mensagem.ok ? 'status' : 'alert'} />}

      <section style={secao} aria-labelledby="h-cred">
        <h2 id="h-cred">Credencial do conector</h2>
        {vista.credencial.tem ? (
          <dl className="ficha">
            {vista.credencial.campos.map((c) => (<div key={c.rotulo}><dt>{c.rotulo}</dt><dd>{c.valor}</dd></div>))}
          </dl>
        ) : (
          <p className="apoio">Nenhuma credencial cadastrada. {configurar ? 'Informe o código e a chave do conector abaixo.' : 'Peça a um administrador para cadastrar.'}</p>
        )}
        {configurar && (
          <form
            aria-label="Trocar a credencial"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const f = ev.currentTarget;
              if (await acoes.salvarCredencial(f)) f.reset();
            }}
          >
            <label className="campo"><span>Código do conector</span><input name="conector_id" defaultValue={vista.credencial.conectorId} maxLength={64} autoComplete="off" required /></label>
            {e.conector_id && <p className="erro-campo" role="alert">{e.conector_id}</p>}
            <label className="campo">
              <span>Chave do conector</span>
              <input name="chave" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} required />
            </label>
            {e.chave && <p className="erro-campo" role="alert">{e.chave}</p>}
            <label className="campo">
              <span>Ambiente</span>
              <select name="ambiente" defaultValue={vista.credencial.ambiente}>{Object.entries(ROTULO_AMBIENTE).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>
            </label>
            {e.ambiente && <p className="erro-campo" role="alert">{e.ambiente}</p>}
            <div className="barra-acoes">
              <button className="mx-botao" type="submit" disabled={estado.ocupado}>Salvar credencial</button>
              <button className="mx-botao-secundario" type="button" disabled={estado.ocupado || !vista.credencial.tem} onClick={acoes.testar}>Testar conexão</button>
            </div>
          </form>
        )}
      </section>

      <section style={secao} aria-labelledby="h-ent">
        <h2 id="h-ent">Cadastros enviados ao FDV</h2>
        {configurar && vista.pausadas.length > 0 && (
          <div className="barra-acoes"><button type="button" className="mx-botao" disabled={estado.ocupado} onClick={() => acoes.tentarDeNovo(vista.pausadas)}>Tentar de novo (todas as pausadas)</button></div>
        )}
        <div className="tabela-rolavel">
          <TabelaDensa colunas={colunasMonitor} linhas={vista.linhas} chaveLinha={(l) => l.entidade} textoVazio="Nenhum cadastro configurado ainda." legenda="Situação do envio por cadastro" />
        </div>
      </section>

      <section style={secao} aria-labelledby="h-err">
        <h2 id="h-err">Erros por registro</h2>
        <div className="barra-acoes">
          <button type="button" className="mx-botao-secundario" disabled={vista.erros.length === 0} onClick={acoes.exportarErros}>Exportar CSV</button>
          <a className="mx-botao-secundario" href={vista.rotaLotes}>Ver os envios</a>
        </div>
        <div className="tabela-rolavel">
          <TabelaDensa colunas={colunasErros} linhas={vista.erros} chaveLinha={(x) => `${x.cadastro}-${x.registro}-${x.campo}-${x.codigo}`} textoVazio="Nenhum erro aberto." legenda="Erros abertos por registro" />
        </div>
      </section>

      <section style={secao} aria-labelledby="h-conf">
        <h2 id="h-conf">Conflitos de chave</h2>
        <p className="apoio">Corrija a chave no cadastro de origem.</p>
        <div className="tabela-rolavel">
          <TabelaDensa colunas={colunasConflitos} linhas={vista.conflitos} chaveLinha={(c) => `${c.cadastro}-${c.chave}-${c.detectadoEm}`} textoVazio="Nenhum conflito aberto." legenda="Conflitos de chave abertos" />
        </div>
      </section>

      <section style={secao} aria-labelledby="h-cfg">
        <h2 id="h-cfg">Configuração do envio</h2>
        {configurar ? (
          <form aria-label="Configuração do envio" onSubmit={(ev) => { ev.preventDefault(); acoes.salvarConfiguracao(ev.currentTarget); }}>
            <fieldset className="grupo-campos">
              <legend>Cadastros que o conector envia</legend>
              {vista.cadastros.map((c) => (
                <label key={c.id} style={{ display: 'inline-flex', gap: 6, marginRight: 16 }}>
                  <input type="checkbox" name="entidades" value={c.id} defaultChecked={vista.configuracao.habilitadas.includes(c.id)} /> {c.rotulo}
                </label>
              ))}
            </fieldset>
            {e.entidades_habilitadas && <p className="erro-campo" role="alert">{e.entidades_habilitadas}</p>}
            <label className="campo">
              <span>Registros por envio (de 1 a {vista.limiteMaximo.toLocaleString('pt-BR')})</span>
              <input name="limite" type="number" inputMode="numeric" min={1} max={vista.limiteMaximo} defaultValue={vista.configuracao.limite} />
            </label>
            {e.limite_registros_lote && <p className="erro-campo" role="alert">{e.limite_registros_lote}</p>}
            <button className="mx-botao" type="submit" disabled={estado.ocupado}>Salvar configuração</button>
          </form>
        ) : (
          <p className="apoio">
            Envia: {vista.cadastros.filter((c) => vista.configuracao.habilitadas.includes(c.id)).map((c) => c.rotulo).join(', ') || 'nenhum cadastro'}. Registros por envio: {vista.configuracao.limite.toLocaleString('pt-BR')}.
          </p>
        )}
      </section>
    </div>
  );
}
