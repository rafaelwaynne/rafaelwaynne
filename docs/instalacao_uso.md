# Robô PJE/Jusbrasil

## Instalação
- Configure as variáveis no `.env`:
  - `DEFAULT_OAB=267847/RJ`
  - `CNJ_API_KEY=...` (opcional para Datajud)
  - `DIGESTO_API_TOKEN=...` (opcional para Digesto)
  - `SMTP_HOST=...`
  - `SMTP_PORT=465`
  - `SMTP_SECURE=true`
  - `SMTP_USER=...`
  - `SMTP_PASS=...`
  - `SMTP_FROM=...`
  - `ALERT_EMAILS=seuemail@exemplo.com`

## Uso
- Painel > Processos > seção "Robô PJE/Jusbrasil"
  - Informe `OAB` e lista de `CNJs`
  - Clique em `Executar agora` para coleta imediata
  - Use `Baixar relatório` para obter o relatório do dia
- Coleta diária automática às 08:00

## Relatórios
- Gerados em `server/data/robot-report-YYYY-MM-DD.html` e `.csv`
- Dados consolidados em `server/data/robot-data.json`

## Alertas
- Novos andamentos disparam e-mail para `ALERT_EMAILS`

## Segurança e conformidade
- Credenciais via `.env`, sem gravação em logs
- Respeitar políticas do PJE e do Jusbrasil
- Ajuste a OAB e CNJs conforme sua necessidade
