'use client';
import { FormularioTrocaSenha } from '@/components/formulario-troca-senha';
import { trocarSenhaBkoAction } from './acoes';

export function FormularioSenhaBko({ destino, semSenhaAtual = false }: { destino: string; semSenhaAtual?: boolean }) {
  return <FormularioTrocaSenha acao={trocarSenhaBkoAction} destino={destino} semSenhaAtual={semSenhaAtual} />;
}
