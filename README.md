# WhatsApp v1

App pessoal de uso próprio: WhatsApp Web dentro de uma janela de Windows, com assistente (Claude) que lê as mensagens e lista o que fazer, lembretes, agenda e atividades.

- `app/` — interface (HTML/JS) e `wa-reader.js` (leitor do WhatsApp Web que roda dentro do webview). É o que o botão ⟳ Atualizar baixa.
- `desktop/` — casca Electron (main.js, preloads, package.json) para gerar o instalador.
- `version.json` — versão publicada. `ui` maior que a instalada = atualização pelo botão; `desktop` maior = precisa do instalador novo.

Nenhuma chave de API ou conversa fica neste repositório: tudo fica só no PC.

## Instalador
O ramo `installer` guarda só o instalador mais recente (`WhatsApp-v1-Instalador.exe`); `version.json` aponta para ele em `installerUrl` com o `sha256`. O app baixa e instala sozinho.
O instalador do Windows (WhatsApp-v1-Instalador.zip) é entregue no projeto do Claude. Quando o botão ⟳ disser que precisa de instalador novo, peça lá a versão mais recente.
