## Objetivo
- Varredura automática dos links cadastrados em cada processo, detectando novas movimentações e alertando imediatamente.

## Decisões Confirmadas
- Intervalo padrão: 30 minutos.
- Concurrency: até 4 processos em paralelo, com backoff.
- Alertas por e-mail: habilitados (usando `SMTP_*`).
- Extratores iniciais: Genérico + Jusbrasil; expansão futura para PJe/TJs conforme necessidade.

## Estado Atual (Base aproveitada)
- Robô existente de varredura por link: `server/index.js:267-313` (`scanProcess`) + `scanAll()` agendado diariamente (`server/index.js:606-613`).
- Broadcast em tempo real para cliente: `broadcast('processes:history', ...)` (`server/index.js:289-293`, `305-307`).
- UI renderiza histórico: `public/app.js:618-639` e trata eventos via WebSocket: `public/app.js:33-53`.

## Implementação
1. Agendador contínuo
- Adicionar um scheduler configurável por env: `PROCESS_SCAN_INTERVAL_MINUTES=30`.
- Rodar `scanAll()` nesse intervalo com fila e concorrência (4).
- Backoff: re-tentar 2× com jitter em falhas temporárias.

2. Extratores por domínio
- Criar módulo `extractors` com funções específicas (ex.: `jusbrasilExtractor`, `genericExtractor`).
- Seleção automática pelo `hostname` do link do processo.
- Padronizar saída: `{ summary, items: [{ dateStr, desc }] }`.

3. Robustez de fetch
- Timeout (ex.: 15s) e `User-Agent` realista.
- Tratamento de 429/5xx e circuit breaker simples por host.

4. Páginas com login/JS (opcional)
- Integrar `server/lib/pjeBot.js` para casos que exigem autenticação/JS.
- Credenciais via env (`PJE_USERNAME`, `PJE_PASSWORD`), nunca logar segredos.

5. Alertas e status
- E-mail quando houver novos andamentos (usando `server/lib/smtp.js`).
- Endpoint `GET /api/processes/scan/status` com último sucesso/erro por processo.
- Campos novos por processo: `scanEnabled` (bool), `scanEveryMinutes` (opcional), `notes`.

6. UI
- Botão "Verificar agora" na tela de processo (chama `POST /api/processes/:id/scan`).
- Indicadores: "Última atualização", "Último erro" e toggle de robô.

7. Testes
- Unit: extratores com fixtures HTML (Jusbrasil/Genérico).
- E2E: criar processos de exemplo; simular mudança de página e verificar atualização + alerta.

## Variáveis de Ambiente
- `PROCESS_SCAN_INTERVAL_MINUTES=30`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_EMAILS`
- (Opcional) `PJE_USERNAME`, `PJE_PASSWORD`

## Entregáveis
- Scheduler contínuo com concorrência e backoff.
- Extratores por domínio, fetch robusto e fallback.
- UI com controle/ação manual e indicadores.
- Endpoint de status e alertas por e-mail.
- Testes unitários e E2E cobrindo detecção de movimento.

Confirma que posso iniciar a implementação com estas configurações? 