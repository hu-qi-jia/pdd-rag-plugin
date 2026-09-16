// 位图资源导入声明(popup 品牌标 ~assets/icon.png; Plasmo 构建期由 parcel 处理为 URL)
declare module '*.png' {
  const src: string
  export default src
}
