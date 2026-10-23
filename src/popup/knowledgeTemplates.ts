export interface KnowledgeTemplateFile {
  filename: string
  mime: string
  content: string
}

const MARKDOWN_MIME = 'text/markdown;charset=utf-8'

/** 可直接下载、编辑后上传的知识库模板。 */
export function knowledgeTemplateFile(): KnowledgeTemplateFile {
  return {
    filename: '客服知识库模板.md',
    mime: MARKDOWN_MIME,
    content: `# 客服知识库模板

> 请替换示例内容后再上传。保留二级标题，系统会按小节切分并建立检索索引。

## 发货与物流

付款后 48 小时内发货，发货后一般 3~5 天送达，具体以物流信息为准。

## 退换货

支持七天无理由退换。商品需保持完好，质量问题产生的运费由商家承担。

## 常见问答

### 怎么开发票？

请在订单完成后进入订单页申请发票，填写抬头与税号。电子发票获批后可在平台发票中心下载。

### 可以修改收货地址吗？

未发货前可以在订单页尝试修改；已发货时请联系客服核实是否能够转寄。
`,
  }
}

/** 可直接下载、按店铺实际区间填写后通过「上传尺码表」导入的模板。 */
export function sizeTableTemplateFile(): KnowledgeTemplateFile {
  return {
    filename: '尺码表模板.md',
    mime: MARKDOWN_MIME,
    content: `# 尺码表模板

> 请替换示例数值并与店铺实际尺码核对后再上传。

| 尺码 | 建议身高（cm） | 建议体重（斤） | 胸围（cm） | 腰围（cm） | 备注 |
| --- | --- | --- | --- | --- | --- |
| S | 150~160 | 80~95 | 80~86 | 64~70 | 合身 |
| M | 158~168 | 95~110 | 86~92 | 70~76 | 常规 |
| L | 165~175 | 110~125 | 92~98 | 76~82 | 宽松 |
| XL | 172~182 | 125~140 | 98~104 | 82~88 | 宽松 |
| 2XL | 178~188 | 140~155 | 104~110 | 88~94 | 宽松 |

## 选码规则

1. 身高与体重同时给出时，以体重为主，身高用于校验。
2. 身高超出某尺码的建议区间，但体重仍在区间内时，不要自动判定超范围。
3. 两项参数落点冲突时，优先选择更宽松的尺码。
4. 买家未提供身高或体重时先询问，不凭空推荐。
5. 只有本表明确写出超出范围时，才建议联系客服确认。
`,
  }
}

/** 浏览器原生 Blob 下载，不经过网络，也不依赖扩展权限。 */
export function downloadKnowledgeTemplate(file: KnowledgeTemplateFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
