/**
 * 装配兼容入口：部分宿主解析器直接查找包根 index.js 而不是 package.json 的
 * main 字段。此处 re-export host 半部分的真实入口。
 * @module dsh-bubble-explain
 */
export * from './lib/index.js'
