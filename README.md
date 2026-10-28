# WhatsApp v1

App pessoal de uso próprio: WhatsApp Web dentro de uma janela de Windows, com assistente (Claude) que lê as mensagens e lista o que fazer, lembretes, agenda e atividades.

- `app/` — interface (HTML/JS). É o que o botão ⟳ Atualizar baixa.
- `desktop/` — casca Electron (main.js, preloads, package.json) para gerar o instalador.
- `version.json` — versão publicada. `ui` maior que a instalada = atualização pelo botão; `desktop` maior = precisa do instalador novo.

Nenhuma chave de API ou conversa fica neste repositório: tudo fica só no PC.

## Instalador
O instalador do Windows (WhatsApp-v1-Instalador.zip) é entregue no projeto do Claude. Quando o botão ⟳ disser que precisa de instalador novo, peça lá a versão mais recente.
