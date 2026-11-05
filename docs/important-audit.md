# `!important` 审计准则

允许保留 `!important` 的场景：

- `prefers-reduced-motion` 与用户“减少全部动效”覆盖常驻动画。
- 打印模式。
- Swup 状态兜底：切页失败时必须恢复可见或可点击。
- 第三方组件（Fancybox、Expressive Code）缺少稳定低优先级入口时的局部覆盖。

禁止新增：

- 全局 `* { transition: none }`。
- 用一个 `!important` 去压另一个只用 `!important` 才能工作的普通页面规则。
- 为动画 `top`、`height`、`grid-template-columns` 添加 `!important`。

新增覆盖必须在同一规则附近写明原因和回滚方式。页面级重构优先通过所有权、层级和 CSS 变量消除冲突。

