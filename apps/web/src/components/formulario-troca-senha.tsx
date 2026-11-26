'use client';
import { useActionState, useState } from 'react';
import { MENSAGEM_SENHA_IGUAL, type RegraSenhaId } from '@macuxierp/platform-sdk';
import { CampoSenha } from '@macuxierp/ui';
import { RegrasSenha } from '@/components/regras-senha';
import { TEXTOS_DESBLOQUEIO } from '@/lib/login-regras';
import { estadoDaTroca, SENHAS_NAO_CONFEREM } from '@/lib/troca-senha';

export interface EstadoTrocaSenha {
  erro?: string;
  regras?: RegraSenhaId[];
  campos?: { senha_atual?: string; senha_nova?: string; confirmacao?: string };
}

/** Formulário único de troca de senha (BKO `/senha` e portal `/config/senha`): atual, nova e confirmação, regras e envio bloqueado até tudo conferir. */
export function FormularioTrocaSenha({ acao: acaoServidor, destino, rotuloAtual = 'Senha atual', rotuloBotao = 'Trocar senha', semSenhaAtual = false }: {
  acao: (estado: EstadoTrocaSenha, dados: FormData) => Promise<EstadoTrocaSenha>;
  destino?: string;
  rotuloAtual?: string;
  rotuloBotao?: string;
  /** Troca da senha temporária (RN-CORE-13, `motivo_troca: 'temporaria'`): sem o campo da senha atual. */
  semSenhaAtual?: boolean;
}) {
  const [estado, acao, pendente] = useActionState<EstadoTrocaSenha, FormData>(acaoServidor, {});
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [visivel, setVisivel] = useState(false);
  const [enviada, setEnviada] = useState<string | null>(null);
  const { difere, igualAtual, podeEnviar } = estadoDaTroca(atual, nova, confirmacao, !semSenhaAtual);
  return (
    <form action={(dados) => { setEnviada(nova); acao(dados); }}>
      <div aria-live="polite">{estado.erro && <p className="erro" role="alert">{estado.erro}</p>}</div>
      {destino !== undefined && <input type="hidden" name="destino" value={destino} />}
      {!semSenhaAtual && <div className="campo-senha-bloco"><CampoSenha id="troca-atual" rotulo={rotuloAtual} nome="senha_atual" valor={atual} aoMudar={setAtual} visivel={false} erro={estado.campos?.senha_atual} /></div>}
      <div className="campo-senha-bloco"><CampoSenha id="troca-nova" rotulo={semSenhaAtual ? TEXTOS_DESBLOQUEIO.rotuloNova : 'Senha nova'} nome="senha_nova" valor={nova} aoMudar={setNova} visivel={visivel} aoAlternar={() => setVisivel((v) => !v)} finalidade="criacao" descrito="regras-lista" erro={igualAtual ? MENSAGEM_SENHA_IGUAL : estado.campos?.senha_nova} /></div>
      <RegrasSenha senha={nova} faltamNaApi={nova === enviada ? estado.regras : undefined} />
      <div className="campo-senha-bloco"><CampoSenha id="troca-confirmacao" rotulo={semSenhaAtual ? TEXTOS_DESBLOQUEIO.rotuloRepita : 'Confirme a senha nova'} nome="confirmacao" valor={confirmacao} aoMudar={setConfirmacao} visivel={visivel} finalidade="criacao" erro={confirmacao.length > 0 && difere ? SENHAS_NAO_CONFEREM : estado.campos?.confirmacao} /></div>
      <button className="mx-botao" type="submit" disabled={!podeEnviar || pendente}>{pendente ? 'Salvando…' : semSenhaAtual ? TEXTOS_DESBLOQUEIO.botao : rotuloBotao}</button>
    </form>
  );
}
