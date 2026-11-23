'use client';
import { useRef, useState, type ReactNode } from 'react';
import { Dialogo } from '@macuxierp/ui';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import type { Retorno } from '@/lib/config/cargas';
import { fraseConfere } from '@macuxierp/platform-sdk';
import { FraseConfirmacao } from './frase-confirmacao';

/**
 * Janela de confirmação destrutiva da aba Cargas (Substituir tudo e Zerar dados): o rodapé (Cancelar e o botão de confirmar),
 * o campo da frase, a linha de erro e o envio com a `Idempotency-Key` da ação (a mesma chave se repete até a resposta ser definitiva).
 * O botão fica desligado até a frase bater (`fraseConfere`) e `podeEnviar` valer. 401 e a troca de senha levam a outra página.
 */
export function ConfirmarComFrase<T>({ titulo, frase, rotulo, rotuloEnviando, idEnvio, enviar, aoSucesso, aoFalha, aoFechar, aoCancelar, podeEnviar = true, aviso, tomAviso, bloqueio, children }: {
  titulo: string;
  frase: string;
  rotulo: string;
  rotuloEnviando: string;
  /** Identifica a ação para a chave de idempotência (muda quando o pedido muda). */
  idEnvio: string;
  /** Recebe a chave de idempotência e a frase digitada. */
  enviar: (chave: string, frase: string) => Promise<Retorno<T>>;
  aoSucesso: (valor: T) => void;
  /** Dá a chance de tratar a falha (ex.: bloqueios); devolva o texto a mostrar, ou nada para usar o da resposta. */
  aoFalha?: (r: Extract<Retorno<T>, { ok: false }>) => string | undefined;
  aoFechar: () => void;
  /** Cancelar (padrão: `aoFechar`). */
  aoCancelar?: () => void;
  podeEnviar?: boolean;
  /** Aviso fixo sob o título (prop `aviso` do Dialogo, fora da área que rola). */
  aviso?: ReactNode;
  /** Tom do aviso: 'erro' para ação irreversível. */
  tomAviso?: 'aviso' | 'erro';
  /** Bloqueio fixo no rodapé, acima dos botões (junto do botão desligado). */
  bloqueio?: ReactNode;
  children?: ReactNode;
}) {
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const chaves = useRef(new ChavesIdempotencia());

  const confirmar = async () => {
    if (!podeEnviar || !fraseConfere(digitado, frase)) return;
    setEnviando(true);
    setErro('');
    const r = await enviar(chaves.current.de(idEnvio), digitado);
    chaves.current.aposResposta(idEnvio, { ok: r.ok, chaveNova: !r.ok && r.chaveNova });
    setEnviando(false);
    if (r.ok) return aoSucesso(r.valor);
    if (r.redirecionar) window.location.assign(r.redirecionar);
    setErro(aoFalha?.(r) ?? r.erro);
  };

  return (
    <Dialogo
      titulo={titulo}
      aoFechar={aoFechar}
      aviso={aviso}
      tomAviso={tomAviso}
      rodape={
        <div className="rodape-confirmar">
          {bloqueio}
          <div className="acoes-confirmar">
            <button type="button" className="mx-botao-secundario" onClick={aoCancelar ?? aoFechar}>Cancelar</button>
            <button type="button" className="mx-botao-destrutivo" data-destrutivo="true" disabled={enviando || !podeEnviar || !fraseConfere(digitado, frase)} onClick={() => void confirmar()}>
              {enviando ? rotuloEnviando : rotulo}
            </button>
          </div>
        </div>
      }
    >
      {children}
      <FraseConfirmacao frase={frase} valor={digitado} aoMudar={setDigitado} erro={!!erro} />
      {erro && <p className="erro" role="alert">{erro}</p>}
    </Dialogo>
  );
}
