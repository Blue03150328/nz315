package cn.nz315.collector.core

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.time.LocalDate

object CodePolicy {
    const val DEFAULT_BASE = "https://www.nz315.cn/trace?code="
    fun payload(raw: String): String {
        if (raw.isBlank()) throw RuleViolation("扫码内容为空")
        if (raw.length > 8192) throw RuleViolation("扫码内容过长，请核对码内容")
        if (raw.indexOf('\u0000') >= 0) throw RuleViolation("扫码内容包含无效字符")
        return raw
    }

    fun base(value: String): String {
        val uri = runCatching { URI(value) }.getOrNull()
            ?: throw RuleViolation("内部码网址格式不正确")
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
            uri.fragment != null || uri.rawQuery != "code=" || uri.path.isNullOrBlank()) {
            throw RuleViolation("内部码网址须为完整HTTPS地址，并以 ?code= 结尾")
        }
        return value
    }

    fun product(mode: CodeMode, raw: String, internalBase: String): String {
        payload(raw)
        if (mode == CodeMode.EXTERNAL) return raw
        val value = raw.trim()
        if (value.matches(Regex("[0-9]{32}"))) return value
        val input = runCatching { URI(value) }.getOrNull()
            ?: throw RuleViolation("未识别到32位内部追溯码")
        if (!input.isAbsolute || input.host.isNullOrBlank()) throw RuleViolation("未识别到32位内部追溯码")
        val expected = URI(base(internalBase))
        if (input.scheme != expected.scheme || !input.host.equals(expected.host, true) ||
            input.port != expected.port || input.path != expected.path || input.userInfo != null || input.fragment != null) {
            throw RuleViolation("该链接不是本任务的内部码网址，请核对模式")
        }
        val parameters = input.rawQuery.orEmpty().split('&').filter { it.substringBefore('=') == "code" }
        val code = parameters.singleOrNull()?.substringAfter('=', "")?.let {
            runCatching { URLDecoder.decode(it, StandardCharsets.UTF_8.name()) }.getOrNull()
        }
        if (code == null || !code.matches(Regex("[0-9]{32}"))) throw RuleViolation("未识别到唯一的32位追溯码")
        return code
    }

    fun info(value: TaskInfo): TaskInfo {
        if (value.name.isBlank()) throw RuleViolation("请输入任务名称")
        if (value.name.length > 100) throw RuleViolation("任务名称最多100字")
        if (value.produceDate.isNotBlank() && runCatching { LocalDate.parse(value.produceDate) }.isFailure) {
            throw RuleViolation("生产日期请填写真实日期，格式为2026-10-06")
        }
        return value.copy(name = value.name.trim())
    }
}
