# Deploy gratuito com domínio dr-rafao.onrender.com

## Passo a passo (Render.com)
- Crie uma conta gratuita em `https://render.com`.
- Conecte seu repositório (GitHub/GitLab) com este projeto.
- Render detectará `render.yaml` na raiz e criará o serviço web:
  - Nome: `dr-rafao`
  - Build: `npm install`
  - Start: `node server/index.js`
- Confirme a criação; após o build, o domínio público ficará disponível:
  - `https://dr-rafao.onrender.com`

## Variáveis de ambiente
- `FORCE_HTTPS=true` (já definido no `render.yaml`)
- Outras usadas pelo app (opcional):
  - `CAM1_URL`, `CAM1_USER`, `CAM1_PASS` (se usar câmeras)
  - Firebase públicos (se usar): `NEXT_PUBLIC_FIREBASE_*`

## Observações
- WebSocket funciona em Render.
- O app usa a porta `PORT` automaticamente (`server/index.js:18`).
- Para atualizar o PWA com o novo domínio, você pode acessar `https://dr-rafao.onrender.com` e instalar o app pelo navegador.

## Alternativas de domínio gratuito
- Fly.io: `dr-rafao.fly.dev`
- Railway: `dr-rafao.up.railway.app`
- Netlify/Vercel: subdomínios `*.netlify.app` / `*.vercel.app` (bom para sites estáticos).
