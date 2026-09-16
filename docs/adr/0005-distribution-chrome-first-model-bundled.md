# 公开分发走商店渠道(Chrome 先行),向量模型内置扩展包

工具转向公开免费分发,用户为国内拼多多商家客服(非技术、普遍无代理),维护者只有 GitHub 无自有服务器。渠道定序:**Chrome Web Store → Edge Add-ons → 离线 zip 兜底**。Chrome 先行是维护者指定;Edge 国内直连、免费、审核快,实际承担无梯子用户的主安装路径;离线 zip 覆盖开发者模式可接受的存量 Chrome 用户。三渠道共用同一份 `build/chrome-mv3-prod` 产物,不维护分支版本。

向量模型(Xenova/bge-small-zh-v1.5 量化 ONNX + tokenizer,~25MB)由首跑在线下载(仅 hf-mirror.com)**改为随包内置**:文件入 `public/model/`,offscreen 侧 `allowRemoteModels=false` + `localModelPath` 指向扩展内路径,`host_permissions` 移除 hf-mirror.com。理由:首跑 25MB 在线下载是公开分发的最大失败点(镜像无 SLA、无进度、失败体验差);商店包体上限远大于 25MB;内置后合规边界从"仅 hf-mirror 下载"升级为"运行期零远程请求"。

代价:安装包 +25MB;模型换代需随商店发版——与 `EMBEDDING_VERSION` 既有懒重嵌机制天然对齐,不新增更新通道。

触发重估的条件(出现其一再议):两个商店均被拒且离线渠道支持成本失控;或模型换代频繁到随包分发不再经济。
