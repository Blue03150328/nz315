package cn.nz315.collector.core

import java.util.UUID

/** 采集状态机：每次成功反馈前，码、箱关系和审计记录必须一起提交。 */
class CollectionWorkflow(
    private val store: CollectionStore,
    private val now: () -> Long = System::currentTimeMillis,
    private val id: () -> String = { UUID.randomUUID().toString() }
) {
    private fun log(taskId: String, action: String, detail: String) =
        store.audit(AuditEvent(id(), taskId, action, detail, now()))

    fun create(info: TaskInfo, mode: CodeMode, boxing: Boolean, boxFirst: Boolean, internalBase: String): CollectionTask = store.transaction {
        val taskId = id()
        val groupId = id()
        val task = CollectionTask(taskId, CodePolicy.info(info), mode, boxing, CodePolicy.base(internalBase), now(),
            currentGroupId = groupId, target = if (boxing && boxFirst) ScanTarget.BOX else ScanTarget.PRODUCT)
        store.saveTask(task)
        store.saveGroup(BoxGroup(groupId, taskId, 1, createdAt = now()))
        log(taskId, "创建任务", "${mode.name}；装箱关联=$boxing")
        task
    }

    private fun open(taskId: String): CollectionTask = store.task(taskId).also {
        if (it.status != TaskStatus.OPEN) throw RuleViolation("任务已完成，请先重新打开任务")
    }

    fun target(taskId: String, target: ScanTarget) = store.transaction {
        val task = open(taskId)
        if (!task.boxing && target == ScanTarget.BOX) throw RuleViolation("本任务未启用箱码关联")
        if (store.group(task.currentGroupId).sealed) throw RuleViolation("本箱已完成，请先开始下一箱")
        store.saveTask(task.copy(target = target))
    }

    fun scan(taskId: String, raw: String, source: String): ScanReceipt = store.transaction {
        val task = open(taskId)
        val group = store.group(task.currentGroupId)
        if (group.sealed) throw RuleViolation("本箱已完成，请点击下一箱")
        if (task.target == ScanTarget.BOX) {
            val box = CodePolicy.payload(raw)
            if (group.boxRaw != null) throw RuleViolation("本箱已有箱码；更正请使用修改箱码")
            if (store.groups(taskId).any { it.boxRaw == box }) throw RuleViolation("箱码已在本任务使用，请核对实物")
            store.saveGroup(group.copy(boxRaw = box))
            store.saveTask(task.copy(target = ScanTarget.PRODUCT))
            log(taskId, "采集箱码", group.id)
            ScanReceipt("箱码已保存，请采集箱内产品", box)
        } else {
            val code = CodePolicy.product(task.mode, raw, task.internalBase)
            store.findCode(taskId, code)?.let {
                throw RuleViolation(if (it.groupId == group.id) "本箱已采集此码" else "此码已属于本任务的其他箱，请核对或使用移箱")
            }
            if (task.mode == CodeMode.INTERNAL) {
                val first = store.firstCode(taskId)
                if (first != null && first.value.take(11) != code.take(11)) {
                    throw RuleViolation("该码产品、生产类型或规格与本任务首码不一致，请另建任务")
                }
            }
            store.saveCode(CollectedCode(id(), taskId, group.id, code, now(), source))
            log(taskId, "采集产品", group.id)
            ScanReceipt(if (task.boxing && group.boxRaw == null) "产品已保存，待关联箱码" else "产品已保存", code)
        }
    }

    fun seal(taskId: String) = store.transaction {
        val task = open(taskId)
        val group = store.group(task.currentGroupId)
        if (group.sealed) throw RuleViolation("本箱已完成")
        if (task.boxing && group.boxRaw == null) throw RuleViolation("请先采集箱码，再完成本箱")
        if (store.countInGroup(group.id) == 0) throw RuleViolation("本箱尚无产品码")
        store.saveGroup(group.copy(sealed = true))
        log(taskId, "完成本箱", group.id)
    }

    fun next(taskId: String, boxFirst: Boolean) = store.transaction {
        val task = open(taskId)
        if (!store.group(task.currentGroupId).sealed) throw RuleViolation("请先完成当前箱，再开始下一箱")
        val group = BoxGroup(id(), taskId, store.groups(taskId).maxOf { it.ordinal } + 1, createdAt = now())
        store.saveGroup(group)
        store.saveTask(task.copy(currentGroupId = group.id, target = if (task.boxing && boxFirst) ScanTarget.BOX else ScanTarget.PRODUCT))
        log(taskId, "开始下一箱", group.id)
    }

    fun replaceBox(taskId: String, raw: String) = store.transaction {
        val task = open(taskId)
        val group = store.group(task.currentGroupId)
        val box = CodePolicy.payload(raw)
        if (!task.boxing) throw RuleViolation("本任务未启用箱码关联")
        if (group.sealed) throw RuleViolation("请先重新打开本箱")
        if (store.groups(taskId).any { it.id != group.id && it.boxRaw == box }) throw RuleViolation("箱码已被其他箱使用")
        store.saveGroup(group.copy(boxRaw = box))
        store.saveTask(task.copy(target = ScanTarget.PRODUCT))
        log(taskId, "更正箱码", "${group.id}：原=${group.boxRaw.orEmpty()}；新=$box")
    }

    fun clearBox(taskId: String) = store.transaction {
        val task = open(taskId)
        val group = store.group(task.currentGroupId)
        if (!task.boxing) throw RuleViolation("本任务未启用箱码关联")
        if (group.sealed) throw RuleViolation("请先重新打开本箱")
        store.saveGroup(group.copy(boxRaw = null))
        store.saveTask(task.copy(target = ScanTarget.BOX))
        log(taskId, "清除误扫箱码", "${group.id}：原=${group.boxRaw.orEmpty()}；已有产品转为待关联")
    }

    fun delete(taskId: String, codeId: String) = store.transaction {
        open(taskId)
        val code = store.code(codeId)
        if (code.taskId != taskId) throw RuleViolation("记录不属于当前任务")
        if (store.group(code.groupId).sealed) throw RuleViolation("请先重新打开该箱再删除")
        store.deleteCode(codeId)
        log(taskId, "删除误扫", "${code.value}；原箱=${code.groupId}")
    }

    fun move(taskId: String, codeId: String, destinationId: String) = store.transaction {
        open(taskId)
        val code = store.code(codeId)
        val from = store.group(code.groupId)
        val to = store.group(destinationId)
        if (code.taskId != taskId || to.taskId != taskId) throw RuleViolation("只允许在同一任务内移箱")
        if (from.sealed || to.sealed) throw RuleViolation("请先重新打开相关箱，再移箱")
        if (from.id == to.id) throw RuleViolation("产品已在目标箱中")
        store.saveCode(code.copy(groupId = to.id))
        log(taskId, "移箱", "${code.value}；${from.id}→${to.id}")
    }

    fun reopenGroup(taskId: String, groupId: String) = store.transaction {
        val task = open(taskId)
        val group = store.group(groupId)
        if (group.taskId != taskId) throw RuleViolation("箱不属于当前任务")
        store.saveGroup(group.copy(sealed = false))
        log(taskId, "重新打开箱", groupId)
        // 切换箱由独立操作完成，避免丢失尚未关联的当前组。
        if (task.currentGroupId == groupId) store.saveTask(task.copy(target = ScanTarget.PRODUCT))
    }

    fun selectGroup(taskId: String, groupId: String) = store.transaction {
        val task = open(taskId)
        val group = store.group(groupId)
        if (group.taskId != taskId) throw RuleViolation("箱不属于当前任务")
        store.saveTask(task.copy(currentGroupId = groupId, target = if (group.boxRaw == null && task.boxing) ScanTarget.BOX else ScanTarget.PRODUCT))
    }

    fun updateInfo(taskId: String, info: TaskInfo) = store.transaction {
        val task = open(taskId)
        val validated = CodePolicy.info(info)
        val old = task.info
        val changed = listOf(Triple("任务名称", old.name, validated.name), Triple("企业", old.enterprise, validated.enterprise),
            Triple("产品", old.product, validated.product), Triple("规格", old.specification, validated.specification),
            Triple("批号", old.batchNo, validated.batchNo), Triple("生产日期", old.produceDate, validated.produceDate),
            Triple("合格证号", old.qualityCertNo, validated.qualityCertNo), Triple("产线", old.line, validated.line),
            Triple("操作员", old.operator, validated.operator), Triple("备注", old.note, validated.note))
            .filter { it.second != it.third }.joinToString("；") { "${it.first}：${it.second}→${it.third}" }
        store.saveTask(task.copy(info = validated))
        log(taskId, "修改任务资料", changed.ifBlank { "资料未变化" })
    }

    fun complete(taskId: String) = store.transaction {
        val task = open(taskId)
        if (store.codes(taskId).isEmpty()) throw RuleViolation("任务尚无产品码")
        val used = store.groups(taskId).filter { it.boxRaw != null || store.countInGroup(it.id) > 0 }
        if (used.any { !it.sealed || (task.boxing && it.boxRaw == null) || store.countInGroup(it.id) == 0 }) {
            throw RuleViolation("存在未完成或空箱，请逐箱核对并完成")
        }
        store.saveTask(task.copy(status = TaskStatus.COMPLETED))
        log(taskId, "完成任务", "资料待补：${task.info.missingFields().joinToString()}")
    }

    fun reopenTask(taskId: String) = store.transaction {
        val task = store.task(taskId)
        store.saveTask(task.copy(status = TaskStatus.OPEN))
        log(taskId, "重新打开任务", "可补充资料或调整采集记录")
    }
}
