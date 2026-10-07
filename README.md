# dsh-plugin-dex-style-edit

像 Codex App 一样编辑已发送的消息：点铅笔改气泡内容，**从这条继续**。

DSH 会话日志只追加、不可改写，所以实现方式是：在此消息之前那一轮处 fork 一个新会话，把改过的文本作为新会话的第一条消息直接发出，并归档被替换的原会话。工作目录与文件保持现状。

## 安装

```sh
dsh plugin --profile desktop add github:XylaAlyx/dsh-plugin-dex-style-edit
```

装完**重启 DSH**。之后每条用户消息气泡下会多出一个铅笔图标；fork 出来的会话在侧栏带分支小图标。

完整说明（行为细节、实现要点、已知边界）见 [docs/README.full.md](docs/README.full.md)。

## License

MIT
