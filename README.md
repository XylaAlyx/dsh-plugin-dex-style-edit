# dsh-plugin-dex-style-edit

Codex-style message editing for DeepSeek Harness: edit an already-sent message and continue from there.

Click the pencil under any user message, change the text in place, press Enter. DSH session logs are append-only, so the plugin forks a new session at the turn *before* that message, sends your edited text as its opening message, and archives the session it replaced. Your files and working directory are left exactly as they are.

The model you pick in the composer before sending is the model that runs the edited message.

<details>
<summary>中文说明</summary>

像 Codex App 一样编辑已发送的消息：点铅笔改气泡内容，**从这条继续**。

DSH 会话日志只追加、不可改写，所以实现方式是：在此消息之前那一轮处 fork 一个新会话，把改过的文本作为新会话的第一条消息直接发出，并归档被替换的原会话。工作目录与文件保持现状。

发送前你在输入框里选的模型，就是这条改过的消息实际使用的模型。

</details>

## Install

```sh
dsh plugin --profile desktop add github:XylaAlyx/dsh-plugin-dex-style-edit
```

Then **restart DSH**. A pencil appears under every user message, and forked sessions carry a branch glyph in the sidebar.

Full notes (behaviour details, implementation, known limits): [docs/README.full.zh.md](docs/README.full.zh.md).

## License

MIT
