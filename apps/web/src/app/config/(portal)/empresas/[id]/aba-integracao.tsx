'use client';
import { LIMITE_REGISTROS_LOTE_FDV, type EntidadeEnvioFdv, type IntegracaoFdvPlataforma } from '@macuxierp/platform-sdk';
import { DialogoMotivo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { AMBIENTES_FDV, LIMITE_INICIAL_FDV, habilitadasApos, validarLimiteLote, linhasCadastros, avisoCarga, avisoLigar, type LinhaCadastroFdv } from '@/lib/config/integracao-fdv';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { colunasStatusFdv } from '@/lib/integracao-fdv';
import type { Resultado } from '@/lib/config/executar';
import { cargaCompletaFdvAcao, configurarFdvAcao, retomarFdvAcao, salvarCredencialFdvAcao, testarConexaoFdvAcao } from '../acoes-integracao-fdv';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';

type Pedido = { tipo: 'ligar' | 'desligar' | 'carga' | 'retomar'; linha: LinhaCadastroFdv };
type Mensagem = { ok: boolean; texto: string } | null;

/**
 * Aba "Integração" da ficha da empresa (T-0056, ADR 0013, molde: aba Integração do portal do FDV). Só o superadmin chega aqui
 * (todo o /config é do superadmin). v0.3.4: só o bloco "Macuxi FDV" (saída para o FDV).
 *
 * LUGAR RESERVADO (cenário B, depois): duas colunas de ENTRADA, "Integração via Conector" e "Integração via API", ao lado deste
 * bloco no desktop e empilhadas abaixo de 768 px (`.integracao-colunas`). Sem tela para elas agora.
 *
 * A chave do conector fica só no campo até o envio: sem estado, URL, armazenamento nem log; depois de salvar, o campo é limpo e a
 * tela mostra só o prefixo e as datas que a API devolve.
 */
export function AbaIntegracao({ empresaId, dados, fuso }: { empresaId: string; dados: IntegracaoFdvPlataforma; fuso: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const chaves = useRef(new ChavesIdempotencia());
  const linhas = linhasCadastros(dados, fuso);
  const semCredencial = dados.credencial_id === null;
  const bloqueado = pendente || !dados.modulo_licenciado;

  /** Uma Idempotency-Key por ação e cadastro; só renova depois de resposta definitiva (repetição de rede reaproveita). */
  const chaveDe = (id: string) => chaves.current.de(id);
  const concluir = <T,>(id: string | null, r: Resultado<T>, textoOk: string) => {
    chaves.current.aposResposta(id, r);
    setCampos(r.ok ? {} : r.campos);
    setMensagem(r.ok ? { ok: true, texto: textoOk } : { ok: false, texto: r.erro || 'Confira os campos.' });
    if (r.ok) router.refresh();
  };

  const salvarCredencial = (f: HTMLFormElement) => {
    const d = new FormData(f);
    iniciar(async () => {
      const r = await salvarCredencialFdvAcao(empresaId, { conector_id: String(d.get('conector_id') ?? ''), chave: String(d.get('chave') ?? ''), ambiente: String(d.get('ambiente') ?? '') });
      if (r.ok) f.reset(); // a chave sai do campo na hora
      concluir(null, r, 'Credencial salva.');
    });
  };
  const salvarLimite = (f: HTMLFormElement) => {
    const v = validarLimiteLote(String(new FormData(f).get('limite_registros_lote') ?? ''));
    if (!v.ok) return setCampos({ limite_registros_lote: v.erro });
    const chave = `lim:${dados.entidades_habilitadas.join(',')}:${v.valor}`;
    iniciar(async () => concluir(chave, await configurarFdvAcao(empresaId, { entidades_habilitadas: dados.entidades_habilitadas, limite_registros_lote: v.valor }, chaveDe(chave)), 'Configuração salva.'));
  };
  const testar = () => iniciar(async () => concluir('testar', await testarConexaoFdvAcao(empresaId, chaveDe('testar')), 'Teste pedido. A resposta do FDV aparece em "Último sinal" em instantes.'));
  const confirmar = (p: Pedido) => {
    setPedido(null);
    const e: EntidadeEnvioFdv = p.linha.entidade;
    iniciar(async () => {
      if (p.tipo === 'carga') return concluir(`carga:${e}`, await cargaCompletaFdvAcao(empresaId, e, chaveDe(`carga:${e}`)), 'Carga completa pedida. O envio começa em instantes.');
      if (p.tipo === 'retomar') {
        const r = await retomarFdvAcao(empresaId, e, chaveDe(`retomar:${e}`));
        return concluir(`retomar:${e}`, r, r.ok && !r.valor.retomada ? 'Este cadastro não estava pausado.' : 'Pedido para tentar de novo registrado.');
      }
      const ligar = p.tipo === 'ligar';
      const nova = habilitadasApos(dados.entidades_habilitadas, e, ligar);
      return concluir(`cfg:${e}:${nova.join(',')}`, await configurarFdvAcao(empresaId, { entidades_habilitadas: nova, limite_registros_lote: dados.limite_registros_lote ?? LIMITE_INICIAL_FDV }, chaveDe(`cfg:${e}:${nova.join(',')}`)), ligar ? 'Cadastro ligado.' : 'Cadastro desligado.');
    });
  };

  const colunas: ColunaTabela<LinhaCadastroFdv>[] = [
    ...colunasStatusFdv<LinhaCadastroFdv>(),
    {
      id: 'acoes',
      titulo: 'Ações',
      celula: (l) => (
        <span className="barra-acoes" style={{ margin: 0 }}>
          <button type="button" className="mx-botao-secundario" disabled={bloqueado || semCredencial} onClick={() => setPedido({ tipo: l.ligada ? 'desligar' : 'ligar', linha: l })} aria-label={`${l.ligada ? 'Desligar' : 'Ligar'}: ${l.rotulo}`}>{l.ligada ? 'Desligar' : 'Ligar'}</button>
          {l.pausada && <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={() => setPedido({ tipo: 'retomar', linha: l })} aria-label={`Tentar de novo: ${l.rotulo}`}>Tentar de novo</button>}
          {l.podeCarga && <button type="button" className="mx-botao-secundario" disabled={bloqueado} onClick={() => setPedido({ tipo: 'carga', linha: l })} aria-label={`Carga completa: ${l.rotulo}`}>Carga completa</button>}
        </span>
      ),
    },
  ];

  const u = dados.ultimo_sinal;
  return (
    <div className="integracao-colunas">
      {/* Cenário B (depois): colunas "Integração via Conector" e "Integração via API" entram aqui, ao lado/acima deste bloco. */}
      <section className="bloco" aria-labelledby="h-fdv">
        <h2 id="h-fdv">Macuxi FDV</h2>
        <p className="apoio">Saída do ERP para o FDV: a credencial do conector e o que ele envia.</p>
        {!dados.modulo_licenciado && <p className="faixa-aviso" role="status">O módulo Integração FDV não está licenciado nesta empresa. Ligue-o na aba Empresa para configurar.</p>}
        {mensagem && <p className={mensagem.ok ? 'faixa-aviso' : 'erro'} role={mensagem.ok ? 'status' : 'alert'}>{mensagem.texto}</p>}

        <h3>Credencial do conector</h3>
        {dados.credencial_id ? (
          <dl className="ficha">
            <div><dt>Chave</dt><dd>{dados.chave_prefixo}…</dd></div>
            <div><dt>Criada em</dt><dd>{dados.criada_em ? formatarDataHora(dados.criada_em, fuso) : '—'}</dd></div>
            <div><dt>Último uso</dt><dd>{dados.ultimo_uso_em ? formatarDataHora(dados.ultimo_uso_em, fuso) : '—'}</dd></div>
          </dl>
        ) : (
          <p className="apoio">Nenhuma credencial cadastrada. Informe o código e a chave do conector abaixo.</p>
        )}
        <form aria-label="Credencial do conector" onSubmit={(ev) => { ev.preventDefault(); salvarCredencial(ev.currentTarget); }}>
          <label className="campo"><span>Código do conector</span><input name="conector_id" defaultValue={dados.conector_id ?? ''} maxLength={64} autoComplete="off" required /></label>
          {campos.conector_id && <p className="erro-campo" role="alert">{campos.conector_id}</p>}
          <label className="campo"><span>Nova chave do conector</span><input name="chave" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} required /></label>
          {campos.chave && <p className="erro-campo" role="alert">{campos.chave}</p>}
          <label className="campo"><span>Ambiente</span><select name="ambiente" defaultValue={dados.ambiente ?? 'teste'}>{AMBIENTES_FDV.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
          {campos.ambiente && <p className="erro-campo" role="alert">{campos.ambiente}</p>}
          <div className="barra-acoes">
            <button className="mx-botao" type="submit" disabled={bloqueado}>{semCredencial ? 'Salvar credencial' : 'Trocar credencial'}</button>
            <button className="mx-botao-secundario" type="button" disabled={bloqueado || semCredencial} onClick={testar}>Testar conexão</button>
          </div>
        </form>
        {u && (
          <p className="apoio" data-testid="ultimo-sinal">
            Último sinal: {u.parado_por_versao ? 'envio parado por versão do conector' : u.ultimo_envio_em ? formatarDataHora(u.ultimo_envio_em, fuso) : 'ainda sem sinal'}{u.ultimo_http ? ` (resposta ${u.ultimo_http})` : ''}.
          </p>
        )}

        <h3>Cadastros enviados ao FDV</h3>
        <form aria-label="Registros por lote" onSubmit={(ev) => { ev.preventDefault(); salvarLimite(ev.currentTarget); }}>
          <label className="campo"><span>Registros por lote</span><input name="limite_registros_lote" type="number" inputMode="numeric" min={1} max={LIMITE_REGISTROS_LOTE_FDV} step={1} defaultValue={dados.limite_registros_lote ?? LIMITE_INICIAL_FDV} required /></label>
          {campos.limite_registros_lote && <p className="erro-campo" role="alert">{campos.limite_registros_lote}</p>}
          <div className="barra-acoes"><button className="mx-botao-secundario" type="submit" disabled={bloqueado || semCredencial}>Salvar</button></div>
        </form>
        <div className="tabela-rolavel com-sinal-rolagem tabela-fdv">
          <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.entidade} textoVazio="Nenhum cadastro." legenda="Envio por cadastro" />
        </div>
      </section>
      {pedido && (
        <DialogoMotivo
          titulo={pedido.tipo === 'ligar' ? `Ligar ${pedido.linha.rotulo}?` : pedido.tipo === 'desligar' ? `Desligar ${pedido.linha.rotulo}?` : pedido.tipo === 'carga' ? `Carga completa de ${pedido.linha.rotulo}?` : `Tentar de novo ${pedido.linha.rotulo}?`}
          aviso={pedido.tipo === 'carga' ? avisoCarga : pedido.tipo === 'retomar' ? undefined : avisoLigar(pedido.tipo === 'ligar')}
          semTexto
          rotuloConfirmar={pedido.tipo === 'ligar' ? 'Ligar' : pedido.tipo === 'desligar' ? 'Desligar' : pedido.tipo === 'carga' ? 'Pedir carga completa' : 'Tentar de novo'}
          rotuloFechar="Cancelar"
          destrutivo={pedido.tipo !== 'ligar'}
          aoConfirmar={() => confirmar(pedido)}
          aoCancelar={() => setPedido(null)}
        />
      )}
    </div>
  );
}
