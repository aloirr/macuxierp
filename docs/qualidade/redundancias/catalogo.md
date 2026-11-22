# Catálogo de redundâncias (RD-nnnn)

Os achados RD-0001 a RD-0019 foram registrados antes deste catálogo, nas tarefas e no quadro (`.coord/tarefas/T-0029.md`, `T-0031.md`, `T-0033.md`, `.coord/quadro.md`). Cada sessão usa só a faixa de números reservada no quadro; esta sessão (T-0024) usa RD-0041..0047.

| ID | Data | Tarefa | Onde | Tipo | Sev. | Dono | Status | Relatório |
|---|---|---|---|---|---|---|---|---|
| RD-0041 | 21/11/2026 | T-0024 | compose.yml (env_file, command, volumes repetidos) | código | média | engenheiro-software | aberto | 2026-11-21-T-0024-deploy.md |
| RD-0042 | 21/11/2026 | T-0024 | compose.yml:1-35 (cabeçalho repete a ADR 0003) | doc | média | engenheiro-software | aberto | 2026-11-21-T-0024-deploy.md |
| RD-0043 | 21/11/2026 | T-0024 | apps/web/Dockerfile (ARGs mortos, comentário desatualizado) | código | média | engenheiro-apps | aberto | 2026-11-21-T-0024-deploy.md |
| RD-0044 | 21/11/2026 | T-0024 | scripts/deploy/producao (leitura de .env 5×, dc() 2×) | código | média | engenheiro-software | aberto | 2026-11-21-T-0024-deploy.md |
| RD-0045 | 21/11/2026 | T-0024 | lista de arquivos de ambiente em 5 lugares, divergente | doc | média | engenheiro-software | aberto | 2026-11-21-T-0024-deploy.md |
| RD-0046 | 21/11/2026 | T-0024 | imagens, Dockerfiles e .dockerignore (ENV e HEALTHCHECK × compose; padrões herdados do FDV; estágios base e manifestos iguais) | código | baixa | engenheiro-software · engenheiro-apps | aberto | 2026-11-21-T-0024-deploy.md |
| RD-0047 | 21/11/2026 | T-0024 | variáveis e arquivos de ambiente sem uso (producao-publicar.yml, governança; S3 e SMTP no compose, manter?) | rotina · código | média | governança · engenheiro-software | aberto | 2026-11-21-T-0024-deploy.md |
