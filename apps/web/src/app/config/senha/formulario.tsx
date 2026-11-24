'use client';
import { FormularioTrocaSenha } from '@/components/formulario-troca-senha';
import { trocarSenhaAcao } from './acoes';

export function FormularioSenha({ semSenhaAtual = false }: { semSenhaAtual?: boolean }) {
  return <FormularioTrocaSenha acao={trocarSenhaAcao} rotuloAtual="Senha provisória atual" rotuloBotao="Definir senha" semSenhaAtual={semSenhaAtual} />;
}
