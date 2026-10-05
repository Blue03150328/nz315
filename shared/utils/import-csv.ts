// CSV 转义并阻止表格公式执行；长追溯码按文本处理，避免科学计数法损坏。
export function csvCell(value: unknown) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text) || /^\d{16,}$/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
