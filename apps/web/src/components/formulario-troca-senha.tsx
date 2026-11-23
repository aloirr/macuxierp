'use client';
import { useActionState, useState } from 'react';
import { MENSAGEM_SENHA_IGUAL, type RegraSenhaId } from '@macuxierp/platform-sdk';
import { CampoSenha } from '@/components/campo-senha';
import { RegrasSenha } from '@/components/regras-senha';
import { estadoDaTroca, SENHAS_NAO_CONFEREM } from '@/lib/troca-senha';

export interface EstadoTrocaSenha {
  erro?: string;
  regras?: RegraSenhaId[];
  campos?: { senha_atual?: string; senha_nova?: string; confirmacao?: string };
}

/** Formulário único de troca de senha (BKO `/senha` e portal `/config/senha`): atual, nova e confirmação, regras e envio bloqueado até tudo conferir. */
export function FormularioTrocaSenha({ acao: acaoServidor, destino, rotuloAtual = 'Senha atual', rotuloBotao = 'Trocar senha' }: {
  acao: (estado: EstadoTrocaSenha, dados: FormData) => Promise<EstadoTrocaSenha>;
  destino?: string;
  rotuloAtual?: string;
  rotuloBotao?: string;
}) {
  const [estado, acao, pendente] = useActionState<EstadoTrocaSenha, FormData>(acaoServidor, {});
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviada, setEnviada] = useState<string | null>(null);
  const { difere, igualAtual, podeEnviar } = estadoDaTroca(atual, nova, confirmacao);
  return (
    <form action={(dados) => { setEnviada(nova); acao(dados); }}>
      <div aria-live="polite">{estado.erro && <p className="erro" role="alert">{estado.erro}</p>}</div>
      {destino !== undefined && <input type="hidden" name="destino" value={destino} />}
      <CampoSenha rotulo={rotuloAtual} nome="senha_atual" valor={atual} aoMudar={setAtual} autoComplete="current-password" erro={estado.campos?.senha_atual} />
      <CampoSenha rotulo="Senha nova" nome="senha_nova" valor={nova} aoMudar={setNova} autoComplete="new-password" erro={igualAtual ? MENSAGEM_SENHA_IGUAL : estado.campos?.senha_nova} />
      <RegrasSenha senha={nova} faltamNaApi={nova === enviada ? estado.regras : undefined} />
      <CampoSenha rotulo="Confirme a senha nova" nome="confirmacao" valor={confirmacao} aoMudar={setConfirmacao} autoComplete="new-password" erro={confirmacao.length > 0 && difere ? SENHAS_NAO_CONFEREM : estado.campos?.confirmacao} />
      <button className="mx-botao" type="submit" disabled={!podeEnviar || pendente}>{pendente ? 'Salvando…' : rotuloBotao}</button>
    </form>
  );
}
