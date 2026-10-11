/**
 * dsh-client-ui-workbench — 浏览器半边（browser half）。
 *
 * 手写 bundle：没有 JSX、没有打包器、没有 node_modules。
 *
 * 四条硬约束（详见 README「契约」）：
 *   1. 必须是 classic script：宿主用 `<script async src=...>` 加载，没有 type="module"，
 *      所以文件里不能出现顶层 import / export。
 *   2. 顶层唯一动作是 `window.__ModuleLoader__.load({ id, factory })`；所有副作用
 *      （含样式注入）都要放进 factory 闭包，因为脚本执行只做「注册」。
 *   3. `id` 必须逐字等于包名。
 *   4. factory 必须返回 `apply`；`inject` 里的每个 cordis 服务都必须存在，
 *      否则 entry 停在 pending → 整个 GUI 白屏。
 *
 * `require()` 只能取「基线模块表」里的 9 个词，本插件只用 `react`。
 * 浏览器侧需要的一切能力（RPC、解压、DOM 解析）都由平台 API 提供。
 */
window.__ModuleLoader__.load({
	id: 'dsh-client-ui-workbench',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const h = react.createElement;

		const NS = 'workbench';

		// ────────────────────────────────────────────────────────────────────
		// 1. 文案（zh / en 键集必须完全一致，tools/verify.mjs 会断言）
		// ────────────────────────────────────────────────────────────────────
		const zh = {
			'view.workbench': '需求执行工作台',

			'stage.requirement': '需求',
			'stage.design': '方案',
			'stage.develop': '开发',
			'stage.test': '测试',
			'stage.release': '提版',

			'panel.aria': '需求执行工作台面板',
			'panel.pipeline': '执行管线',
			'panel.running': '执行中',
			'panel.idle': '空闲',
			'panel.queued': '队列 {count}',
			'panel.state.cold': '未加载',
			'panel.state.loading': '加载中',
			'panel.state.open': '已就绪',
			'panel.state.error': '加载失败',
			'panel.loading': '读取中…',
			'panel.viewInTrajectory': '在轨迹中查看',

			'status.pending': '未开始',
			'status.active': '进行中',
			'status.approved': '已审核',

			'req.parallel': '需求列表',
			'req.more': '更多操作',
			'req.pause': '暂停',
			'req.resume': '恢复',
			'req.archive': '移入历史',
			'req.unarchive': '移出历史',
			'req.paused': '已暂停',
			'req.archived': '已归档',
			'req.history': '历史需求',
			'req.historyEmpty': '历史里没有需求',
			'req.done': '标记完成',
			'req.reopen': '取消完成',
			'req.doneTag': '已完成',
			'req.delete': '删除需求',
			'req.deleteTitle': '删除 {id}？',
			'req.deleteWarn': '整个需求文件夹会一起删掉 —— 文档原件、解析出的正文、每一版分析、功能点、方案、测试记录全在里面，**删掉之后没有任何地方还留着副本**。',
			'req.deleteAsk': '确认删除这条需求？',
			'req.deleteYes': '确认删除',
			'req.deleting': '删除中…',
			'req.deleted': '已删除 {id}',
			'req.deleteNeedsRestart': '宿主半边还是旧版本，没有这个操作：请重启一次 DSH（它注册的路由是开机时加载的），再点一次删除。',

			'notice.title': '提醒',
			'notice.empty': '没有待处理的提醒',
			'notice.unread': '未读',
			'notice.prompt': '这个需求已上线（{date}）并标记为完成，是否移入历史？还有 {days} 天将自动归档。',
			'notice.detail': '上线日期 {date} · 还有 {days} 天自动归档',
			'notice.readHint': '点开铃铛即视为已读，已读 3 天后不再显示。',
			'notice.later': '稍后再说',

			'hist.search': '搜索标题或编号',
			'hist.empty': '没有匹配的历史需求',
			'hist.detail': '详情',
			'hist.expand': '展开',
			'hist.collapse': '收起',
			'hist.restore': '恢复',
			'hist.restoreHint': '把整条管线恢复到活跃需求',

			'dev.heading': '开发人员',
			'dev.add': '添加',
			'dev.current': '当前开发人员',
			'dev.mine': '我的管线',
			'dev.viewing': '正在查看 {name} 的管线，只能查看，不能修改。',
			'me.welcome': '欢迎使用需求执行工作台',
			'me.changeTitle': '修改你的姓名',
			'me.prompt': '请输入你的姓名',
			'me.hint': '姓名用来区分你和同事各自的「方案 / 开发 / 测试」管线。只保存在这个浏览器里，不会上传。',
			'me.placeholder': '例如：张三',
			'me.confirm': '开始使用',
			'me.save': '保存',
			'me.setName': '设置我的姓名',
			'me.change': '我：{name}',
			'me.changeHint': '点击修改',
			'me.notInList': '「{name}」不在这个需求的开发人员里。',
			'dev.backToMine': '查看我的管线',
			'dev.addMe': '把我加入开发人员',
			'dev.placeholder': '输入姓名后回车添加',
			'dev.empty': '还没有登记开发人员。登记后，方案 / 开发 / 测试 会按人分开。',
			'dev.remove': '移除 {name}',
			'dev.shared': '公共',
			'dev.sharedHint': '需求与提版是公共管线；方案 / 开发 / 测试 每人各自一条。',

			'lead.heading': '主导者',
			'lead.pill': '主导者：{name}',
			'lead.none': '还没有主导者（先登记开发人员）',
			'lead.change': '变更',
			'lead.pick': '交给',
			'lead.confirm': '确认变更',
			'lead.cancel': '取消',
			'lead.confirmPrompt': '把主导者交给「{name}」？变更后他是唯一能编辑方案汇总的人。',
			'lead.onlyLead': '只有主导者（{name}）能变更',
			'lead.role': '主导者是唯一能编辑「方案汇总」的人。',
			'lead.defaultHint': '默认是名单里的第一个人。',

			'point.heading': '功能点',
			'point.name': '功能点',
			'point.needName': '请填写功能点名称',
			'point.empty': '还没有功能点。',
			'point.namePlaceholder': '例如：客户信息导出',
			'point.assignee': '分派给',
			'point.unassigned': '未分派',
			'point.add': '新增功能点',
			'point.delete': '删除',
			'point.noDevelopers': '先在上面登记开发人员，才能按人分派。',
			// 分块（树形的第一级）
			'point.group': '需求分块',
			'point.groupPlaceholder': '例如：客户主数据',
			'point.groupCount': '{count} 项',
			'point.groupAdd': '加一条',
			'point.groupRename': '改名',
			'point.groupRenamePrompt': '把分块「{name}」改名（{count} 个功能点跟着换）：',
			'point.groupMove': '改这块',
			'point.groupBoth': '分块与功能点',
			'point.newGroup': '新分块',			'point.groupEmpty': '这一块还没有功能点',
			'point.needGroupName': '新分块还没起名字：填一个名字，或按 Esc 放弃新建',
			'point.collapse': '收起',
			'point.expand': '展开',
			'point.search': '按名称或分块筛选…',
			'point.searchEmpty': '没有匹配的功能点',
			// 分派状态筛选（与名称筛选并列，两个条件同时生效）
			'point.assignFilter': '分派状态',
			'point.assignAll': '全部分派状态',
			'point.assignAssigned': '已分派',
			'point.assignUnassigned': '未分派',
			'point.assigned': '已分派 {count}',
			'point.groups': '{count} 块',

			'detail.title': '需求管线回显',
			'detail.readonly': '只读',
			'detail.close': '关闭',
			'detail.status': '状态',
			'detail.createdAt': '创建时间',
			'detail.updatedAt': '更新时间',
			'detail.archivedAt': '归档时间',
			'detail.pipeline': '管线',
			'detail.documents': '需求文档',
			'detail.noDocuments': '没有需求文档',
			'detail.clarifications': '澄清问答',
			'detail.noClarifications': '没有澄清记录',
			'detail.viewText': '查看正文',
			'detail.hideText': '收起正文',

			'dates.heading': '关键时间',
			'dates.release': '提版日期',
			'dates.testFreeze': '测试封板日期',
			'dates.goLive': '上线日期',
			'dates.unset': '未设置',
			'dates.today': '今天',
			'dates.remaining': '还剩 {days} 天',
			'dates.overdue': '已过期 {days} 天',
			'dates.order': '先后顺序：提版日期 < 测试封板日期 < 上线日期',
			'dates.errReleaseBeforeFreeze': '提版日期必须早于测试封板日期',
			'dates.errFreezeBeforeLive': '测试封板日期必须早于上线日期',

			'selftest.note': '这一阶段是开发者自测调试用的；专业测试在提版后走专门的流程系统。',
			'req.none': '工作台目录里还没有需求',
			'req.create': '新建需求',
			'req.createHint': '需求编号按 XQ+日期+序号 生成，也可以手填外部系统的编号。',
			'req.id': '需求编号',
			'req.autoId': '建议编号',
			'req.title': '需求标题',
			'req.titlePlaceholder': '例如：客户经营信息优化',
			'req.submit': '创建',
			'req.cancel': '取消',
			'req.needTitle': '请填写需求标题',
			'req.needId': '需求编号格式应为 XQ+8 位日期+4 位序号',

			'doc.heading': '需求文档',
			'doc.upload': '上传 Word 文档',
			'doc.uploading': '正在解析…',
			'doc.empty': '还没有需求文档。上传 .docx 后会解析出正文并按版本留存。',
			'doc.versions': '版本记录',
			'doc.chars': '{count} 字',
			// 方案页的版本对比复用了这一条；文档区自己的对比走 cmp.*
			'doc.compareClose': '关闭对比',
			'doc.added': '新增',
			'doc.removed': '删除',
			'doc.unchanged': '两个版本正文没有差异',
			'doc.parseFailed': '解析失败：{reason}',
			'doc.unsupported': '这个浏览器不支持 DecompressionStream(deflate-raw)，无法解析 .docx',
			'doc.notDocx': '不是有效的 .docx（没有找到 word/document.xml）',
			'doc.saved': '已保存 {version}',

			// 导入后展示的不是原文，而是 AI 的分析结果（原文只在「查看原文」里按需展开）。
			'an.heading': 'AI 分析',
			'an.run': 'AI 分析',
			'an.redo': '继续优化分析',
			'an.working': '正在交给 AI…',
			'an.updating': '正在读取…',
			'an.sent': '已把分析指令发给对话。AI 写完后这里会自动刷新。',
			'an.analyzing': 'AI 正在读文档…',
			'an.failed': '发送失败：{reason}',
			'an.manual': '送不进对话，可以复制下面这段指令，自己粘贴到输入框。',
			'an.source': '查看原文',
			'an.sourceHide': '收起原文',
			'an.sourceHeading': '解析出的原文（供核对，正常看分析就够）',
			'an.noVersion': '这一版还没有分析',
			'an.emptyHint': '点这一行的【AI 分析】让 AI 读它。',
			'an.extracted': '已从分析里补进 {count} 个功能点',

			// 版本行上的动作
			'ver.analyze': 'AI 分析',
			'ver.refine': '继续优化',
			'ver.delete': '删除',
			'ver.deleteConfirm': '删除 {version}？文档、解析出的正文和这一版的分析都会一并删掉，功能点保留。',
			'ver.deleted': '已删除 {version}',

			// 两版对比：文档差异 + 分析差异
			'cmp.title': '版本对比',
			'cmp.off': '版本对比',
			'cmp.on': '关闭对比',
			'cmp.needTwo': '至少两版才有可对比的东西。',
			'cmp.pick': '选择两版',
			'cmp.left': '左',
			'cmp.right': '右',
			'cmp.same': '两版一模一样（连解析出的正文都完全相同）',
			'cmp.docDiff': '文档差异',
			'cmp.anDiff': '分析差异',
			'cmp.noAnalysis': '这一版还没有分析',
			'cmp.noAnalysisBoth': '两版都还没有分析，先各点一次【AI 分析】。',
			'cmp.stats': '文档 +{added} / -{removed} 行 · 分析 +{anAdded} / -{anRemoved} 行',
			// 判定的种类直接用两句话写清楚 —— 把内部的 kind 值拼进句子只会得到「差异异常：jump」。
			'cmp.suspiciousJump': '差异异常：版本号跳了一大截，正文却几乎没变',
			'cmp.suspiciousStale': '差异异常：正文改了很多，分析却几乎没动',
			'cmp.suspiciousHint': '常见原因是这一版上传错了文件（或者把同一份传了两次）。请核对原件，必要时删掉这一版重传。',
			'cmp.suspiciousHintBig': '分析可能是在旧正文上做的，或者这一版还没重跑过分析。建议对右版点一次【继续优化】。',
			'cmp.anMissingSide': '{side} 版还没有分析，下面只对比文档差异。',
			'cmp.vsPrevious': '与上一版对比',
			'cmp.vsPreviousHint': '对比 {left} → {right}：文档差异 + 分析差异',
			'cmp.anHeaderMissing': '这一版的分析里还没有「与上一版差异」小节（老分析或没带上一版读）。对【{refine}】重跑一次就会出现。',
			'cmp.anDiffSection': '与上一版差异',

			'qa.heading': '澄清问答',
			'qa.empty': '还没有澄清记录。',
			'qa.question': '问题',
			'qa.answer': '回答',
			'qa.questionPlaceholder': '待澄清的问题…',
			'qa.answerPlaceholder': '回答…',
			'qa.add': '新增一条',
			'qa.delete': '删除',
			'qa.pending': '待回答',
			'qa.answered': '已回答',

			'menu.requirement.intake': '录入需求',
			'menu.requirement.clarify': '澄清问答',
			'menu.requirement.accept': '验收标准',
			'menu.design.draft': '方案草稿',
			'menu.design.impact': '影响面分析',
			'menu.design.breakdown': '任务拆分',
			'menu.design.apis': '接口清单',
			'menu.design.pages': '页面清单',

			'design.ai': '让 AI 出方案',
			'design.aiRedo': '让 AI 优化方案',
			'design.aiWorking': '正在交给 AI…',
			'design.aiSent': '已把出稿指令发给对话。AI 写完后这里会自动刷新。',
			'design.aiFailed': '发送失败：{reason}',
			'design.aiManual': '送不进对话，可以复制下面这段指令，自己粘贴到输入框。',
			'design.paste': '手动粘贴用（点进框里全选复制）：',
			'design.placeholder': '方案正文…（可以直接在这里改）',
			'design.empty': '还没有方案正文。点【让 AI 出方案】让它读需求后出稿，也可以自己在下面写。',
			'design.save': '保存正文',
			'design.saving': '保存中…',
			'design.saved': '已保存',
			'design.snapshot': '留存版本',
			'design.snapshotted': '已留存 {version}',
			'design.compare': '与最近版本对比',
			'design.noVersions': '还没有留存版本可对比',
			'design.confirm': '方案定稿',
			'design.reopen': '取消定稿',
			'design.confirmEmpty': '方案还是空的：先让 AI 出稿或自己写正文，再定稿。',

			// 文档生成（`gendoc.` 前缀）：与需求文档区的 `doc.` 分开 ——
			// 两套文案语义不同，共用一个前缀迟早互相覆盖（`doc.empty` 就撞过一次）。
			'gendoc.heading': '方案文档',
			'gendoc.generate': '生成方案文档',
			'gendoc.regenerate': '重新生成',
			'gendoc.generating': '正在生成…',
			'gendoc.copy': '复制全文',
			'gendoc.copied': '已复制全文',
			'gendoc.copyFailed': '复制失败：{reason}（可以手动全选下面的预览复制）',
			'gendoc.save': '写入文件',
			'gendoc.saving': '写入中…',
			'gendoc.saved': '已写入 {path}',
			'gendoc.failed': '失败：{reason}',
			'gendoc.template': '模板：{source}',
			'gendoc.missing': '缺 {count} 项：{names}',
			'gendoc.complete': '模板需要的字段都有值。',
			'gendoc.empty': '还没有可生成的内容：先让 AI 出方案（或自己写方案正文 / 接口清单），再来生成。',
			'gendoc.exportNote': '生成的是导出物：改了清单或正文后请【重新生成】，不要直接改这份文档。',
			'gendoc.builtin': '内置默认',
			'gendoc.custom': '自定义（{path}）',
			'gendoc.templateMissing': '还没有自定义模板，正在用内置默认。公司模板请放到 {path}（放好后重新生成即可生效）。',
			'gendoc.exportBuiltin': '把内置模板写到 {path}',
			'gendoc.exported': '已写出 {path}，改成公司模板后重新生成即可。',
			'gendoc.exists': '{path} 已经存在，没有覆盖它（要恢复内置版就先删掉它）。',
			'gendoc.needsRestart': '宿主还是旧版本：自定义模板要**重启一次 DSH** 才会生效（现在用的是内置默认模板）。',

			'summary.label': '汇总方案',
			'summary.heading': '方案汇总',
			'summary.working': '正在汇总…',
			'summary.sent': '已把汇总指令发给对话。AI 写完这里会自动刷新。',
			'summary.empty': '还没有汇总。由主导者点「方案草稿」里的【汇总方案】—— AI 会读所有人的方案，产出一份整体开发概念。',
			'summary.save': '保存汇总',
			'summary.saving': '保存中…',
			'summary.saved': '已保存',
			'summary.updatedAt': '更新于 {time}',
			'summary.roster': '各人方案进度',
			'summary.done': '已汇总',
			'summary.pending': '未汇总',
			'summary.wrote': '已写方案',
			'summary.notWrote': '未写方案',
			'summary.confirmed': '已定稿',
			'summary.tasks': '{count} 个任务 · {days} 人天',
			'summary.totalDays': '合计预估 {days} 人天',
			'summary.missing': '还没写方案：{names}',
			'summary.allWritten': '所有人都已写方案',
			'summary.noDevelopers': '这个需求还没有登记开发人员。',
			'summary.readonly': '方案汇总只有主导者（{name}）能编辑，其他人只能看。',
			'summary.leadOnly': '汇总方案（主导者可编辑汇总本身）',

			'col.target': '文件 / 模块',
			'ph.target': '例如：src/customer/export.ts',
			'col.note': '说明',
			'col.done': '完成',
			'col.hash': '提交',
			'ph.hash': '例如：a1b2c3d',
			'col.message': '说明',
			'col.item': '自测项',
			'ph.item': '例如：导出空数据不报错',
			'col.result': '结果',
			'col.case': '用例',
			'ph.case': '例如：导出 10 万行不超时',
			'col.expected': '预期',
			'col.at': '时间',
			'ph.at': '例如：2026-10-10 14:00',
			'col.passed': '通过',
			'col.failed': '失败',
			'col.defect': '缺陷',
			'ph.defect': '例如：导出大文件时内存溢出',
			'col.severity': '严重度',
			'col.status': '状态',
			'col.task': '对应任务',
			'col.taskNone': '（未关联任务）',

			'col.point': '来源功能点',
			'ph.point': '例如：客户建档表单',
			'col.taskNo': '任务号',
			'ph.taskNo': '例如：T04；没定就留空',
			'col.apiName': '接口名',
			'ph.apiName': '例如：客户查重预检',
			'col.method': '方法',
			'ph.method': 'GET / POST / PUT / DELETE',
			'col.path': '接口路径',
			'ph.path': '例如：/api/customer/dedup/check；没定就写（路径待确认）',
			'col.change': '新增/修改',
			'ph.change': '新增 / 修改',
			'col.request': '入参要点',
			'ph.request': '例如：name、uscc',
			'col.response': '出参要点',
			'ph.response': '例如：hits[]，含相似度',
			'col.route': '路由 / 入口',
			'ph.route': '例如：/customer/list',
			'col.pageName': '页面名',
			'ph.pageName': '例如：客户列表页',
			'col.blocks': '页面区块',
			'ph.blocks': '例如：筛选区、列表、批量操作条',
			'col.interaction': '关键交互',
			'ph.interaction': '例如：失焦即预检、超限置灰',

			'mine.heading': '我的任务',
			'mine.summary': '共 {count} 个 · 未开工 {todo} · 进行中 {doing} · 已完成 {done}',
			'mine.todo': '未开工',
			'mine.doing': '进行中',
			'mine.done': '已完成',
			'mine.empty': '方案里还没有你的任务。到「方案」页点【从功能点生成】建任务骨架。',
			'mine.untitled': '（未命名任务）',
			'mine.point': '来源功能点',
			'mine.estimate': '预估 {days} 人天',
			'mine.noChange': '还没有对应变更',
			'mine.changes': '{done}/{total} 项变更已完成',
			// 【执行】的通用部分（弹窗本身与它的按钮）：开发页的每个任务、测试页的每条用例
			// 都用同一套 —— 两个阶段不同的只是"指令怎么生成"与弹窗里的那两句说明。
			'exec.run': '执行',
			'exec.edit': '发给 AI 的指令（可以先改再发）',
			'exec.manual': '当前会话通道不可用，这段指令发不出去 —— 先复制到对话里。',
			'exec.send': '发送给对话',
			'exec.sending': '正在发送…',
			'exec.sent': '已把执行指令发给对话。AI 做完这里会自动刷新。',
			'exec.failed': '发送失败：{reason}',
			'exec.reset': '恢复默认指令',
			'exec.close': '取消',
			'mine.execTitle': '执行任务：{name}',
			'mine.execNote': '点【发送给对话】后，AI 会读这个人的方案、按方案实现这一个任务；写完页面会自动刷新。',
			'mine.execWrites': 'AI 会把每条改动追加进下面的「变更清单」并补「开发自测」项。**勾选留给你复核** —— 所以新记进来的行一律是未完成。',
			'case.execTitle': '执行用例：{name}',
			'case.execNote': '点【发送给对话】后，AI 会读方案与这一轮开发改动，然后跑这一条用例（本阶段只做简单的接口测试）。',
			'case.execWrites': 'AI 会把这一条的「结果」改成通过 / 失败并写清实际验了什么；同时往「执行结果」追加一条记录，失败时往「缺陷跟踪」记一条。**跑不了时它会说跑不了、结果留在「未做」** —— 不会编一个通过给你。',
			'stage.rowNo': '第 {no} 条',
			'mine.groupTodo': '还没有开工的任务',
			'mine.groupGap': '这些功能点还没有任何任务',
			'mine.groupCount': '{count} 个',
			'mine.groupHint': '去「方案」页补。',
			'mine.noGaps': '分派给你的功能点都有对应任务。',
			'mine.readonly': '任务在「方案」页维护',
			'mine.hint': '在下面的变更清单里把每行挂到对应任务上，这一块就会跟着走。',
			'mine.untagged': '还有 {count} 行变更没有挂任务。',
			'opt.pending': '未做',
			'opt.pass': '通过',
			'opt.fail': '失败',
			'opt.low': '低',
			'opt.medium': '中',
			'opt.high': '高',
			'opt.critical': '致命',
			'opt.open': '待修',
			'opt.fixing': '修复中',
			'opt.fixed': '已修复',
			'opt.closed': '已关闭',
			'field.version': '版本号',
			'ph.version': '例如：1.2.0',
			'field.releasedAt': '提版日期',

			'stage.add': '新增一行',
			'stage.remove': '删除',
			'stage.rows': '{count} 行',
			'stage.empty': '还没有内容。可以让 AI 起草，也可以自己一行行加。',
			'stage.save': '保存',
			'stage.saving': '保存中…',
			'stage.saved': '已保存',
			'stage.ai': '让 AI 写这一阶段',
			'stage.aiRedo': '让 AI 重写这一阶段',
			'stage.aiWorking': '正在交给 AI…',
			'stage.aiSent': '已把指令发给对话。AI 写完后这里会自动刷新。',
			'stage.sharedHint': '提版是公共管线，所有人可改。',
			'stage.done.develop': '变更清单全部勾完、且自测项全部通过后，这一阶段算「已审核」。',
			'stage.done.test': '用例全部通过、且没有未关闭的缺陷后，这一阶段算「已审核」。',
			'stage.done.release': '填了版本号与发布说明后，这一阶段算「已审核」。',
			'stage.ownerHint': '这一阶段按人分开：只有本人能改，别人打开是只读的。',

			'impact.modules': '受影响模块 / 文件',
			'impact.modulesPlaceholder': '一行一个，例如：src/customer/export.ts',
			'impact.risk': '风险等级',
			'impact.riskLow': '低',
			'impact.riskMedium': '中',
			'impact.riskHigh': '高',
			'impact.rollback': '回滚方案',
			'impact.rollbackPlaceholder': '出问题时怎么退回去…',
			'impact.dependencies': '依赖与前置条件',
			'impact.dependenciesPlaceholder': '需要谁配合、需要先做什么…',
			'impact.save': '保存影响面',
			'impact.saving': '保存中…',
			'impact.saved': '已保存',

			'task.total': '共 {count} 个任务 · 预估 {days} 人天 · 已完成 {done} 个',
			'task.seed': '从功能点生成',
			'task.seedHint': '分派给「{name}」的功能点有 {count} 个；已生成过的不会重复。',
			'task.add': '新增任务',
			'task.save': '保存任务',
			'task.saving': '保存中…',
			'task.saved': '已保存',
			'task.noPoints': '这个需求还没有分派给你的功能点，先到「需求」页登记。',
			'task.empty': '还没有任务。可以从功能点生成，也可以手工新增。',
			'task.titlePlaceholder': '任务内容',
			'task.manual': '手工任务',
			'task.point': '来源功能点',
			'task.orphan': '来源功能点已删除',
			'task.estimate': '预估人天',
			'task.doneTag': '完成',
			'task.remove': '删除',
			'menu.develop.changes': '变更清单',
			'menu.develop.commits': '提交记录',
			'menu.develop.selfTest': '开发自测',
			'menu.test.cases': '测试用例',
			'menu.test.runs': '执行结果',
			'menu.test.defects': '缺陷跟踪',
			'menu.release.changelog': '变更日志',
			'menu.release.version': '版本号',
			'menu.release.notes': '发布说明',
		};

		const en = {
			'view.workbench': 'Requirements Workbench',

			'stage.requirement': 'Requirement',
			'stage.design': 'Design',
			'stage.develop': 'Develop',
			'stage.test': 'Test',
			'stage.release': 'Release',

			'panel.aria': 'Requirements execution workbench panel',
			'panel.pipeline': 'Execution pipeline',
			'panel.running': 'Running',
			'panel.idle': 'Idle',
			'panel.queued': 'Queued {count}',
			'panel.state.cold': 'Not loaded',
			'panel.state.loading': 'Loading',
			'panel.state.open': 'Ready',
			'panel.state.error': 'Load failed',
			'panel.loading': 'Loading…',
			'panel.viewInTrajectory': 'View in trajectory',

			'status.pending': 'Not started',
			'status.active': 'In progress',
			'status.approved': 'Approved',

			'req.parallel': 'Requirement list',
			'req.more': 'More actions',
			'req.pause': 'Pause',
			'req.resume': 'Resume',
			'req.archive': 'Move to history',
			'req.unarchive': 'Restore from history',
			'req.paused': 'Paused',
			'req.archived': 'Archived',
			'req.history': 'History',
			'req.historyEmpty': 'No archived requirement',
			'req.done': 'Mark done',
			'req.reopen': 'Reopen',
			'req.doneTag': 'Done',
			'req.delete': 'Delete requirement',
			'req.deleteTitle': 'Delete {id}?',
			'req.deleteWarn': 'The whole requirement folder goes with it — source documents, extracted text, every analysis, feature points, design notes and test records all live there, and **nothing keeps a copy once it is gone**.',
			'req.deleteAsk': 'Delete this requirement for good?',
			'req.deleteYes': 'Delete',
			'req.deleting': 'Deleting…',
			'req.deleted': 'Deleted {id}',
			'req.deleteNeedsRestart': 'The host half is still the old version without this operation: restart DSH once (its route is registered at startup) and press Delete again.',

			'notice.title': 'Notifications',
			'notice.empty': 'Nothing pending',
			'notice.unread': 'Unread',
			'notice.prompt': 'This requirement went live on {date} and is marked done. Move it to history? It will be archived automatically in {days} day(s).',
			'notice.detail': 'Went live {date} · auto-archive in {days} day(s)',
			'notice.readHint': 'Opening the bell marks these read; they stop showing 3 days after being read.',
			'notice.later': 'Later',

			'hist.search': 'Search title or id',
			'hist.empty': 'No matching archived requirement',
			'hist.detail': 'Details',
			'hist.expand': 'Expand',
			'hist.collapse': 'Collapse',
			'hist.restore': 'Restore',
			'hist.restoreHint': 'Restore the whole pipeline to active requirements',

			'dev.heading': 'Developers',
			'dev.add': 'Add',
			'dev.current': 'Current developer',
			'dev.mine': 'My pipeline',
			'dev.viewing': 'Viewing {name}\u2019s pipeline — read only, no changes allowed.',
			'me.welcome': 'Welcome to the Requirements Workbench',
			'me.changeTitle': 'Change your name',
			'me.prompt': 'Please enter your name',
			'me.hint': 'Your name tells your own design / develop / test pipeline apart from your teammates’. It is stored in this browser only and never uploaded.',
			'me.placeholder': 'e.g. Jane Doe',
			'me.confirm': 'Get started',
			'me.save': 'Save',
			'me.setName': 'Set my name',
			'me.change': 'Me: {name}',
			'me.changeHint': 'Click to change',
			'me.notInList': '“{name}” is not one of this requirement’s developers.',
			'dev.backToMine': 'View my pipeline',
			'dev.addMe': 'Add me as a developer',
			'dev.placeholder': 'Type a name and press Enter',
			'dev.empty': 'No developer yet. Once added, design / develop / test are tracked per person.',
			'dev.remove': 'Remove {name}',
			'dev.shared': 'Shared',
			'dev.sharedHint': 'Requirement and release are shared; design / develop / test are per person.',

			'lead.heading': 'Lead',
			'lead.pill': 'Lead: {name}',
			'lead.none': 'No lead yet (register a developer first)',
			'lead.change': 'Change',
			'lead.pick': 'Hand over to',
			'lead.confirm': 'Confirm change',
			'lead.cancel': 'Cancel',
			'lead.confirmPrompt': 'Hand the lead role to “{name}”? Afterwards that person is the only one who can edit the design summary.',
			'lead.onlyLead': 'Only the lead ({name}) can change this',
			'lead.role': 'The lead is the only person who can edit the design summary.',
			'lead.defaultHint': 'Defaults to the first person in the list.',

			'point.heading': 'Feature points',
			'point.name': 'Feature point',
			'point.needName': 'A name is required',
			'point.empty': 'No feature point yet.',
			'point.namePlaceholder': 'e.g. Customer data export',
			'point.assignee': 'Assignee',
			'point.unassigned': 'Unassigned',
			'point.add': 'Add feature point',
			'point.delete': 'Delete',
			'point.noDevelopers': 'Register a developer above before assigning.',
			// Grouping (the first level of the tree)
			'point.group': 'Requirement block',
			'point.groupPlaceholder': 'e.g. Customer master data',
			'point.groupCount': '{count}',
			'point.groupAdd': 'Add',
			'point.groupRename': 'Rename',
			'point.groupRenamePrompt': 'Rename block "{name}" ({count} feature points move with it):',
			'point.groupMove': 'Move to',
			'point.groupBoth': 'Block and point',
			'point.newGroup': 'New block',
			'point.needGroupName': 'The new block has no name yet: type one, or press Esc to give it up',
			'point.groupEmpty': 'No feature point in this block yet',
			'point.collapse': 'Collapse',
			'point.expand': 'Expand',
			'point.search': 'Filter by name or block…',
			'point.searchEmpty': 'No matching feature point',
			'point.assignFilter': 'Assignment',
			'point.assignAll': 'Any assignment',
			'point.assignAssigned': 'Assigned',
			'point.assignUnassigned': 'Unassigned',
			'point.assigned': '{count} assigned',
			'point.groups': '{count} blocks',

			'detail.title': 'Requirement pipeline',
			'detail.readonly': 'Read-only',
			'detail.close': 'Close',
			'detail.status': 'Status',
			'detail.createdAt': 'Created',
			'detail.updatedAt': 'Updated',
			'detail.archivedAt': 'Archived',
			'detail.pipeline': 'Pipeline',
			'detail.documents': 'Documents',
			'detail.noDocuments': 'No document',
			'detail.clarifications': 'Clarifications',
			'detail.noClarifications': 'No clarification',
			'detail.viewText': 'View text',
			'detail.hideText': 'Hide text',

			'dates.heading': 'Key dates',
			'dates.release': 'Release date',
			'dates.testFreeze': 'Test freeze date',
			'dates.goLive': 'Go-live date',
			'dates.unset': 'Not set',
			'dates.today': 'Today',
			'dates.remaining': '{days} days left',
			'dates.overdue': '{days} days overdue',
			'dates.order': 'Required order: release date < test freeze date < go-live date',
			'dates.errReleaseBeforeFreeze': 'The release date must be earlier than the test freeze date',
			'dates.errFreezeBeforeLive': 'The test freeze date must be earlier than the go-live date',

			'selftest.note': 'This stage is for developer self-testing and debugging; formal QA runs in a separate system after release.',
			'req.none': 'No requirement in the workbench folder yet',
			'req.create': 'New requirement',
			'req.createHint': 'The id is generated as XQ + date + sequence; you can also type an id from an external system.',
			'req.id': 'Requirement id',
			'req.autoId': 'Suggested id',
			'req.title': 'Title',
			'req.titlePlaceholder': 'e.g. Customer operation data cleanup',
			'req.submit': 'Create',
			'req.cancel': 'Cancel',
			'req.needTitle': 'A title is required',
			'req.needId': 'The id must look like XQ + 8-digit date + 4-digit sequence',

			'doc.heading': 'Requirement documents',
			'doc.upload': 'Upload Word document',
			'doc.uploading': 'Parsing…',
			'doc.empty': 'No document yet. Uploading a .docx extracts its text and keeps it per version.',
			'doc.versions': 'Versions',
			'doc.chars': '{count} chars',
			// The design page's version comparison reuses this one; the document
			// section has its own cmp.* strings.
			'doc.compareClose': 'Close comparison',
			'doc.added': 'Added',
			'doc.removed': 'Removed',
			'doc.unchanged': 'The two versions have identical text',
			'doc.parseFailed': 'Parse failed: {reason}',
			'doc.unsupported': 'This browser lacks DecompressionStream(deflate-raw), so .docx cannot be parsed',
			'doc.notDocx': 'Not a valid .docx (no word/document.xml found)',
			'doc.saved': 'Saved {version}',

			// What you see after an import is the AI's analysis, not the raw text
			// (the raw text sits behind "View source", on demand).
			'an.heading': 'AI analysis',
			'an.run': 'Analyze with AI',
			'an.redo': 'Analyze again',
			'an.working': 'Handing over to the AI…',
			'an.updating': 'Reading…',
			'an.sent': 'The analysis instruction was sent to the conversation. This page refreshes itself once the AI finishes.',
			'an.analyzing': 'The AI is reading the document…',
			'an.failed': 'Send failed: {reason}',
			'an.manual': 'The instruction could not be sent into the conversation — copy it below and paste it into the composer.',
			'an.source': 'View source',
			'an.sourceHide': 'Hide source',
			'an.sourceHeading': 'Extracted text (to check against; the analysis is normally enough)',
			'an.noVersion': 'No analysis for this version yet',
			'an.emptyHint': 'Click "AI analysis" on that row and let the AI read it.',
			'an.extracted': 'Added {count} feature point(s) found in the analysis',

			'ver.analyze': 'AI analysis',
			'ver.refine': 'Refine',
			'ver.delete': 'Delete',
			'ver.deleteConfirm': 'Delete {version}? The document, its extracted text and its analysis are all removed. Feature points are kept.',
			'ver.deleted': 'Deleted {version}',

			'cmp.title': 'Version comparison',
			'cmp.off': 'Version comparison',
			'cmp.on': 'Close comparison',
			'cmp.needTwo': 'Two versions are needed before anything can be compared.',
			'cmp.pick': 'Pick two versions',
			'cmp.left': 'Left',
			'cmp.right': 'Right',
			'cmp.same': 'The two versions are identical (even the extracted text)',
			'cmp.docDiff': 'Document diff',
			'cmp.anDiff': 'Analysis diff',
			'cmp.noAnalysis': 'No analysis for this version',
			'cmp.noAnalysisBoth': 'Neither version has an analysis yet — run "AI analysis" on each first.',
			'cmp.stats': 'document +{added} / -{removed} lines · analysis +{anAdded} / -{anRemoved} lines',
			'cmp.suspiciousJump': 'Suspicious difference: the version number jumped but the text barely changed',
			'cmp.suspiciousStale': 'Suspicious difference: the text changed a lot but the analysis barely moved',
			'cmp.suspiciousHint': 'That usually means the wrong file was uploaded (or the same one twice). Check the original and delete this version if needed.',
			'cmp.suspiciousHintBig': 'The analysis may have been made against the old text, or this version was never re-analysed. Click "Refine" on the right-hand version.',
			'cmp.anMissingSide': '{side} has no analysis, so only the document diff is shown.',
			'cmp.vsPrevious': 'Compare with previous',
			'cmp.vsPreviousHint': 'Compare {left} → {right}: document diff + analysis diff',
			'cmp.anHeaderMissing': 'This version\'s analysis has no "changes vs previous" section yet (older analysis, or it was made without the previous version). Run "{refine}" to get it.',
			'cmp.anDiffSection': 'Changes vs previous',

			'qa.heading': 'Clarifications',
			'qa.empty': 'No clarification recorded yet.',
			'qa.question': 'Question',
			'qa.answer': 'Answer',
			'qa.questionPlaceholder': 'An open question…',
			'qa.answerPlaceholder': 'The answer…',
			'qa.add': 'Add one',
			'qa.delete': 'Delete',
			'qa.pending': 'Open',
			'qa.answered': 'Answered',

			'menu.requirement.intake': 'Capture requirement',
			'menu.requirement.clarify': 'Clarify',
			'menu.requirement.accept': 'Acceptance criteria',
			'menu.design.draft': 'Design draft',
			'menu.design.impact': 'Impact analysis',
			'menu.design.breakdown': 'Task breakdown',
			'menu.design.apis': 'Backend APIs',
			'menu.design.pages': 'Frontend pages',

			'design.ai': 'Draft with AI',
			'design.aiRedo': 'Improve with AI',
			'design.aiWorking': 'Handing over to the AI…',
			'design.aiSent': 'The drafting instruction was sent to the conversation. This page refreshes itself once the AI finishes.',
			'design.aiFailed': 'Send failed: {reason}',
			'design.aiManual': 'The instruction could not be sent into the conversation — copy it below and paste it into the composer.',
			'design.paste': 'For manual paste (click the box, select all, copy):',
			'design.placeholder': 'Design text… (edit it right here)',
			'design.empty': 'No design text yet. Use “Draft with AI” to have it written from the requirement, or write it below.',
			'design.save': 'Save text',
			'design.saving': 'Saving…',
			'design.saved': 'Saved',
			'design.snapshot': 'Keep version',
			'design.snapshotted': 'Kept {version}',
			'design.compare': 'Compare with latest version',
			'design.noVersions': 'No kept version to compare with',
			'design.confirm': 'Finalize design',
			'design.reopen': 'Reopen design',
			'design.confirmEmpty': 'The design is still empty — draft it with the AI or write the text first.',

			// Document generation (`gendoc.` prefix) — deliberately not `doc.`,
			// which belongs to the requirement-documents block above.
			'gendoc.heading': 'Design document',
			'gendoc.generate': 'Generate design document',
			'gendoc.regenerate': 'Regenerate',
			'gendoc.generating': 'Generating…',
			'gendoc.copy': 'Copy all',
			'gendoc.copied': 'Copied',
			'gendoc.copyFailed': 'Copy failed: {reason}',
			'gendoc.save': 'Write file',
			'gendoc.saving': 'Writing…',
			'gendoc.saved': 'Written to {path}',
			'gendoc.failed': 'Failed: {reason}',
			'gendoc.template': 'Template: {source}',
			'gendoc.missing': '{count} missing: {names}',
			'gendoc.complete': 'Every field the template needs has a value.',
			'gendoc.empty': 'Nothing to generate yet — draft the design with the AI (or write the text / API list) first.',
			'gendoc.exportNote': 'This file is generated: after changing the lists or the text, regenerate it instead of editing it.',
			'gendoc.builtin': 'built-in default',
			'gendoc.custom': 'custom ({path})',
			'gendoc.templateMissing': 'No custom template yet — using the built-in one. Put the company template at {path} and regenerate.',
			'gendoc.exportBuiltin': 'Write the built-in template to {path}',
			'gendoc.exported': 'Wrote {path}. Edit it into the company template and regenerate.',
			'gendoc.exists': '{path} already exists and was not overwritten (delete it first to restore the built-in one).',
			'gendoc.needsRestart': 'The host is an older build: custom templates need a **DSH restart** to take effect (the built-in template is being used now).',

			'summary.label': 'Summarize designs',
			'summary.heading': 'Design summary',
			'summary.working': 'Summarizing…',
			'summary.sent': 'The summary instruction was sent to the conversation. This page refreshes itself when the AI finishes.',
			'summary.empty': 'No summary yet. The lead clicks “Summarize designs” in the design draft block — the AI reads everyone’s design and produces one overall development concept.',
			'summary.save': 'Save summary',
			'summary.saving': 'Saving…',
			'summary.saved': 'Saved',
			'summary.updatedAt': 'updated {time}',
			'summary.roster': 'Per-developer progress',
			'summary.done': 'Summarized',
			'summary.pending': 'Not summarized',
			'summary.wrote': 'Design written',
			'summary.notWrote': 'No design yet',
			'summary.confirmed': 'Finalized',
			'summary.tasks': '{count} task(s) · {days} person-days',
			'summary.totalDays': '{days} person-days in total',
			'summary.missing': 'No design yet from: {names}',
			'summary.allWritten': 'Everyone has written a design',
			'summary.noDevelopers': 'No developer is registered on this requirement yet.',
			'summary.readonly': 'Only the lead ({name}) can edit the design summary; everyone else can read it.',
			'summary.leadOnly': 'Summarize designs (the lead edits the summary itself)',

			'col.target': 'File / module',
			'ph.target': 'e.g. src/customer/export.ts',
			'col.note': 'Note',
			'col.done': 'Done',
			'col.hash': 'Commit',
			'ph.hash': 'e.g. a1b2c3d',
			'col.message': 'Note',
			'col.item': 'Self-test',
			'ph.item': 'e.g. exporting empty data does not throw',
			'col.result': 'Result',
			'col.case': 'Case',
			'ph.case': 'e.g. export 100k rows within the time limit',
			'col.expected': 'Expected',
			'col.at': 'When',
			'ph.at': 'e.g. 2026-10-10 14:00',
			'col.passed': 'Passed',
			'col.failed': 'Failed',
			'col.defect': 'Defect',
			'ph.defect': 'e.g. memory blow-up on large exports',
			'col.severity': 'Severity',
			'col.status': 'Status',
			'col.task': 'Task',
			'col.taskNone': '(no task)',

			'col.point': 'Feature point',
			'ph.point': 'e.g. customer creation form',
			'col.taskNo': 'Task no.',
			'ph.taskNo': 'e.g. T04; leave empty if undecided',
			'col.apiName': 'API',
			'ph.apiName': 'e.g. customer dedup precheck',
			'col.method': 'Method',
			'ph.method': 'GET / POST / PUT / DELETE',
			'col.path': 'API path',
			'ph.path': 'e.g. /api/customer/dedup/check; write “(path TBD)” if undecided',
			'col.change': 'New / changed',
			'ph.change': 'new / changed',
			'col.request': 'Request',
			'ph.request': 'e.g. name, uscc',
			'col.response': 'Response',
			'ph.response': 'e.g. hits[] with similarity',
			'col.route': 'Route',
			'ph.route': 'e.g. /customer/list',
			'col.pageName': 'Page',
			'ph.pageName': 'e.g. customer list page',
			'col.blocks': 'Page blocks',
			'ph.blocks': 'e.g. filters, list, bulk action bar',
			'col.interaction': 'Key interactions',
			'ph.interaction': 'e.g. precheck on blur, grey out when over quota',

			'mine.heading': 'My tasks',
			'mine.summary': '{count} total · {todo} not started · {doing} in progress · {done} done',
			'mine.todo': 'Not started',
			'mine.doing': 'In progress',
			'mine.done': 'Done',
			'mine.empty': 'No task of yours in the design yet. On the Design page, use “Generate from feature points”.',
			'mine.untitled': '(untitled task)',
			'mine.point': 'Feature point',
			'mine.estimate': '{days} person-days',
			'mine.noChange': 'No change linked yet',
			'mine.changes': '{done}/{total} change(s) done',
			// Shared【Run】pieces (the dialog and its buttons): the Develop page's tasks and the
			// Test page's cases use the same ones — only the instruction and the two notes differ.
			'exec.run': 'Run',
			'exec.edit': 'Instruction to send (edit it before sending if you like)',
			'exec.manual': 'The conversation channel is unavailable, so this cannot be sent — copy the instruction into the conversation instead.',
			'exec.send': 'Send to conversation',
			'exec.sending': 'Sending…',
			'exec.sent': 'The instruction was sent to the conversation. This page refreshes itself once the AI finishes.',
			'exec.failed': 'Send failed: {reason}',
			'exec.reset': 'Reset instruction',
			'exec.close': 'Cancel',
			'mine.execTitle': 'Run task: {name}',
			'mine.execNote': 'After you press “Send to conversation”, the AI reads this person’s design and implements this one task; the page refreshes itself when it finishes.',
			'mine.execWrites': 'The AI appends every change to the change list below and adds self-test items. **Ticking them off is yours to do** — so new rows always arrive unticked.',
			'case.execTitle': 'Run case: {name}',
			'case.execNote': 'After you press “Send to conversation”, the AI reads the design plus this round’s changes and runs this one case (this stage only does simple interface tests).',
			'case.execWrites': 'The AI sets this row’s result to pass / fail and says what it actually checked; it appends a run record and, on failure, a defect. **If it cannot run the case it says so and leaves the result pending** — it will not invent a pass for you.',
			'stage.rowNo': 'Row {no}',
			'mine.groupTodo': 'Not started yet',
			'mine.groupGap': 'These feature points have no task at all',
			'mine.groupCount': '{count}',
			'mine.groupHint': 'Add them on the Design page.',
			'mine.noGaps': 'Every feature point assigned to you has a task.',
			'mine.readonly': 'Tasks are maintained on the Design page',
			'mine.hint': 'Link each row in the change list below to a task and this block follows along.',
			'mine.untagged': '{count} change row(s) are still unlinked.',
			'opt.pending': 'Not done',
			'opt.pass': 'Pass',
			'opt.fail': 'Fail',
			'opt.low': 'Low',
			'opt.medium': 'Medium',
			'opt.high': 'High',
			'opt.critical': 'Critical',
			'opt.open': 'Open',
			'opt.fixing': 'Fixing',
			'opt.fixed': 'Fixed',
			'opt.closed': 'Closed',
			'field.version': 'Version',
			'ph.version': 'e.g. 1.2.0',
			'field.releasedAt': 'Release date',

			'stage.add': 'Add row',
			'stage.remove': 'Remove',
			'stage.rows': '{count} row(s)',
			'stage.empty': 'Nothing here yet. Have the AI draft it, or add rows yourself.',
			'stage.save': 'Save',
			'stage.saving': 'Saving…',
			'stage.saved': 'Saved',
			'stage.ai': 'Have the AI write this stage',
			'stage.aiRedo': 'Have the AI rewrite this stage',
			'stage.aiWorking': 'Handing over to the AI…',
			'stage.aiSent': 'The instruction was sent to the conversation. This page refreshes itself once the AI finishes.',
			'stage.sharedHint': 'Release is a shared pipeline — anyone can edit it.',
			'stage.done.develop': 'This stage counts as approved once every change is ticked and every self-test passes.',
			'stage.done.test': 'This stage counts as approved once every case passes and no defect is left open.',
			'stage.done.release': 'This stage counts as approved once a version and release notes are filled in.',
			'stage.ownerHint': 'This stage is per person: only its owner can edit it, everyone else opens it read-only.',

			'impact.modules': 'Affected modules / files',
			'impact.modulesPlaceholder': 'One per line, e.g. src/customer/export.ts',
			'impact.risk': 'Risk level',
			'impact.riskLow': 'Low',
			'impact.riskMedium': 'Medium',
			'impact.riskHigh': 'High',
			'impact.rollback': 'Rollback plan',
			'impact.rollbackPlaceholder': 'How to back out if it goes wrong…',
			'impact.dependencies': 'Dependencies',
			'impact.dependenciesPlaceholder': 'Who must help; what must land first…',
			'impact.save': 'Save impact',
			'impact.saving': 'Saving…',
			'impact.saved': 'Saved',

			'task.total': '{count} task(s) · {days} person-days · {done} done',
			'task.seed': 'Generate from feature points',
			'task.seedHint': '{count} feature point(s) assigned to “{name}”; already-generated ones are not duplicated.',
			'task.add': 'Add task',
			'task.save': 'Save tasks',
			'task.saving': 'Saving…',
			'task.saved': 'Saved',
			'task.noPoints': 'No feature point is assigned to you on this requirement — register one on the Requirement page first.',
			'task.empty': 'No task yet. Generate them from feature points, or add one by hand.',
			'task.titlePlaceholder': 'What needs doing',
			'task.manual': 'Manual task',
			'task.point': 'Feature point',
			'task.orphan': 'Source feature point was deleted',
			'task.estimate': 'Days',
			'task.doneTag': 'Done',
			'task.remove': 'Remove',
			'menu.develop.changes': 'Change list',
			'menu.develop.commits': 'Commit log',
			'menu.develop.selfTest': 'Self test',
			'menu.test.cases': 'Test cases',
			'menu.test.runs': 'Run results',
			'menu.test.defects': 'Defects',
			'menu.release.changelog': 'Changelog',
			'menu.release.version': 'Version',
			'menu.release.notes': 'Release notes',
		};

		const STATUS_KEY = { pending: 'status.pending', active: 'status.active', approved: 'status.approved' };
		/**
		 * 枚举值与文案键的映射。
		 *
		 * 刻意**不拼接**键名（把 `opt.` 和值接起来那种写法）：拼接出来的键在源码里
		 * 不是一个字面量，[14] 的文案键自检只会看到一个不存在的 `opt.`，
		 * 而真正要断言的十一个键它一个都看不到。写成表之后，自检可以逐个查这些键
		 * 在 zh / en 里都在 —— 动态键也有牙。
		 */
		const OPTION_KEY = {
			pending: 'opt.pending', pass: 'opt.pass', fail: 'opt.fail',
			low: 'opt.low', medium: 'opt.medium', high: 'opt.high', critical: 'opt.critical',
			open: 'opt.open', fixing: 'opt.fixing', fixed: 'opt.fixed', closed: 'opt.closed',
		};
		/** 阶段 → 它的完成条件说明（同样是显式表，理由同上）。 */
		const STAGE_DONE_KEY = { develop: 'stage.done.develop', test: 'stage.done.test', release: 'stage.done.release' };
		const OPEN_STATE_KEY = {
			cold: 'panel.state.cold',
			loading: 'panel.state.loading',
			open: 'panel.state.open',
			error: 'panel.state.error',
		};

		/** 阶段定义；`dir` 与宿主半边 STAGE_DIRS 里的目录名一一对应。 */
		const STAGES = [
			{ id: 'requirement', dir: '需求', labelKey: 'stage.requirement', menus: ['menu.requirement.intake', 'menu.requirement.clarify', 'menu.requirement.accept'] },
			{ id: 'design', dir: '方案', labelKey: 'stage.design', menus: ['menu.design.draft', 'menu.design.impact', 'menu.design.breakdown'] },
			{ id: 'develop', dir: '开发', labelKey: 'stage.develop', menus: ['menu.develop.changes', 'menu.develop.commits', 'menu.develop.selfTest'] },
			{ id: 'test', dir: '测试', labelKey: 'stage.test', menus: ['menu.test.cases', 'menu.test.runs', 'menu.test.defects'] },
			{ id: 'release', dir: '提版', labelKey: 'stage.release', menus: ['menu.release.changelog', 'menu.release.version', 'menu.release.notes'] },
		];

		/** 管线目录名，与宿主半边的 PIPELINE_DIR 一致。 */
		const PIPELINE_DIR = 'Pipeline';

		/** 共享元数据文件名，与宿主半边的 REQUIREMENT_FILE 一致（自检里有断言比对两侧）。 */
		const REQUIREMENT_FILE = 'requirement.json';

		/** 需求编号格式，与宿主半边保持一致。 */
		const ID_PATTERN = /^XQ\d{8}-\d{4}$/;

		/** 公共管线：需求与提版，所有人共享。 */
		const SHARED_STAGE_IDS = ['requirement', 'release'];
		/** 按人分开的管线：方案 / 开发 / 测试，每个开发人员各一条。 */
		const PER_DEVELOPER_STAGE_IDS = ['design', 'develop', 'test'];

		// ────────────────────────────────────────────────────────────────────
		// 2. 样式（只用主题真实定义的 --dsw-alias-* token）
		// ────────────────────────────────────────────────────────────────────
		const CSS = [
			'.wcw-root{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);padding-bottom:calc(var(--dsh-composer-height,152px) + 8px)}',
			'.wcw-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:14px 18px 22px}',

			'.wcw-req{display:flex;flex-direction:column;gap:9px;box-sizing:border-box;padding:11px 13px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base)}',
			'.wcw-reqTop{display:flex;align-items:center;gap:11px}',
			'.wcw-reqMark{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1}',
			'.wcw-reqText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
			'.wcw-reqTitle{margin:0;font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wcw-reqMeta{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wcw-reqAction{flex:none;padding:6px 13px;border:.5px solid var(--dsw-alias-border-l3);border-radius:9px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;cursor:pointer}',
			'.wcw-reqAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.wcw-reqAction:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',

			'.wcw-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
			'.wcw-chip{display:inline-flex;align-items:center;gap:6px;max-width:300px;padding:5px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;cursor:pointer}',
			'.wcw-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.wcw-chip[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}',
			'.wcw-chipId{color:var(--dsw-alias-label-tertiary);font-size:11px}',
			'.wcw-chipText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wcw-chipNew{border-style:dashed}',
			'.wcw-chipsLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',

			'.wcw-pipe{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px}',
			'.wcw-stage{display:flex;align-items:center;gap:9px;box-sizing:border-box;min-width:0;padding:9px 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);text-align:left;cursor:pointer}',
			'.wcw-stage:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.wcw-stage:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
			'.wcw-stage[aria-selected=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-stageBadge{display:flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;border-radius:50%;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;font-weight:600}',
			'.wcw-stageBadge[data-status=approved]{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-foreground)}',
			'.wcw-stageBadge[data-status=active]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}',
			'.wcw-stageText{display:flex;flex-direction:column;gap:1px;min-width:0}',
			'.wcw-stageName{font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wcw-stageStatus{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
			'.wcw-stageStatus[data-status=approved]{color:var(--dsw-alias-state-success-primary)}',
			'.wcw-stageStatus[data-status=active]{color:var(--dsw-alias-state-business-primary)}',

			'.wcw-section{display:flex;flex-direction:column;gap:9px;box-sizing:border-box;padding:11px 13px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base)}',
			'.wcw-sectionHead{display:flex;flex-wrap:wrap;align-items:center;gap:9px}',
			'.wcw-sectionTitle{margin:0;font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.wcw-pill{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}',
			'.wcw-pill[data-status=approved]{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}',
			'.wcw-pill[data-status=active]{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}',
			'.wcw-empty{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}',

			'.wcw-btn{padding:6px 13px;border:.5px solid var(--dsw-alias-border-l3);border-radius:9px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;cursor:pointer}',
			'.wcw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.wcw-btn:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
			'.wcw-btnPrimary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
			// 不可逆操作（删除需求）用错误色：它不是"另一种主按钮"，是一步走错就没法回头的那种。
			'.wcw-btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
			'.wcw-btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.wcw-btnRow{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}',
			'.wcw-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',

			'.wcw-field{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}',
			'.wcw-fieldNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.wcw-input,.wcw-textarea{box-sizing:border-box;width:100%;padding:6px 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px}',
			'.wcw-input:focus,.wcw-textarea:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
			'.wcw-textarea{min-height:52px;resize:vertical}',
			'.wcw-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
			'.wcw-ok{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}',

			'.wcw-docList{display:flex;flex-direction:column;gap:5px}',
			'.wcw-docRow{display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:7px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:17px}',			// 选中的那一版靠**边框高亮**表达，不挂「当前版」标签：一眼能看出来的状态
			// 不需要额外解释，多一个标签反而让人以为"当前版"是个有语义的角色。
			'.wcw-docRowActive{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}',
			// 一行的三列要**定宽**，否则文件名长短不同时中间那列会左右漂：
			// 「文件名」这一列封顶（长了省略号），「字数 · 时间 · AI 分析」这一列从固定位置起
			// 左对齐、不换行 —— 这样每行的元信息都在同一条竖线上，扫一眼就能纵向比较。
			// 用 flex:1 让文件名吃掉剩余宽度是最省事的写法，但那正是它漂移的原因。
			//
			// 关键在 `width` + `flex:none`，不是 `max-width` + `flex:0 1 auto`：
			// 后者在空间紧张时**先压文件名列**（它 min-width:0，可以被压到很小），而元信息列有
			// 300px 下限压不动 —— 结果是两行的文件名列宽度不同，元信息列的起点又对不齐了。
			// 定宽之后，起点是算出来的常数，跟文件名长短、跟窗口宽度都无关。
			//
			// 元信息列的宽度按**最长可能内容**留（"9286 字 · 2026-09-18 23:41 · AI 分析" + 可能追加的
			// "· 已从分析里补进 3 个功能点"）：给窄了它会换行，行高一变，纵向对齐就又没了。
			'.wcw-docName{min-width:0;flex:none;width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
			'.wcw-docMeta{flex:none;width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;text-align:left}',
			// 版本行里这一列**居中**（用户要的是"信息居中"）—— 定宽列内居中，两行的文字块
			// 因此都以同一条中线为轴，比左对齐更像"一整块信息"。
			// 必须限定在 `.wcw-docRow` 之内：`.wcw-docMeta` 是全局类，功能点区的说明、
			// 对比统计那些段落也用它，那些地方居中会变得很难读。
			'.wcw-docRow .wcw-docMeta{text-align:center}',
			'.wcw-pre{margin:0;max-height:340px;overflow:auto;padding:9px 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-size:12px;line-height:19px;white-space:pre-wrap;word-break:break-word}',

			// 「我的任务」下方的汇总：一组名字 = 一个组头（叫什么 + 几个）+ 成组的名字标签。
			// 限高滚动是刻意的 —— 33 个任务名铺开会把下面的产物区整块顶出屏幕，
			// 而"汇总"的用处恰恰是不占地方就能看全。
			'.wcw-taskGroups{display:flex;flex-direction:column;gap:7px}',
			'.wcw-taskGroup{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}',
			// 缺口（分派给我、却一个任务都没有的功能点）用错误色：它和「还没开工」不是一个量级的事。
			'.wcw-taskGroup[data-tone=gap]{border-color:var(--dsw-alias-state-error-primary)}',
			'.wcw-taskGroupHead{display:flex;align-items:center;gap:7px}',
			'.wcw-taskGroupLabel{font-size:12px;line-height:17px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
			'.wcw-taskGroup[data-tone=gap] .wcw-taskGroupLabel{color:var(--dsw-alias-state-error-primary)}',
			'.wcw-taskGroupTags{display:flex;flex-wrap:wrap;gap:5px;max-height:104px;overflow:auto}',
			'.wcw-taskTag{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}',
			// 执行指令的编辑框：指令是一段有换行的长文，给足高度才看得出结构。
			'.wcw-execPrompt{min-height:220px;max-height:46vh;overflow:auto;font-size:12px;line-height:19px}',
			'.wcw-diffLine{display:block}',
			'.wcw-diffAdded{color:var(--dsw-alias-state-success-primary)}',
			'.wcw-diffRemoved{color:var(--dsw-alias-state-error-primary)}',
			'.wcw-diffSame{color:var(--dsw-alias-label-tertiary)}',

			// 需求文档区：默认显示 AI 分析，原文退到「查看原文」后面。
			'.wcw-analysisBody{display:flex;flex-direction:column;gap:6px}',
			'.wcw-analysisText{max-height:420px}',
			// 「与上一版差异」是 AI 逐条比过的结论，视觉上要压过下面的行级 diff 一眼。
			'.wcw-analysisDiff{max-height:420px;border-color:var(--dsw-alias-state-business-primary)}',
			'.wcw-analysisWait{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}',
			'.wcw-analysisHead{margin:0;font-size:12px;line-height:17px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.wcw-analysisManual{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
			'.wcw-analysisManual summary{cursor:pointer}',
			'.wcw-compare{display:flex;flex-direction:column;gap:7px}',
			// 差异异常提示：用状态色而不是普通提示的灰 —— 它是「你可能传错文件了」，
			// 混在一堆灰色小字里就等于没提示。
			'.wcw-suspicious{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-suspiciousTitle{margin:0;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px;font-weight:600}',
			'.wcw-suspiciousBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',

			'.wcw-qa{display:flex;flex-direction:column;gap:8px}',
			'.wcw-qaRow{display:flex;flex-direction:column;gap:6px;padding:9px 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-qaHead{display:flex;align-items:center;gap:8px}',
			'.wcw-qaIndex{color:var(--dsw-alias-label-tertiary);font-size:11px}',
			'.wcw-qaSpacer{flex:1}',

			'.wcw-menuGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:8px}',
			'.wcw-menu{display:flex;align-items:center;justify-content:space-between;gap:8px;box-sizing:border-box;padding:9px 11px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:16px;text-align:left;cursor:not-allowed}',
			'.wcw-menuLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wcw-menuState{flex:none;color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:16px}',

			'.wcw-chipTag{padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}',
			'.wcw-chipArchived{opacity:.72}',
			'.wcw-chip:disabled{opacity:.45;cursor:default}',
			'.wcw-chipMenu{display:flex;flex-wrap:wrap;align-items:center;gap:8px;box-sizing:border-box;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-chipMenuTitle{font-size:12px;line-height:17px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			// 删除的二次确认：整条菜单换成这一屏，边框用错误色提醒"这一步不可逆"。
			// 竖排（而不是沿用菜单那一行的横排）：警告文案要完整读得完，不该被按钮挤成一条。
			'.wcw-chipMenuDanger{border-color:var(--dsw-alias-state-error-primary);flex-direction:column;align-items:stretch}',
			'.wcw-confirmText{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
			'.wcw-confirmAsk{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;font-weight:600}',
			'.wcw-chipMenuDanger .wcw-btnRow{justify-content:flex-end}',

			'.wcw-countdowns{display:flex;flex-wrap:wrap;gap:6px}',
			'.wcw-countdown{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-countdownLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.wcw-countdownValue{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:600}',
			'.wcw-countdown[data-state=remaining] .wcw-countdownValue{color:var(--dsw-alias-state-business-primary)}',
			'.wcw-countdown[data-state=today] .wcw-countdownValue{color:var(--dsw-alias-state-warn-primary)}',
			'.wcw-countdown[data-state=overdue] .wcw-countdownValue{color:var(--dsw-alias-state-error-primary)}',

			'.wcw-bell{position:relative;flex:none}',
			'.wcw-bellButton{display:inline-flex;align-items:center;justify-content:center;width:30px;height:28px;border:.5px solid var(--dsw-alias-border-l3);border-radius:9px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);cursor:pointer}',
			'.wcw-bellButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.wcw-bellButton[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
			'.wcw-bellBadge{position:absolute;top:-4px;right:-4px;min-width:15px;height:15px;padding:0 3px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);font-size:10px;line-height:15px;text-align:center;font-weight:600}',
			'.wcw-bellPanel{position:absolute;top:calc(100% + 6px);right:0;z-index:20;width:min(420px,80vw);box-sizing:border-box;padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-prominent)}',
			'.wcw-bellRow{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-bellRowTitle{font-size:12px;line-height:17px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.wcw-bellHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',

			'.wcw-overdue{display:flex;flex-wrap:wrap;align-items:center;gap:9px;box-sizing:border-box;padding:8px 11px;border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-overdueText{min-width:0;flex:1;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',

			'.wcw-hist{position:relative;flex:none}',
			'.wcw-histButton{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border:.5px solid var(--dsw-alias-border-l3);border-radius:9px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;cursor:pointer}',
			'.wcw-histButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.wcw-histButton[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
			'.wcw-histCaret{font-size:9px;line-height:1}',
			'.wcw-histPanel{position:absolute;top:calc(100% + 6px);right:0;z-index:20;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:min(420px,84vw);padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-prominent)}',
			'.wcw-histSearch{box-sizing:border-box;width:100%;padding:6px 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px}',
			'.wcw-histList{display:flex;flex-direction:column;gap:5px;max-height:320px;overflow:auto}',
			'.wcw-histRow{display:flex;flex-direction:column;gap:6px;padding:7px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-histRowHead{display:flex;align-items:center;gap:8px}',
			'.wcw-histTitle{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary)}',
			'.wcw-histArrow{flex:none;padding:2px 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;cursor:pointer}',
			'.wcw-histArrow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',

			'.wcw-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-2)}',
			'.wcw-modalPanel{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:min(780px,94vw);max-height:88vh;overflow:auto;padding:16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-prominent)}',
			'.wcw-modalHead{display:flex;align-items:center;gap:10px}',
			'.wcw-modalTitle{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.wcw-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:0}',
			'.wcw-kvRow{display:flex;flex-direction:column;gap:2px;padding:7px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}',
			'.wcw-kvKey{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.wcw-kvValue{margin:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px}',

			'.wcw-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px}',
			'.wcw-tag{display:inline-flex;align-items:center;gap:6px;padding:3px 6px 3px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px}',
			'.wcw-tagRemove{padding:0 2px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;cursor:pointer}',
			'.wcw-tagRemove:hover{color:var(--dsw-alias-state-error-primary)}',
			'.wcw-points{display:flex;flex-direction:column;gap:6px}',
			'.wcw-point{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}',
			// 功能点树：分块 = 第一级，功能点 = 叶子。
			// 缩进只用来表达层级，不做花哨的连线 —— 上百个叶子节点上，连线是噪声不是信息。
			'.wcw-groupTree{display:flex;flex-direction:column;gap:9px}',
			'.wcw-group{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base)}',
			// 未归类的点：树根下的散条。没有「未分组」块头，但必须看得见 ——
			// 界面上看不见和不存在，对用户是同一件事。
			'.wcw-loosePoints{padding:2px 0}',
			'.wcw-groupHead{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
			'.wcw-groupToggle{padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:19px;font-weight:600;text-align:left;cursor:pointer}',
			'.wcw-groupBody{display:flex;flex-direction:column;gap:6px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2)}',
			'.wcw-pointLeaf{background:var(--dsw-alias-bg-layer-2)}',
			// 行内新建/改名分块的输入组：紧跟在触发它的下拉后面，不弹窗。
			'.wcw-newGroup{display:inline-flex;align-items:center;gap:6px}',
			'.wcw-select{box-sizing:border-box;padding:6px 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px}',
			'.wcw-pipeBar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}',
			'.wcw-pipeTag{padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}',
			'.wcw-mePrompt{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;font-weight:500}',
			'.wcw-meInput{padding:8px 11px;font-size:13px;line-height:20px}',

			'.wcw-designEditor{min-height:240px;font-size:12px;line-height:19px}',
			'.wcw-taskNum{flex:none;max-width:96px}',
			'.wcw-check{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;cursor:pointer}',
		].join('\n');

		// ────────────────────────────────────────────────────────────────────
		// 3. 宿主通道（RPC）
		//
		// 浏览器读不到磁盘。所有文件操作走宿主半边的 POST /api/rpc/workbench ——
		// 该路由挂在 /api 之下，自动继承 Host/Origin 围栏与浏览器登录态，
		// 所以这里只发同源 fetch，不带任何凭证。
		// ────────────────────────────────────────────────────────────────────
		const RPC_PATH = '/api/rpc/workbench';
		const RPC_METHOD = 'rpc/workbench';
		let seq = 0;

		/**
		 * 读取结果的小缓存：**活在插件作用域里，组件卸载不会丢**。
		 *
		 * 为什么非要它：切换页签会把组件**卸载掉**，再打开就是一次全新的挂载 ——
		 * 「刷新时保留上一份数据」那条规则救不了这种情况（状态已经随卸载没了），
		 * 于是每切一次都要重新走一遍「读取中…」。这正是「反复打开每个页块都慢」的原因。
		 *
		 * 边界：这是**本机视图状态**，永远不落盘、不进仓库，所以不违反存储规范
		 * （第 3 节要求「换个人打开就该不一样」的东西不能进共享树 —— 它连树都不进）。
		 * 任何**写操作**都会清空它：宁可多读一次，也不要拿旧内容骗人。
		 */
		const READ_CACHE_MAX = 80;

		/** 造一个带上限的读取缓存。抽成工厂是为了能断言淘汰顺序，而不是只有一个全局 Map。 */
		function createReadCache(max) {
			const store = new Map();
			return {
				get(key) {
					return key === undefined ? undefined : store.get(key);
				},
				set(key, value) {
					if (key === undefined) return;
					// 先删再插 = 移到队尾，于是淘汰顺序就是「最久没用过的先走」。
					if (store.has(key)) store.delete(key);
					store.set(key, value);
					while (store.size > max) store.delete(store.keys().next().value);
				},
				clear() {
					store.clear();
				},
				get size() {
					return store.size;
				},
			};
		}

		const readCache = createReadCache(READ_CACHE_MAX);

		/** 会改磁盘的 op —— 跑完就把读取缓存清掉。 */
		const WRITE_OPS = [
			'writeText', 'writeBinary', 'writeRequirement', 'createRequirement',
			'archiveRequirement', 'restoreRequirement', 'ensureLayout', 'writeTemplate',
			'raiseNotice', 'markNoticeRead', 'clearNotice', 'writeIdentity',
		];

		/**
		 * 碰**工作区**的 op —— 每一个都必须带 `sessionId`。
		 *
		 * 为什么这条如此要紧：工作台根目录是按**会话的 cwd** 解析的
		 * （`ctx.sessions.get(sessionId).header.cwd`），而**不带 sessionId 时会回落到
		 * `sandboxPolicy.workspaceRoot` —— 那是另一个目录**。
		 *
		 * 早期版本靠每个调用点自己记得传，结果 30 多处里漏了一大半。漏掉的那些会读写到
		 * 另一个根目录，于是「新建需求」和「添加开发人员」落在**两个不同的工作区**：
		 * 需求建出来了，紧接着报 `requirement.json not found`。
		 * 在开发机上这两个路径恰好相同，所以一路没暴露 —— 到了别人的机器上才现形。
		 *
		 * 现在改成在 {@link callWorkbench} 里**统一补**，并在这里分类，客户端不再依赖
		 * 调用点的自觉。（与身份 / 通知那些"本机状态"op 无关：它们落在 `$DSH_HOME`，
		 * 本来就不看工作区。）
		 */
		const WORKSPACE_OPS = [
			// ping 也读工作区（它回报 workbenchRoot），所以同样需要 sessionId ——
			// 否则它报的是"没有会话时的回落值"，与页面实际读写的目录可能不是一个。
			'ping',
			'readText', 'writeText', 'writeBinary', 'listDir', 'remove',
			'readRequirement', 'writeRequirement', 'createRequirement', 'listRequirements',
			'nextRequirementId', 'archiveRequirement', 'restoreRequirement', 'deleteRequirement', 'ensureLayout',
			// 模板也落在工作区根下（`templates/<阶段>/`），所以同样必须带 sessionId。
			'readTemplate', 'writeTemplate',
		];

		/**
		 * 当前正在渲染的工作台页签属于哪个会话。
		 *
		 * 由 {@link WorkbenchView} 在**渲染期**登记（父组件先渲染，所以子组件发起请求时
		 * 它一定已经就位）。渲染期赋值确实不算纯，但它换来的是：**这个值不可能漏传** ——
		 * 而漏传的后果是把数据读写到另一个目录，且不报任何错。
		 */
		let activeSessionId = '';

		/** 生成请求关联 id。 */
		function nextRpcId() {
			seq += 1;
			return 'wc-' + Date.now().toString(36) + '-' + seq;
		}

		/**
		 * 调用一个工作台操作。
		 * @param {string} op @param {Record<string, unknown>} [payload]
		 * @returns {Promise<any>}
		 */
		async function callWorkbench(op, payload) {
			const body = {
				type: 'client-request',
				rpcId: nextRpcId(),
				method: RPC_METHOD,
				payload: Object.assign({ op }, payload),
			};
			// ★ 碰工作区的 op 一律补上 sessionId。
			//   不补的后果是回落到另一个根目录 —— 读写落在别处，而且**不报任何错**。
			//   万一当前没有会话上下文，就**直接抛**：用错误的根目录静默读写比报错糟糕得多。
			if (WORKSPACE_OPS.includes(op)) {
				const given = body.payload.sessionId;
				if (given === undefined || given === null || given === '') {
					if (activeSessionId === '') {
						throw new Error('工作台还没有会话上下文，' + op + ' 需要一个 sessionId');
					}
					body.payload.sessionId = activeSessionId;
				}
			}
			let response;
			try {
				response = await fetch(RPC_PATH, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				});
			} catch (error) {
				throw new Error('无法连接宿主通道：' + (error && error.message ? error.message : error));
			}
			if (!response.ok) throw new Error('宿主通道返回 HTTP ' + response.status);
			const envelope = await response.json();
			const result = envelope && envelope.result;
			if (!result || result.ok !== true) {
				const detail = result && result.error ? result.error : undefined;
				throw new Error(detail ? detail.code + ': ' + detail.message : '宿主通道返回了异常结果');
			}
			// 写过盘了：之前读到的都可能已经过时，整个清掉。
			if (WRITE_OPS.includes(op)) readCache.clear();
			return result.value;
		}

		// ────────────────────────────────────────────────────────────────────
		// 4. .docx 解析
		//
		// .docx 是 ZIP，核心在 word/document.xml。零依赖路线：自己读 ZIP 中央目录，
		// 用平台 DecompressionStream('deflate-raw') 解压，再用 DOMParser 走
		// WordprocessingML 取文本。
		//
		// 真实存在的坑：**局部头的 extra field 长度可能与中央目录里的不同**，
		// 所以取数据前必须读局部头自己的 nameLen/extraLen，不能复用中央目录的值。
		// ────────────────────────────────────────────────────────────────────

		function u16(bytes, at) { return bytes[at] | (bytes[at + 1] << 8); }
		function u32(bytes, at) {
			return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
		}

		/** 从后往前找 4 字节签名。 */
		function findSignature(bytes, signature, from, to) {
			for (let at = to - 4; at >= from; at -= 1) if (u32(bytes, at) === signature) return at;
			return -1;
		}

		/** 列出 ZIP 条目（读中央目录）。 */
		function readZipEntries(bytes) {
			const eocd = findSignature(bytes, 0x06054b50, Math.max(0, bytes.length - 65558), bytes.length);
			if (eocd === -1) throw new Error('不是有效的 ZIP（没有找到 EOCD）');

			const count = u16(bytes, eocd + 10);
			let at = u32(bytes, eocd + 16);
			const decoder = new TextDecoder('utf-8');
			const entries = [];

			for (let index = 0; index < count; index += 1) {
				if (u32(bytes, at) !== 0x02014b50) break;
				const nameLength = u16(bytes, at + 28);
				const extraLength = u16(bytes, at + 30);
				const commentLength = u16(bytes, at + 32);
				entries.push({
					name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
					method: u16(bytes, at + 10),
					compressedSize: u32(bytes, at + 20),
					size: u32(bytes, at + 24),
					localOffset: u32(bytes, at + 42),
				});
				at += 46 + nameLength + extraLength + commentLength;
			}
			return entries;
		}

		/** 取条目的压缩数据（长度以局部头为准）。 */
		function readZipEntryData(bytes, entry) {
			const at = entry.localOffset;
			if (u32(bytes, at) !== 0x04034b50) throw new Error('ZIP 局部头签名不对');
			const nameLength = u16(bytes, at + 26);
			const extraLength = u16(bytes, at + 28);
			const start = at + 30 + nameLength + extraLength;
			const length = entry.compressedSize !== 0 ? entry.compressedSize : entry.size;
			return bytes.subarray(start, start + length);
		}

		/** deflate-raw 解压（浏览器原生）。 */
		async function inflateRaw(data) {
			if (typeof DecompressionStream !== 'function') throw new Error('UNSUPPORTED');
			const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
			return new Uint8Array(await new Response(stream).arrayBuffer());
		}

		/**
		 * 从 WordprocessingML 抽正文。
		 *
		 * 用 DOMParser 而不是正则：段落/表格/制表位/软换行的嵌套用正则会很难写对。
		 * 丢弃 `w:instrText`（域代码）与 `w:delText`（修订删除文本）；`</w:p>` 换行，
		 * `w:tab` 制表，`w:br`/`w:cr` 换行，`w:tc` 后制表、`w:tr` 后换行。
		 */
		function wordXmlToText(xml) {
			const doc = new DOMParser().parseFromString(xml, 'application/xml');
			if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('document.xml 解析失败');

			const out = [];
			function walk(node) {
				for (let child = node.firstChild; child !== null; child = child.nextSibling) {
					if (child.nodeType === 3) { out.push(child.nodeValue); continue; }
					if (child.nodeType !== 1) continue;
					const name = child.localName;
					if (name === 'instrText' || name === 'delText') continue;
					if (name === 'tab') { out.push('\t'); continue; }
					if (name === 'br' || name === 'cr') { out.push('\n'); continue; }
					walk(child);
					if (name === 'p') out.push('\n');
					else if (name === 'tc') out.push('\t');
					else if (name === 'tr') out.push('\n');
				}
			}
			walk(doc.documentElement);

			return out.join('')
				.replace(/\r\n?/g, '\n')
				.replace(/[ \t]+\n/g, '\n')
				.replace(/[ \t]{2,}/g, ' ')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
		}

		/** 解析 .docx 文件为正文文本。 */
		async function parseDocx(file) {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const target = readZipEntries(bytes).find((entry) => entry.name === 'word/document.xml');
			if (target === undefined) throw new Error('NOT_DOCX');

			const raw = readZipEntryData(bytes, target);
			if (target.method === 0) return wordXmlToText(new TextDecoder('utf-8').decode(raw));
			if (target.method !== 8) throw new Error('不支持的 ZIP 压缩方式 ' + target.method);

			let inflated;
			try {
				inflated = await inflateRaw(raw);
			} catch (error) {
				if (error && error.message === 'UNSUPPORTED') throw error;
				throw new Error('解压失败：' + (error && error.message ? error.message : error));
			}
			return wordXmlToText(new TextDecoder('utf-8').decode(inflated));
		}

		// ────────────────────────────────────────────────────────────────────
		// 5. 行级 diff（需求文档版本对比；方案对比会复用）
		// ────────────────────────────────────────────────────────────────────

		/**
		 * 行级 LCS diff。行数过多时退化为简单增删对照，避免卡死浏览器。
		 * @returns {{ kind: 'same'|'add'|'remove', text: string }[]}
		 */
		function diffLines(before, after) {
			const left = before === '' ? [] : before.split('\n');
			const right = after === '' ? [] : after.split('\n');
			const MAX = 1200;

			if (left.length > MAX || right.length > MAX) {
				return left.map((text) => ({ kind: 'remove', text }))
					.concat(right.map((text) => ({ kind: 'add', text })));
			}

			const cols = right.length + 1;
			const lcs = new Array((left.length + 1) * cols).fill(0);
			const at = (row, col) => row * cols + col;

			for (let row = left.length - 1; row >= 0; row -= 1) {
				for (let col = right.length - 1; col >= 0; col -= 1) {
					lcs[at(row, col)] = left[row] === right[col]
						? lcs[at(row + 1, col + 1)] + 1
						: Math.max(lcs[at(row + 1, col)], lcs[at(row, col + 1)]);
				}
			}

			const out = [];
			let row = 0;
			let col = 0;
			while (row < left.length && col < right.length) {
				if (left[row] === right[col]) { out.push({ kind: 'same', text: left[row] }); row += 1; col += 1; continue; }
				if (lcs[at(row + 1, col)] >= lcs[at(row, col + 1)]) { out.push({ kind: 'remove', text: left[row] }); row += 1; continue; }
				out.push({ kind: 'add', text: right[col] }); col += 1;
			}
			while (row < left.length) { out.push({ kind: 'remove', text: left[row] }); row += 1; }
			while (col < right.length) { out.push({ kind: 'add', text: right[col] }); col += 1; }
			return out;
		}

		/** 统计 diff 的增删行数。 */
		function diffStats(lines) {
			let added = 0;
			let removed = 0;
			for (const line of lines) {
				if (line.kind === 'add') added += 1;
				else if (line.kind === 'remove') removed += 1;
			}
			return { added, removed };
		}

		// ────────────────────────────────────────────────────────────────────
		// 6. 小工具
		// ────────────────────────────────────────────────────────────────────

		/** `session-60386e79-...` → `60386e79`。 */
		function shortSessionId(sessionId) {
			const raw = String(sessionId === undefined || sessionId === null ? '' : sessionId);
			const tail = raw.indexOf('-') === -1 ? raw : raw.slice(raw.indexOf('-') + 1);
			return tail.slice(0, 8) || raw.slice(0, 8);
		}

		/** 本地化时间。 */
		function formatTime(iso) {
			if (typeof iso !== 'string' || iso === '') return '';
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			const pad = (value) => String(value).padStart(2, '0');
			return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
				+ ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
		}

		/** 本地唯一 id。 */
		function newId() {
			if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
			seq += 1;
			return 'id-' + Date.now().toString(36) + '-' + seq;
		}

		/** File → base64（去掉 data URL 前缀）。 */
		function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => { reject(new Error('读取文件失败')); };
				reader.onload = () => {
					const result = String(reader.result);
					const comma = result.indexOf(',');
					resolve(comma === -1 ? result : result.slice(comma + 1));
				};
				reader.readAsDataURL(file);
			});
		}

		/** v1.0 → v1.1；无法识别时回落到 v1.0。 */
		function nextVersion(previous) {
			if (typeof previous !== 'string') return 'v1.0';
			const match = /^v(\d+)\.(\d+)$/.exec(previous.trim());
			if (match === null) return 'v1.0';
			return 'v' + match[1] + '.' + (Number.parseInt(match[2], 10) + 1);
		}

		/** 版本号 → 安全文件名。 */
		function versionSlug(version) {
			return String(version).replace(/[^A-Za-z0-9._-]/g, '_');
		}

		/**
		 * 路径拼接。
		 *
		 * 只处理 `/`：ASCII 的 `/` 与 Unicode 的 `／` 都认（需求文件夹名是中文，
		 * 路径里的每一步都在这里拼，不该指望调用方永远只用一种斜杠）。
		 * 插件只 require 得到 `react`，没有 `node:path`，所以这一步自己写 —— 三行的事。
		 */
		function joinPath(...parts) {
			const pieces = [];
			for (const part of parts) {
				if (typeof part !== 'string' || part === '') continue;
				pieces.push(part.replace(/^\/+|\/+$/g, ''));
			}
			return pieces.join('/');
		}

		/**
		 * 一个文档版本的分析结果落在哪。
		 *
		 * 规则：**一版一份**，与 `parsed/<slug>.txt` 一一对应。这样三件事同时成立：
		 *   - 路径可以从版本号算出来，不需要任何索引文件（见 docs/storage-format.md 第 5 节）；
		 *   - 换了文档就换文件，旧分析不会冒充新文档的结论；
		 *   - 界面上「这一版分析过没有」=「这个文件在不在」。
		 *
		 * 与 `versionSlug` 一样只允许 `[A-Za-z0-9._-]`（版本号本身已经被它洗干净了）。
		 */
		function requirementAnalysisPath(version) {
			return PIPELINE_DIR + '/需求/analysis/' + versionSlug(version) + '.md';
		}

		/**
		 * 一版文档「分析出哪些功能点」落在哪。
		 *
		 * 与 `.md` 分析同一个目录、同一个 slug，只是后缀不同。为什么是**文件**而不是
		 * 分析正文里的一段 Markdown：功能点要能**机读**（自动填进需求页），
		 * 从散文里正则抠列表是那种「今天能跑、明天就错」的做法。
		 *
		 * @param version 版本号（例如 `v1.0`）
		 */
		function requirementPointsPath(version) {
			return PIPELINE_DIR + '/需求/analysis/' + versionSlug(version) + '.points.json';
		}

		/**
		 * 一份分析正文里「与上一版差异」那一节的标题。
		 *
		 * 指令要求 AI **逐字**写这一行，工作台也按这一行去认它。为什么不做成结构化数据：
		 * 差异是**散文**（"原来是什么 → 现在是什么"、"这一版删了整章"），塞进 JSON 会
		 * 逼着模型把话压缩成字段，而压缩掉的恰恰是人要看的那部分。标题写死就够了 ——
		 * 认不出来只影响一句提示，不影响别的。
		 */
		function analysisDiffHeading(previousVersion) {
			return '## 与上一版（' + previousVersion + '）的差异';
		}

		/**
		 * 取一份 Markdown 里某个二级标题下的正文（到下一个同级或更高级标题为止）。
		 *
		 * 找不到返回空串 —— 调用方据此判断"这份分析没带上一版读"。只认 `## ` 开头：
		 * 三级标题属于这一节的内容，不该把它截断。
		 */
		function extractSection(text, heading) {
			if (typeof text !== 'string' || text === '' || typeof heading !== 'string' || heading === '') return '';
			const lines = text.split('\n');
			const from = lines.findIndex((line) => line.trim() === heading.trim());
			if (from === -1) return '';
			const out = [];
			for (let index = from + 1; index < lines.length; index += 1) {
				if (/^##\s/.test(lines[index])) break;
				out.push(lines[index]);
			}
			return out.join('\n').trim();
		}

		/**
		 * 把 AI 分析出的功能点并进现有列表。
		 *
		 * 规则：**同名（忽略大小写与空白）即同一个功能点**，已存在的一律不动 ——
		 * 人可能已经改了名字、派给了人、在方案里引用了它，重新分析不该把这些抹掉。
		 * 只追加真正新的，并记下它出自哪一版文档。
		 *
		 * 唯一的例外是**分块**：已有的点如果还没有分块名、而这次分析给了，就把分块补上。
		 * 补的是"它属于哪个模块"这种结构信息，不覆盖任何人的输入 —— 而且它是让
		 * 树形结构在老数据上生效的唯一自动化手段（否则只能靠人一个个手填）。
		 *
		 * @param existing 现有功能点数组
		 * @param incoming AI 分析出的功能点（形状宽松，坏数据直接跳过）
		 * @param source 来源版本号（写进 `source` / `sourceVersion`）
		 * @param now 时间戳（ISO 串）
		 * @returns { points, added, grouped } —— 合并后的新数组、新增条数、补上分块的条数
		 */
		function mergeExtractedPoints(existing, incoming, source, now) {
			const base = [];
			const seen = {};
			let grouped = 0;
			for (const point of Array.isArray(existing) ? existing : []) {
				if (point === null || typeof point !== 'object') continue;
				seen[normalizePointName(point.name)] = base.length;
				base.push(point);
			}
			let added = 0;
			for (const raw of Array.isArray(incoming) ? incoming : []) {
				if (raw === null || typeof raw !== 'object') continue;
				const name = typeof raw.name === 'string' ? raw.name.trim() : '';
				const group = normalizeGroupName(raw.group);
				const key = normalizePointName(name);
				if (key === '') continue;
				if (seen[key] !== undefined) {
					// 已存在：只在「它还没有分块」时补分块，其余一个字都不动。
					const current = base[seen[key]];
					if (group !== '' && normalizeGroupName(current.group) === '') {
						base[seen[key]] = Object.assign({}, current, { group });
						grouped += 1;
					}
					continue;
				}
				seen[key] = base.length;
				added += 1;
				base.push({
					id: newId(),
					name,
					group,
					assignee: '',
					note: typeof raw.note === 'string' ? raw.note : '',
					source,
					sourceVersion: source,
					createdAt: now,
				});
			}
			return { points: base, added, grouped };
		}

		/** 功能点名的比较键：忽略大小写与所有空白，避免「客户信息 导出」与「客户信息导出」被当成两个。 */
		function normalizePointName(name) {
			return typeof name === 'string' ? name.replace(/\s+/g, '').toLowerCase() : '';
		}

		/** 分块名的规范键；也用于比较。没有分块就是空串。 */
		function normalizeGroupName(name) {
			return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
		}

		/**
		 * 分块下拉里那一项「+ 新分块」的哨兵值。
		 *
		 * 它是一个**控件内部的值，永远不写进数据**：选中它意味着"打开取名框"，
		 * 真正的分块名在取名框里，落盘前要用 {@link normalizeGroupName} 过一遍。
		 * 万一漏了这一步，数据里就会出现一个叫 `__new` 的分块 —— 那是脏数据，
		 * 而且它会像一个正常分块那样显示出来。
		 *
		 * 用 `__new` 开头是有意的：功能点/分块名里出现这种串的概率可以忽略，
		 * 所以下面各处可以用 `=== NEW_GROUP` 直接比对，不必再考虑"名字恰好撞上"。
		 */
		const NEW_GROUP = '__new';

			/**
			 * 「新增功能点」这一刻，这条点该放进哪一块。
			 *
			 * 这是**唯一**一条能把哨兵值 {@link NEW_GROUP} 混进数据、或者把"我要新建一块"
			 * 悄悄丢掉的路 —— 两种都不会报错，只会让数据或用户意图静静地变样
			 * （前者长出一个叫 `__new` 的脏分块，后者功能点掉进未分组）。
			 * 所以它是个模块级的纯函数，能被真正断言，而不是只靠肉眼看页面。
			 *
			 * @param chosen 下拉当前选中的值（可能是 `NEW_GROUP`）
			 * @param drafted 取名框里的字
			 * @returns 分块名（`''` = 未分组）；**`null` = 拒绝**（选了新建却没起名字）
			 */
		function groupForAdd(chosen, drafted) {
			if (chosen !== NEW_GROUP) return normalizeGroupName(chosen);
			const wanted = normalizeGroupName(drafted);
			return wanted === '' ? null : wanted;
		}

		/**
		 * 没写分块时，从功能点名里**推**一个候选前缀出来。
		 *
		 * 为什么要有这条兜底：AI 的分析常用「客户 360 视图-概览页签」这种点名前缀表达层级，
		 * 但那是文档写法，不是数据。没有兜底的话，老数据（以及 AI 忘了写 group 的那几次）
		 * 会全部掉进「未分组」，树形结构就白做了。
		 *
		 * 这只是**候选**，不是结论 —— 一个前缀够不够格当分块，要看它在整份清单里出现几次，
		 * 那个判断在 {@link pointTree} 里做（孤例不成块）。
		 */
		function deriveGroupName(name) {
			const text = typeof name === 'string' ? name.trim() : '';
			if (text === '') return '';
			// 上限是**硬的**：`.{1,10}?` 只在头 10 个字里找分隔符，找不到就放弃。
			// 写成 `.{1,10}?\s*` 会更糟 —— 后面的 `\s*` 仍能一路吃到句子中间的破折号；
			// 用无上限的 `.*?` 则会把「这是一句很长的话-后面还有内容」整句当成模块名。
			const match = /^(.{1,10}?)\s*[-–—:：]\s*\S/.exec(text);
			if (match === null) return '';
			return match[1].trim();
		}

		/**
		 * 一个功能点**写盘**的分块：没有就是空串。
		 *
		 * 只看 `group` 字段，不做推导 —— 推导需要"这个前缀在整份清单里出现过几次"这个上下文，
		 * 那是 {@link pointTree} 的活。把两者混在一起，会让"这一条属于哪块"取决于调用点。
		 */
		function pointGroupOf(point) {
			if (point === null || typeof point !== 'object') return '';
			return normalizeGroupName(point.group);
		}

		/**
		 * 扁平的功能点列表 → 两级树。
		 *
		 * 分块顺序按**首次出现的顺序**，不排序：文档的模块顺序本身就是一种排序
		 * （需求 → 联系人 → 商机 → …），按字母或按条目数重排会把它弄丢。
		 * 未分组固定排在最后 —— 它是"还没归位"的待办，不是第一个模块。
		 *
		 * 两级的理由：需求文档的章节结构是两级的（模块 → 功能），功能点本身已经是叶子。
		 * 更深的层级在"能被派给人、能被勾完成"这个粒度上是无意义的 —— 一个功能点就是一件事。
		 *
		 * 「孤例不成块」值得单独说：从点名推出来的前缀必须先**在清单里出现两次以上**才算分块。
		 * 少了这条，「导出：明细」「备注-补充」这种名字里的冒号/破折号会造出一堆只有一个
		 * 功能点的假模块，树形反而比平铺更难读。写盘的 group 不受这条约束 —— 人手工分的
		 * 单条成块是正常用法。
		 *
		 * 未分块那一组的 name 用空串：**这里不能取文案**（`t` 只在组件里），标签由调用方给。
		 *
		 * 未归类的点仍然**保持在返回的树里**（`name: ''`、`ungrouped: true`），只是界面上
		 * 不再为它画一个叫「未分组」的块头 —— 见 `FeaturePoints` 里怎么渲染它。
		 * 直接从树里丢掉是不行的：那会让功能点凭空消失，而"界面上看不见"和"不存在"
		 * 对用户是同一件事，却是最危险的那种（数据还在，没人知道）。
		 *
		 * @param points 扁平数组（可以是 `requirement.featurePoints`）
		 * @returns `[{ name, points, ungrouped }]`；空数组进空数组
		 */
		function pointTree(points) {
			const list = [];
			const hints = {};
			for (const point of Array.isArray(points) ? points : []) {
				if (point === null || typeof point !== 'object') continue;
				list.push(point);
				const stored = pointGroupOf(point);
				if (stored === '') {
					const hint = deriveGroupName(point.name);
					if (hint !== '') hints[hint] = (hints[hint] ?? 0) + 1;
				}
			}
			const order = [];
			const buckets = {};
			const push = (name, point) => {
				if (buckets[name] === undefined) { buckets[name] = []; order.push(name); }
				buckets[name].push(point);
			};
			for (const point of list) {
				const stored = pointGroupOf(point);
				if (stored !== '') { push(stored, point); continue; }
				const hint = deriveGroupName(point.name);
				push(hint !== '' && (hints[hint] ?? 0) >= 2 ? hint : '', point);
			}
			const groups = [];
			for (const name of order) {
				if (name === '') continue;
				groups.push({ name, points: buckets[name], ungrouped: false });
			}
			if (buckets[''] !== undefined) groups.push({ name: '', points: buckets[''], ungrouped: true });
			return groups;
		}

		/** 按分块名取一组；空名取「未分组」那一组（没有就是空组）。 */
		function groupByName(groups, name) {
			const wanted = normalizeGroupName(name);
			for (const group of Array.isArray(groups) ? groups : []) {
				if (group.name === wanted) return group;
			}
			return { name: wanted, points: [], ungrouped: wanted === '' };
		}

		/**
		 * 两个版本号相差多远。
		 *
		 * `v1.0 → v1.1` 是 1（同一大版本内的小步），`v1.0 → v2.0` 是 10 ——
		 * 权重是刻意这样定的：**大版本跳一级**远比小版本连跳几级更值得怀疑，
		 * 因为它通常意味着「换了一份文档」，而不是「改了几处」。
		 * 认不出来的版本号返回 0（不参与可疑判定，宁可漏报不可误报）。
		 */
		function versionDistance(left, right) {
			const a = /^v(\d+)\.(\d+)$/.exec(String(left).trim());
			const b = /^v(\d+)\.(\d+)$/.exec(String(right).trim());
			if (a === null || b === null) return 0;
			return Math.abs(Number.parseInt(a[1], 10) - Number.parseInt(b[1], 10)) * 10
				+ Math.abs(Number.parseInt(a[2], 10) - Number.parseInt(b[2], 10));
		}

		/** 行级差异的规模：改动行数 / 总行数。两边都空时算 0。 */
		function changeRatio(lines) {
			let added = 0;
			let removed = 0;
			for (const line of Array.isArray(lines) ? lines : []) {
				if (line.kind === 'add') added += 1;
				else if (line.kind === 'remove') removed += 1;
			}
			const total = added + removed + (Array.isArray(lines) ? lines.filter((line) => line.kind === 'same').length : 0);
			return {
				added,
				removed,
				total,
				ratio: total === 0 ? 0 : (added + removed) / total,
			};
		}

		/**
		 * 「这一版是不是上传错了」的判定。
		 *
		 * 两个方向都值得提示，而且给的建议完全不同：
		 *
		 *   - `jump`：版本号跳了一大截（大版本变了）但正文几乎没动 —— 最常见的原因是
		 *     **上传错了文件**，或者把同一份又传了一次。建议核对原件、必要时删掉重传。
		 *   - `stale`：正文改了很多，分析却几乎没动 —— 分析很可能是在**旧正文**上做的，
		 *     或者这一版根本没重跑过分析。建议对右版点「继续优化」。
		 *
		 * 只在两版**都有分析**时才判 `stale`：分析缺失是另一个提示（要先去跑分析），
		 * 混在一起说会让人以为分析写坏了。阈值宁可保守 —— 误报一次，人就不再看这个提示了。
		 *
		 * @param doc docDiff 的结果（diffLines + diffStats）
		 * @param analysis analysisDiff 的结果
		 * @param versions { left, right } 两个版本号
		 * @returns { kind, ratio, anRatio } 或 null
		 */
		function suspicionOf(doc, analysis, versions) {
			const document = changeRatio(doc === null || doc === undefined ? [] : doc.lines);
			const markdown = changeRatio(analysis === null || analysis === undefined ? [] : analysis.lines);
			const distance = versionDistance(
				versions === null || versions === undefined ? '' : versions.left,
				versions === null || versions === undefined ? '' : versions.right,
			);
			if (distance >= 10 && document.ratio <= 0.02) {
				return { kind: 'jump', ratio: document.ratio, anRatio: markdown.ratio };
			}
			const bothAnalyzed = markdown.total > 0
				&& analysis !== null && analysis !== undefined
				&& analysis.left !== '' && analysis.right !== '';
			if (bothAnalyzed && document.ratio >= 0.25 && markdown.ratio <= 0.02) {
				return { kind: 'stale', ratio: document.ratio, anRatio: markdown.ratio };
			}
			return null;
		}

		/**
		 * 「分析需求文档」要优先使用的 skill 名。
		 *
		 * 由宿主半边在插件加载时投放到 `$DSH_HOME/skills/`（见 index.js 的 installSkill）。
		 * 这里是**软依赖**：加载不到就退回下面那份通用指令，不会让分析失败 ——
		 * 但要求 AI 在回报里说明走的是哪条路，免得"没用上 skill"这件事静默发生。
		 */
		const ANALYSIS_SKILL_NAME = 'requirement-doc-reader';

		/**
		 * 「分析需求文档」发给对话的指令。
		 *
		 * 与 `designPrompt` 的差别在**读者**：出方案是给自己写产物，分析是给所有人
		 * 一份"这文档说了什么"的共识，所以指令要求**只做提炼、不做发挥**，并且
		 * 把「文档没说的事」单列出来 —— 需求文档最贵的失败不是漏读，是把没写的当写过了。
		 *
		 * 产物是**两个**文件，而且这件事必须写死在指令里：
		 *   - `<版本>.md` 给人读；
		 *   - `<版本>.points.json` 给工作台读，用来把功能点自动填进需求页。
		 * 少了第二个，功能点就只能靠人照着分析一个字一个字敲 —— 那正是这一步要省掉的活。
		 *
		 * 路径与"只准写这两个文件"照样写死：AI 顺手去改 `parsed/*.txt` 或
		 * `requirement.json`，会让导入的原文与元数据和它的分析互相打架。
		 *
		 * **有上一版时必须做版本对比**（`previousVersion`）：需求文档改版之后，
		 * 读的人第一个问题永远是"这次改了什么"。让读者自己去比两份几万字的文档，
		 * 比不比得出来先不说，结论也不会一致。所以对比是**分析的固定一节**，
		 * 标题写死成 `## 与上一版（vX.Y）的差异`，工作台会按这个标题去认它。
		 *
		 * @param input { id, title, version, textFile, analysisPath, pointsPath, root, hasAnalysis,
		 *                previousVersion?, previousTextFile?, previousAnalysisPath? }
		 */
		function documentAnalysisPrompt(input) {
			const abs = (relative) => input.root + '/' + input.id + '/' + relative;
			const hasPrevious = typeof input.previousVersion === 'string' && input.previousVersion !== '';
			const lines = [];
			lines.push('请分析需求 ' + input.id + '《' + input.title + '》的需求文档。');
			lines.push('');
			lines.push('【先试着加载 skill】');
			lines.push('本次分析**优先**用 skill「' + ANALYSIS_SKILL_NAME + '」——它写清了需求文档该怎么读：');
			lines.push('怎么判断这份文档是「一个 Word 里装着多系统、多功能点、多处修订记录表」还是单一文档；');
			lines.push('怎么按修订记录表里那一行声明的变更底色，只抽**本次这一条需求**的变更；');
			lines.push('怎么区分「新增功能」（整个功能块同色）与「变更功能」（只有部分带底色，无底色即已实现的原功能）；');
			lines.push('以及功能点该写到什么粒度。');
			lines.push('**第一步就用 skill 工具加载 `' + ANALYSIS_SKILL_NAME + '`**，加载到就按它的流程走。');
			lines.push('加载不到（skill 不存在、或加载失败）就按下面的通用要求做 —— 但要在最后的回报里');
			lines.push('**明确说一句「本次没有用上 skill」**，让人一眼看出走的是哪条路。');
			lines.push('无论走哪条，下面【要写的文件】、两个产物的路径、以及差异小节的标题都是**硬要求**，一个字都不能改。');
			lines.push('');
			lines.push('【先读】');
			lines.push(abs(input.textFile) + '（这是 ' + input.version + ' 版 .docx 解析出来的正文，**先完整读一遍**）');
			if (input.hasAnalysis) {
				lines.push(abs(input.analysisPath) + '（这个版本已经有一份分析，**先读它**）');
			}
			if (hasPrevious) {
				lines.push('');
				lines.push('**这一版有上一版，下面两个文件也要读**（本次必须产出"与上一版的差异"，见后）：');
				if (typeof input.previousTextFile === 'string' && input.previousTextFile !== '') {
					lines.push(abs(input.previousTextFile) + '（' + input.previousVersion + ' 版的正文）');
				}
				if (typeof input.previousAnalysisPath === 'string' && input.previousAnalysisPath !== '') {
					lines.push(abs(input.previousAnalysisPath) + '（' + input.previousVersion + ' 版的分析 —— 对比时以它为准，它已经把上一版的结论提炼过了）');
				}
			}
			lines.push('');
			lines.push('【要写的文件】');
			if (input.hasAnalysis) {
				lines.push('这一版已经有分析：请**在它现有内容的基础上继续优化**，保留其中仍然有效的结论，');
				lines.push('补上缺的、改掉已经不成立的，不要从零重写，也不要为了显得改过而重排全文。');
			}
			lines.push('1. ' + abs(input.analysisPath) + '  ← 给人读的分析，Markdown');
			lines.push('2. ' + abs(input.pointsPath) + '  ← 给工作台读的功能点，JSON：');
			lines.push('   { "schema": 1, "version": "' + input.version + '", "points": [ { "group": "需求分块名", "name": "功能点名称", "note": "一句话说明，没有就填空串" } ], "updatedAt": "ISO 时间" }');
			lines.push('   `group` 是**需求分块**：按文档自己的章节/模块来分（例如「客户主数据」「商机与报价」），');
			lines.push('   同一个模块的功能点写**一模一样**的 group 字符串 —— 工作台会按它把功能点显示成树。');
			lines.push('   不要每个功能点自造一个新分块名，也不要用「第一部分」这种位置词。');
			lines.push('   功能点要**能被派给人、能被勾完成**那个粒度：一个功能点 = 一件可独立交付的事。');
			lines.push('   不要写"系统"、"模块"这种粒度，也不要写"支持 XX 能力"这种没法验收的说法。');
			lines.push('');
			lines.push('【分析要写到的内容】');
			lines.push('1. 一句话结论：这份需求到底要做什么，值不值得往下走');
			lines.push('2. 关键信息：涉及的系统 / 模块、角色、数据实体、外部依赖');
			lines.push('3. 需求要点：编号列出功能点（与第 2 个文件里那份清单**一一对应**，编号顺序也一致）');
			lines.push('4. 影响面与风险：会动到已有的什么东西，哪里最容易出问题');
			lines.push('5. 待澄清问题：文档里**没有说清楚**的地方，一条一行，写成可以直接拿去问的句子');
			lines.push('6. 与已有工作台数据的关系：如果能对上功能点列表，指出哪些功能点在文档里找不到出处、哪些文档要求还没有功能点');
			if (hasPrevious) {
				lines.push('7. **与上一版（' + input.previousVersion + '）的差异** —— 这一节是**硬要求**，见下。');
				lines.push('');
				lines.push('【与上一版的差异（第 7 节）怎么写】');
				lines.push('标题必须**逐字**写成：`## 与上一版（' + input.previousVersion + '）的差异`（工作台按这个标题认它）。');
				lines.push('正文按下面的小标题组织，**每一条都要能对上具体内容**：');
				lines.push('- **新增**：这一版新加的要求，逐条列出（带上它在文档里的章号），没有就写"无"。');
				lines.push('- **删除**：上一版有、这一版没有的要求，逐条列出 —— **包括整章被删**这种（那要明确写出"整章删除：第 N 章 XXX"）。没有就写"无"。');
				lines.push('- **修改**：说法变了、数值变了、口径变了的，写成"原来是什么 → 现在是什么"。没有就写"无"。');
				lines.push('- **未变**：一句话说明哪些部分与上一版逐字相同即可，不要复述。');
				lines.push('- **文档自身的不一致**：这次删改之后留下的自相矛盾（例如改了正文但汇总表/版本号/变更记录没跟着改、章节断号、指标悬空），一条一行列出。没有就写"无"。');
				lines.push('- **对功能点清单的影响**：明确说清相比上一版**少了几条、多了几条、总数从多少变成多少**，');
				lines.push('  并点名"哪些上一版的功能点在这一版里已经没有出处"（工作台不会自动删功能点，这条是给人做决定用的）。');
				lines.push('纪律：**只写实际读到的差异**。两份文档逐字相同的部分不要列出来充数；');
				lines.push('拿不准某一处算"修改"还是算"没变"时，按"修改"写，并说明你的判断依据。');
			}
			lines.push('');
			lines.push('【纪律】');
			lines.push('- **只做分析与提炼**，不要写方案、不要写代码、不要替需求做决定。');
			lines.push('- 严格按文档说；文档没写的推断要**明确标注为推断**，不确定就写进待澄清问题，不要编。');
			lines.push('- 直接写正文，不要"好的，我来分析"这类前言，也不要在结尾复述全文。');
			lines.push('- **不要改动需求层和工作台的任何文件**（requirement.json、Pipeline/需求/source、parsed 下的东西、其它版本的分析）。');
			lines.push('  功能点由工作台自己读上面那个 JSON 去填，你**不要**去改 requirement.json。');
			lines.push('- 两个文件都用 UTF-8、LF 换行；JSON 必须是能被 JSON.parse 解析的合法 JSON。');
			lines.push('- 写完用一两句话告诉我你的结论，**不要复述正文全文**。');
			for (const line of subagentDirective('需求', input)) lines.push(line);
			return lines.join('\n');
		}

		/**
		 * 每个模块的动作都**交给一个只做本模块的子 agent**。
		 *
		 * 为什么不是「让当前对话顺手做掉」：五个模块的产物互相咬合（方案读需求、开发读方案、
		 * 测试读开发），一个什么都看的上下文很容易顺手改到上游的文件 —— 那是最难追的一类事故，
		 * 因为改它的人（模型）不觉得那是越界。子 agent 的上下文是**一次性的**：它只拿到
		 * 本模块的指令，做完就结束，够不到别的模块。
		 *
		 * 这条纪律写进指令而不是靠插件去调度：插件这一层没有「派活给子 agent」的 API
		 * （那是模型自己的工具），所以插件能做的最强约束就是**把要求写死在这段指令里**，
		 * 并说清为什么要这么做 —— 只说「用子 agent」模型会照做，说清楚理由它才会在
		 * 「这个顺手我也可以改」的时候停手。
		 *
		 * @param module 模块名（需求 / 方案 / 开发 / 测试 / 提版）
		 * @param input { id, title }
		 */
		function subagentDirective(module, input) {
			const lines = [];
			lines.push('');
			lines.push('【怎么做：开一个只做「' + module + '」的子 agent】');
			lines.push('用 DSH 的子 agent 工具执行本次任务，并在指令开头就把它钉死在这个模块上：');
			lines.push('- 交代清楚：需求 ' + input.id + '《' + input.title + '》，本次只做「' + module + '」模块。');
			lines.push('- 上游内容**只读**，不要改动：' + module + ' 的产出才是本次目标。');
			lines.push('- 别的模块的文件（含别人的按人管线）一律不要碰，也不要"顺手"替别人补。');
			lines.push('- 子 agent 做完就结束，不要在它里面再派活。');
			lines.push('理由：五个模块的产物互相咬合，一个什么都看的上下文很容易改到上游的文件，');
			lines.push('而那种改动事后极难追查。子 agent 之间互不影响，出问题也只影响本模块。');
			return lines;
		}

		/** 解析 YYYY-MM-DD 为本地当天 0 点；无效返回 null。 */
		function parseDay(value) {
			if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
			const parts = value.split('-').map((piece) => Number.parseInt(piece, 10));
			const date = new Date(parts[0], parts[1] - 1, parts[2]);
			return Number.isNaN(date.getTime()) ? null : date;
		}

		/** 距目标日期还有几天（按本地日历日算，今天 = 0）。 */
		function daysUntil(value, now) {
			const targetDay = parseDay(value);
			if (targetDay === null) return null;
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			return Math.round((targetDay.getTime() - today.getTime()) / 86400000);
		}

		/** 把 YYYY-MM-DD 平移若干天；入参无效返回 ''。 */
		function shiftDay(value, delta) {
			const day = parseDay(value);
			if (day === null) return '';
			day.setDate(day.getDate() + delta);
			const pad = (piece) => String(piece).padStart(2, '0');
			return day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
		}

		/**
		 * 三个关键日期的先后规则：提版日期 < 测试封板日期 < 上线日期。
		 * 空值一律放行（允许只填一部分）。
		 * 越界时返回错误文案键，否则返回 ''。
		 * 字符串比较对 YYYY-MM-DD 就是日期比较，不需要构造 Date。
		 */
		function checkOrder(candidate) {
			const release = candidate.releaseDate ?? '';
			const freeze = candidate.testFreezeDate ?? '';
			const live = candidate.goLiveDate ?? '';
			if (release !== '' && freeze !== '' && release >= freeze) return 'dates.errReleaseBeforeFreeze';
			if (freeze !== '' && live !== '' && freeze >= live) return 'dates.errFreezeBeforeLive';
			return '';
		}

		/** 未处理时，超过上线日期多少天自动归档。 */
		const OVERDUE_ARCHIVE_DAYS = 3;
		/** 已读之后还继续显示多少天。 */
		const NOTICE_LINGER_DAYS = 3;
		const DAY_MS = 86400000;

		/** 解析 ISO 时间戳；无效返回 null。 */
		function parseInstant(value) {
			if (typeof value !== 'string' || value === '') return null;
			const at = new Date(value);
			return Number.isNaN(at.getTime()) ? null : at;
		}

		/** 是否「已标记完成，且今天已经超过上线日期」。 */
		function isOverdueDone(meta, now) {
			if (meta === null || meta === undefined) return false;
			if (meta.status !== 'done') return false;
			const day = parseDay(meta.goLiveDate);
			if (day === null) return false;
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			return today.getTime() > day.getTime();
		}

		/** 距离自动归档还剩几天（向上取整，最小 0）。 */
		function daysUntilAutoArchive(notice, now) {
			const raisedAt = parseInstant(notice.overdueNoticeAt);
			if (raisedAt === null) return OVERDUE_ARCHIVE_DAYS;
			return Math.max(0, Math.ceil((raisedAt.getTime() + OVERDUE_ARCHIVE_DAYS * DAY_MS - now.getTime()) / DAY_MS));
		}

		/** 通知是否还该显示：未读的一直显示，已读的只再显示 3 天。 */
		function noticeVisible(notice, now) {
			if (typeof notice.overdueNoticeAt !== 'string' || notice.overdueNoticeAt === '') return false;
			const readAt = parseInstant(notice.overdueNoticeReadAt);
			if (readAt === null) return true;
			return now.getTime() < readAt.getTime() + NOTICE_LINGER_DAYS * DAY_MS;
		}

		/**
		 * 登记通知之后满 3 天，就该自动归档了。
		 *
		 * 抽成纯函数是因为这条判定原来内联在扫描循环里 —— 没有名字就测不到，
		 * 而「会不会被提前归档」是这套机制里最不能出错的一条。
		 */
		function isAutoArchiveDue(meta, now) {
			const raisedAt = parseInstant(meta === null || meta === undefined ? '' : meta.overdueNoticeAt);
			if (raisedAt === null) return false;
			return now.getTime() >= raisedAt.getTime() + OVERDUE_ARCHIVE_DAYS * DAY_MS;
		}

		/**
		 * 推导五个阶段的显示状态。
		 *
		 * ★ 这里是**拼装**，不是判定：
		 *   - 已完成的需求 → 整条管线视为「已审核」；
		 *   - 「需求」与「提版」是**公共管线**，所有人共享；
		 *   - 「方案 / 开发 / 测试」是**按人分开**的管线，取选中开发人员的状态；
		 *   - 有澄清记录 → 「需求」已审核，否则进行中。
		 * 抽成纯函数是为了让只读回显弹框和主视图用同一套推导，不会各说各话。
		 *
		 * @param meta 需求元数据
		 * @param developer 当前查看的开发人员；省略时按人那三段一律「未开始」
		 * @param stageStates 各阶段**已经算好的**状态，例如 `{ design: 'active', release: 'approved' }`。
		 *   省略某个键（或给 `null`）= 这个阶段还没有真实数据，回退到占位规则。
		 *
		 * ★ 唯一的占位规则：**方案**在没有任何真实产物时，按「分到功能点即进行中」推导。
		 *   开发 / 测试 / 提版 不再有任何占位 —— 它们要么有真实产物，要么就是「未开始」。
		 */
		/** 取值合法的阶段状态；不合法或缺失返回 null（含义是「这个阶段还没有真实数据」）。 */
		function statusOf(value) {
			return value === 'pending' || value === 'active' || value === 'approved' ? value : null;
		}

		/**
		 * 把各段的真实状态拼成管线状态。
		 *
		 * @param meta 需求元数据
		 * @param developer 当前查看的开发人员；省略时按人那三段一律「未开始」
		 * @param stageStates 各阶段**已经算好的**状态，例如 `{ design: 'active', release: 'approved' }`。
		 *   省略某个键（或给 `null`）= 这个阶段还没有真实数据，回退到占位规则。
		 *
		 * 分工刻意分开：**判定**由 `designStageStatus()` / `stageVerdict()` 负责，
		 * 这里只负责**拼装**。于是这个函数不需要知道任何一种产物的形状，
		 * 已有的那批断言也就不用跟着产物改。
		 */
		function deriveStageStatus(meta, developer, stageStates) {
			const status = {};
			for (const stage of STAGES) status[stage.id] = 'pending';
			if (meta === null || meta === undefined) return status;

			if (meta.status === 'done') {
				for (const stage of STAGES) status[stage.id] = 'approved';
				return status;
			}

			const given = stageStates !== null && typeof stageStates === 'object' ? stageStates : {};

			const clarifications = Array.isArray(meta.clarifications) ? meta.clarifications : [];
			status.requirement = clarifications.length > 0 ? 'approved' : 'active';

			// 提版是公共阶段，它的真实进度与「有没有开发人员」无关。
			status.release = statusOf(given.release) === null ? 'pending' : given.release;

			if (typeof developer === 'string' && developer !== '') {
				const realDesign = statusOf(given.design);
				if (realDesign !== null) {
					status.design = realDesign;
				} else {
					// 占位规则：分到功能点的人，方案算「进行中」。
					const points = Array.isArray(meta.featurePoints) ? meta.featurePoints : [];
					let mine = 0;
					for (const point of points) if (point.assignee === developer) mine += 1;
					status.design = mine > 0 ? 'active' : 'pending';
				}
				if (statusOf(given.develop) !== null) status.develop = given.develop;
				if (statusOf(given.test) !== null) status.test = given.test;
			}
			return status;
		}

		// ────────────────────────────────────────────────────────────────────
		// 6.1 主导者
		//
		// 主导者是这条需求里**唯一能编辑「方案汇总」**的人。它是共享标量
		// （`requirement.json` 的 `leadDeveloper`），因为「谁是主导者」整个需求只有一个值，
		// 两个人同时改它属于**真实分歧**，本就该由人来解决。
		// ────────────────────────────────────────────────────────────────────

		/** 主导者字段名。与宿主半边共享同一个 requirement.json。 */
		const LEAD_FIELD = 'leadDeveloper';

		/**
		 * 这条需求的主导者是谁。
		 *
		 * **默认是名单里的第一个人** —— 默认值靠推导得出而不是靠写盘，所以已经存在的
		 * 需求不需要任何迁移就自动有了主导者。
		 *
		 * 记的人已经不在名单里（被移除了）时回落到第一个人：否则主导者一被移除，
		 * 方案汇总就**永远没人能改**了。这是必要的逃生口。
		 */
		function leadOf(meta) {
			if (meta === null || meta === undefined) return '';
			const developers = Array.isArray(meta.developers) ? meta.developers : [];
			if (developers.length === 0) return '';
			const marked = typeof meta[LEAD_FIELD] === 'string' ? meta[LEAD_FIELD] : '';
			return developers.includes(marked) ? marked : developers[0];
		}

		/** 我能不能编辑**方案汇总**：只有主导者能，其他人只能看。 */
		function canEditSummary(identity, lead) {
			// 身份还没登记、或名单里还没有主导者时不拦 —— 那时候拦住的只会是使用者。
			if (typeof identity !== 'string' || identity === '') return true;
			if (typeof lead !== 'string' || lead === '') return true;
			return identity === lead;
		}

		/**
		 * 我能不能**变换**主导者。
		 *
		 * 「不能随便调整」就落在这一条上：**只有现任主导者能把位置交出去**。
		 * 这不是为了严格而严格 —— 如果谁都能改，那「只有主导者能编辑汇总」就是空的：
		 * 任何人先把自己设成主导者就行了。**权限的入口必须和权限本身一样紧**。
		 *
		 * 交出之后，新主导者立刻接手；老主导者变回普通开发人员（他自己的方案照旧只有他能改）。
		 */
		function canHandOverLead(identity, lead, developers) {
			const list = Array.isArray(developers) ? developers : [];
			if (list.length === 0) return false;
			if (typeof identity !== 'string' || identity === '') return true;
			if (typeof lead !== 'string' || lead === '') return true;
			return identity === lead;
		}

		// ────────────────────────────────────────────────────────────────────
		// 6.2 「方案」阶段的数据模型
		//
		// 方案是**按人分开**的管线，一个开发人员一套文件，各写各的：
		//
		//   Pipeline/方案/<开发人员>/
		//   ├── draft.md          方案正文（AI 出稿 → 人改稿）
		//   ├── versions/v1.md    正文的历史快照（留档用，不影响正文）
		//   ├── impact.json       影响面分析
		//   ├── tasks.json        任务拆分
		//   └── design.json       定稿时间
		//
		// 这个目录下的每个文件**只有本人写**，所以方案页完全不碰共享的
		// `requirement.json` —— 两个人同时写各自的方案，路径不相交，merge 干净。
		// 见 docs/storage-format.md 第 0 节那条规则。
		// ────────────────────────────────────────────────────────────────────

		/** 方案阶段的目录名，与宿主半边 STAGE_DIRS 里的 `方案` 一致。 */
		const DESIGN_DIR = PIPELINE_DIR + '/方案';

		/** 正文历史快照的目录名。 */
		const DESIGN_VERSIONS = 'versions';

		/**
		 * 方案汇总：整条需求**只有一份**，由主导者在协同开始时生成。
		 *
		 * 它不是「谁的」产物，所以放在按人目录**之外**、`Pipeline/方案/` 的根部。
		 * 和按人目录不会撞名是**结构上保证**的：目录名来自 `developerSlug()`，
		 * 而它保证输出**不含 `.`**（见下），所以任何人的目录都不可能是 `汇总.md`。
		 */
		const DESIGN_SUMMARY_FILE = '汇总.md';

		/** 汇总文件的路径（相对需求文件夹）。 */
		function designSummaryPath() {
			return DESIGN_DIR + '/' + DESIGN_SUMMARY_FILE;
		}

		/**
		 * 把开发人员姓名转成安全的目录名。
		 *
		 * 规则与 docs/storage-format.md 第 2 节一致：去掉 `/ \ : * ? " < > |`、
		 * 去掉首尾空白与开头的 `.`。
		 *
		 * **内部点号也换成下划线**，这一条是为共享汇总文件服务的：汇总叫 `汇总.md`，
		 * 如果某个开发人员叫 `汇总.md`，他的目录就会和那份共享文件同名 —— 文件和目录
		 * 不能同名，汇总从此写不进去。保证 slug 不含点号，这类撞名就**不可能发生**，
		 * 而不是"大概不会发生"。
		 *
		 * 已知代价（写进文档，不假装没有）：转义仍会撞名（`张三` 与 `张 三` 同目录）。
		 * 两个人真的撞在一起时，方案文件里记着姓名，能看出来是两个人。
		 */
		function developerSlug(name) {
			const raw = typeof name === 'string' ? name : '';
			const cleaned = raw
				.replace(/[\\/:*?"<>|]/g, '')
				.replace(/^[\s.]+/, '')
				.replace(/[\s.]+$/, '')
				.replace(/\./g, '_');
			return cleaned === '' ? '_' : cleaned;
		}

		/**
		 * 一个开发人员在方案阶段的全部路径。
		 * 返回的都是**相对需求文件夹**的路径，直接喂给宿主 op。
		 */
		function designPaths(developer) {
			const base = DESIGN_DIR + '/' + developerSlug(developer);
			return {
				base,
				draft: base + '/draft.md',
				impact: base + '/impact.json',
				tasks: base + '/tasks.json',
				apis: base + '/apis.json',
				pages: base + '/pages.json',
				// 生成出来的方案文档（导出物，不是可编辑产物）。
				doc: base + '/方案文档.md',
				meta: base + '/design.json',
				versions: base + '/' + DESIGN_VERSIONS,
				version: (index) => base + '/' + DESIGN_VERSIONS + '/v' + index + '.md',
			};
		}

		/** 一个开发人员的方案产物，读盘之后的形状。 */
		function designState(input) {
			const draft = typeof input.draft === 'string' ? input.draft : '';
			const impact = input.impact !== null && typeof input.impact === 'object' ? input.impact : null;
			const tasksFile = input.tasks !== null && typeof input.tasks === 'object' ? input.tasks : null;
			const meta = input.meta !== null && typeof input.meta === 'object' ? input.meta : null;
			return {
				draft,
				impact,
				tasks: tasksFile !== null && Array.isArray(tasksFile.tasks) ? tasksFile.tasks : [],
				apis: designListState(DESIGN_LISTS.apis, input.apis),
				pages: designListState(DESIGN_LISTS.pages, input.pages),
				confirmedAt: meta !== null && typeof meta.confirmedAt === 'string' ? meta.confirmedAt : '',
				versions: Array.isArray(input.versions) ? input.versions : [],
			};
		}

		/**
		 * 「方案」阶段的两张结构化清单：后端接口 / 前端页面。
		 *
		 * 为什么要有这两张表：现实流程里方案要回答的就是"**要改或新增哪些后端接口、
		 * 要改或新增哪些前端页面**"。这两件事如果埋在正文里，人改不动（改一个接口
		 * 要去长文里找）、AI 只能整篇重写、下游（开发 / 提版）也引用不了 ——
		 * 而文档生成要的正是**能循环的字段**。
		 *
		 * 与 develop / test / release 的 `STAGE_BLOCKS` **刻意分开**：那张表决定阶段的
		 * 完成判定（`stageVerdict`），而方案阶段的完成判定是"定稿"（`designStageStatus`）——
		 * 把这两块塞进去会顺手改掉那条判定链。这里只声明**编辑与文档渲染**要用的形状。
		 */
		const DESIGN_LISTS = {
			apis: {
				file: 'apis.json',
				titleKey: 'menu.design.apis',
				columns: [
					{ key: 'pointName', labelKey: 'col.point', placeholderKey: 'ph.point' },
					{ key: 'taskNo', labelKey: 'col.taskNo', placeholderKey: 'ph.taskNo', width: 90 },
					{ key: 'name', labelKey: 'col.apiName', placeholderKey: 'ph.apiName' },
					{ key: 'method', labelKey: 'col.method', placeholderKey: 'ph.method', width: 110 },
					{ key: 'path', labelKey: 'col.path', placeholderKey: 'ph.path' },
					{ key: 'change', labelKey: 'col.change', placeholderKey: 'ph.change', width: 110 },
					{ key: 'request', labelKey: 'col.request', placeholderKey: 'ph.request' },
					{ key: 'response', labelKey: 'col.response', placeholderKey: 'ph.response' },
					{ key: 'note', labelKey: 'col.note' },
				],
			},
			pages: {
				file: 'pages.json',
				titleKey: 'menu.design.pages',
				columns: [
					{ key: 'pointName', labelKey: 'col.point', placeholderKey: 'ph.point' },
					{ key: 'taskNo', labelKey: 'col.taskNo', placeholderKey: 'ph.taskNo', width: 90 },
					{ key: 'name', labelKey: 'col.pageName', placeholderKey: 'ph.pageName' },
					{ key: 'route', labelKey: 'col.route', placeholderKey: 'ph.route' },
					{ key: 'change', labelKey: 'col.change', placeholderKey: 'ph.change', width: 110 },
					{ key: 'blocks', labelKey: 'col.blocks', placeholderKey: 'ph.blocks' },
					{ key: 'interaction', labelKey: 'col.interaction', placeholderKey: 'ph.interaction' },
					{ key: 'note', labelKey: 'col.note' },
				],
			},
		};

		/**
		 * 一张清单的落盘形状 → 规范行数组。
		 *
		 * 坏数据（缺字段、类型不对）一律落回默认值，不带到界面上：与 `normalizeRow`
		 * 同一条规矩，理由也一样 —— 界面上出现 `undefined` 比出现空串糟得多。
		 */
		function designListState(spec, json) {
			const source = json !== null && typeof json === 'object' ? json : {};
			const items = Array.isArray(source.items) ? source.items : [];
			return items.map((item) => normalizeRow(spec, item));
		}

		/** 一张清单的落盘 payload（与其它产物同一套 schema / 时间戳约定）。 */
		function designListPayload(spec, developer, items) {
			return {
				schema: 1,
				developer,
				items: Array.isArray(items) ? items : [],
				updatedAt: new Date().toISOString(),
			};
		}

		/**
		 * 一张清单在给 AI 的指令里的 JSON 形状。
		 *
		 * 与 `blockShapeText` 同一个道理：**由声明生成**，所以表里加一列，指令里就跟着多一列，
		 * 不会出现"页面加了字段、指令里没有"这种错位（AI 会自己猜一个，然后永远对不上）。
		 */
		function designListShapeText(spec, developer) {
			const columns = Array.isArray(spec.columns) ? spec.columns : [];
			const row = columns.map((column) => (
				column.type === 'select'
					? '"' + column.key + '": "' + (Array.isArray(column.options) ? column.options.join('|') : '') + '"'
					: '"' + column.key + '": "…"'
			));
			const head = typeof developer === 'string' && developer !== '' ? '"developer": "' + developer + '", ' : '';
			return '{ "schema": 1, ' + head + '"items": [ { ' + row.join(', ') + ' } ], "updatedAt": "ISO 时间" }';
		}

		/**
		 * 读一个文本文件；**不存在就返回空串**，不抛。
		 *
		 * 方案文件是「写了才有」的，没写过是常态而不是错误 —— 把 404 当异常会
		 * 让一个还没出稿的方案页显示一片红字。
		 */
		async function readTextOrNull(id, path) {
			try {
				const value = await callWorkbench('readText', { args: { id, path } });
				return typeof value.text === 'string' ? value.text : '';
			} catch (error) {
				return '';
			}
		}

		/** 读一个 JSON 文件；不存在或不是合法 JSON 都返回 null（损坏的当作没填过）。 */
		async function readJsonOrNull(id, path) {
			const text = await readTextOrNull(id, path);
			if (text.trim() === '') return null;
			try {
				const parsed = JSON.parse(text);
				return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
			} catch (error) {
				return null;
			}
		}

		/** 列一个目录；不存在返回空数组。 */
		async function listEntriesOrEmpty(id, path) {
			try {
				const value = await callWorkbench('listDir', { args: { id, path } });
				return Array.isArray(value.entries) ? value.entries : [];
			} catch (error) {
				return [];
			}
		}

		/**
		 * 从目录列表里取某个文件的修改时间（毫秒）。文件不在就返回 0。
		 *
		 * 汇总的「更新于」直接从文件系统读，不另建一个记录时间的元数据文件 ——
		 * 那又是一件要「读-改-写」的东西。
		 */
		function entryMtime(entries, name) {
			for (const entry of Array.isArray(entries) ? entries : []) {
				if (entry === null || typeof entry !== 'object') continue;
				if (entry.name === name && typeof entry.mtime === 'number' && entry.mtime > 0) return entry.mtime;
			}
			return 0;
		}

		/**
		 * 下一个快照序号。
		 *
		 * 从**目录里已有的文件名**推出来，不记在索引文件里 —— 索引文件就是那份
		 * 会「读-改-写」的东西，正是要避免的（见 docs/storage-format.md 第 0 节）。
		 */
		function nextSnapshotIndex(entries) {
			let max = 0;
			for (const entry of Array.isArray(entries) ? entries : []) {
				const name = entry !== null && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name : '';
				const match = /^v(\d+)\.md$/.exec(name);
				if (match === null) continue;
				const index = Number(match[1]);
				if (index > max) max = index;
			}
			return max + 1;
		}

		/** 版本快照列表，新的在前。 */
		function snapshotList(entries) {
			const out = [];
			for (const entry of Array.isArray(entries) ? entries : []) {
				const name = entry !== null && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name : '';
				const match = /^v(\d+)\.md$/.exec(name);
				if (match === null) continue;
				out.push({ name, index: Number(match[1]), bytes: typeof entry.bytes === 'number' ? entry.bytes : 0 });
			}
			out.sort((left, right) => right.index - left.index);
			return out;
		}

		/** 影响面分析里真正填了内容吗（空表单不算「动过方案」）。 */
		function impactFilled(impact) {
			if (impact === null || impact === undefined) return false;
			const keys = ['modules', 'rollback', 'dependencies'];
			return keys.some((key) => typeof impact[key] === 'string' && impact[key].trim() !== '');
		}

		/** 这个人的方案动过没有。 */
		function hasDesignContent(design) {
			if (design === null || design === undefined) return false;
			if (typeof design.draft === 'string' && design.draft.trim() !== '') return true;
			if (impactFilled(design.impact)) return true;
			if (Array.isArray(design.tasks) && design.tasks.length > 0) return true;
			// 清单也算动过：只填了接口清单的人，方案页不该显示成「未开始」。
			return Object.keys(DESIGN_LISTS).some((key) => Array.isArray(design[key]) && design[key].length > 0);
		}

		/**
		 * 方案阶段的真实状态；**读不到方案数据时返回 null**，由调用方回退到占位规则。
		 *
		 * 三态与管线其它阶段一致：未开始 / 进行中 / 已审核（= 定稿）。
		 *
		 * **定稿必须有内容才算已审核。** 一份空方案被点了定稿，徽标不该变绿 ——
		 * 那正是「状态说谎」里最容易被忽略的一种：界面上给了个按钮，点一下就绿了，
		 * 谁也不会再去核对里面有没有东西。空方案即使被定稿也仍然算「未开始」。
		 */
		function designStageStatus(design) {
			if (design === null || design === undefined) return null;
			if (!hasDesignContent(design)) return 'pending';
			return typeof design.confirmedAt === 'string' && design.confirmedAt !== '' ? 'approved' : 'active';
		}

		/** 任务汇总：个数 / 预估人天 / 已完成个数。 */
		function taskSummary(tasks) {
			const list = Array.isArray(tasks) ? tasks : [];
			let days = 0;
			let done = 0;
			for (const task of list) {
				const estimate = typeof task.estimate === 'number' && Number.isFinite(task.estimate) ? task.estimate : 0;
				days += estimate;
				if (task.done === true) done += 1;
			}
			// 人天保留一位小数，避免 0.1+0.2 这种浮点尾巴显示成 0.30000000000000004。
			return { count: list.length, days: Math.round(days * 10) / 10, done };
		}

		/** 任务标题：没有手填标题时用来源功能点的名字兜底。 */
		function taskLabel(task, points) {
			if (typeof task.title === 'string' && task.title.trim() !== '') return task.title;
			const list = Array.isArray(points) ? points : [];
			for (const point of list) if (point.id === task.pointId) return point.name;
			return '';
		}

		/**
		 * 把「分派给我的功能点」变成任务骨架。
		 *
		 * 幂等：**已经由同一个功能点生成过的任务不会再来一条**，所以按钮可以随便点。
		 * 这是「需求 → 方案」两层真正打通的一步 —— 功能点的分派不再只是给管线染色。
		 *
		 * @param points 需求的功能点数组
		 * @param developer 当前开发人员
		 * @param existing 已存在的任务数组
		 * @param makeId 生成任务 id；测试里传确定值，页面里用 newId()
		 * @returns 合并后的完整任务数组（新的在前，保持与功能点一致的顺序）
		 */
		function seedTasks(points, developer, existing, makeId) {
			const list = Array.isArray(points) ? points : [];
			const current = Array.isArray(existing) ? existing : [];
			const taken = new Set();
			for (const task of current) if (typeof task.pointId === 'string' && task.pointId !== '') taken.add(task.pointId);
			const id = typeof makeId === 'function' ? makeId : newId;

			const added = [];
			for (const point of list) {
				if (point === null || point === undefined) continue;
				if (point.assignee !== developer) continue;
				if (typeof point.id !== 'string' || point.id === '') continue;
				if (taken.has(point.id)) continue;
				taken.add(point.id);
				added.push({
					id: id(),
					pointId: point.id,
					title: typeof point.name === 'string' ? point.name : '',
					estimate: 0,
					done: false,
				});
			}
			return current.concat(added);
		}

		/**
		 * 「让 AI 出方案」发给对话的指令。
		 *
		 * 这段文字是**插件与 AI 之间唯一的契约**：插件只负责把需求编号、开发者、
		 * 目标文件路径和产物形状写清楚，AI 用自己已有的文件工具去读需求、写方案，
		 * 写完页面自动刷新。所以这里必须把路径和 JSON 形状写死 —— 少一项，
		 * AI 就得猜，猜错就等于没写。
		 *
		 * @param input { id, title, developer, root, points, hasDraft }
		 */
		function designPrompt(input) {
			const paths = designPaths(input.developer);
			const abs = (relative) => input.root + '/' + input.id + '/' + relative;
			const mine = (Array.isArray(input.points) ? input.points : [])
				.filter((point) => point !== null && point !== undefined && point.assignee === input.developer);

			const lines = [];
			lines.push('请为需求 ' + input.id + '《' + input.title + '》撰写「方案」阶段的产物。');
			lines.push('');
			lines.push('写作对象是开发人员「' + input.developer + '」这一条按人管线（方案按人分开，你只写这个人的）。');
			lines.push('');
			lines.push('【先读需求】');
			lines.push('1. ' + abs(REQUIREMENT_FILE) + '（标题、三个关键日期、功能点与分派）');
			lines.push('2. ' + abs(PIPELINE_DIR + '/需求/parsed/') + ' 下的最新版本正文（有多个版本时取版本号最大的那个）');
			lines.push('');
			lines.push('【本次要写的文件】');
			if (input.hasDraft) {
				lines.push('（已有一版正文，请**先读它**，在保留其中有效内容的前提下改写，不要从零重写）');
			}
			lines.push('1. ' + abs(paths.draft) + '  ← 方案正文，Markdown');
			lines.push('2. ' + abs(paths.impact) + '  ← 影响面分析，JSON：');
			lines.push('   { "schema": 1, "modules": "一行一个受影响模块/文件", "risk": "low|medium|high", "rollback": "出问题怎么退回", "dependencies": "依赖与前置条件", "updatedAt": "ISO 时间" }');
			lines.push('3. ' + abs(paths.tasks) + '  ← 任务拆分，JSON：');
			lines.push('   { "schema": 1, "developer": "' + input.developer + '", "tasks": [ { "id": "随机 id", "pointId": "来源功能点编号，没有就填空串", "title": "任务内容", "estimate": 预估人天数字, "done": false } ], "updatedAt": "ISO 时间" }');
			lines.push('4. ' + abs(paths.apis) + '  ← **后端接口清单**，JSON：');
			lines.push('   ' + designListShapeText(DESIGN_LISTS.apis, input.developer));
			lines.push('5. ' + abs(paths.pages) + '  ← **前端页面清单**，JSON：');
			lines.push('   ' + designListShapeText(DESIGN_LISTS.pages, input.developer));
			lines.push('');
			lines.push('【正文要写到的内容】');
			lines.push('1. 目标与范围：这个需求要解决什么，明确不做什么');
			lines.push('2. 总体思路：怎么做，为什么这么做（有取舍就写清楚取舍）');
			lines.push('3. 改动点：具体改哪里，按模块列');
			lines.push('4. 影响面：会不会影响已有功能、数据、接口');
			lines.push('5. 风险与回滚：最可能出问题的地方，以及怎么退回');
			lines.push('6. 任务拆分建议：要做的活，与第 3 个文件对应');
			if (mine.length > 0) {
				lines.push('');
				lines.push('【分派给「' + input.developer + '」的功能点】（任务拆分要能对上它们）');
				for (const point of mine) lines.push('- ' + (point.name || '(未命名)') + '（' + point.id + '）');
			}
			// 阶段专属规则（见 STAGE_RULES）：与阶段页同一套口径，改一处两边都变。
			for (const line of STAGE_RULES.design) {
				lines.push('');
				lines.push(line);
			}
			lines.push('');
			lines.push('【纪律】');
			lines.push('- 只写上面列出的五个文件，**不要改动需求层的任何文件**（requirement.json、Pipeline/需求/ 下的东西）。');
			lines.push('- 五个文件都用 UTF-8、LF 换行；三个 JSON 都必须是能被 JSON.parse 解析的合法 JSON。');
			lines.push('- 写完用一两句话告诉我写了什么，不要复述正文全文。');
			for (const line of subagentDirective('方案', input)) lines.push(line);
			return lines.join('\n');
		}

		/**
		 * 「汇总方案」发给对话的指令。
		 *
		 * 与 `designPrompt` 的关键差别：这次的读者是**主导者**，要的是"整体开发概念"，
		 * 所以指令的重点不是把方案写出来，而是**横向对照** —— 谁做什么、彼此有没有分歧、
		 * 哪些功能点漏了、谁必须先做完、合计多少投入。
		 *
		 * 同样地，路径与"只准写这一个文件"都必须写死：AI 很热心地"顺手"去改别人的方案，
		 * 正是这个动作最危险的失败方式。
		 *
		 * @param input { id, title, root, developers }
		 */
		function designSummaryPrompt(input) {
			const abs = (relative) => input.root + '/' + input.id + '/' + relative;
			const developers = Array.isArray(input.developers) ? input.developers : [];

			const lines = [];
			lines.push('请为需求 ' + input.id + '《' + input.title + '》汇总整个「方案」阶段，');
			lines.push('产出一份**给主导者看的整体开发概念**。现在正是协同开始的时候，主导者需要一眼看清全貌。');
			lines.push('');
			lines.push('【先读】');
			lines.push('1. ' + abs(REQUIREMENT_FILE) + '（标题、关键日期、功能点与分派）');
			lines.push('2. ' + abs(DESIGN_DIR + '/') + ' 下**每一个**子目录（每人含 draft.md / impact.json / tasks.json / design.json）；');
			lines.push('   请真的去列一遍目录，不要只按下面这份名单 —— 名单可能不全，也可能有人已经写了但没登记。');
			lines.push('   还没写方案的人**要如实指出**，不要替他补写。');
			if (developers.length > 0) {
				lines.push('   需求里登记的开发人员：' + developers.join('、'));
			}
			lines.push('3. ' + abs(PIPELINE_DIR + '/需求/parsed/') + ' 的最新版本正文（有多个版本时取版本号最大的）');
			lines.push('');
			lines.push('【本次要写的唯一文件】');
			lines.push(abs(designSummaryPath()) + '  ← 方案汇总，Markdown');
			lines.push('');
			lines.push('【内容要求】');
			lines.push('1. **整体开发概念**：先用一段话讲清楚这次整体打算怎么做、分几步走 —— 给不写代码的人也能看懂，这段放最前面');
			lines.push('2. **各人方案对照**：一张表，每行一个开发人员，列出「负责的功能点 / 思路要点 / 任务数 / 预估人天 / 是否已写方案」');
			lines.push('3. **分歧与冲突**：两个人对同一处的不同做法要**点名是谁与谁**、分歧点在哪、建议怎么定');
			lines.push('4. **覆盖缺口**：哪些功能点还没有人写方案、或者还没有对应任务 —— 这是主导者最需要看到的');
			lines.push('5. **依赖与顺序**：谁的活必须先做完，谁在等谁');
			lines.push('6. **投入汇总**：按人列出任务数与预估人天，给出合计');
			lines.push('7. **风险汇总**：各人的风险等级与回滚要点，挑出最需要盯的两三条');
			lines.push('');
			lines.push('【纪律】');
			lines.push('- **只写上面那一个文件**。');
			lines.push('- **绝不修改任何人的方案文件**（draft.md / impact.json / tasks.json / design.json），也不要动需求层');
			lines.push('  —— 汇总只负责**描述**分歧，不替人做决定，更不替人改稿。');
			lines.push('- 用 UTF-8、LF 换行；对照表用 Markdown 表格；写完用一两句话说明结论，不要复述全文。');
			for (const line of subagentDirective('方案汇总', input)) lines.push(line);
			return lines.join('\n');
		}

		// ────────────────────────────────────────────────────────────────────
		// 6.4 文档生成：模板 → 渲染 → 写盘
		//
		// 现实流程里最终要交给流程系统的是**文档**（方案文档、自测报告、提版文档），
		// 而工作台里放的是**数据**（清单、任务、变更、自测）。这一节就是两者之间的那一步。
		//
		// 三条原则，都是"文档生成"这类功能最容易翻车的地方：
		//   ① **模板是人写的文字，不是代码。** 语法只有三种（{{path}} / {{#each}} / {{#if}}），
		//      把公司的 Word 模板搬进来，就是"粘文字 + 插占位符"。刻意**不支持嵌套循环** ——
		//      模板要给人手写，嵌套语法一进来就没法维护；需要嵌套就把数据拍平（行里冗余一个
		//      `pointName` 这类字段）。
		//   ② **缺字段必须看得见。** 文档级字段取不到值一律渲染成「（待补：路径）」并列成清单，
		//      绝不静默留空 —— 一份看起来完整、实际缺内容的方案，比明写着"待补"的危险得多。
		//      （唯一的例外是列表项里的空单元格：那一格本来就是"没写"，见 renderScalar。）
		//   ③ **生成物可复现。** 重生成直接覆盖，文件头写明用了哪份模板、什么时候、读了什么。
		//      要改就改数据源，不要改生成物本身。
		//
		// 模板放**客户端半边**（不是宿主）：改模板机制只要热更新，不用重启 DSH。
		// ────────────────────────────────────────────────────────────────────

		/**
		 * 文档种类 → 模板在宿主 `TEMPLATE_DIRS` 里的阶段目录名。
		 *
		 * 模板放在**工作台根**的 `templates/<阶段>/` 下（由宿主的 `ensureLayout` 建好），
		 * 不是每条需求一份：公司模板是**一套**，改一次全工作台生效。
		 * 也正因为它不在需求文件夹里，客户端读不到 —— 走 `readTemplate` 这个宿主 op。
		 */
		const DOC_TEMPLATE_STAGE = { design: '方案' };

		/** 文档种类 → 模板文件名。命名与生成物同名，少一层记忆负担。 */
		const DOC_TEMPLATE_FILE = { design: '方案文档.md' };

		/** 生成物里会列出的数据源（写进生成头，便于日后追溯）。 */
		const DOC_SOURCES = ['draft.md', 'impact.json', 'tasks.json', 'apis.json', 'pages.json'];

		/** 占位符词法：{{path}} / {{#each path}} / {{#if path}} / {{else}} / {{/each}} / {{/if}}。 */
		const TAG_PATTERN = /\{\{([#/]?)([^{}]*)\}\}/g;

		/**
		 * 「取不到值」时渲染成什么。
		 *
		 * 刻意**不是空串**：文档缺字段必须看得见。空串会让一份文档看起来完整，
		 * 而实际上某个该说的东西一个字都没写 —— 那是最难被发现的一类问题。
		 */
		function pendingText(path) {
			return '（待补：' + path + '）';
		}

		/** 点号取值；任一段缺失就返回 undefined。 */
		function lookupValue(scope, path) {
			const parts = String(path).split('.');
			let current = scope;
			for (const part of parts) {
				if (current === null || current === undefined || typeof current !== 'object') return undefined;
				current = current[part];
			}
			return current;
		}

		/** 值算不算「有内容」：空串 / 空数组 / 0 / false / undefined 都算没有。 */
		function hasValue(value) {
			if (value === undefined || value === null || value === false) return false;
			if (typeof value === 'string') return value.trim() !== '';
			if (Array.isArray(value)) return value.length > 0;
			if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
			return true;
		}

		/**
		 * 标量渲染。
		 *
		 * 文档级字段取不到值 → 登记进 `missing` 并显示「（待补：路径）」。
		 * **列表项里的空字段留空**（`inItem`）：表格里某一行的备注没写就是没写，
		 * 每格都印「待补」反而会把真正的缺口淹掉 —— 而真正的缺口正是这套机制要暴露的东西。
		 */
		function renderScalar(scope, path, missing, inItem) {
			const value = lookupValue(scope, path);
			if (!hasValue(value)) {
				if (inItem) return '';
				missing.push(path);
				return pendingText(path);
			}
			if (Array.isArray(value)) return value.join('、');
			if (typeof value === 'boolean') return value ? '是' : '否';
			return String(value);
		}

		/** 模板 → token 序列。 */
		function tokenizeTemplate(text) {
			const tokens = [];
			let cursor = 0;
			TAG_PATTERN.lastIndex = 0;
			let match = TAG_PATTERN.exec(text);
			while (match !== null) {
				if (match.index > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, match.index) });
				const marker = match[1];
				const name = match[2].trim();
				if (marker === '#') tokens.push({ kind: 'open', name });
				else if (marker === '/') tokens.push({ kind: 'close', name });
				else if (name === 'else') tokens.push({ kind: 'else' });
				else tokens.push({ kind: 'var', name });
				cursor = match.index + match[0].length;
				match = TAG_PATTERN.exec(text);
			}
			if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) });
			return tokens;
		}

		/**
		 * token → 块树。
		 *
		 * 标签不成对、不认识的块、嵌套循环都**直接抛错**，不猜、不降级：
		 * 一份半成品文档比一个明确的报错糟糕得多（用户会照着它去开发）。
		 */
		function buildTemplateTree(tokens) {
			const root = [];
			const stack = [{ list: root, block: null }];
			for (const token of tokens) {
				const frame = stack[stack.length - 1];
				if (token.kind === 'text' || token.kind === 'var') { frame.list.push(token); continue; }
				if (token.kind === 'open') {
					const space = token.name.indexOf(' ');
					const type = space === -1 ? token.name : token.name.slice(0, space);
					const path = space === -1 ? '' : token.name.slice(space + 1).trim();
					if ((type !== 'each' && type !== 'if') || path === '') {
						throw new Error('模板里有不认识的块：{{#' + token.name + '}}（只支持 each 与 if）');
					}
					if (type === 'each' && stack.some((entry) => entry.block !== null && entry.block.type === 'each')) {
						throw new Error('模板不支持嵌套循环（' + path + '）：需要嵌套就把数据拍平成一行一个字段');
					}
					const node = { kind: 'block', type, path, body: [], alt: null };
					frame.list.push(node);
					stack.push({ list: node.body, block: node });
					continue;
				}
				if (token.kind === 'else') {
					if (frame.block === null || frame.block.type !== 'if' || frame.block.alt !== null) {
						throw new Error('模板里的 {{else}} 没有对应的 {{#if}}');
					}
					frame.block.alt = [];
					stack[stack.length - 1] = { list: frame.block.alt, block: frame.block };
					continue;
				}
				if (frame.block === null || frame.block.type !== token.name) {
					throw new Error('模板标签不成对：{{/' + token.name + '}}');
				}
				stack.pop();
			}
			if (stack.length !== 1) {
				const open = stack[stack.length - 1].block;
				throw new Error('模板里有没闭合的块：{{#' + open.type + ' ' + open.path + '}}');
			}
			return root;
		}

		/** 渲染块树。`inItem` = 当前在列表项作用域里（见 `renderScalar`）。 */
		function renderNodes(nodes, scope, missing, inItem) {
			let out = '';
			for (const node of nodes) {
				if (node.kind === 'text') { out += node.text; continue; }
				if (node.kind === 'var') { out += renderScalar(scope, node.name, missing, inItem === true); continue; }
				const value = lookupValue(scope, node.path);
				if (node.type === 'if') {
					if (hasValue(value)) out += renderNodes(node.body, scope, missing, inItem);
					else if (node.alt !== null) out += renderNodes(node.alt, scope, missing, inItem);
					continue;
				}
				// each：不是数组就当空（模板用 {{#if}} / {{else}} 兜底，别在这里猜）。
				const list = Array.isArray(value) ? value : [];
				for (let index = 0; index < list.length; index += 1) {
					const item = list[index];
					// `index` 由渲染器注入（1 起）：表格的「#」列每张表都要，让每处数据自己算序号
					// 只会多出 N 份重复代码。行里同名字段以**数据里的为准**。
					const itemScope = item !== null && typeof item === 'object'
						? Object.assign({ index: String(index + 1) }, item)
						: { index: String(index + 1), value: item };
					out += renderNodes(node.body, itemScope, missing, true);
				}
			}
			return out;
		}

		/**
		 * 渲染一份模板。**纯函数**：同一个 scope 永远同样的输出，可以离线断言。
		 *
		 * @returns `{ text, missing }`；`missing` 是取不到值的占位符路径（去重、按出现顺序）。
		 */
		function renderTemplate(text, scope) {
			const missing = [];
			const tree = buildTemplateTree(tokenizeTemplate(typeof text === 'string' ? text : ''));
			const out = renderNodes(tree, scope !== null && typeof scope === 'object' ? scope : {}, missing);
			return { text: out, missing: [...new Set(missing)] };
		}

		/**
		 * 收集模板里引用到的**全部**占位符，列表项的字段用 `[]` 表示。
		 *
		 * 给自检用的：模板引用的每个字段都必须在 `DOC_SCOPE_KEYS` 里声明过。
		 * 没有这条，改一个字段名（或模板里写错一个字）文档只会**静默变空**，
		 * 而"空"在这种场景里看起来就像"这块本来就没内容"。
		 */
		function collectRefs(text) {
			const refs = [];
			const prefixes = [];
			// 前缀为空串 = 顶层作用域：此时不能再补一个点，否则收出来的键会变成 `.design.draft`
			// （这种键当然不在声明表里 —— 一次误报就够让人不再相信这条检查了）。
			const outer = () => (prefixes.length === 0 || prefixes[prefixes.length - 1] === '' ? '' : prefixes[prefixes.length - 1] + '.');
			for (const token of tokenizeTemplate(typeof text === 'string' ? text : '')) {
				if (token.kind === 'var') { refs.push(outer() + token.name); continue; }
				if (token.kind === 'open') {
					const space = token.name.indexOf(' ');
					const type = space === -1 ? token.name : token.name.slice(0, space);
					const path = space === -1 ? '' : token.name.slice(space + 1).trim();
					const listPath = outer() + path;
					refs.push(listPath);
					// each 之后块内字段属于**列表项**；if 不换作用域（沿用当前前缀，含列表项）。
					prefixes.push(type === 'each' ? listPath + '[]' : (prefixes.length === 0 ? '' : prefixes[prefixes.length - 1]));
					continue;
				}
				if (token.kind === 'close') prefixes.pop();
			}
			return [...new Set(refs)];
		}

		/** 一个真实 scope 展开成同样的键表示法（数组取第一个元素），与 `collectRefs` 对得上。 */
		function scopeKeys(scope) {
			const out = [];
			(function walk(value, prefix) {
				if (Array.isArray(value)) {
					if (prefix !== '') out.push(prefix);
					if (value.length > 0) walk(value[0], prefix + '[]');
					return;
				}
				if (value !== null && value !== undefined && typeof value === 'object') {
					if (prefix !== '') out.push(prefix);
					for (const key of Object.keys(value)) walk(value[key], prefix === '' ? key : prefix + '.' + key);
					return;
				}
				if (prefix !== '') out.push(prefix);
			})(scope, '');
			return [...new Set(out)];
		}

		/**
		 * 任务号：**由任务在数组里的次序推出来**，不落盘。
		 *
		 * `tasks.json` 里没有 T 号，而《方案汇总》的人天表就是按这个规则写的
		 * （T01…T44；功能点 16「客户合并」的任务排在最后，所以是 T44）。
		 * 渲染器用同一条规则，生成文档里的任务号才不会和汇总打架。
		 */
		function taskNo(index) {
			return 'T' + String(index + 1).padStart(2, '0');
		}

		/**
		 * 把正文按二级标题切开。
		 *
		 * 只认 `## `（与需求分析的 `extractSection` 同一套口味），三级及以下标题留在正文里。
		 * 返回值里 `preamble` 是第一个二级标题之前的引言 —— 丢掉它，正文开头那段总述就没了。
		 */
		function parseDraftSections(markdown) {
			const text = typeof markdown === 'string' ? markdown : '';
			const sections = [];
			const preamble = [];
			let current = null;
			for (const line of text.split('\n')) {
				const match = /^##\s+(.*)$/.exec(line);
				if (match !== null) {
					current = { title: match[1].trim(), lines: [] };
					sections.push(current);
					continue;
				}
				if (current === null) preamble.push(line);
				else current.lines.push(line);
			}
			return {
				preamble: preamble.join('\n').trim(),
				sections: sections.map((section) => ({ title: section.title, body: section.lines.join('\n').trim() })),
			};
		}

		/** 分派给某个人的功能点（文档里的「功能点覆盖」与计数都用它）。 */
		function minePoints(requirement, developer) {
			const points = requirement !== null && requirement !== undefined && Array.isArray(requirement.featurePoints)
				? requirement.featurePoints
				: [];
			return points.filter((point) => point !== null && typeof point === 'object' && point.assignee === developer);
		}

		/**
		 * 方案文档要用到的**全部**字段。
		 *
		 * 这里刻意返回**字符串化的值**（数字、布尔都转成文本）：模板是给人读的文档，
		 * 拼进 markdown 表格里的东西一律是文本，省得模板里还要考虑格式。
		 *
		 * 同时它是**契约的实物**：`DOC_SCOPE_KEYS` 声明的键必须都能在这里取到，
		 * 自检拿两边对照 —— 改了字段名而没改模板（或反过来），自检立刻红。
		 */
		function designDocScope(input) {
			const text = (value) => (typeof value === 'string' ? value : '');
			const requirement = input.requirement !== null && typeof input.requirement === 'object' ? input.requirement : {};
			const design = input.design;
			const developer = text(input.developer);
			const allPoints = Array.isArray(requirement.featurePoints) ? requirement.featurePoints : [];
			const tasks = Array.isArray(design.tasks) ? design.tasks : [];
			const points = minePoints(requirement, developer);
			const summary = taskSummary(tasks);
			const parsed = parseDraftSections(design.draft);

			const nameOfPoint = (pointId) => {
				for (const point of allPoints) {
					if (point !== null && point !== undefined && point.id === pointId) return text(point.name);
				}
				return '';
			};
			const withIndex = (rows) => rows.map((row, index) => Object.assign({}, row, { index: String(index + 1) }));
			const taskRows = tasks.map((task, index) => ({
				index: String(index + 1),
				taskNo: taskNo(index),
				title: taskLabel(task, allPoints),
				estimate: String(typeof task.estimate === 'number' ? task.estimate : 0),
				pointName: nameOfPoint(task.pointId),
				doneText: task.done === true ? '是' : '否',
			}));
			const pointRows = points.map((point, index) => ({
				index: String(index + 1),
				name: text(point.name),
				group: text(point.group),
				taskNos: tasks
					.map((task, at) => (task !== null && task !== undefined && task.pointId === point.id ? taskNo(at) : ''))
					.filter((value) => value !== '')
					.join('、'),
			}));
			const impact = design.impact;
			const section = {};
			for (const entry of parsed.sections) if (entry.title !== '') section[entry.title] = entry.body;

			return {
				requirement: {
					id: text(requirement.id),
					title: text(requirement.title),
					status: text(requirement.status),
					developers: Array.isArray(requirement.developers) ? requirement.developers.join('、') : '',
					releaseDate: text(requirement.releaseDate),
					testFreezeDate: text(requirement.testFreezeDate),
					goLiveDate: text(requirement.goLiveDate),
				},
				developer,
				generatedAt: text(input.generatedAt),
				templateSource: text(input.templateSource),
				design: {
					draft: text(design.draft),
					preamble: parsed.preamble,
					sections: parsed.sections,
					// 动态键（按标题取小节）：不进声明表，模板里想用可以直接写标题。
					section,
					pointCount: String(pointRows.length),
					taskCount: String(summary.count),
					effortTotal: String(summary.days),
					apiCount: String(design.apis.length),
					pageCount: String(design.pages.length),
					points: pointRows,
					tasks: taskRows,
					apis: withIndex(design.apis),
					pages: withIndex(design.pages),
				},
				// 影响面整个文件缺失时给 undefined（而不是四个空串）：那样模板里三处都会
				// 显示「待补」，比"一片空白"更早让人发现"影响面还没写"。
				impact: impact === null || impact === undefined ? undefined : {
					risk: text(impact.risk),
					modules: text(impact.modules),
					rollback: text(impact.rollback),
					dependencies: text(impact.dependencies),
				},
			};
		}

		/**
		 * 模板与数据的**字段契约**：模板里能引用哪些占位符。
		 *
		 * 这张表是自检的基准 —— 内置模板里出现的每个占位符都必须在这里，
		 * 而这张表里的每个键都必须能从真实 scope 里取到。两边同时成立，才叫"契约"。
		 */
		const DOC_SCOPE_KEYS = {
			design: [
				'requirement.id', 'requirement.title', 'requirement.status', 'requirement.developers',
				'requirement.releaseDate', 'requirement.testFreezeDate', 'requirement.goLiveDate',
				'developer', 'generatedAt', 'templateSource',
				'design.draft', 'design.preamble', 'design.sections', 'design.sections[].title', 'design.sections[].body',
				'design.section',
				'design.pointCount', 'design.taskCount', 'design.effortTotal', 'design.apiCount', 'design.pageCount',
				'design.points', 'design.points[].index', 'design.points[].name', 'design.points[].group', 'design.points[].taskNos',
				'design.tasks', 'design.tasks[].index', 'design.tasks[].taskNo', 'design.tasks[].title',
				'design.tasks[].estimate', 'design.tasks[].pointName', 'design.tasks[].doneText',
				'design.apis', 'design.apis[].index', 'design.apis[].pointName', 'design.apis[].taskNo', 'design.apis[].name',
				'design.apis[].method', 'design.apis[].path', 'design.apis[].change', 'design.apis[].request',
				'design.apis[].response', 'design.apis[].note',
				'design.pages', 'design.pages[].index', 'design.pages[].pointName', 'design.pages[].taskNo', 'design.pages[].name',
				'design.pages[].route', 'design.pages[].change', 'design.pages[].blocks', 'design.pages[].interaction', 'design.pages[].note',
				'impact.risk', 'impact.modules', 'impact.rollback', 'impact.dependencies',
			],
		};

		/**
		 * 内置默认模板：方案文档。
		 *
		 * 顺序按**读者的需要**排：先说这需求要干什么（正文），再说**要改哪些接口、哪些页面**
		 * （这正是现实流程里方案要回答的两个问题），然后是影响面与任务。
		 *
		 * 用户可以在 `templates/方案/方案文档.md` 放一份自己的模板整份替换；
		 * 只改文字、不动占位符是最省事的用法。
		 */
		const BUILTIN_DOCS = {
			design: [
				'# {{requirement.title}} · 方案设计',
				'',
				'- 需求编号：{{requirement.id}}',
				'- 开发人员：{{developer}}',
				'- 需求状态：{{requirement.status}}',
				'- 提版日期：{{requirement.releaseDate}}',
				'- 测试封板：{{requirement.testFreezeDate}}',
				'- 上线日期：{{requirement.goLiveDate}}',
				'- 生成时间：{{generatedAt}}',
				'- 模板来源：{{templateSource}}',
				'',
				'> 本文档由工作台按模板生成，数据源：方案正文、影响面、任务拆分、接口清单、页面清单。',
				'> 要看最新内容请重新生成，不要直接改这份文件。',
				'',
				'## 一、需求与目标',
				'',
				'{{#if design.sections}}{{#if design.preamble}}{{design.preamble}}',
				'',
				'{{/if}}{{#each design.sections}}### {{title}}',
				'',
				'{{body}}',
				'',
				'{{/each}}{{else}}{{design.draft}}{{/if}}',
				'## 二、后端接口清单（新增 / 修改）',
				'',
				'{{#if design.apis}}共 {{design.apiCount}} 个接口。',
				'{{else}}（待补：接口清单 apis.json 还没有内容。没有可改的既有工程时，这里写**需要新增**哪些接口；',
				'路径未定就写「路径待确认」，不要编一个像真的的路径。）',
				'{{/if}}',
				'',
				'{{#if design.apis}}',
				'| # | 来源功能点 | 任务号 | 接口名 | 方法 | 路径 | 新增/修改 | 入参要点 | 出参要点 | 备注 |',
				'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
				'{{#each design.apis}}| {{index}} | {{pointName}} | {{taskNo}} | {{name}} | {{method}} | {{path}} | {{change}} | {{request}} | {{response}} | {{note}} |',
				'{{/each}}',
				'{{else}}',
				'（待补：接口清单 apis.json 还没有内容。没有可改的既有工程时，这里写**需要新增**哪些接口；',
				'路径未定就写「路径待确认」，不要编一个像真的的路径。）',
				'{{/if}}',
				'',
				'## 三、前端页面清单（新增 / 修改）',
				'',
				'{{#if design.pages}}共 {{design.pageCount}} 个页面。',
				'{{else}}（待补：页面清单 pages.json 还没有内容。）',
				'{{/if}}',
				'',
				'{{#if design.pages}}',
				'| # | 来源功能点 | 任务号 | 页面名 | 路由 / 入口 | 新增/修改 | 页面区块 | 关键交互 | 备注 |',
				'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
				'{{#each design.pages}}| {{index}} | {{pointName}} | {{taskNo}} | {{name}} | {{route}} | {{change}} | {{blocks}} | {{interaction}} | {{note}} |',
				'{{/each}}',
				'{{else}}',
				'（待补：页面清单 pages.json 还没有内容。）',
				'{{/if}}',
				'',
				'## 四、影响面与风险',
				'',
				'- 风险等级：{{impact.risk}}',
				'',
				'### 受影响的数据 / 接口 / 模块',
				'',
				'{{impact.modules}}',
				'',
				'### 出问题怎么退回',
				'',
				'{{impact.rollback}}',
				'',
				'### 依赖与前置条件',
				'',
				'{{impact.dependencies}}',
				'',
				'## 五、任务拆分与工时',
				'',
				'| 任务号 | 任务内容 | 来源功能点 | 预估人天 | 完成 |',
				'| --- | --- | --- | --- | --- |',
				'{{#each design.tasks}}| {{taskNo}} | {{title}} | {{pointName}} | {{estimate}} | {{doneText}} |',
				'{{/each}}',
				'',
				'合计：{{design.taskCount}} 个任务，预估 {{design.effortTotal}} 人天。',
				'',
				'## 六、功能点覆盖',
				'',
				'| # | 功能点 | 分块 | 关联任务 |',
				'| --- | --- | --- | --- |',
				'{{#each design.points}}| {{index}} | {{name}} | {{group}} | {{taskNos}} |',
				'{{/each}}',
				'',
			].join('\n'),
		};

		/**
		 * 读需求级自定义模板。
		 *
		 * 三种结果要分清楚，因为它们的**处理方式完全不同**：
		 *   - 读到内容 → 用它；
		 *   - `not-found`（还没放模板）→ 用内置默认，**正常**；
		 *   - `unknown-op`（宿主还是旧版本、没重启）→ 也用内置默认，但**必须告诉用户**
		 *     "你放在 templates/ 里的模板现在没生效"。静默回落等于骗人：用户改了半天模板，
		 *     生成的文档却一点没变，而且没有任何提示。
		 */
		async function readTemplateOrNull(kind) {
			const stage = DOC_TEMPLATE_STAGE[kind];
			const file = DOC_TEMPLATE_FILE[kind];
			if (typeof stage !== 'string' || typeof file !== 'string') return { text: '', path: '', unsupported: false };
			try {
				const value = await callWorkbench('readTemplate', { args: { stage, file } });
				const text = typeof value.text === 'string' ? value.text : '';
				return { text, path: typeof value.path === 'string' ? value.path : '', unsupported: false };
			} catch (error) {
				const reason = String(error && error.message ? error.message : error);
				return { text: '', path: '', unsupported: /unknown-op/.test(reason) };
			}
		}

		/** 模板在磁盘上的位置（提示文案用；没读到模板时也能说清该把文件放哪）。 */
		function templateHint(kind) {
			const stage = DOC_TEMPLATE_STAGE[kind];
			const file = DOC_TEMPLATE_FILE[kind];
			return typeof stage === 'string' && typeof file === 'string' ? 'templates/' + stage + '/' + file : '';
		}

		/**
		 * 生成头 —— **这份文档是哪来的**。
		 *
		 * 日后翻出一份方案文档，必须能立刻回答"用的哪份模板、什么时候生成的、读了哪些数据"；
		 * 否则重新生成一次之后，没人说得清内容为什么变了。
		 */
		function docHeader(input) {
			const source = typeof input.templatePath === 'string' && input.templatePath !== ''
				? input.templatePath
				: '内置默认模板';
			return '<!-- 工作台生成 · 模板=' + source + ' · 时间=' + input.generatedAt
				+ ' · 数据源=' + DOC_SOURCES.join(' + ') + ' -->';
		}

		/**
		 * 渲染方案文档（**不写盘**）。
		 *
		 * 渲染与写盘刻意分开：用户要能先看预览再决定。一份按模板渲染的文档直接落盘之后，
		 * 才发现缺了三个字段就已经晚了 —— 而"缺字段"恰恰是最常见的情况。
		 *
		 * @returns `{ text, missing, templatePath, templateUnsupported, hasContent, generatedAt }`
		 */
		async function renderDesignDoc(input) {
			const id = input.id;
			const developer = typeof input.developer === 'string' ? input.developer : '';
			const paths = designPaths(developer);
			const custom = await readTemplateOrNull('design');
			const results = await Promise.all([
				readTextOrNull(id, paths.draft),
				readJsonOrNull(id, paths.impact),
				readJsonOrNull(id, paths.tasks),
				readJsonOrNull(id, paths.apis),
				readJsonOrNull(id, paths.pages),
			]);
			const design = designState({
				draft: results[0], impact: results[1], tasks: results[2], apis: results[3], pages: results[4],
			});
			const generatedAt = new Date().toISOString();
			const useCustom = custom.text.trim() !== '';
			const scope = designDocScope({
				requirement: input.requirement,
				developer,
				design,
				generatedAt,
				templateSource: useCustom ? '自定义模板 ' + custom.path : '内置默认模板',
			});
			const rendered = renderTemplate(useCustom ? custom.text : BUILTIN_DOCS.design, scope);
			return {
				text: rendered.text,
				missing: rendered.missing,
				templatePath: useCustom ? custom.path : '',
				templateUnsupported: custom.unsupported,
				generatedAt,
				// 数据源全空时不生成空壳：一份只有标题和「待补」的文档，交上去不如不交。
				hasContent: design.draft.trim() !== ''
					|| design.apis.length > 0 || design.pages.length > 0 || design.tasks.length > 0,
			};
		}

		/** 生成头 + 正文（写盘与复制都用这一份，保证两边逐字一致）。 */
		function designDocFile(rendered) {
			return docHeader({ templatePath: rendered.templatePath, generatedAt: rendered.generatedAt })
				+ '\n\n' + rendered.text.trim() + '\n';
		}

		/**
		 * 把内置模板摊到 `templates/<阶段>/`，让人在它上面改成公司模板。
		 *
		 * 宿主的 `writeTemplate` **拒绝覆盖**已存在的文件：这个动作只是"给个起点"，
		 * 一次点击抹掉别人改好的模板是不可逆的损失。要恢复内置版就先把文件删掉。
		 */
		async function writeBuiltinTemplate() {
			const stage = DOC_TEMPLATE_STAGE.design;
			const file = DOC_TEMPLATE_FILE.design;
			return callWorkbench('writeTemplate', { args: { stage, file, text: BUILTIN_DOCS.design + '\n' } });
		}

		/**
		 * 每个开发人员的方案进度 —— 主导者要的「整体」。
		 *
		 * 这一份是**跨人**的：一人三个读操作并行发出，所以总耗时约等于一个人的耗时，
		 * 而不是乘以人数。读不到的文件按「还没写」处理，不报错。
		 */
		async function loadRoster(id, developers) {
			const names = Array.isArray(developers) ? developers : [];
			return Promise.all(names.map(async (name) => {
				const paths = designPaths(name);
				const results = await Promise.all([
					readTextOrNull(id, paths.draft),
					readJsonOrNull(id, paths.impact),
					readJsonOrNull(id, paths.tasks),
					readJsonOrNull(id, paths.meta),
				]);
				const list = results[2] !== null && Array.isArray(results[2].tasks) ? results[2].tasks : [];
				const summary = taskSummary(list);
				return {
					name,
					hasDraft: results[0].trim() !== '',
					hasImpact: impactFilled(results[1]),
					tasks: summary.count,
					days: summary.days,
					done: summary.done,
					confirmed: results[3] !== null && typeof results[3].confirmedAt === 'string' && results[3].confirmedAt !== '',
				};
			}));
		}

		/** 全队预估人天合计。 */
		function rosterDays(roster) {
			const list = Array.isArray(roster) ? roster : [];
			let total = 0;
			for (const person of list) total += typeof person.days === 'number' ? person.days : 0;
			return Math.round(total * 10) / 10;
		}

		/** 还没写方案的人 —— 覆盖缺口里最要紧的一类。 */
		function rosterMissing(roster) {
			const list = Array.isArray(roster) ? roster : [];
			return list.filter((person) => person.hasDraft !== true).map((person) => person.name);
		}

		// ────────────────────────────────────────────────────────────────────
		// 6.3 开发 / 测试 / 提版：一份声明表驱动的通用阶段页
		//
		// 这三个页面在结构上是**同一件事**：一个阶段目录 + 几块产物，每块是一个文件、
		// 一种控件形态。所以它们由下面这张表驱动，而不是三段各写一遍 ——
		// 加一个阶段（或给某个阶段加一块）只是往表里加一行，页面、落盘、
		// 状态推导、给 AI 的指令会同时跟上。
		//
		// 产物文件都落在 `<阶段目录>/` 之下：开发与测试**按人**各一个子目录，
		// 提版是公共阶段，直接放在阶段目录下。
		// ────────────────────────────────────────────────────────────────────

		/**
		 * 一个阶段的产物声明。
		 *
		 * `kind` 决定控件形态：
		 *   rows      一组行，每行按 `columns` 定义渲染（`type` 省略即单行文本）
		 *   fields    几个标量字段
		 *   markdown  整篇文本
		 *
		 * `titleKey` 直接复用管线上的菜单文案 —— 菜单项和页面区块本来就是同一件事，
		 * 分两套文案迟早会各说各话。
		 */
		const STAGE_BLOCKS = {
			develop: [
				{
					file: 'changes.json', titleKey: 'menu.develop.changes', kind: 'rows',
					columns: [
						// 把每条变更挂到方案里的某个任务上 —— 任务的执行情况就是这样推出来的。
						{ key: 'taskId', labelKey: 'col.task', type: 'task', width: 200 },
						{ key: 'target', labelKey: 'col.target', placeholderKey: 'ph.target' },
						{ key: 'note', labelKey: 'col.note' },
						{ key: 'done', labelKey: 'col.done', type: 'check' },
					],
				},
				{
					file: 'commits.json', titleKey: 'menu.develop.commits', kind: 'rows',
					columns: [
						{ key: 'hash', labelKey: 'col.hash', width: 130, placeholderKey: 'ph.hash' },
						{ key: 'message', labelKey: 'col.message' },
					],
				},
				{
					file: 'selftest.json', titleKey: 'menu.develop.selfTest', kind: 'rows',
					columns: [
						{ key: 'item', labelKey: 'col.item', placeholderKey: 'ph.item' },
						{ key: 'result', labelKey: 'col.result', type: 'select', options: ['pending', 'pass', 'fail'] },
						{ key: 'note', labelKey: 'col.note' },
					],
				},
			],
			test: [
				{
					file: 'cases.json', titleKey: 'menu.test.cases', kind: 'rows',
					// 逐行【执行】：这一块的行是**可以被跑一遍**的东西（开发页的任务、
					// 测试页的用例），别的块不行 —— 执行记录、缺陷记录都不是"跑的对象"。
					// 声明成一行字，渲染器就只管照做，不需要认识阶段名。
					execute: 'case',
					columns: [
						{ key: 'name', labelKey: 'col.case', placeholderKey: 'ph.case' },
						{ key: 'expected', labelKey: 'col.expected' },
						{ key: 'result', labelKey: 'col.result', type: 'select', options: ['pending', 'pass', 'fail'] },
					],
				},
				{
					file: 'runs.json', titleKey: 'menu.test.runs', kind: 'rows',
					columns: [
						{ key: 'at', labelKey: 'col.at', width: 150, placeholderKey: 'ph.at' },
						{ key: 'passed', labelKey: 'col.passed', width: 90 },
						{ key: 'failed', labelKey: 'col.failed', width: 90 },
						{ key: 'note', labelKey: 'col.note' },
					],
				},
				{
					file: 'defects.json', titleKey: 'menu.test.defects', kind: 'rows',
					columns: [
						{ key: 'title', labelKey: 'col.defect', placeholderKey: 'ph.defect' },
						{ key: 'severity', labelKey: 'col.severity', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
						{ key: 'status', labelKey: 'col.status', type: 'select', options: ['open', 'fixing', 'fixed', 'closed'] },
					],
				},
			],
			release: [
				{
					file: 'release.json', titleKey: 'menu.release.version', kind: 'fields',
					fields: [
						{ key: 'version', labelKey: 'field.version', placeholderKey: 'ph.version' },
						{ key: 'releasedAt', labelKey: 'field.releasedAt', type: 'date' },
					],
				},
				{ file: 'changelog.md', titleKey: 'menu.release.changelog', kind: 'markdown' },
				{ file: 'notes.md', titleKey: 'menu.release.notes', kind: 'markdown' },
			],
		};

		/** 各阶段写产物之前要先读什么（给 AI 的指令用它，页面本身不读）。 */
		const STAGE_INPUTS = {
			develop: [DESIGN_DIR + '/', PIPELINE_DIR + '/需求/parsed/'],
			test: [PIPELINE_DIR + '/开发/', PIPELINE_DIR + '/方案/'],
			release: [PIPELINE_DIR + '/方案/', PIPELINE_DIR + '/开发/', PIPELINE_DIR + '/测试/', PIPELINE_DIR + '/需求/parsed/'],
		};

		/**
		 * 逐行【执行】的表：块声明里的 `execute` 值 → 那一段指令怎么生成、弹窗里说什么。
		 *
		 * 为什么用表而不是在渲染器里写 `if (stageId === 'test')`：按钮出现在哪些块上、
		 * 附带的说明是什么，都属于**声明**（与 `titleKey` / `columns` 同一性质）。
		 * 这样"给某个块加一个执行按钮"就是往表里加一行，渲染器永远不认识阶段名。
		 *
		 * 键名放在这里而不是用字符串拼：拼出来的键名（前缀 + 'Title' 那种写法）静态扫描
		 * （自检 [14]）一个都看不到，拼错了界面就显示原始 key，而没有东西拦得住。
		 */
		const BLOCK_EXECUTE = {
			case: {
				prompt: testCaseExecutePrompt,
				titleKey: 'case.execTitle',
				noteKey: 'case.execNote',
				writesKey: 'case.execWrites',
			},
		};

		/** 各阶段**额外的写作规则**，拼进给 AI 的指令里。
		 *
		 * 为什么要有这张表：阶段之间不只是"读什么、写什么"不同，**用力的地方**也不同，
		 * 而那只写在人脑子里 —— 换个会话、换个人让 AI 再跑一次，它就会按最省事的默认
		 * （穷举、堆量）去写，产出一堆没人会用的东西。规则只有**写进指令**才会每次都生效。
		 *
		 * 「测试」这一条尤其值得写死：这个阶段的性价比**不在用例数量上**。
		 * 每个功能点几十条边界（并发/幂等/事务/性能）看着很专业，实际没人跑、也不会因此
		 * 多抓到一个 bug；真正能兜住质量的是**让 AI 去读代码检查**（那是「开发」阶段自测的事）。
		 * 所以测试这一层只留**简单的接口测试**：一个接口一两条，验通不通、返回形状对不对。
		 */
		const STAGE_RULES = {
			/**
			 * 方案这一层的口径（用户明确过）：方案**核心目的是指导开发怎么动手**，
			 * 所以它必须先回答现实流程里的那两个问题 —— 后端要改或新增哪些接口、
			 * 前端要改或新增哪些页面 —— 再谈别的。
			 */
			design: [
				'【本阶段规则】方案的**核心目的是指导开发怎么动手**，不是写一篇综述。',
				'- **先出「接口清单」和「页面清单」两张表**（apis.json / pages.json），**再**写正文 —— 正文是这两张表的叙述版，不是把清单藏在正文里。',
				'- 接口清单要能回答"**后端要改或新增哪些接口**"：方法、路径、入参出参要点、新增还是修改。路径没定就写「路径待确认」—— 那是合法值，**不要编一个像真的路径**。',
				'- 页面清单要能回答"**前端要改或新增哪些页面**"：页面名、路由 / 入口、页面区块、关键交互。',
				'- **识别到可改的既有工程**时，正文要写到"改哪个文件、哪个方法、怎么改"；**没有识别到工程**（技术栈未定、手上没有代码库）时，就写"需要新增什么方法、入参与返回是什么"，用语言无关的写法（`方法名(入参) -> 返回`），**不要凭空写出源码路径或行号**。',
				'- 技术栈 / 框架 / 版本没确定就如实写「待确认」，不要假设一套然后照着写。',
			],
			test: [
				'【本阶段规则】这个阶段**不做功能点的完整详细测试** —— 不要为每个功能点穷举边界用例。',
				'- 代码质量由 **AI 自己读代码检查**（在「开发」阶段的自测里做），不靠这里堆用例。',
				'- 「测试用例」只写**简单的接口测试**：一个接口 1–2 条，验通不通、返回形状/状态码对不对、关键错误码有没有；总量控制在几十条以内。',
				'- 不要写并发 / 幂等 / 事务 / 性能 / 多阈值边界这类重型用例 —— 那是代码检查该管的，不是这一层的。',
			],
		};

		/** 按 id 找阶段定义。 */
		function stageOf(stageId) {
			for (const stage of STAGES) if (stage.id === stageId) return stage;
			return null;
		}

		/** 这个阶段是不是按人分开的。判定来源与管线划分一致。 */
		function stageIsPerPerson(stageId) {
			return PER_DEVELOPER_STAGE_IDS.includes(stageId);
		}

		/** 一个阶段的目录（相对需求文件夹）。按人阶段会带上这个人的子目录。 */
		function stageDir(stageId, developer) {
			const stage = stageOf(stageId);
			if (stage === null) return '';
			const base = PIPELINE_DIR + '/' + stage.dir;
			return stageIsPerPerson(stageId) ? base + '/' + developerSlug(developer) : base;
		}

		/** 一个阶段里某个产物的路径。 */
		function stageBlockPath(stageId, developer, file) {
			return stageDir(stageId, developer) + '/' + file;
		}

		/** 这个阶段有几块产物、都是什么文件。 */
		function stageBlocks(stageId) {
			const list = STAGE_BLOCKS[stageId];
			return Array.isArray(list) ? list : [];
		}

		/** 按列声明把一行读成规范形状；缺字段、类型不对都落回默认值。 */
		function normalizeRow(spec, item) {
			const source = item !== null && typeof item === 'object' ? item : {};
			const row = {};
			for (const column of spec.columns) {
				if (column.type === 'check') {
					row[column.key] = source[column.key] === true;
				} else if (column.type === 'select') {
					const options = Array.isArray(column.options) ? column.options : [];
					row[column.key] = options.includes(source[column.key]) ? source[column.key] : (options.length > 0 ? options[0] : '');
				} else {
					row[column.key] = typeof source[column.key] === 'string' ? source[column.key] : '';
				}
			}
			return row;
		}

		/** 读盘之后的一块产物。 */
		function blockState(spec, input) {
			if (spec.kind === 'markdown') {
				return { kind: 'markdown', text: typeof input.text === 'string' ? input.text : '' };
			}
			const source = input.json !== null && typeof input.json === 'object' ? input.json : {};
			if (spec.kind === 'fields') {
				const values = {};
				for (const field of spec.fields) {
					values[field.key] = typeof source[field.key] === 'string' ? source[field.key] : '';
				}
				return { kind: 'fields', values };
			}
			const items = Array.isArray(source.items) ? source.items : [];
			return { kind: 'rows', items: items.map((item) => normalizeRow(spec, item)) };
		}

		/** 空块（还没写过）。 */
		function emptyBlock(spec) {
			return blockState(spec, { json: null, text: '' });
		}

		/** 这一块写了东西没有。空表单不算。 */
		function blockFilled(spec, state) {
			if (state === null || state === undefined) return false;
			if (state.kind === 'markdown') return state.text.trim() !== '';
			if (state.kind === 'fields') {
				return spec.fields.some((field) => String(state.values[field.key] ?? '').trim() !== '');
			}
			return state.items.length > 0;
		}

		/** 取一块里的行（不是 rows 块就返回空数组）。 */
		function blockRows(states, file) {
			const state = states === null || states === undefined ? undefined : states[file];
			return state !== undefined && state !== null && state.kind === 'rows' ? state.items : [];
		}

		/**
		 * 各阶段的**完成条件** —— 全部满足才算「已审核」。
		 *
		 * 刻意定得朴素且可解释：条件写在界面上也说得通，不是凑出来的阈值。
		 * 只要有一块写了东西但没满足条件，状态就是「进行中」。
		 */
		const STAGE_DONE = {
			develop: (states) => {
				const changes = blockRows(states, 'changes.json');
				const checks = blockRows(states, 'selftest.json');
				return changes.length > 0 && changes.every((row) => row.done === true)
					&& checks.length > 0 && checks.every((row) => row.result === 'pass');
			},
			test: (states) => {
				const cases = blockRows(states, 'cases.json');
				const defects = blockRows(states, 'defects.json');
				return cases.length > 0 && cases.every((row) => row.result === 'pass')
					&& defects.every((row) => row.status === 'fixed' || row.status === 'closed');
			},
			release: (states) => {
				const version = states === null || states === undefined ? undefined : states['release.json'];
				const notes = states === null || states === undefined ? undefined : states['notes.md'];
				const hasVersion = version !== undefined && version !== null && String(version.values.version ?? '').trim() !== '';
				const hasNotes = notes !== undefined && notes !== null && notes.text.trim() !== '';
				return hasVersion && hasNotes;
			},
		};

		/**
		 * 一个阶段的真实状态。
		 *
		 * 一块都没写 → 未开始；写了但没满足完成条件 → 进行中；满足了 → 已审核。
		 * 阶段没有声明块（或没有完成条件）时，写没写就是全部依据。
		 */
		function stageVerdict(stageId, states) {
			const list = stageBlocks(stageId);
			if (list.length === 0) return null;
			if (!list.some((spec) => blockFilled(spec, states === null || states === undefined ? undefined : states[spec.file]))) {
				return 'pending';
			}
			const done = STAGE_DONE[stageId];
			return typeof done === 'function' && done(states) ? 'approved' : 'active';
		}

		// ────────────────────────────────────────────────────────────────────
		// 6.4 我的任务：方案 → 开发的连接点
		//
		// 任务是**方案**的一部分（在方案页生成、在方案页改），但在开发页才看得出做得怎么样。
		// 两边各管一头：
		//   方案页 → 做什么、多少工作量（`Pipeline/方案/<人>/tasks.json`）
		//   开发页 → 实际改了什么、勾没勾完（`Pipeline/开发/<人>/changes.json`）
		//
		// 执行情况**不另存一份状态**，而是从「变更清单里挂在这个任务上的行」推出来 ——
		// 任务只有一份真相，开发页只负责往上挂证据。多存一份状态就必然要同步，
		// 而同步迟早会不一致，到那时两个页面会各说各话。
		// ────────────────────────────────────────────────────────────────────

		/** 任务执行情况 → 文案键。同样用显式表，理由见 OPTION_KEY。 */
		const TASK_STATE_KEY = { todo: 'mine.todo', doing: 'mine.doing', done: 'mine.done' };

		/**
		 * 每个任务 + 它的执行情况。
		 *
		 * - 挂在这个任务下的变更**一条都没有** → 未开工
		 * - 挂了但还没全勾完 → 进行中
		 * - 挂了而且全勾完（或在方案页上手工勾了「完成」）→ 已完成
		 *
		 * @param tasks 方案里这个人的任务数组
		 * @param changes 开发页变更清单的行（带 `taskId`）
		 */
		function taskProgress(tasks, changes) {
			const list = Array.isArray(tasks) ? tasks : [];
			const rows = Array.isArray(changes) ? changes : [];
			return list.map((task) => {
				const id = task !== null && typeof task === 'object' && typeof task.id === 'string' ? task.id : '';
				const mine = id === '' ? [] : rows.filter((row) => row !== null && row !== undefined && row.taskId === id);
				const doneChanges = mine.filter((row) => row.done === true).length;
				let state = 'todo';
				if (task !== null && task.done === true) state = 'done';
				else if (mine.length > 0) state = doneChanges === mine.length ? 'done' : 'doing';
				return { task, changes: mine, state, doneChanges };
			});
		}

		/** 未开工 / 进行中 / 已完成 各几个。 */
		function progressSummary(rows) {
			const summary = { count: 0, todo: 0, doing: 0, done: 0 };
			for (const row of Array.isArray(rows) ? rows : []) {
				summary.count += 1;
				if (row.state === 'todo') summary.todo += 1;
				else if (row.state === 'doing') summary.doing += 1;
				else if (row.state === 'done') summary.done += 1;
			}
			return summary;
		}

		/**
		 * 覆盖缺口：**分派给我、但方案里一个任务都没有**的功能点。
		 *
		 * 「没有任务」里最要紧的一种 —— 不是任务没开工，而是这条活压根没人拆出来。
		 */
		function taskGaps(points, developer, tasks) {
			const mine = (Array.isArray(points) ? points : []).filter((point) => (
				point !== null && point !== undefined && point.assignee === developer
			));
			const list = Array.isArray(tasks) ? tasks : [];
			return mine.filter((point) => !list.some((task) => (
				task !== null && task !== undefined && task.pointId === point.id
			)));
		}

		/** 任务的显示名：优先用任务标题，没有就用来源功能点的名字，再没有就用 id。 */
		function taskName(task, points) {
			if (task !== null && task !== undefined && typeof task.title === 'string' && task.title.trim() !== '') return task.title;
			const list = Array.isArray(points) ? points : [];
			const pointId = task !== null && task !== undefined && typeof task.pointId === 'string' ? task.pointId : '';
			for (const point of list) if (point !== null && point !== undefined && point.id === pointId) return point.name;
			return task !== null && task !== undefined && typeof task.id === 'string' ? task.id : '';
		}

		/**
		 * 「执行这一个任务」发给对话的指令。
		 *
		 * 与 `stagePrompt` 的分工：那个是"把这一阶段的产物写一遍"，这个是"**动手做**其中一个
		 * 任务"。所以它读的是同一个人的方案（正文 / 影响面 / 接口清单 / 页面清单 / 任务拆分），
		 * 写的是**开发**阶段的证据 —— 变更清单里的行。
		 *
		 * 为什么必须要求 AI 落这些行：任务做没做，开发页是**从变更清单推出来的**
		 * （见 `taskProgress`）。AI 改了代码却不落盘，页面就仍然显示「未开工」——
		 * 那是界面在说谎，而用户会信它。
		 *
		 * `done` 一律先写 false：勾选是开发者本人的复核动作，不是 AI 的自我评价。
		 * 两个文件的形状由 `blockShapeText()` 从 `STAGE_BLOCKS` 生成，所以表改了指令就跟着改。
		 *
		 * @param input { id, title, developer, root, task, points }
		 */
		function taskExecutePrompt(input) {
			const task = input.task !== null && input.task !== undefined && typeof input.task === 'object' ? input.task : {};
			const points = Array.isArray(input.points) ? input.points : [];
			const paths = designPaths(input.developer);
			const abs = (relative) => input.root + '/' + input.id + '/' + relative;
			const changes = STAGE_BLOCKS.develop[0];
			const selftest = STAGE_BLOCKS.develop[2];
			const point = points.find((candidate) => candidate !== null && candidate !== undefined && candidate.id === task.pointId);
			const name = taskName(task, points);
			const taskId = typeof task.id === 'string' ? task.id : '';
			const estimate = typeof task.estimate === 'number' && task.estimate > 0 ? task.estimate : 0;

			const lines = [];
			lines.push('请实现需求 ' + input.id + '《' + input.title + '》里的**这一个任务**：' + (name === '' ? '（未命名任务）' : name));
			lines.push('（开发人员：' + input.developer
				+ '；任务 id：' + (taskId === '' ? '（无 id）' : taskId)
				+ (point === undefined || point === null ? '' : '；来源功能点：' + String(point.name))
				+ (estimate === 0 ? '' : '；预估 ' + estimate + ' 人天') + '）');
			lines.push('');
			lines.push('【先读这个人的方案，按它动手】');
			lines.push('1. ' + abs(REQUIREMENT_FILE) + '（标题、功能点与分派）');
			lines.push('2. ' + abs(paths.draft) + '（方案正文：总体思路、改动点）');
			lines.push('3. ' + abs(paths.impact) + '（影响面：涉及哪些模块/文件、风险、回滚）');
			lines.push('4. ' + abs(paths.apis) + ' 与 ' + abs(paths.pages) + '（要改或新增的接口与页面）');
			lines.push('5. ' + abs(paths.tasks) + '（任务拆分，本次只做其中这一条）');
			lines.push('');
			lines.push('【做什么】');
			lines.push('- 读不到方案正文 / 任务清单，或这份方案里根本没有这个任务时**先别动手**：如实说清缺什么（例如"这个需求还没有方案"），让人先去「方案」页补齐 —— 凭需求正文凭空实现，是最坏的一种"做完了"；');
			lines.push('- 按方案实现这一个任务：方案里写的接口 / 页面就按它给的形状去改或新增；');
			lines.push('- **只做这一个任务的范围** —— 别的任务不要顺手一起做（它们各有各的【执行】）；');
			lines.push('- 方案里没定的细节（字段名、表名、错误码、路径）先问，不要自己发明一套再让人去猜；');
			lines.push('- 工作区里找不到对应的代码库或文件时**如实说明找不到**，不要编造文件路径，也不要照着方案里的描述造一份假实现；');
			lines.push('- 做完用一两句话说明你实际动了哪些文件、自测结论是什么，不要复述方案。');
			lines.push('');
			lines.push('【做完必须落盘：把证据记进开发管线】');
			lines.push('1. ' + abs(stageBlockPath('develop', input.developer, changes.file)) + ' ← **每改一处追加一行**（先读原文件，保留已有的行）：');
			lines.push('   形状：' + blockShapeText(changes, input.developer));
			lines.push('   其中 taskId 逐字填 "' + taskId + '"'
				+ (taskId === '' ? '（这个任务没有 id，填空串，并在 note 里写清是哪个任务）' : '')
				+ '，否则开发页没法把这条变更挂到这个任务上。');
			lines.push('   **done 一律先填 false**：勾选是开发者本人复核之后才做的事，不是你替他的结论。');
			lines.push('2. ' + abs(stageBlockPath('develop', input.developer, selftest.file)) + ' ← 你为这个任务做过的自测（先读原文件，保留已有的行）：');
			lines.push('   形状：' + blockShapeText(selftest, input.developer));
			lines.push('');
			lines.push('【纪律】');
			lines.push('- 方案层（' + paths.base + '/）与需求层**只读**，一个字都不要改；');
			lines.push('- 不要动别人的目录；也不要改任务的**定义**（任务在「方案」页维护）；');
			lines.push('- 上面那两个文件之外的开发产物不要写；用 UTF-8、LF 换行，JSON 必须能被 JSON.parse 解析。');
			for (const line of subagentDirective('开发', input)) lines.push(line);
			return lines.join('\n');
		}


		function blockShapeText(spec, developer) {
			if (spec.kind === 'markdown') return 'Markdown 正文';
			if (spec.kind === 'fields') {
				const parts = spec.fields.map((field) => '"' + field.key + '": "' + (field.type === 'date' ? 'YYYY-MM-DD' : '…') + '"');
				return '{ "schema": 1, ' + parts.join(', ') + ', "updatedAt": "ISO 时间" }';
			}
			const row = spec.columns.map((column) => {
				if (column.type === 'check') return '"' + column.key + '": false';
				if (column.type === 'select') return '"' + column.key + '": "' + (Array.isArray(column.options) ? column.options.join('|') : '') + '"';
				// 任务列要写的是**方案里真实存在的任务 id**，所以指令里把出处也点明 ——
				// 否则 AI 会自己编一个 id，开发页就永远关联不上任务。
				if (column.type === 'task') return '"' + column.key + '": "任务 id（必须取自方案的任务拆分，没有对应的就填空串）"';
				return '"' + column.key + '": "…"';
			});
			const head = typeof developer === 'string' && developer !== '' ? '"developer": "' + developer + '", ' : '';
			return '{ "schema": 1, ' + head + '"items": [ { ' + row.join(', ') + ' } ], "updatedAt": "ISO 时间" }';
		}

		/**
		 * 阶段页的「让 AI 写」指令 —— **由块声明生成**，所以三个阶段共用一套。
		 *
		 * 与方案页同一个道理：插件不调模型，只把路径与产物形状写死交给对话里的 AI。
		 * 形状由 `blockShapeText()` 从同一张表生成，所以**表改了指令就跟着改**，
		 * 不会出现「页面加了字段、指令里没有」这种错位。
		 */
		function stagePrompt(stageId, input) {
			const list = stageBlocks(stageId);
			const stage = stageOf(stageId);
			const stageName = stage === null ? stageId : stage.dir;
			const abs = (relative) => input.root + '/' + input.id + '/' + relative;
			const reads = STAGE_INPUTS[stageId] ?? [];
			const perPerson = stageIsPerPerson(stageId);

			const lines = [];
			lines.push('请为需求 ' + input.id + '《' + input.title + '》写「' + stageName + '」阶段的产物。');
			if (perPerson && typeof input.developer === 'string' && input.developer !== '') {
				lines.push('写作对象是开发人员「' + input.developer + '」这一条按人管线（这个阶段按人分开，你只写这个人的）。');
			}
			lines.push('');
			lines.push('【先读】');
			lines.push('1. ' + abs(REQUIREMENT_FILE) + '（标题、关键日期、功能点与分派）');
			for (let index = 0; index < reads.length; index += 1) {
				lines.push((index + 2) + '. ' + abs(reads[index]) + (reads[index].endsWith('/') ? '（列目录，把相关文件都读一遍）' : ''));
			}
			lines.push('');
			lines.push('【本次要写的文件】共 ' + list.length + ' 个');
			for (let index = 0; index < list.length; index += 1) {
				const spec = list[index];
				lines.push((index + 1) + '. ' + abs(stageBlockPath(stageId, input.developer, spec.file)));
				lines.push('   形状：' + blockShapeText(spec, perPerson ? input.developer : ''));
			}
			// 阶段专属规则（见 STAGE_RULES）：放在文件清单之后、"纪律"之前 ——
			// 先说清"这一阶段该怎么用力"，再说通用纪律，读起来才是一条完整的指令。
			for (const line of STAGE_RULES[stageId] ?? []) {
				lines.push('');
				lines.push(line);
			}
			lines.push('');
			lines.push('【纪律】');
			lines.push('- **只写上面列出的文件**，不要新建别的文件。');
			lines.push('- **不要改动其它阶段的任何文件**' + (perPerson ? '，也不要动别人的目录' : '') + '；需求层（' + REQUIREMENT_FILE + '、' + PIPELINE_DIR + '/需求/ 下的东西）同样不许改。');
			lines.push('- 用 UTF-8、LF 换行；JSON 必须是能被 JSON.parse 解析的合法 JSON，字段名逐字照上面给的形状。');
			lines.push('- 内容要基于**真实读到的**东西；没读到就如实少写，不要编造。');
			lines.push('- 写完用一两句话说明写了什么，不要复述全文。');
			for (const line of subagentDirective(stageName, input)) lines.push(line);
			return lines.join('\n');
		}

		/**
		 * 一行行的显示名：取**第一个有值的文本列**（测试用例就是「用例名」）。
		 *
		 * 逐行【执行】要说出"跑的是哪一条"，而各块的列不一样（用例有名、执行记录没有），
		 * 所以名字从**声明**里取第一列，而不是在渲染器里写死 `row.name`。
		 * 勾选列与枚举列跳过：枚举列的值是 `pass` 这种机器值，不是名字。
		 */
		function rowLabel(spec, row) {
			const columns = spec !== null && spec !== undefined && Array.isArray(spec.columns) ? spec.columns : [];
			for (const column of columns) {
				if (column.type === 'check' || column.type === 'select') continue;
				const value = row !== null && row !== undefined ? row[column.key] : undefined;
				if (typeof value === 'string' && value.trim() !== '') return value;
			}
			return '';
		}

		/**
		 * 「执行这一条测试用例」发给对话的指令。
		 *
		 * 与开发页的 `taskExecutePrompt` 同一套路：插件不调模型，只把**路径、这一次的范围、
		 * 要落盘的结果形状**写死交给对话里的 AI。差别在读者要什么 —— 跑测试要的是一次
		 * **可复核**的结果，不是一份测试报告。
		 *
		 * 三条硬要求，都是"不说就会静默出错"的那一类：
		 *   - **只跑这一条**，别顺手把别的用例一起改了；
		 *   - **跑不了就说跑不了**，`result` 留在 pending。编一个"通过"是最坏的结果 ——
		 *     它会把一条根本没验过的用例变成绿色证据，而页面上完全看不出来；
		 *   - 结果必须落回**这一行**：用例没有 id，所以用「用例名 + 预期 + 第几条」三者一起
		 *     定位；对不上或重名时**停下来问**，不要猜一行去改。
		 *
		 * @param input { id, title, developer, root, row, index }
		 */
		function testCaseExecutePrompt(input) {
			const cases = STAGE_BLOCKS.test[0];
			const runs = STAGE_BLOCKS.test[1];
			const defects = STAGE_BLOCKS.test[2];
			const row = input.row !== null && input.row !== undefined && typeof input.row === 'object' ? input.row : {};
			const index = typeof input.index === 'number' && input.index >= 0 ? input.index : 0;
			const paths = designPaths(input.developer);
			const abs = (relative) => input.root + '/' + input.id + '/' + relative;
			const name = rowLabel(cases, row);
			const expected = typeof row.expected === 'string' ? row.expected : '';

			const lines = [];
			lines.push('请执行需求 ' + input.id + '《' + input.title + '》里的**这一条测试用例**：'
				+ (name === '' ? '（第 ' + (index + 1) + ' 条，没有名字）' : name));
			lines.push('（用例所在管线：' + input.developer
				+ '；它是「测试用例」里的第 ' + (index + 1) + ' 条'
				+ '；预期：' + (expected === '' ? '（这一条没写预期）' : expected) + '）');
			lines.push('');
			lines.push('【先读】');
			lines.push('1. ' + abs(REQUIREMENT_FILE) + '（标题与功能点）');
			lines.push('2. ' + abs(paths.base + '/') + '（列目录：draft.md 的改动点、apis.json 的接口清单、pages.json 的页面清单 —— 这一条要验的接口 / 页面在这里）');
			lines.push('3. ' + abs(PIPELINE_DIR + '/开发/' + developerSlug(input.developer) + '/') + '（列目录：changes.json 改了什么、selftest.json 开发者自测过什么 —— 要验的就是这些改动）');
			lines.push('4. ' + abs(stageBlockPath('test', input.developer, runs.file)) + '（同一条用例以前跑过没有、跑成什么样）');
			lines.push('   —— 注意：这个工作区里**可能没有可运行的工程**（只有文档）。没有就如实说，不要假装跑过。');
			lines.push('');
			lines.push('【这一层的口径】');
			lines.push('- 只做**简单的接口测试**：验通不通、返回形状 / 状态码对不对、关键错误码有没有；');
			lines.push('- 不要为这一条用例补并发 / 幂等 / 事务 / 性能 / 多阈值边界这类重型验证 —— 那是"读代码检查"该管的（在开发阶段的自测里做）；');
			lines.push('- 需求层、方案层、开发产物**只读**，一个字都不要改。');
			lines.push('');
			lines.push('【做什么】');
			lines.push('- 就这一条：按它的「预期」去验，别的用例不要顺手一起改；');
			lines.push('- **跑不了（没有工程、起不了服务、缺环境）就如实说跑不了**：说清缺什么，把这一条的 result 留在 pending。**不要编一个"通过"** —— 那会把一条根本没验过的用例变成绿色证据，而页面上完全看不出来；');
			lines.push('- 失败要写清现象（实际返回了什么），不要只写一个"不通过"。');
			lines.push('');
			lines.push('【做完必须落盘】');
			lines.push('1. ' + abs(stageBlockPath('test', input.developer, cases.file)) + ' ← 把**这一条**的 result 改成 "pass" 或 "fail"，并在 note 里写清你实际验了什么、怎么验的、看到什么（先读原文件，别的行一个字都不要动）：');
			lines.push('   形状：' + blockShapeText(cases, input.developer));
			lines.push('   怎么认这一行：用例没有 id，所以按「name = ' + (name === '' ? '（空）' : name)
				+ '」+「expected = ' + (expected === '' ? '（空）' : expected) + '」+「第 ' + (index + 1)
				+ ' 条」三者一起认；**对不上、或同名同预期的用例不止一条时停下来问**，不要猜一行去改。');
			lines.push('2. ' + abs(stageBlockPath('test', input.developer, runs.file)) + ' ← 追加一条执行记录（先读原文件，保留已有的行）：');
			lines.push('   形状：' + blockShapeText(runs, input.developer));
			lines.push('3. 失败了才写：' + abs(stageBlockPath('test', input.developer, defects.file)) + ' ← 追加一条缺陷（同一套写法）：');
			lines.push('   形状：' + blockShapeText(defects, input.developer));
			lines.push('');
			lines.push('【纪律】');
			lines.push('- 不要新增用例、不要改别的用例，也不要写上面这三个文件之外的东西；');
			lines.push('- 测试是按人分开的：不要动别人的目录，也不要替别人跑；');
			lines.push('- 用 UTF-8、LF 换行，JSON 必须能被 JSON.parse 解析。');
			lines.push('- 做完用一两句话说明结果（跑了什么、通过还是失败、失败的话现象是什么），不要复述用例全文。');
			for (const line of subagentDirective('测试', input)) lines.push(line);
			return lines.join('\n');
		}

		/** 定时触发重渲染，让倒计时自己走。 */
		function useNow(intervalMs) {
			const state = react.useState(() => new Date());
			const setNow = state[1];
			react.useEffect(() => {
				const timer = setInterval(() => { setNow(new Date()); }, intervalMs);
				return () => { clearInterval(timer); };
			}, [intervalMs]);
			return state[0];
		}

		/** 三个关键日期的倒计时。 */
		function CountdownChips(props) {
			const t = props.t;
			const requirement = props.requirement;
			if (requirement === null || requirement === undefined) return null;

			const fields = [
				{ key: 'releaseDate', labelKey: 'dates.release' },
				{ key: 'testFreezeDate', labelKey: 'dates.testFreeze' },
				{ key: 'goLiveDate', labelKey: 'dates.goLive' },
			];

			return h('div', { className: 'wcw-countdowns' }, fields.map((field) => {
				const value = requirement[field.key];
				const days = daysUntil(value, props.now);
				let state = 'unset';
				let text = t('dates.unset');
				if (days !== null) {
					state = days === 0 ? 'today' : days > 0 ? 'remaining' : 'overdue';
					text = days === 0 ? t('dates.today')
						: (days > 0 ? t('dates.remaining', { days }) : t('dates.overdue', { days: -days }));
				}
				return h('span', { key: field.key, className: 'wcw-countdown', 'data-state': state, title: value === '' ? '' : value },
					h('span', { className: 'wcw-countdownLabel' }, t(field.labelKey)),
					h('span', { className: 'wcw-countdownValue' }, text),
				);
			}));
		}

		/**
		 * 一次读取开始时的状态。
		 *
		 * 抽成纯函数是为了能**断言**「刷新不许清空数据」这条规则 —— 它纯粹是观感问题，
		 * 靠肉眼很难发现回归：唯一表现是页面闪一下，而闪一下不会让任何断言变红。
		 */
		function readState(previous, sameSubject) {
			const before = previous !== null && previous !== undefined ? previous : {};
			if (sameSubject && before.status === 'ready') {
				return { status: 'ready', data: before.data, error: null, refreshing: true };
			}
			return { status: 'loading', data: null, error: null, refreshing: false };
		}

		/**
		 * 带 loading / error / ready 的异步读取 hook。
		 *
		 * `subjectDeps` 描述「读的是谁」（哪条需求、哪个人、哪个阶段），
		 * `refreshToken` 是「再读一次」的计数，`cacheKey` 是这块内容的身份（可选）。
		 *
		 * 三件事要分清楚，少一件就会出问题：
		 *
		 *   - **只是刷新**（token 变了，读的还是同一个东西）→ **保留上一份数据**。
		 *     每次保存都把整块内容换成「读取中…」再换回来，即使只有几十毫秒，
		 *     看起来也像卡了一下 —— 这是「页面慢」最常见的来源，而且它根本不是慢，是闪。
		 *   - **换了读取对象**（subjectDeps 变了）→ 旧数据是**别人的**，必须清掉，
		 *     否则会短暂地拿张三的方案冒充李四的。
		 *   - **重新挂载**（切走再切回来，组件被卸载过）→ 上面两条都救不了，状态已经没了。
		 *     所以给了 `cacheKey` 就从缓存里**先把内容摆出来**，再去后台读一次。
		 *     缓存只活在内存里，且任何写操作都会清空它。
		 *
		 * 返回值里的 `refreshing` 表示「显示的是上一份数据，新的正在路上」。
		 */
		function useAsync(load, subjectDeps, refreshToken, cacheKey) {
			const subject = JSON.stringify(subjectDeps);
			// 只有第一次渲染会用到这份种子；之后 subjectDeps 变了要按「换了对象」处理。
			const seedRef = react.useRef(undefined);
			if (seedRef.current === undefined) {
				const cached = readCache.get(cacheKey);
				seedRef.current = cached === undefined ? null : cached;
			}
			const seed = seedRef.current;

			const state = react.useState(() => (seed === null
				? { status: 'loading', data: null, error: null, refreshing: false }
				: { status: 'ready', data: seed, error: null, refreshing: true }));
			const value = state[0];
			const setValue = state[1];
			// 有缓存时把「上一次读的是谁」当成已经读过了，于是第一次 effect 走「刷新」那条路，
			// 不会把刚摆出来的缓存内容又清掉。
			const previousSubject = react.useRef(seed === null ? null : subject);
			const deps = subjectDeps.concat([refreshToken]);
			react.useEffect(() => {
				let cancelled = false;
				const sameSubject = previousSubject.current === subject;
				previousSubject.current = subject;
				setValue((previous) => readState(previous, sameSubject));
				load().then(
					(data) => {
						if (cancelled) return;
						readCache.set(cacheKey, data);
						setValue({ status: 'ready', data, error: null, refreshing: false });
					},
					(error) => { if (!cancelled) setValue({ status: 'error', data: null, error: String(error && error.message ? error.message : error), refreshing: false }); },
				);
				return () => { cancelled = true; };
			}, deps);
			return [value, setValue];
		}

		// ────────────────────────────────────────────────────────────────────
		// 7. 页面组件
		// ────────────────────────────────────────────────────────────────────

		/**
		 * 需求列表。
		 *
		 * `…` 操作菜单只有一个，放在「新建需求」前面，作用于当前选中的需求；
		 * 不给每个需求都挂一个，列表才不会随需求数变长。
		 * 归档掉的需求不在这里 —— 它们收在顶部栏右侧的「历史需求」下拉框里。
		 */
		function RequirementChips(props) {
			const t = props.t;
			const requirements = props.requirements;
			const menuFor = props.menuFor;

			/**
			 * 删除的二次确认状态。
			 *
			 * `confirmFor` 是**正在确认删除的需求编号**（空串 = 没在确认）。存在这里的理由：
			 * 确认框必须跟着菜单一起消失 —— 用户点开确认、又去点了别的需求，那个确认要作废，
			 * 否则下一步的「确认删除」删的就是他以为已经不看的那条了。
			 *
			 * 只用一个布尔量是不够的：菜单里出现的那条需求可能已经换了人。
			 * 所以下面判定时要求 `confirmFor === selected.id`，**编号对不上就不算在确认**。
			 */
			const confirmState = react.useState('');
			const confirmFor = confirmState[0];
			const setConfirmFor = confirmState[1];
			const deletingState = react.useState(false);
			const deleting = deletingState[0];
			const setDeleting = deletingState[1];
			const deleteErrorState = react.useState('');
			const deleteError = deleteErrorState[0];
			const setDeleteError = deleteErrorState[1];

			// 历史需求不在这一行里 —— 它挪到了顶部栏右侧的下拉框（可搜索）。
			const visible = requirements.filter((entry) => !entry.archived);

			let selected;
			for (const entry of requirements) if (entry.id === props.selectedId) selected = entry;
			const menuOpen = menuFor !== '' && selected !== undefined;
			const confirming = menuOpen && selected !== undefined && confirmFor === selected.id;

			/**
			 * 真正删。失败**不关确认框**，把错误留在原地 —— 关掉的话用户只看到
			 * "点了确认，然后什么都没发生"，而他刚刚按下的是一次不可逆操作。
			 */
			async function runDelete(id) {
				setDeleting(true);
				setDeleteError('');
				try {
					await props.onDelete(id);
					setConfirmFor('');
				} catch (failure) {
					setDeleteError(String(failure && failure.message ? failure.message : failure));
				} finally {
					setDeleting(false);
				}
			}

			const children = [h('span', { key: 'label', className: 'wcw-chipsLabel' }, t('req.parallel'))];

			for (const requirement of visible) {
				const badges = [];
				if (requirement.status === 'paused') badges.push(h('span', { key: 'paused', className: 'wcw-chipTag' }, t('req.paused')));
				if (requirement.status === 'done') badges.push(h('span', { key: 'done', className: 'wcw-chipTag' }, t('req.doneTag')));
				if (requirement.archived) badges.push(h('span', { key: 'archived', className: 'wcw-chipTag' }, t('req.archived')));

				children.push(h('button', {
					key: requirement.id,
					type: 'button',
					className: requirement.archived ? 'wcw-chip wcw-chipArchived' : 'wcw-chip',
					'aria-pressed': requirement.id === props.selectedId,
					title: requirement.id,
					onClick: () => { props.onSelect(requirement.id); },
				},
					h('span', { className: 'wcw-chipText' }, requirement.title === '' ? requirement.id : requirement.title),
					badges,
					h('span', { className: 'wcw-chipId' }, requirement.id),
				));
			}

			// 唯一的 `…`：样式与「新建需求」一致，作用于当前选中的需求。
			children.push(h('button', {
				key: 'more',
				type: 'button',
				className: 'wcw-chip wcw-chipNew',
				disabled: selected === undefined,
				'aria-pressed': menuOpen,
				title: t('req.more'),
				'aria-label': t('req.more'),
				// 每次开合都把确认状态清干净：合上等于取消，重开也不该停在"确认删除"那一屏。
				onClick: () => {
					setConfirmFor('');
					setDeleteError('');
					props.onMenu(menuOpen ? '' : props.selectedId);
				},
			}, '…'));

			children.push(h('button', {
				key: 'new',
				type: 'button',
				className: 'wcw-chip wcw-chipNew',
				onClick: props.onNew,
			}, '+ ' + t('req.create')));


			const target = menuOpen ? selected : undefined;
			const menu = target === undefined ? null : (confirming
				// ★ 二次确认：把整个菜单**换掉**，而不是叠一个弹窗。
				//   这样做有两个好处：确认内容占满整行，警告文案不会缩在一个小气泡里；
				//   而且原来的「归档」「暂停」这些按钮此刻根本不在 DOM 里，点不到。
				? h('div', { className: 'wcw-chipMenu wcw-chipMenuDanger' },
					h('span', { className: 'wcw-chipMenuTitle' }, t('req.deleteTitle', { id: target.id })),
					h('span', { className: 'wcw-chipId' }, target.title === '' ? target.id : target.title),
					h('span', { className: 'wcw-confirmText' }, t('req.deleteWarn')),
					h('span', { className: 'wcw-confirmAsk' }, t('req.deleteAsk')),
					deleteError === '' ? null : h('span', { className: 'wcw-error' }, deleteError),
					h('div', { className: 'wcw-btnRow' },
						h('button', {
							type: 'button',
							className: 'wcw-btn wcw-btnDanger',
							disabled: deleting,
							onClick: () => { void runDelete(target.id); },
						}, deleting ? t('req.deleting') : t('req.deleteYes')),
						h('button', {
							type: 'button',
							className: 'wcw-btn',
							disabled: deleting,
							onClick: () => { setConfirmFor(''); setDeleteError(''); },
						}, t('req.cancel')),
					),
				)
				: h('div', { className: 'wcw-chipMenu' },
					h('span', { className: 'wcw-chipMenuTitle' }, target.title === '' ? target.id : target.title),
					h('span', { className: 'wcw-chipId' }, target.id),
					h('span', { className: 'wcw-qaSpacer' }),
					target.archived
						? h('button', { type: 'button', className: 'wcw-btn', onClick: () => { props.onRestore(target.id); } }, t('req.unarchive'))
						: h(react.Fragment, null,
							h('button', {
								type: 'button',
								className: 'wcw-btn',
								onClick: () => { props.onSetStatus(target.id, target.status === 'paused' ? 'active' : 'paused'); },
							}, target.status === 'paused' ? t('req.resume') : t('req.pause')),
							h('button', {
								type: 'button',
								className: 'wcw-btn',
								onClick: () => { props.onSetStatus(target.id, target.status === 'done' ? 'active' : 'done'); },
							}, target.status === 'done' ? t('req.reopen') : t('req.done')),
						),
					target.archived ? null : h('button', { type: 'button', className: 'wcw-btn', onClick: () => { props.onArchive(target.id); } }, t('req.archive')),
					// 删除是**唯一不可逆**的一项，所以它单独占一个位置：在菜单最右侧、取消之前，
					// 而且要再点一次确认（见上）。归档/暂停随时能撤回，删除不能。
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnDanger',
						onClick: () => { setConfirmFor(target.id); setDeleteError(''); },
					}, t('req.delete')),
					h('button', { type: 'button', className: 'wcw-btn', onClick: () => { setConfirmFor(''); props.onMenu(''); } }, t('req.cancel')),
				));

			return h(react.Fragment, null,
				h('div', { className: 'wcw-chips' }, children),
				menu,
			);
		}

		/** 新建需求表单。 */
		function CreateRequirementForm(props) {
			const t = props.t;
			const idState = react.useState('');
			const titleState = react.useState('');
			const errorState = react.useState('');
			const busyState = react.useState(false);
			const id = idState[0];
			const setId = idState[1];
			const title = titleState[0];
			const setTitle = titleState[1];
			const error = errorState[0];
			const setError = errorState[1];
			const busy = busyState[0];
			const setBusy = busyState[1];

			// 建议编号到达后填入（之后用户可以改）。
			react.useEffect(() => {
				if (props.suggestedId !== '' && id === '') setId(props.suggestedId);
			}, [props.suggestedId]);

			function submit() {
				const finalId = (id === '' ? props.suggestedId : id).trim();
				if (title.trim() === '') { setError(t('req.needTitle')); return; }
				if (!ID_PATTERN.test(finalId)) { setError(t('req.needId')); return; }
				setError('');
				setBusy(true);
				Promise.resolve(props.onSubmit(finalId, title.trim()))
					.catch((failure) => { setError(String(failure && failure.message ? failure.message : failure)); })
					.then(() => { setBusy(false); });
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' }, h('h3', { className: 'wcw-sectionTitle' }, t('req.create'))),
				h('p', { className: 'wcw-empty' }, t('req.createHint')),
				h('div', { className: 'wcw-btnRow' },
					h('label', { className: 'wcw-field' },
						h('span', { className: 'wcw-fieldNote' }, t('req.id')),
						h('input', {
							className: 'wcw-input',
							value: id,
							placeholder: props.suggestedId,
							onChange: (event) => { setId(event.target.value); },
						}),
					),
					h('label', { className: 'wcw-field' },
						h('span', { className: 'wcw-fieldNote' }, t('req.title')),
						h('input', {
							className: 'wcw-input',
							value: title,
							placeholder: t('req.titlePlaceholder'),
							onChange: (event) => { setTitle(event.target.value); },
						}),
					),
				),
				error === '' ? null : h('p', { className: 'wcw-error' }, error),
				h('div', { className: 'wcw-btnRow' },
					h('button', { type: 'button', className: 'wcw-btn wcw-btnPrimary', disabled: busy, onClick: submit }, t('req.submit')),
					h('button', { type: 'button', className: 'wcw-btn', onClick: props.onCancel }, t('req.cancel')),
					h('span', { className: 'wcw-fieldNote' }, t('req.autoId') + '：' + (props.suggestedId === '' ? '…' : props.suggestedId)),
				),
			);
		}

		/** 关键时间：提版 / 测试封板 / 上线。顶部内容条据此倒计时。 */
		function RequirementDates(props) {
			const t = props.t;
			const requirement = props.requirement;
			const onChanged = props.onChanged;
			const busyState = react.useState('');
			const busy = busyState[0];
			const setBusy = busyState[1];
			const errorState = react.useState('');
			const error = errorState[0];
			const setError = errorState[1];

			/**
			 * 三个日期的先后关系：提版日期 < 测试封板日期 < 上线日期。
			 * min/max 从相邻日期推出，浏览器会直接挡住越界的日期选择；
			 * 写盘前再校验一次（键盘输入、粘贴、旧数据都可能绕过 min/max）。
			 */
			const FIELDS = [
				{ key: 'releaseDate', labelKey: 'dates.release', minKey: '', maxKey: 'testFreezeDate', shift: -1 },
				{ key: 'testFreezeDate', labelKey: 'dates.testFreeze', minKey: 'releaseDate', maxKey: 'goLiveDate', shift: 1 },
				{ key: 'goLiveDate', labelKey: 'dates.goLive', minKey: 'testFreezeDate', maxKey: '', shift: 1 },
			];

			/** 某字段的下界（含）。 */
			function boundFor(field, side) {
				const key = side === 'min' ? field.minKey : field.maxKey;
				if (key === '') return '';
				const anchor = requirement[key];
				if (typeof anchor !== 'string' || anchor === '') return '';
				// max 侧一律往前一天，min 侧一律往后一天，保证是严格不等。
				return shiftDay(anchor, side === 'min' ? 1 : -1);
			}

			/** 先重读再合并，只改这一个字段，避免覆盖并发改动。 */
			async function save(field, value) {
				setBusy(field);
				setError('');
				try {
					const fresh = await callWorkbench('readRequirement', { args: { id: requirement.id } });
					const nextValue = Object.assign({}, fresh.requirement);
					nextValue[field] = value;
					const broken = checkOrder(nextValue);
					if (broken !== '') {
						// 不写盘：保持已存数据的先后关系始终合法，只把原因告诉用户。
						setError(t(broken));
						return;
					}
					await callWorkbench('writeRequirement', { args: { id: requirement.id, requirement: nextValue } });
					await onChanged();
				} catch (failure) {
					setError(String(failure && failure.message ? failure.message : failure));
				} finally {
					setBusy('');
				}
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('dates.heading')),
					h('span', { className: 'wcw-pill' }, t('dates.order')),
				),
				h('div', { className: 'wcw-btnRow' },
					// min / max 仍从相邻日期推出（浏览器会挡住越界选择），但不再显示边界文字。
					FIELDS.map((field) => {
						const min = boundFor(field, 'min');
						const max = boundFor(field, 'max');

						return h('label', { key: field.key, className: 'wcw-field' },
							h('span', { className: 'wcw-fieldNote' }, t(field.labelKey)),
							h('input', {
								type: 'date',
								className: 'wcw-input',
								value: requirement[field.key] ?? '',
								min: min === '' ? undefined : min,
								max: max === '' ? undefined : max,
								disabled: busy !== '',
								onChange: (event) => { void save(field.key, event.target.value); },
							}),
						);
					}),
				),
				error === '' ? null : h('p', { className: 'wcw-error' }, error),
			);
		}

		/** 需求文档：上传 → 解析 → 版本记录 → AI 分析（原文按需展开）/ 版本对比。 */
		function RequirementDocuments(props) {
			const t = props.t;
			const requirement = props.requirement;
			const onChanged = props.onChanged;
			const root = typeof props.root === 'string' ? props.root : '';
			const sendPrompt = props.sendPrompt;
			/** 会话还在跑（AI 正在写分析）——用来显示「AI 正在读文档…」并在跑完后自动重读。 */
			const running = props.running === true;
			const fileInput = react.useRef(null);

			const busyState = react.useState('');
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];
			/** 指令送不进对话时，把它摆出来让人自己粘贴 —— 功能不能就这么死掉。 */
			const manualState = react.useState('');
			const manual = manualState[0];
			const setManual = manualState[1];
			const selectedState = react.useState('');
			const selected = selectedState[0];
			const setSelected = selectedState[1];
			/** 「版本对比」面板的开关。 */
			const comparingState = react.useState(false);
			const comparing = comparingState[0];
			const setComparing = comparingState[1];
			/** 「版本对比」：两个待对比的版本号（'' = 没选）。 */
			const pickLeftState = react.useState('');
			const pickLeft = pickLeftState[0];
			const setPickLeft = pickLeftState[1];
			const pickRightState = react.useState('');
			const pickRight = pickRightState[0];
			const setPickRight = pickRightState[1];
			const sourceState = react.useState(false);
			const showSource = sourceState[0];
			const setShowSource = sourceState[1];
			/**
			 * 已经交给 AI 分析、正在等它写完。
			 *
			 * 只有自己发出去的请求才算「在分析中」——单纯因为会话在跑就显示加载中，
			 * 会在你在旁边做别的事时一直骗人。
			 */
			const analyzingState = react.useState(false);
			const analyzing = analyzingState[0];
			const setAnalyzing = analyzingState[1];
			/**
			 * 原文：只在版本对比和「查看原文」时需要，所以只在真的要用时才读。
			 */
			const sourceState2 = react.useState({ version: '', text: '', loading: false });
			const source = sourceState2[0];
			const setSource = sourceState2[1];
			/**
			 * 分析结果 —— 按版本存一份，**点哪一版就显示哪一版的分析**。
			 * `stale` 表示「显示的是上一份，新的正在路上」：重读期间不清空内容，
			 * 否则每次 AI 写完都会先闪一下「没有分析」。
			 */
			const analysisState = react.useState({});
			const analyses = analysisState[0];
			const setAnalyses = analysisState[1];
			/** AI 从分析里拆出来的功能点：`{ [版本]: { added, template } }`，用来在版本行上标个数字。 */
			const pointsState = react.useState({});
			const extracted = pointsState[0];
			const setExtracted = pointsState[1];
			/** 已经补过功能点的版本，避免同一次分析被补两遍（补是幂等的，但没必要反复写盘）。 */
			const filledRef = react.useRef('');
			/** 导入流程自己会写消息；它跑着的时候不要被「补了几个功能点」盖掉。 */
			const importedRef = react.useRef(null);

			const documents = Array.isArray(requirement.documents) ? requirement.documents : [];
			const active = documents.find((entry) => entry.version === selected) ?? documents[documents.length - 1];
			const previous = active === undefined ? undefined : documents[documents.indexOf(active) - 1];

			/** 两个版本是不是**紧挨着**的（列表里前后相邻）。只有相邻才提醒"该有差异小节"。 */
			function isAdjacent(left, right) {
				const at = documents.findIndex((entry) => entry.version === left);
				return at >= 0 && at + 1 < documents.length && documents[at + 1].version === right;
			}

			/**
			 * 某一版的**上一版**（按文件列表顺序，不是按版本号猜）。
			 *
			 * 谁在谁前面是需求文档的真实顺序，重传、跳版（v1.0 → v1.2）都算数；
			 * 按版本号排序反而会在跳版时挑错对比对象 —— 而"和上一版比"这个动作
			 * 一旦比错对象，得出的结论比不比更糟。第一版没有上一版，返回空对象。
			 */
			function previousOf(version) {
				const index = documents.findIndex((entry) => entry.version === version);
				const before = index > 0 ? documents[index - 1] : undefined;
				if (before === undefined) return {};
				return {
					previousVersion: before.version,
					previousTextFile: before.textFile,
					previousAnalysisPath: requirementAnalysisPath(before.version),
				};
			}

			/**
			 * 会话换了，**整块内容重新挂载**。
			 *
			 * 看的是缓存里的数据，但缓存是按「会话 × 需求」分区的：换需求的瞬间不重挂，
			 * 上一刻读到的别人的分析就会留在屏幕上，而它看起来完全正常 —— 这类
			 * 「显示的是别人的东西」比报错难发现得多，所以宁可贵一次重读。
			 */
			const scopeKey = String(props.scopeKey ?? '');

			// 原文只在这一版真的要用到时才读：默认那一屏看的是分析，不是原文。
			const needSource = active !== undefined && (showSource || comparing);
			react.useEffect(() => {
				if (active === undefined || !needSource) return undefined;
				let cancelled = false;
				setSource((old) => ({ version: active.version, text: old.version === active.version ? old.text : '', loading: true }));
				readTextOrNull(requirement.id, active.textFile).then((text) => {
					if (cancelled) return;
					setSource({ version: active.version, text, loading: false });
				});
				return () => { cancelled = true; };
			}, [requirement.id, active === undefined ? '' : active.version, active === undefined ? '' : active.textFile, needSource, scopeKey]);

			/**
			 * 把一版的分析读进来（读不到就是空串，不报错 —— 「还没分析」是常态）。
			 *
			 * `running` 是这条读取的**触发条件**：AI 写完分析时页面不会重新挂载，
			 * 唯一的信号就是会话从「跑着」变回「空闲」。少了它，分析写完了页面上
			 * 还显示着「AI 正在读文档…」，看起来像卡住了。
			 */
			react.useEffect(() => {
				if (documents.length === 0) return undefined;
				let cancelled = false;
				for (const entry of documents) {
					setAnalyses((old) => Object.assign({}, old, {
						[entry.version]: Object.assign({ stale: true, text: '' }, old[entry.version]),
					}));
					readTextOrNull(requirement.id, requirementAnalysisPath(entry.version)).then((text) => {
						if (cancelled) return;
						setAnalyses((old) => Object.assign({}, old, { [entry.version]: { text, stale: false } }));
					});
				}
				return () => { cancelled = true; };
				// running 见上；documents 变化（导入/删除）也要重读。
			}, [requirement.id, documents.map((entry) => entry.version).join(','), requirement.updatedAt, running, scopeKey]);

			const currentAnalysis = active === undefined ? undefined : analyses[active.version];
			const analysisText = currentAnalysis === undefined ? '' : currentAnalysis.text;
			const analysisStale = currentAnalysis === undefined || currentAnalysis.stale === true;
			const hasAnalysis = analysisText.trim() !== '';
			const sessionAnalyzing = analyzing && running;

			/** 版本对比是否真的能显示：要开了开关，且选了两版。 */
			const compareReady = comparing && pickLeft !== '' && pickRight !== '' && pickLeft !== pickRight;
			const compareDocs = compareReady
				? {
					left: documents.find((entry) => entry.version === pickLeft),
					right: documents.find((entry) => entry.version === pickRight),
				}
				: { left: undefined, right: undefined };
			const compareRef = compareReady ? pickLeft + '..' + pickRight : '';

			/** 两版正文的行级差异。 */
			const compareLoadedState = react.useState({ ref: '', left: '', right: '' });
			const compareLoaded = compareLoadedState[0];
			const setCompareLoaded = compareLoadedState[1];
			react.useEffect(() => {
				if (!compareReady) return undefined;
				let cancelled = false;
				const jobs = [
					readTextOrNull(requirement.id, compareDocs.left.textFile),
					readTextOrNull(requirement.id, compareDocs.right.textFile),
				];
				Promise.all(jobs).then((results) => {
					if (cancelled) return;
					setCompareLoaded({ ref: compareRef, left: results[0], right: results[1] });
				});
				return () => { cancelled = true; };
			}, [requirement.id, compareRef, compareReady ? 'yes' : 'no', scopeKey]);

			/**
			 * 让 AI 分析**某一版**文档：写 `analysis/<版本>.md`（给人看）
			 * 和 `analysis/<版本>.points.json`（给工作台读，用来填功能点）。
			 *
			 * 这一版已经有分析时，指令要求它**在现有内容上继续优化**，不是从零重写 ——
			 * 人的补充、上一版的结论都会留在里面，重跑一次不会把之前的理解全丢掉。
			 *
			 * 插件自己不调模型、不存密钥 —— 它只把「读哪个文件、写到哪个路径、写哪些内容」
			 * 拼成一段指令，丢进你已经在用的那个对话（平台通道
			 * `ctx.sessions.scope(id).get('conversation').send`，见 apply() 里的 sendPrompt），
			 * 由那边的 AI 用自己的文件工具落盘。
			 *
			 * @param entry 目标版本记录；默认是当前选中的那一版
			 */
			async function analyze(entry) {
				const target = entry === undefined ? active : entry;
				if (target === undefined) return;
				setMessage(null);
				setManual('');
				const targetAnalysis = analyses[target.version];
				const existing = targetAnalysis !== undefined && targetAnalysis.text.trim() !== '';
				const prompt = documentAnalysisPrompt(Object.assign({
					id: requirement.id,
					title: requirement.title,
					version: target.version,
					textFile: target.textFile,
					analysisPath: requirementAnalysisPath(target.version),
					pointsPath: requirementPointsPath(target.version),
					root,
					hasAnalysis: existing,
				}, previousOf(target.version)));
				setBusy('ai:' + target.version);
				try {
					if (typeof sendPrompt !== 'function') throw new Error('NO_SEND_CHANNEL');
					await sendPrompt(prompt);
					setAnalyzing(true);
					// 内容不清空，只标成「旧的」；等会话跑完那次重读会把它换掉。
					setAnalyses((old) => Object.assign({}, old, {
						[target.version]: Object.assign({ stale: true, text: '' }, old[target.version]),
					}));
					setMessage({ kind: 'ok', text: t('an.sent') });
				} catch (error) {
					const reason = String(error && error.message ? error.message : error);
					setManual(prompt);
					setMessage({ kind: 'error', text: t('an.failed', { reason }) });
				} finally {
					setBusy('');
				}
			}

			/**
			 * 把 AI 拆出来的功能点补进需求。
			 *
			 * 幂等：同名（忽略大小写与空白）的一律不动 —— 人可能已经改过名字、派给了人、
			 * 在方案里引用了它，重新分析不该把这些抹掉。所以同一个版本分析两次，
			 * 第二次补进 0 个，不会让列表翻倍。
			 *
			 * @param version 版本号
			 * @returns 新增的条数（读不到 points 文件时是 0，不抛）
			 */
			async function autoFillPoints(version) {
				const text = await readTextOrNull(requirement.id, requirementPointsPath(version));
				if (text.trim() === '') return 0;
				let parsed = null;
				try {
					parsed = JSON.parse(text);
				} catch (error) {
					return 0;
				}
				const incoming = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.points)
					? parsed.points
					: [];
				if (incoming.length === 0) return 0;
				const fresh = await callWorkbench('readRequirement', { args: { id: requirement.id } });
				const before = Array.isArray(fresh.requirement.featurePoints) ? fresh.requirement.featurePoints : [];
				const merged = mergeExtractedPoints(before, incoming, version, new Date().toISOString());
				setExtracted((old) => Object.assign({}, old, { [version]: { added: merged.added } }));
				if (merged.added === 0) return 0;
				await callWorkbench('writeRequirement', {
					args: {
						id: requirement.id,
						requirement: Object.assign({}, fresh.requirement, { featurePoints: merged.points }),
					},
				});
				return merged.added;
			}

			/**
			 * 删掉一版：原件、解析出的正文、这一版的分析**一起删**。
			 *
			 * 这正是「生成的内容跟着文档走」的意思 —— 留着一份没有文档的分析，
			 * 页面会拿它当这一版的结论，而没人能再核对它说的是哪份文档。
			 * **功能点不删**：它们已经是需求的一部分，可能已经派了人、写了方案，
			 * 静默删掉比留着更危险。
			 */
			async function removeVersion(entry) {
				if (entry === undefined) return;
				if (!window.confirm(t('ver.deleteConfirm', { version: entry.version }))) return;
				setBusy('del:' + entry.version);
				setMessage(null);
				try {
					const paths = [entry.file, entry.textFile, requirementAnalysisPath(entry.version), requirementPointsPath(entry.version)];
					for (const path of paths) {
						if (typeof path !== 'string' || path === '') continue;
						await callWorkbench('remove', { args: { id: requirement.id, path } });
					}
					await callWorkbench('writeRequirement', {
						args: {
							id: requirement.id,
							requirement: Object.assign({}, requirement, {
								documents: documents.filter((one) => one.version !== entry.version),
							}),
						},
					});
					if (selected === entry.version) setSelected('');
					setMessage({ kind: 'ok', text: t('ver.deleted', { version: entry.version }) });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy('');
				}
			}

			async function upload(file) {
				if (file === undefined || file === null) return;
				setMessage(null);
				setBusy(t('doc.uploading'));
				let imported = null;
				importedRef.current = null;
				try {
					const text = await parseDocx(file);
					const version = nextVersion(documents.length === 0 ? undefined : documents[documents.length - 1].version);
					const slug = versionSlug(version);
					const sourcePath = PIPELINE_DIR + '/需求/source/' + slug + '-' + file.name.replace(/[\\/]/g, '_');
					const textPath = PIPELINE_DIR + '/需求/parsed/' + slug + '.txt';
					// 上一版在这**当场记下**：写完 requirement 之后再问就晚了 ——
					// `previousOf` 查的是 props 里的 documents，而它要等重新读盘才更新。
					const lastBefore = documents.length === 0 ? undefined : documents[documents.length - 1];
					imported = {
						version,
						textFile: textPath,
						previousVersion: lastBefore === undefined ? '' : lastBefore.version,
						previousTextFile: lastBefore === undefined ? '' : lastBefore.textFile,
						previousAnalysisPath: lastBefore === undefined ? '' : requirementAnalysisPath(lastBefore.version),
					};
					importedRef.current = imported;
					await callWorkbench('writeBinary', { args: { id: requirement.id, path: sourcePath, base64: await fileToBase64(file) } });
					await callWorkbench('writeText', { args: { id: requirement.id, path: textPath, text } });
					await callWorkbench('writeRequirement', {
						args: {
							id: requirement.id,
							requirement: Object.assign({}, requirement, {
								documents: documents.concat([{
									version,
									file: sourcePath,
									textFile: textPath,
									sourceName: file.name,
									importedAt: new Date().toISOString(),
									chars: text.length,
								}]),
							}),
						},
					});
					setSelected(version);
					setMessage({ kind: 'ok', text: t('doc.saved', { version }) });
					await onChanged();
				} catch (error) {
					const raw = String(error && error.message ? error.message : error);
					const reason = raw === 'UNSUPPORTED' ? t('doc.unsupported')
						: raw === 'NOT_DOCX' ? t('doc.notDocx')
							: raw;
					setMessage({ kind: 'error', text: t('doc.parseFailed', { reason }) });
				} finally {
					setBusy('');
					if (fileInput.current !== null) fileInput.current.value = '';
				}
				// 导入即分析：用户要的是「这份文档说了什么」，不是「这堆字长什么样」。
				// 放在 finally 之后单独走一遍，失败也不影响「已经存下来了」这个事实。
				if (imported !== null) {
					setBusy('ai:' + imported.version);
					const prompt = documentAnalysisPrompt({
						id: requirement.id,
						title: requirement.title,
						version: imported.version,
						textFile: imported.textFile,
						analysisPath: requirementAnalysisPath(imported.version),
						pointsPath: requirementPointsPath(imported.version),
						root,
						hasAnalysis: false,
						previousVersion: imported.previousVersion,
						previousTextFile: imported.previousTextFile,
						previousAnalysisPath: imported.previousAnalysisPath,
					});
					try {
						if (typeof sendPrompt !== 'function') throw new Error('NO_SEND_CHANNEL');
						await sendPrompt(prompt);
						setAnalyzing(true);
						setMessage({ kind: 'ok', text: t('doc.saved', { version: imported.version }) + ' · ' + t('an.sent') });
					} catch (error) {
						// 自动分析送不出去时**不报红**：文档已经存好了，按钮还在，
						// 把指令摆出来 + 一句说明就够了 —— 把一次成功的导入画成失败最误导人。
						const reason = String(error && error.message ? error.message : error);
						setManual(prompt);
						setMessage({ kind: 'ok', text: t('doc.saved', { version: imported.version }) + ' · ' + t('an.failed', { reason }) });
					} finally {
						setBusy('');
					}
				}
			}

			/**
			 * AI 写完之后，把这一版拆出来的功能点补进需求页。
			 *
			 * 触发点只有一个：**会话从「跑着」变回「空闲」**（和重读分析同一个信号）。
			 * 没有它，功能点要人照着分析一个字一个字敲 —— 那正是这一步要省掉的活。
			 */
			const pendingFill = active === undefined ? '' : active.version;
			const pendingFillText = pendingFill === '' ? '' : (analyses[pendingFill] === undefined ? '' : analyses[pendingFill].text);
			react.useEffect(() => {
				if (pendingFill === '' || pendingFillText.trim() === '') return undefined;
				if (filledRef.current === requirement.id + '|' + pendingFill) return undefined;
				filledRef.current = requirement.id + '|' + pendingFill;
				let cancelled = false;
				autoFillPoints(pendingFill).then(
					(added) => {
						if (cancelled || added === 0) return;
						// 需求页的功能点列表在另一处渲染，这里只说一句"补了几个"。
						// 导入流程自己会写消息，那条信息更多，不要覆盖它。
						if (importedRef.current === null) setMessage({ kind: 'ok', text: t('an.extracted', { count: added }) });
						onChanged();
					},
					() => { /* 补功能点失败不影响看分析，静默即可 */ },
				);
				return () => { cancelled = true; };
			}, [requirement.id, pendingFill, pendingFillText]);

			/** 行级 diff 的渲染：两边共用，版本对比和「查看原文」的差异是同一套视觉。 */
			function renderDiff(before, after) {
				const lines = diffLines(before, after);
				const stats = diffStats(lines);
				return h('div', null,
					stats.added === 0 && stats.removed === 0
						? h('p', { className: 'wcw-empty' }, t('doc.unchanged'))
						: h('p', { className: 'wcw-docMeta' }, '+' + stats.added + ' / -' + stats.removed),
					h('pre', { className: 'wcw-pre' }, lines.map((line, index) => h('span', {
						key: String(index),
						className: 'wcw-diffLine ' + (line.kind === 'add' ? 'wcw-diffAdded' : line.kind === 'remove' ? 'wcw-diffRemoved' : 'wcw-diffSame'),
					}, (line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  ') + line.text + '\n'))),
				);
			}

			/** 两版对比：文档差异 + 分析差异，外加「这一版是不是传错了」的提示。 */
			function renderCompare() {
				const leftAnalysis = analyses[pickLeft];
				const rightAnalysis = analyses[pickRight];
				const leftText = leftAnalysis === undefined ? '' : leftAnalysis.text;
				const rightText = rightAnalysis === undefined ? '' : rightAnalysis.text;
				const docDiff = { lines: diffLines(compareLoaded.left, compareLoaded.right) };
				const analysisDiff = { lines: diffLines(leftText, rightText), left: leftText, right: rightText };
				const docStats = diffStats(docDiff.lines);
				const analysisStats = diffStats(analysisDiff.lines);
				const suspicion = suspicionOf(docDiff, analysisDiff, { left: pickLeft, right: pickRight });

				if (compareLoaded.ref !== compareRef) {
					return h('p', { className: 'wcw-empty' }, t('panel.loading'));
				}
				if (compareLoaded.left === '' && compareLoaded.right === '') {
					return h('p', { className: 'wcw-empty' }, t('cmp.same'));
				}

				const body = [];
				body.push(h('p', { className: 'wcw-docMeta' }, t('cmp.stats', {
					added: docStats.added, removed: docStats.removed,
					anAdded: analysisStats.added, anRemoved: analysisStats.removed,
				})));

				// 差异异常：这是这个功能存在的理由，所以放在最前面。
				if (suspicion !== null) {
					body.push(h('div', { className: 'wcw-suspicious' },
						h('p', { className: 'wcw-suspiciousTitle' }, t(suspicion.kind === 'jump' ? 'cmp.suspiciousJump' : 'cmp.suspiciousStale')),
						h('p', { className: 'wcw-suspiciousBody' },
							suspicion.kind === 'jump' ? t('cmp.suspiciousHint') : t('cmp.suspiciousHintBig')),
					));
				}

				body.push(h('h4', { className: 'wcw-analysisHead' }, t('cmp.docDiff')));
				body.push(h('p', { className: 'wcw-docMeta' }, pickLeft + ' → ' + pickRight));
				body.push(renderDiff(compareLoaded.left, compareLoaded.right));

				body.push(h('h4', { className: 'wcw-analysisHead' }, t('cmp.anDiff')));
				if (leftText.trim() === '' && rightText.trim() === '') {
					body.push(h('p', { className: 'wcw-empty' }, t('cmp.noAnalysisBoth')));
				} else {
					if (leftText.trim() === '') body.push(h('p', { className: 'wcw-docMeta' }, t('cmp.anMissingSide', { side: pickLeft })));
					if (rightText.trim() === '') body.push(h('p', { className: 'wcw-docMeta' }, t('cmp.anMissingSide', { side: pickRight })));
					// 右版的分析里若有「与上一版（左版）的差异」那一节，**先把它单独抬出来**：
					// 它是 AI 逐条对比过的结论，比让读者自己从两份分析的行级 diff 里找要快得多。
					// 找不到就说明这份分析没带上一版读（老分析，或者上一版当时还不存在），
					// 那就明说一句怎么让它出现，而不是让读者以为是功能坏了。
					const section = extractSection(rightText, analysisDiffHeading(pickLeft));
					if (section !== '') {
						body.push(h('pre', { className: 'wcw-pre wcw-analysisDiff' }, section));
					} else if (isAdjacent(pickLeft, pickRight)) {
						body.push(h('p', { className: 'wcw-docMeta' }, t('cmp.anHeaderMissing', { refine: t('ver.refine') })));
					}
					body.push(renderDiff(leftText, rightText));
				}
				return h('div', { className: 'wcw-compare' }, body);
			}

			let body = null;
			if (active === undefined) {
				body = h('p', { className: 'wcw-empty' }, t('doc.empty'));
			} else if (comparing) {
				body = pickLeft === '' || pickRight === '' || pickLeft === pickRight
					? h('p', { className: 'wcw-empty' }, t('cmp.pick'))
					: renderCompare();
			} else if (sessionAnalyzing) {
				body = h('p', { className: 'wcw-analysisWait' }, t('an.analyzing'));
			} else if (!hasAnalysis) {
				body = h('div', null,
					h('p', { className: 'wcw-empty' }, t('an.noVersion', { version: active.version })),
					h('p', { className: 'wcw-docMeta' }, t('an.emptyHint')),
				);
			} else {
				// 默认这一屏显示的是**这一版的分析**；原文退到「查看原文」后面。
				// 原文一个字符都没丢，只是不再抢在分析前面。
				body = h('div', { className: 'wcw-analysisBody' },
					// stale 只在**重读那一瞬间**显示：正在跑的时候上面那句「AI 正在读文档…」
					// 已经说清楚了，两个都显示等于同一件事说两遍。
					analysisStale && !sessionAnalyzing ? h('p', { className: 'wcw-docMeta' }, t('panel.loading')) : null,
					h('pre', { className: 'wcw-pre wcw-analysisText' }, analysisText),
				);
			}
			if (!comparing && showSource && active !== undefined) {
				body = h('div', null,
					body,
					h('h4', { className: 'wcw-analysisHead' }, t('an.sourceHeading')),
					source.version === active.version && source.loading
						? h('p', { className: 'wcw-empty' }, t('panel.loading'))
						: h('pre', { className: 'wcw-pre' }, source.text),
				);
			}

			/**
			 * 一行版本记录：点版本号看那一版的分析，行上直接有「AI 分析」和「删除」。
			 *
			 * 两处刻意的做法：
			 *   - **不标「当前版」**。版本列表里没有"最新/当前"的概念 —— 上传顺序就是版本号顺序，
			 *     点哪一版就显示哪一版；哪一行被选中靠**边框高亮**表达（`.wcw-docRowActive`），
			 *     不额外挂一个标签去解释"当前"。挂标签等于承认这个状态需要解释，
			 *     而它其实一眼就能看出来。
			 *   - **「与上一版对比」按文件列表的前一版**，不是按版本号猜。谁在谁前面是
			 *     需求文档的真实顺序，重传、跳版都算数。
			 */
			const rows = documents.map((entry, index) => {
				const rowAnalysis = analyses[entry.version];
				const hasRow = rowAnalysis !== undefined && rowAnalysis.text.trim() !== '';
				const rowAnalyzing = analyzing && running && busy === 'ai:' + entry.version;
				const added = extracted[entry.version] === undefined ? 0 : extracted[entry.version].added;
				const previousEntry = index > 0 ? documents[index - 1] : undefined;
				return h('div', {
					key: entry.version,
					className: entry === active ? 'wcw-docRow wcw-docRowActive' : 'wcw-docRow',
				},
					h('button', {
						type: 'button',
						className: entry === active ? 'wcw-btn wcw-btnPrimary' : 'wcw-btn',
						onClick: () => { setSelected(entry.version); setComparing(false); },
					}, entry.version),
					h('span', { className: 'wcw-docName' }, entry.sourceName ?? entry.file),
					h('span', { className: 'wcw-docMeta' },
						t('doc.chars', { count: entry.chars ?? 0 }) + ' · ' + formatTime(entry.importedAt)
						+ (hasRow ? ' · ' + t('an.heading') : '')
						+ (typeof added === 'number' && added > 0 ? ' · ' + t('an.extracted', { count: added }) : '')),
					h('span', { className: 'wcw-qaSpacer' }),
					previousEntry === undefined ? null : h('button', {
						type: 'button',
						className: 'wcw-btn',
						title: t('cmp.vsPreviousHint', { left: previousEntry.version, right: entry.version }),
						onClick: () => {
							setPickLeft(previousEntry.version);
							setPickRight(entry.version);
							setComparing(true);
						},
					}, t('cmp.vsPrevious')),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '',
						onClick: () => { void analyze(entry); },
					}, rowAnalyzing ? t('an.analyzing') : (hasRow ? t('ver.refine') : t('ver.analyze'))),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '',
						onClick: () => { void removeVersion(entry); },
					}, t('ver.delete')),
				);
			});

			/** 对比面板上的两个选择器：选完就对比，不需要再点一次「确定」。 */
			function picker(label, value, onPick) {
				const options = [h('option', { key: '__none', value: '' }, label)];
				for (const entry of documents) options.push(h('option', { key: entry.version, value: entry.version }, entry.version));
				return h('select', {
					className: 'wcw-select',
					value,
					onChange: (event) => { onPick(event.target.value); },
				}, options);
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('doc.heading')),
					h('span', { className: 'wcw-pill' }, t('doc.versions') + ' ' + documents.length),
					active === undefined || (!analysisStale && !sessionAnalyzing) ? null : h('span', { className: 'wcw-pill' },
						t(sessionAnalyzing ? 'an.working' : 'an.updating')),
					h('span', { className: 'wcw-qaSpacer' }),
					documents.length < 2 ? null : h('button', {
						type: 'button',
						className: comparing ? 'wcw-btn wcw-btnPrimary' : 'wcw-btn',
						onClick: () => { setComparing(!comparing); },
					}, comparing ? t('cmp.on') : t('cmp.off')),
				),
				h('div', { className: 'wcw-btnRow' },
					h('input', {
						ref: fileInput,
						type: 'file',
						accept: '.docx',
						className: 'wcw-hidden',
						onChange: (event) => { void upload(event.target.files && event.target.files[0]); },
					}),
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy !== '',
						onClick: () => { if (fileInput.current !== null) fileInput.current.click(); },
					}, busy === '' ? t('doc.upload') : busy),
					active === undefined || comparing ? null : h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '' || sessionAnalyzing,
						onClick: () => { void analyze(); },
					}, sessionAnalyzing ? t('an.analyzing') : (hasAnalysis ? t('an.redo') : t('an.run'))),
					active === undefined || comparing ? null : h('button', {
						type: 'button',
						className: showSource ? 'wcw-btn wcw-btnPrimary' : 'wcw-btn',
						onClick: () => { setShowSource(!showSource); },
					}, showSource ? t('an.sourceHide') : t('an.source')),
				),
				comparing ? h('div', { className: 'wcw-btnRow' },
					h('span', { className: 'wcw-docMeta' }, t('cmp.left')),
					picker(pickLeft === '' ? t('cmp.pick') : pickLeft, pickLeft, (value) => { setPickLeft(value); }),
					h('span', { className: 'wcw-docMeta' }, t('cmp.right')),
					picker(pickRight === '' ? t('cmp.pick') : pickRight, pickRight, (value) => { setPickRight(value); }),
				) : null,
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				manual === '' ? null : h('details', { className: 'wcw-analysisManual' },
					h('summary', null, t('an.manual')),
					h('pre', { className: 'wcw-pre' }, manual),
				),
				rows.length === 0 ? null : h('div', { className: 'wcw-docList' }, rows),
				body,
			);
		}

		/** 澄清问答。 */
		function RequirementClarifications(props) {
			const t = props.t;
			const requirement = props.requirement;
			const onChanged = props.onChanged;

			const questionState = react.useState('');
			const question = questionState[0];
			const setQuestion = questionState[1];
			const answerState = react.useState('');
			const answer = answerState[0];
			const setAnswer = answerState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const errorState = react.useState('');
			const error = errorState[0];
			const setError = errorState[1];

			const clarifications = Array.isArray(requirement.clarifications) ? requirement.clarifications : [];

			/**
			 * 每次都先重读 requirement.json 再合并，只改 clarifications 字段。
			 * 直接用组件里那份快照会覆盖掉并发发生的其它改动（例如刚上传的文档）。
			 */
			async function persist(nextClarifications) {
				setBusy(true);
				setError('');
				try {
					const fresh = await callWorkbench('readRequirement', { args: { id: requirement.id } });
					await callWorkbench('writeRequirement', {
						args: {
							id: requirement.id,
							requirement: Object.assign({}, fresh.requirement, { clarifications: nextClarifications }),
						},
					});
					await onChanged();
				} catch (failure) {
					setError(String(failure && failure.message ? failure.message : failure));
				} finally {
					setBusy(false);
				}
			}

			function add() {
				if (question.trim() === '') return;
				const trimmedAnswer = answer.trim();
				const entry = {
					id: newId(),
					question: question.trim(),
					answer: trimmedAnswer,
					askedAt: new Date().toISOString(),
					answeredAt: trimmedAnswer === '' ? '' : new Date().toISOString(),
				};
				setQuestion('');
				setAnswer('');
				void persist(clarifications.concat([entry]));
			}

			const rows = clarifications.map((entry, index) => h('div', { key: entry.id, className: 'wcw-qaRow' },
				h('div', { className: 'wcw-qaHead' },
					h('span', { className: 'wcw-qaIndex' }, '#' + (index + 1)),
					h('span', {
						className: 'wcw-pill',
						'data-status': entry.answer === '' ? 'pending' : 'approved',
					}, entry.answer === '' ? t('qa.pending') : t('qa.answered')),
					h('span', { className: 'wcw-qaSpacer' }),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy,
						onClick: () => { void persist(clarifications.filter((other) => other.id !== entry.id)); },
					}, t('qa.delete')),
				),
				h('label', { className: 'wcw-field' },
					h('span', { className: 'wcw-fieldNote' }, t('qa.question')),
					h('textarea', {
						className: 'wcw-textarea',
						defaultValue: entry.question,
						onBlur: (event) => {
							const value = event.target.value.trim();
							if (value === entry.question) return;
							void persist(clarifications.map((other) => (
								other.id === entry.id ? Object.assign({}, other, { question: value }) : other
							)));
						},
					}),
				),
				h('label', { className: 'wcw-field' },
					h('span', { className: 'wcw-fieldNote' }, t('qa.answer')),
					h('textarea', {
						className: 'wcw-textarea',
						defaultValue: entry.answer,
						placeholder: t('qa.answerPlaceholder'),
						onBlur: (event) => {
							const value = event.target.value.trim();
							if (value === entry.answer) return;
							void persist(clarifications.map((other) => (
								other.id === entry.id
									? Object.assign({}, other, { answer: value, answeredAt: value === '' ? '' : new Date().toISOString() })
									: other
							)));
						},
					}),
				),
			));

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('qa.heading')),
					h('span', { className: 'wcw-pill' }, String(clarifications.length)),
				),
				rows.length === 0 ? h('p', { className: 'wcw-empty' }, t('qa.empty')) : h('div', { className: 'wcw-qa' }, rows),
				h('div', { className: 'wcw-qaRow' },
					h('label', { className: 'wcw-field' },
						h('span', { className: 'wcw-fieldNote' }, t('qa.question')),
						h('textarea', {
							className: 'wcw-textarea',
							value: question,
							placeholder: t('qa.questionPlaceholder'),
							onChange: (event) => { setQuestion(event.target.value); },
						}),
					),
					h('label', { className: 'wcw-field' },
						h('span', { className: 'wcw-fieldNote' }, t('qa.answer')),
						h('textarea', {
							className: 'wcw-textarea',
							value: answer,
							placeholder: t('qa.answerPlaceholder'),
							onChange: (event) => { setAnswer(event.target.value); },
						}),
					),
					h('div', { className: 'wcw-btnRow' },
						h('button', {
							type: 'button',
							className: 'wcw-btn wcw-btnPrimary',
							disabled: busy || question.trim() === '',
							onClick: add,
						}, t('qa.add')),
						error === '' ? null : h('span', { className: 'wcw-error' }, error),
					),
				),
			);
		}

		/**
		 * 「方案」阶段的功能页。
		 *
		 * 方案是**按人分开**的管线：每个开发人员一套文件，各写各的。页面把
		 * 「AI 出稿 → 人改稿」这条链路闭环：
		 *
		 *   1. 点【让 AI 出方案】→ 把一段写死了路径与产物形状的指令发给当前会话；
		 *   2. 对话里的 AI 用它自己的文件工具读需求、写方案；
		 *   3. 会话从「执行中」回到「空闲」时页面自动重读，稿子就出现了；
		 *   4. 人在页面上直接改，改完保存，或留存一个版本快照。
		 *
		 * 全过程**不碰共享的 `requirement.json`** —— 两个人各自的方案落在各自目录里，
		 * 路径不相交，merge 干净。
		 */
		function DesignStage(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const editable = props.editable;
			/**
			 * 汇总的编辑权是**另一条规则**：不看「这是谁的管线」，只看「我是不是主导者」。
			 * 把它和按人的 `editable` 分开，是因为两者的判定依据根本不同 ——
			 * 合在一起就会出现「主导者看别人的管线时反而改不了全队汇总」这种荒唐结果。
			 */
			const summaryEditable = props.summaryEditable === true;
			const lead = typeof props.lead === 'string' ? props.lead : '';
			const running = props.running === true;
			const sendPrompt = props.sendPrompt;
			const root = typeof props.root === 'string' ? props.root : '';
			const onChanged = props.onChanged;

			const nonceState = react.useState(0);
			const nonce = nonceState[0];
			const setNonce = nonceState[1];
			const reload = react.useCallback(() => { setNonce((value) => value + 1); }, []);

			/** 「汇总方案」这个动作本身的状态；两个入口共用同一份，反馈只在一处出现。 */
			const summaryBusyState = react.useState(false);
			const summaryBusy = summaryBusyState[0];
			const setSummaryBusy = summaryBusyState[1];
			const summaryMessageState = react.useState(null);
			const summaryMessage = summaryMessageState[0];
			const setSummaryMessage = summaryMessageState[1];

			/**
			 * 汇总方案：让 AI 读**所有人**的方案，产出一份给主导者的整体开发概念。
			 *
			 * 与出稿的区别在读者：出稿是给我自己写方案，汇总是给主导者看全局 ——
			 * 所以指令里要的是横向对照（分歧、缺口、依赖、投入），而不是又一份方案。
			 */
			async function askSummary() {
				if (!summaryEditable || typeof sendPrompt !== 'function') return;
				setSummaryMessage(null);
				const prompt = designSummaryPrompt({
					id: requirement.id,
					title: requirement.title,
					root,
					developers,
				});
				setSummaryBusy(true);
				try {
					await sendPrompt(prompt);
					setSummaryMessage({ kind: 'ok', text: t('summary.sent') });
				} catch (error) {
					const reason = String(error && error.message ? error.message : error);
					setSummaryMessage({ kind: 'error', text: t('design.aiFailed', { reason }) });
				} finally {
					setSummaryBusy(false);
				}
			}

			const id = requirement !== null && requirement !== undefined ? requirement.id : '';
			const paths = designPaths(developer);
			const developers = requirement !== null && requirement !== undefined && Array.isArray(requirement.developers)
				? requirement.developers
				: [];
			// 依赖名单的**内容**而不是数组身份：名单是父组件每次渲染新造的数组，
			// 直接把数组放进 deps 会让这里每渲染一次就重读一遍磁盘。
			const developersKey = developers.join('\u0000');
			const pair = useAsync(
				async () => {
					if (id === '' || developer === '') {
						return { design: designState({}), summary: '', summaryMtime: 0, roster: [] };
					}
					const results = await Promise.all([
						readTextOrNull(id, paths.draft),
						readJsonOrNull(id, paths.impact),
						readJsonOrNull(id, paths.tasks),
						readJsonOrNull(id, paths.meta),
						listEntriesOrEmpty(id, paths.versions),
						// 汇总与它在磁盘上的修改时间（「更新于」直接来自文件系统）。
						readTextOrNull(id, designSummaryPath()),
						listEntriesOrEmpty(id, DESIGN_DIR),
						loadRoster(id, developers),
						// 两张结构化清单（接口 / 页面）。放在**末尾**追加：上面的下标是既有顺序，
						// 插在中间就得把每个 results[n] 重数一遍，那是白送一次错。
						readJsonOrNull(id, paths.apis),
						readJsonOrNull(id, paths.pages),
					]);
					return {
						design: designState({
							draft: results[0],
							impact: results[1],
							tasks: results[2],
							meta: results[3],
							versions: snapshotList(results[4]),
							apis: results[8],
							pages: results[9],
						}),
						summary: results[5],
						summaryMtime: entryMtime(results[6], DESIGN_SUMMARY_FILE),
						roster: results[7],
					};
				},
				[id, developer, developersKey],
				nonce,
				'design|' + id + '|' + developer,
			);
			const loaded = pair[0];

			// 会话从「执行中」回到「空闲」= AI 大概写完了，自动重读一次。
			// 刻意不做轮询：AI 写盘期间读到的半成品比晚几秒看到更容易误导人。
			const wasRunning = react.useRef(running);
			react.useEffect(() => {
				if (wasRunning.current && !running) reload();
				wasRunning.current = running;
			}, [running, reload]);

			const head = h('div', { className: 'wcw-sectionHead' },
				h('h3', { className: 'wcw-sectionTitle' },
					t('stage.design') + (developer === '' ? '' : ' \u00b7 ' + developer)),
				h('span', { className: 'wcw-pill' }, t('dev.mine')));

			if (developer === '') {
				return h('div', { className: 'wcw-section' }, head,
					h('p', { className: 'wcw-empty' }, t('dev.empty')));
			}
			if (loaded.status !== 'ready') {
				return h('div', { className: 'wcw-section' }, head,
					h('p', { className: loaded.status === 'error' ? 'wcw-error' : 'wcw-empty' },
						loaded.status === 'error' ? loaded.error : t('panel.loading')));
			}

			const data = loaded.data;
			return h(react.Fragment, null,
				// 汇总在最前面：主导者的阅读顺序应当是「先整体、后自己」。
				h(DesignSummarySection, {
					t,
					requirement,
					text: data.summary,
					updatedAt: data.summaryMtime,
					roster: data.roster,
					// 汇总的编辑权**不**跟着按人门禁走：只看我是不是主导者。
					editable: summaryEditable,
					lead,
					busy: summaryBusy,
					message: summaryMessage,
					onRun: askSummary,
					onChanged: reload,
				}),
				h(DesignDraftSection, {
					t, requirement, developer, design: data.design, paths, editable, running, sendPrompt, root, onChanged: reload,
					summaryEditable, summaryBusy, onSummarize: askSummary, lead,
				}),
				h(DesignImpactSection, {
					t, requirement, developer, impact: data.design.impact, paths, editable, onChanged: reload,
				}),
				h(DesignTasksSection, {
					t, requirement, developer, tasks: data.design.tasks, paths, editable, onChanged: reload,
				}),
				// 两张结构化清单：方案要回答的"改 / 新增哪些接口、哪些页面"就落在这里。
				h(DesignListSection, {
					t, requirement, developer, spec: DESIGN_LISTS.apis, rows: data.design.apis,
					path: paths.apis, editable, onChanged: reload,
				}),
				h(DesignListSection, {
					t, requirement, developer, spec: DESIGN_LISTS.pages, rows: data.design.pages,
					path: paths.pages, editable, onChanged: reload,
				}),
				h(DesignDocSection, {
					t, requirement, developer, path: paths.doc, editable,
				}),
			);
		}

		/**
		 * 方案汇总：给主导者看的整体视图。
		 *
		 * 与下面三段不同，这一块**不属于任何一个人** —— 它读的是共享的那一份
		 * `Pipeline/方案/汇总.md`，而且**无论当前在看谁的管线都照常显示**：
		 * 主导者不该为了看全局先把自己切到某个人的视图上。
		 *
		 * 除了汇总正文，这里还给出**跨人的进度对照**（谁写了方案、各自多少任务与人天、
		 * 谁还没写）。这部分是纯数据，不依赖 AI —— 即使汇总还没生成，
		 * 主导者也能立刻看出缺口在哪。
		 */
		function DesignSummarySection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const text = props.text;
			const updatedAt = props.updatedAt;
			const roster = props.roster;
			/** 只有主导者能改这一块；`editable` 在这里的含义就是「我是不是主导者」。 */
			const editable = props.editable === true;
			const lead = typeof props.lead === 'string' ? props.lead : '';
			/** AI 汇总的执行状态由上层持有（另一个入口在方案草稿的按钮行里）。 */
			const running = props.busy === true;
			const runMessage = props.message === undefined ? null : props.message;
			const onRun = props.onRun;
			const onChanged = props.onChanged;

			const bufferState = react.useState(text);
			const buffer = bufferState[0];
			const setBuffer = bufferState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];

			const bufferRef = react.useRef(buffer);
			bufferRef.current = buffer;
			const lastLoaded = react.useRef(text);
			// AI 重写了汇总时同步进编辑框，但正在改的人不被覆盖（与正文同一套规矩）。
			react.useEffect(() => {
				const clean = bufferRef.current === lastLoaded.current;
				lastLoaded.current = text;
				if (clean) setBuffer(text);
			}, [text]);

			const hasText = text.trim() !== '';
			const dirty = buffer !== text;
			const missing = rosterMissing(roster);
			const people = Array.isArray(roster) ? roster : [];

			async function save() {
				setBusy(true);
				setMessage(null);
				try {
					await callWorkbench('writeText', { args: { id: requirement.id, path: designSummaryPath(), text: buffer } });
					setMessage({ kind: 'ok', text: t('summary.saved') });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy(false);
				}
			}

			const rows = people.map((person) => h('div', { key: person.name, className: 'wcw-docRow' },
				h('span', { className: 'wcw-docName' }, person.name),
				h('span', {
					className: 'wcw-pill',
					'data-status': person.hasDraft ? (person.confirmed ? 'approved' : 'active') : undefined,
				}, person.hasDraft
					? (person.confirmed ? t('summary.confirmed') : t('summary.wrote'))
					: t('summary.notWrote')),
				h('span', { className: 'wcw-docMeta' },
					person.tasks === 0 ? '' : t('summary.tasks', { count: person.tasks, days: person.days })),
			));

			// 反馈只有一个出处：两个入口都能触发的那个动作，消息统一显示在这里。
			const shown = runMessage !== null && runMessage !== undefined ? runMessage : message;

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('summary.heading')),
					h('span', { className: 'wcw-pill', 'data-status': hasText ? 'active' : undefined },
						hasText ? t('summary.done') : t('summary.pending')),
					updatedAt === 0 ? null : h('span', { className: 'wcw-docMeta' },
						t('summary.updatedAt', { time: formatTime(new Date(updatedAt).toISOString()) })),
					h('span', { className: 'wcw-qaSpacer' }),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: !editable || running,
						title: editable ? t('summary.leadOnly') : t('summary.readonly', { name: lead }),
						onClick: () => { if (typeof onRun === 'function') void onRun(); },
					}, running ? t('summary.working') : t('summary.label')),
					editable && hasText ? h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || !dirty,
						onClick: () => { void save(); },
					}, busy ? t('summary.saving') : (dirty ? t('summary.save') : t('summary.saved'))) : null,
				),
				editable ? null : h('p', { className: 'wcw-fieldNote' }, t('summary.readonly', { name: lead })),
				shown === null ? null : h('p', { className: shown.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, shown.text),
				people.length === 0
					? h('p', { className: 'wcw-empty' }, t('summary.noDevelopers'))
					: h('div', null,
						h('p', { className: 'wcw-fieldNote' },
							t('summary.roster') + ' · '
							+ (missing.length === 0 ? t('summary.allWritten') : t('summary.missing', { names: missing.join('、') }))
							+ ' · ' + t('summary.totalDays', { days: rosterDays(roster) })),
						h('div', { className: 'wcw-docList' }, rows),
					),
				hasText ? null : h('p', { className: 'wcw-empty' }, t('summary.empty')),
				hasText && editable ? h('textarea', {
					className: 'wcw-textarea wcw-designEditor',
					value: buffer,
					onChange: (event) => { setBuffer(event.target.value); },
				}) : null,
				hasText && !editable ? h('pre', { className: 'wcw-pre' }, text) : null,
			);
		}

		/** 方案正文：AI 出稿、人工修改、保存、留存版本、与上一版对比、定稿。 */
		function DesignDraftSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const design = props.design;
			const paths = props.paths;
			const editable = props.editable;
			const sendPrompt = props.sendPrompt;
			const root = props.root;
			const onChanged = props.onChanged;
			/** 汇总按钮的可用性由**主导者身份**决定，与按人的 editable 是两套规则。 */
			const summaryEditable = props.summaryEditable === true;
			const summaryBusy = props.summaryBusy === true;
			const onSummarize = props.onSummarize;
			const lead = typeof props.lead === 'string' ? props.lead : '';

			const textState = react.useState(design.draft);
			const text = textState[0];
			const setText = textState[1];
			const busyState = react.useState('');
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];
			const manualState = react.useState('');
			const manual = manualState[0];
			const setManual = manualState[1];
			const compareState = react.useState(false);
			const comparing = compareState[0];
			const setComparing = compareState[1];
			const beforeState = react.useState('');
			const before = beforeState[0];
			const setBefore = beforeState[1];

			const textRef = react.useRef(text);
			textRef.current = text;
			const lastLoaded = react.useRef(design.draft);
			// AI 写了新稿（或刷新）时同步进编辑框，但**正在改的人不被覆盖**：
			// 编辑框里的内容和上一次读到的正文一致，才算「没动过」。
			react.useEffect(() => {
				const clean = textRef.current === lastLoaded.current;
				lastLoaded.current = design.draft;
				if (clean) setText(design.draft);
			}, [design.draft]);

			const latest = design.versions.length > 0 ? design.versions[0] : null;
			const latestName = latest === null ? '' : latest.name;
			react.useEffect(() => {
				if (!comparing || latestName === '') return undefined;
				let cancelled = false;
				readTextOrNull(requirement.id, paths.versions + '/' + latestName).then((value) => {
					if (!cancelled) setBefore(value);
				});
				return () => { cancelled = true; };
			}, [comparing, latestName, requirement.id]);

			/** 让对话里的 AI 出稿 / 改稿。 */
			async function askAi() {
				setMessage(null);
				setManual('');
				const prompt = designPrompt({
					id: requirement.id,
					title: requirement.title,
					developer,
					root,
					points: Array.isArray(requirement.featurePoints) ? requirement.featurePoints : [],
					hasDraft: design.draft.trim() !== '',
				});
				if (typeof sendPrompt !== 'function') {
					setManual(prompt);
					setMessage({ kind: 'error', text: t('design.aiManual') });
					return;
				}
				setBusy('ai');
				try {
					await sendPrompt(prompt);
					setMessage({ kind: 'ok', text: t('design.aiSent') });
				} catch (error) {
					const reason = String(error && error.message ? error.message : error);
					// 送不出去并不是死路：把指令摆出来让人自己粘贴，功能仍然可用。
					setManual(prompt);
					setMessage({ kind: 'error', text: t('design.aiFailed', { reason }) });
				} finally {
					setBusy('');
				}
			}

			async function save() {
				setBusy('save');
				setMessage(null);
				try {
					await callWorkbench('writeText', { args: { id: requirement.id, path: paths.draft, text } });
					setMessage({ kind: 'ok', text: t('design.saved') });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy('');
				}
			}

			async function snapshot() {
				setBusy('snapshot');
				setMessage(null);
				try {
					const index = nextSnapshotIndex(design.versions.map((entry) => ({ name: entry.name })));
					await callWorkbench('writeText', { args: { id: requirement.id, path: paths.version(index), text } });
					setMessage({ kind: 'ok', text: t('design.snapshotted', { version: 'v' + index }) });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy('');
				}
			}

			async function toggleConfirm() {
				setBusy('confirm');
				setMessage(null);
				try {
					const confirmedAt = design.confirmedAt === '' ? new Date().toISOString() : '';
					await callWorkbench('writeText', {
						args: {
							id: requirement.id,
							path: paths.meta,
							text: JSON.stringify({ schema: 1, developer, confirmedAt, updatedAt: new Date().toISOString() }, null, 2) + '\n',
						},
					});
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy('');
				}
			}

			const confirmed = design.confirmedAt !== '';
			// 空方案不给点定稿：状态判定那边同样不认（两道都要有，缺一个就有点一下变绿的路径）。
			const hasContent = hasDesignContent(design);
			const dirty = text !== design.draft;
			const state = confirmed ? 'approved' : (design.draft.trim() === '' ? 'pending' : 'active');

			const versionRows = design.versions.map((entry) => h('div', { key: entry.name, className: 'wcw-docRow' },
				h('span', { className: 'wcw-docName' }, entry.name),
				h('span', { className: 'wcw-docMeta' }, entry.bytes + ' B'),
			));

			let body = null;
			if (comparing && latest === null) {
				body = h('p', { className: 'wcw-empty' }, t('design.noVersions'));
			} else if (comparing) {
				const lines = diffLines(before, text);
				const stats = diffStats(lines);
				body = h('div', null,
					stats.added === 0 && stats.removed === 0
						? h('p', { className: 'wcw-empty' }, t('doc.unchanged'))
						: h('p', { className: 'wcw-docMeta' }, '+' + stats.added + ' / -' + stats.removed),
					h('pre', { className: 'wcw-pre' }, lines.map((line, index) => h('span', {
						key: String(index),
						className: 'wcw-diffLine ' + (line.kind === 'add' ? 'wcw-diffAdded' : line.kind === 'remove' ? 'wcw-diffRemoved' : 'wcw-diffSame'),
					}, (line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  ') + line.text + '\n'))),
				);
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('menu.design.draft')),
					h('span', { className: 'wcw-pill', 'data-status': state }, t(STATUS_KEY[state])),
					h('span', { className: 'wcw-docMeta' }, design.draft.trim() === '' ? '' : t('doc.chars', { count: design.draft.length })),
					h('span', { className: 'wcw-qaSpacer' }),
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '' || (!confirmed && !hasContent),
						title: !confirmed && !hasContent ? t('design.confirmEmpty') : '',
						onClick: () => { void toggleConfirm(); },
					}, confirmed ? t('design.reopen') : t('design.confirm')) : null,
				),
				editable ? h('div', { className: 'wcw-btnRow' },
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy !== '' || typeof sendPrompt !== 'function',
						onClick: () => { void askAi(); },
					}, busy === 'ai' ? t('design.aiWorking') : (design.draft.trim() === '' ? t('design.ai') : t('design.aiRedo'))),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '' || !dirty,
						onClick: () => { void save(); },
					}, busy === 'save' ? t('design.saving') : (dirty ? t('design.save') : t('design.saved'))),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '',
						onClick: () => { void snapshot(); },
					}, t('design.snapshot')),
					// 汇总紧挨着「留存版本」：留档是自己的稿子，汇总是全队的稿子。
					// 但它的编辑权不看「这是谁的管线」，只看「我是不是主导者」——
					// 不是主导者时按钮在，但点不动，并说明为什么。
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy !== '' || !summaryEditable,
						title: summaryEditable ? t('summary.leadOnly') : t('summary.readonly', { name: lead }),
						onClick: () => { if (typeof onSummarize === 'function') void onSummarize(); },
					}, summaryBusy ? t('summary.working') : t('summary.label')),
					design.versions.length === 0 ? null : h('button', {
						type: 'button',
						className: comparing ? 'wcw-btn wcw-btnPrimary' : 'wcw-btn',
						onClick: () => { setComparing(!comparing); },
					}, comparing ? t('doc.compareClose') : t('design.compare')),
				) : h('p', { className: 'wcw-error' }, t('dev.viewing', { name: developer })),
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				manual === '' ? null : h('div', { className: 'wcw-field' },
					h('p', { className: 'wcw-fieldNote' }, t('design.paste')),
					h('pre', { className: 'wcw-pre' }, manual),
				),
				editable ? h('textarea', {
					className: 'wcw-textarea wcw-designEditor',
					value: text,
					placeholder: t('design.placeholder'),
					onChange: (event) => { setText(event.target.value); },
				}) : (design.draft.trim() === '' && !comparing
					? h('p', { className: 'wcw-empty' }, t('design.empty'))
					: null),
				body,
				versionRows.length === 0 ? null : h('div', { className: 'wcw-docList' }, versionRows),
			);
		}

		/** 影响面分析：受影响的模块、风险等级、回滚方案、依赖。 */
		function DesignImpactSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const impact = props.impact;
			const paths = props.paths;
			const editable = props.editable;
			const onChanged = props.onChanged;

			const formState = react.useState(() => impactToForm(impact));
			const form = formState[0];
			const setForm = formState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];

			const lastLoaded = react.useRef(impact);
			react.useEffect(() => {
				if (lastLoaded.current === impact) return;
				lastLoaded.current = impact;
				setForm(impactToForm(impact));
			}, [impact]);

			const patch = (key, value) => { setForm(Object.assign({}, form, { [key]: value })); };
			const dirty = !sameImpact(form, impact);

			async function save() {
				setBusy(true);
				setMessage(null);
				try {
					await callWorkbench('writeText', {
						args: {
							id: requirement.id,
							path: paths.impact,
							text: JSON.stringify({
								schema: 1,
								developer,
								modules: form.modules,
								risk: form.risk,
								rollback: form.rollback,
								dependencies: form.dependencies,
								updatedAt: new Date().toISOString(),
							}, null, 2) + '\n',
						},
					});
					setMessage({ kind: 'ok', text: t('impact.saved') });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy(false);
				}
			}

			const riskOptions = [['low', 'impact.riskLow'], ['medium', 'impact.riskMedium'], ['high', 'impact.riskHigh']];

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('menu.design.impact')),
					h('span', { className: 'wcw-pill', 'data-status': impactFilled(impact) ? 'active' : undefined },
						impactFilled(impact) ? t('status.active') : t('status.pending')),
					h('span', { className: 'wcw-qaSpacer' }),
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || !dirty,
						onClick: () => { void save(); },
					}, busy ? t('impact.saving') : (dirty ? t('impact.save') : t('impact.saved'))) : null,
				),
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				h('div', { className: 'wcw-field' },
					h('label', { className: 'wcw-fieldNote' }, t('impact.modules')),
					h('textarea', {
						className: 'wcw-textarea',
						value: form.modules,
						disabled: !editable,
						placeholder: t('impact.modulesPlaceholder'),
						onChange: (event) => { patch('modules', event.target.value); },
					}),
				),
				h('div', { className: 'wcw-btnRow' },
					h('div', { className: 'wcw-field' },
						h('label', { className: 'wcw-fieldNote' }, t('impact.risk')),
						h('select', {
							className: 'wcw-select',
							value: form.risk,
							disabled: !editable,
							onChange: (event) => { patch('risk', event.target.value); },
						}, riskOptions.map((pair) => h('option', { key: pair[0], value: pair[0] }, t(pair[1])))),
					),
				),
				h('div', { className: 'wcw-field' },
					h('label', { className: 'wcw-fieldNote' }, t('impact.rollback')),
					h('textarea', {
						className: 'wcw-textarea',
						value: form.rollback,
						disabled: !editable,
						placeholder: t('impact.rollbackPlaceholder'),
						onChange: (event) => { patch('rollback', event.target.value); },
					}),
				),
				h('div', { className: 'wcw-field' },
					h('label', { className: 'wcw-fieldNote' }, t('impact.dependencies')),
					h('textarea', {
						className: 'wcw-textarea',
						value: form.dependencies,
						disabled: !editable,
						placeholder: t('impact.dependenciesPlaceholder'),
						onChange: (event) => { patch('dependencies', event.target.value); },
					}),
				),
			);
		}

		/** 任务拆分：从功能点生成骨架，手工增删改，记预估人天与完成情况。 */
		function DesignTasksSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const tasks = props.tasks;
			const paths = props.paths;
			const editable = props.editable;
			const onChanged = props.onChanged;

			const listState = react.useState(tasks);
			const list = listState[0];
			const setList = listState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];

			const lastLoaded = react.useRef(tasks);
			react.useEffect(() => {
				if (lastLoaded.current === tasks) return;
				lastLoaded.current = tasks;
				setList(tasks);
			}, [tasks]);

			const points = requirement !== null && requirement !== undefined && Array.isArray(requirement.featurePoints)
				? requirement.featurePoints
				: [];
			const mine = points.filter((point) => point !== null && point !== undefined && point.assignee === developer);
			const summary = taskSummary(list);
			const dirty = JSON.stringify(list) !== JSON.stringify(tasks);

			function seed() {
				setMessage(null);
				setList(seedTasks(points, developer, list, newId));
			}

			function updateAt(index, patch) {
				setList(list.map((task, at) => (at === index ? Object.assign({}, task, patch) : task)));
			}

			async function save() {
				setBusy(true);
				setMessage(null);
				try {
					await callWorkbench('writeText', {
						args: {
							id: requirement.id,
							path: paths.tasks,
							text: JSON.stringify({ schema: 1, developer, tasks: list, updatedAt: new Date().toISOString() }, null, 2) + '\n',
						},
					});
					setMessage({ kind: 'ok', text: t('task.saved') });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy(false);
				}
			}

			const rows = list.map((task, index) => {
				const point = points.find((candidate) => candidate !== null && candidate !== undefined && candidate.id === task.pointId);
				return h('div', { key: typeof task.id === 'string' && task.id !== '' ? task.id : String(index), className: 'wcw-point' },
					h('div', { className: 'wcw-field' },
						h('input', {
							type: 'text',
							className: 'wcw-input',
							value: typeof task.title === 'string' ? task.title : '',
							disabled: !editable,
							placeholder: point === undefined ? t('task.titlePlaceholder') : point.name,
							onChange: (event) => { updateAt(index, { title: event.target.value }); },
						}),
						h('span', { className: 'wcw-fieldNote' },
							task.pointId === '' || task.pointId === undefined
								? t('task.manual')
								: (point === undefined ? t('task.orphan') : t('task.point') + '：' + point.name)),
					),
					h('div', { className: 'wcw-field wcw-taskNum' },
						h('label', { className: 'wcw-fieldNote' }, t('task.estimate')),
						h('input', {
							type: 'number',
							min: '0',
							step: '0.5',
							className: 'wcw-input',
							value: String(typeof task.estimate === 'number' ? task.estimate : 0),
							disabled: !editable,
							onChange: (event) => { updateAt(index, { estimate: Number(event.target.value) || 0 }); },
						}),
					),
					h('label', { className: 'wcw-check' },
						h('input', {
							type: 'checkbox',
							checked: task.done === true,
							disabled: !editable,
							onChange: (event) => { updateAt(index, { done: event.target.checked }); },
						}),
						t('task.doneTag'),
					),
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { setList(list.filter((candidate, at) => at !== index)); },
					}, t('task.remove')) : null,
				);
			});

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('menu.design.breakdown')),
					h('span', { className: 'wcw-pill', 'data-status': list.length === 0 ? undefined : (summary.done === summary.count ? 'approved' : 'active') },
						t('task.total', { count: summary.count, days: summary.days, done: summary.done })),
					h('span', { className: 'wcw-qaSpacer' }),
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: mine.length === 0,
						onClick: seed,
					}, t('task.seed')) : null,
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { setList(list.concat([{ id: newId(), pointId: '', title: '', estimate: 0, done: false }])); },
					}, t('task.add')) : null,
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || !dirty,
						onClick: () => { void save(); },
					}, busy ? t('task.saving') : (dirty ? t('task.save') : t('task.saved'))) : null,
				),
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				h('p', { className: 'wcw-fieldNote' },
					mine.length === 0 ? t('task.noPoints') : t('task.seedHint', { name: developer, count: mine.length })),
				rows.length === 0
					? h('p', { className: 'wcw-empty' }, t('task.empty'))
					: h('div', { className: 'wcw-points' }, rows),
			);
		}

		/**
		 * 方案清单（后端接口 / 前端页面）：逐行增删改，落盘成 `apis.json` / `pages.json`。
		 *
		 * 为什么**不**并进 `STAGE_BLOCKS`：那张表决定的是**阶段完成判定**（`stageVerdict`），
		 * 而方案阶段的完成判定是"定稿"（`designStageStatus`）—— 共用一张表会顺手改掉那条判定链。
		 * 这里只共用**渲染方式**：同一套 `.wcw-point` 行样式、同一套"保存 / 已保存"语义。
		 */
		function DesignListSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const spec = props.spec;
			const rows = props.rows;
			const path = props.path;
			const editable = props.editable === true;
			const onChanged = props.onChanged;

			const listState = react.useState(rows);
			const list = listState[0];
			const setList = listState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];

			// AI 写了新内容（或手动刷新）时同步进来，但**正在改的人不被覆盖**。
			const bufferRef = react.useRef(list);
			bufferRef.current = list;
			const lastLoaded = react.useRef(rows);
			react.useEffect(() => {
				const clean = JSON.stringify(bufferRef.current) === JSON.stringify(lastLoaded.current);
				lastLoaded.current = rows;
				if (clean) setList(rows);
			}, [rows]);

			const columns = Array.isArray(spec.columns) ? spec.columns : [];
			const dirty = JSON.stringify(list) !== JSON.stringify(rows);

			/** 空白行：每一列都给空串，不留 undefined（界面上出现 undefined 比空串糟得多）。 */
			function blankRow() {
				const row = {};
				for (const column of columns) row[column.key] = '';
				return row;
			}

			function patch(index, key, value) {
				setList(list.map((row, at) => (at === index ? Object.assign({}, row, { [key]: value }) : row)));
			}

			async function save() {
				setBusy(true);
				setMessage(null);
				try {
					await callWorkbench('writeText', {
						args: {
							id: requirement.id,
							path,
							text: JSON.stringify(designListPayload(spec, developer, list), null, 2) + '\n',
						},
					});
					setMessage({ kind: 'ok', text: t('stage.saved') });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy(false);
				}
			}

			function cell(column, row, index) {
				// 只有声明了宽度的列才定宽：其余列平分剩余空间，长文本（路径、交互说明）才有地方写。
				const style = column.width === undefined ? undefined : { flex: 'none', width: String(column.width) + 'px' };
				return h('div', { key: column.key, className: 'wcw-field', style },
					h('label', { className: 'wcw-fieldNote' }, t(column.labelKey)),
					h('input', {
						type: 'text',
						className: 'wcw-input',
						value: typeof row[column.key] === 'string' ? row[column.key] : '',
						disabled: !editable,
						placeholder: column.placeholderKey === undefined ? '' : t(column.placeholderKey),
						onChange: (event) => { patch(index, column.key, event.target.value); },
					}));
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t(spec.titleKey)),
					h('span', { className: 'wcw-pill' }, t('stage.rows', { count: list.length })),
					h('span', { className: 'wcw-qaSpacer' }),
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { setList(list.concat([blankRow()])); },
					}, t('stage.add')) : null,
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || !dirty,
						onClick: () => { void save(); },
					}, busy ? t('stage.saving') : (dirty ? t('stage.save') : t('stage.saved'))) : null,
				),
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				list.length === 0
					? h('p', { className: 'wcw-empty' }, t('stage.empty'))
					: h('div', { className: 'wcw-points' }, list.map((row, index) => h('div', {
						key: String(index),
						className: 'wcw-point',
					},
						columns.map((column) => cell(column, row, index)),
						editable ? h('button', {
							type: 'button',
							className: 'wcw-btn',
							onClick: () => { setList(list.filter((other, at) => at !== index)); },
						}, t('stage.remove')) : null,
					))),
			);
		}

		/**
		 * 方案文档：把方案数据按模板渲染成一份**能交出去的文档**。
		 *
		 * 三个动作**刻意分开**：生成（只渲染，不落盘）→ 预览 → 写入文件。
		 * 直接落盘的话，等看到"缺了三个字段"就已经晚了 —— 而缺字段恰恰是最常见的情况。
		 */
		function DesignDocSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const path = props.path;
			const editable = props.editable === true;

			const renderedState = react.useState(null);
			const rendered = renderedState[0];
			const setRendered = renderedState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];

			async function generate() {
				setBusy(true);
				setMessage(null);
				try {
					const result = await renderDesignDoc({ id: requirement.id, requirement, developer });
					if (!result.hasContent) {
						setRendered(null);
						setMessage({ kind: 'error', text: t('gendoc.empty') });
						return;
					}
					setRendered(result);
					setMessage(result.missing.length === 0
						? { kind: 'ok', text: t('gendoc.complete') }
						: {
							kind: 'error',
							text: t('gendoc.missing', { count: result.missing.length, names: result.missing.join('、') }),
						});
				} catch (error) {
					setRendered(null);
					setMessage({ kind: 'error', text: t('gendoc.failed', { reason: String(error && error.message ? error.message : error) }) });
				} finally {
					setBusy(false);
				}
			}

			async function write() {
				if (rendered === null) return;
				setBusy(true);
				setMessage(null);
				try {
					await callWorkbench('writeText', { args: { id: requirement.id, path, text: designDocFile(rendered) } });
					setMessage({ kind: 'ok', text: t('gendoc.saved', { path }) });
				} catch (error) {
					setMessage({ kind: 'error', text: t('gendoc.failed', { reason: String(error && error.message ? error.message : error) }) });
				} finally {
					setBusy(false);
				}
			}

			async function copy() {
				if (rendered === null) return;
				try {
					// 受嵌环境里 clipboard 可能不存在（或不是安全上下文）：那是**可以接受**的失败，
					// 预览就在下面，用户手动全选复制即可 —— 所以这里只提示，不假装成功。
					if (typeof navigator === 'undefined' || navigator.clipboard === undefined
						|| typeof navigator.clipboard.writeText !== 'function') {
						throw new Error('clipboard unavailable');
					}
					await navigator.clipboard.writeText(designDocFile(rendered));
					setMessage({ kind: 'ok', text: t('gendoc.copied') });
				} catch (error) {
					setMessage({ kind: 'error', text: t('gendoc.copyFailed', { reason: String(error && error.message ? error.message : error) }) });
				}
			}

			async function exportBuiltin() {
				setBusy(true);
				setMessage(null);
				try {
					const value = await writeBuiltinTemplate();
					setMessage({ kind: 'ok', text: t('gendoc.exported', { path: value.path }) });
				} catch (error) {
					const reason = String(error && error.message ? error.message : error);
					const path = templateHint('design');
					// 已经存在 = 没覆盖它。这不是失败，是**刻意的保护**，所以按提示（而不是错误）讲清楚。
					setMessage(/exists/.test(reason)
						? { kind: 'error', text: t('gendoc.exists', { path }) }
						: { kind: 'error', text: t('gendoc.failed', { reason }) });
				} finally {
					setBusy(false);
				}
			}

			const source = rendered === null
				? ''
				: (rendered.templatePath === ''
					? t('gendoc.builtin')
					: t('gendoc.custom', { path: rendered.templatePath }));

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('gendoc.heading')),
					rendered === null ? null : h('span', { className: 'wcw-pill' }, t('doc.chars', { count: designDocFile(rendered).length })),
					h('span', { className: 'wcw-qaSpacer' }),
					h('button', {
						type: 'button',
						className: 'wcw-btn' + (rendered === null ? ' wcw-btnPrimary' : ''),
						disabled: busy,
						onClick: () => { void generate(); },
					}, busy ? t('gendoc.generating') : (rendered === null ? t('gendoc.generate') : t('gendoc.regenerate'))),
					rendered === null ? null : h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { void copy(); },
					}, t('gendoc.copy')),
					rendered === null || !editable ? null : h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy,
						onClick: () => { void write(); },
					}, busy ? t('gendoc.saving') : t('gendoc.save')),
				),
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				// 模板放哪、现在是哪一份，必须一直看得见：用户改了半天模板却生成不出效果，
				// 十有八九就是文件放错了地方（或宿主没重启）。
				editable ? h('p', { className: 'wcw-fieldNote' },
					t('gendoc.templateMissing', { path: templateHint('design') }),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						style: { marginLeft: '8px' },
						disabled: busy,
						onClick: () => { void exportBuiltin(); },
					}, t('gendoc.exportBuiltin', { path: templateHint('design') }))) : null,
				h('p', { className: 'wcw-fieldNote' }, t('gendoc.exportNote')),
				rendered !== null && rendered.templateUnsupported === true
					? h('p', { className: 'wcw-error' }, t('gendoc.needsRestart'))
					: null,
				rendered === null
					? h('p', { className: 'wcw-empty' }, t('gendoc.empty'))
					: h(react.Fragment, null,
						h('p', { className: 'wcw-fieldNote' }, t('gendoc.template', { source })),
						h('pre', { className: 'wcw-pre' }, designDocFile(rendered)),
					),
			);
		}

		/** 影响面表单的初始值；字段缺失或类型不对都落回空串。 */
		function impactToForm(impact) {
			const source = impact !== null && typeof impact === 'object' ? impact : {};
			const text = (key) => (typeof source[key] === 'string' ? source[key] : '');
			const risk = source.risk === 'low' || source.risk === 'medium' || source.risk === 'high' ? source.risk : 'medium';
			return {
				modules: text('modules'),
				risk,
				rollback: text('rollback'),
				dependencies: text('dependencies'),
			};
		}

		/** 表单和已存的影响面是不是一样（用来决定「保存」按钮亮不亮）。 */
		function sameImpact(form, impact) {
			const saved = impactToForm(impact);
			return form.modules === saved.modules
				&& form.risk === saved.risk
				&& form.rollback === saved.rollback
				&& form.dependencies === saved.dependencies;
		}

		/** 从块状态里取出可编辑的值：rows → 行数组，fields → 字段对象，markdown → 文本。 */
		function valueOf(spec, state) {
			if (state === null || state === undefined) {
				return spec.kind === 'markdown' ? '' : (spec.kind === 'fields' ? {} : []);
			}
			if (spec.kind === 'markdown') return state.text;
			if (spec.kind === 'fields') return state.values;
			return state.items;
		}

		/** 深比较。只需要应付「字符串 / 数组 / 对象」这三种形状。 */
		function sameValue(left, right) {
			return JSON.stringify(left) === JSON.stringify(right);
		}

		/** 要写盘的对象：块声明 + 值 → 磁盘形状。 */
		function blockPayload(spec, developer, buffer) {
			const head = typeof developer === 'string' && developer !== '' ? { developer } : {};
			const body = spec.kind === 'fields' ? buffer : { items: buffer };
			return Object.assign({ schema: 1 }, head, body, { updatedAt: new Date().toISOString() });
		}

		/**
		 * 一块产物：读、改、存。
		 *
		 * 三种形态（rows / fields / markdown）共用同一套「缓冲 → 脏检查 → 保存」骨架，
		 * 因为它们的交互完全一样，差别只在中间那段渲染 —— 所以是**一个组件加三种渲染**，
		 * 而不是三个组件。加一种形态只要往这里加一个分支。
		 */
		function StageBlockSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const stageId = props.stageId;
			const developer = props.developer;
			const spec = props.spec;
			const state = props.state;
			const editable = props.editable === true;
			const taskOptions = props.taskOptions;
			const onChanged = props.onChanged;
			const sendPrompt = props.sendPrompt;
			const root = typeof props.root === 'string' ? props.root : '';
			/**
			 * 逐行【执行】由**声明**决定：块里有没有 `execute`、值是哪一种。
			 * 所以这个组件从头到尾不需要知道"测试"这个词，也不需要知道第几块。
			 */
			const execute = typeof spec.execute === 'string' ? BLOCK_EXECUTE[spec.execute] : undefined;
			const canExecute = editable && execute !== undefined && execute !== null && typeof execute.prompt === 'function';

			const initial = valueOf(spec, state);
			const bufferState = react.useState(initial);
			const buffer = bufferState[0];
			const setBuffer = bufferState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];
			/** 正在【执行】的那一行（下标）；-1 = 弹窗关着。 */
			const execState = react.useState(-1);
			const execIndex = execState[0];
			const setExecIndex = execState[1];

			const bufferRef = react.useRef(buffer);
			bufferRef.current = buffer;
			const lastLoaded = react.useRef(initial);
			// AI 写了新内容（或刷新）时同步进来，但**正在改的人不被覆盖**。
			react.useEffect(() => {
				const next = valueOf(spec, state);
				const clean = sameValue(bufferRef.current, lastLoaded.current);
				lastLoaded.current = next;
				if (clean) setBuffer(next);
			}, [state]);

			const saved = valueOf(spec, state);
			const dirty = !sameValue(buffer, saved);
			const filled = blockFilled(spec, state);

			/** 这一行的名字：第一个有值的文本列；没有就退回「第 N 条」（序号也是定位依据）。 */
			const labelOf = (row, index) => rowLabel(spec, row) || t('stage.rowNo', { no: index + 1 });
			/** 弹窗正开着的那一行执行指令。算它是纯函数，不读盘。 */
			const execRow = canExecute && execIndex >= 0 && execIndex < buffer.length ? buffer[execIndex] : null;
			const execPrompt = execRow === null ? '' : execute.prompt({
				id: requirement.id,
				title: requirement.title,
				developer,
				root,
				row: execRow,
				index: execIndex,
			});

			/** 把这一行的执行指令送进对话；成功才关弹窗（失败由弹窗自己显示，指令不丢）。 */
			async function sendExecute(text) {
				if (typeof sendPrompt !== 'function') throw new Error(t('exec.manual'));
				await sendPrompt(text);
				setExecIndex(-1);
				setMessage({ kind: 'ok', text: t('exec.sent') });
			}

			async function save() {
				setBusy(true);
				setMessage(null);
				try {
					const path = stageBlockPath(stageId, developer, spec.file);
					const text = spec.kind === 'markdown'
						? buffer
						: JSON.stringify(blockPayload(spec, developer, buffer), null, 2) + '\n';
					await callWorkbench('writeText', { args: { id: requirement.id, path, text } });
					setMessage({ kind: 'ok', text: t('stage.saved') });
					await onChanged();
				} catch (error) {
					setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) });
				} finally {
					setBusy(false);
				}
			}

			const patchRow = (index, key, value) => {
				setBuffer(buffer.map((row, at) => (at === index ? Object.assign({}, row, { [key]: value }) : row)));
			};			const patchField = (key, value) => {
				setBuffer(Object.assign({}, buffer, { [key]: value }));
			};

			/** 一列的控件。 */
			function cell(column, row, index) {
				const value = row[column.key];
				const style = column.width === undefined ? undefined : { maxWidth: String(column.width) + 'px' };
				if (column.type === 'check') {
					return h('label', { key: column.key, className: 'wcw-check' },
						h('input', {
							type: 'checkbox',
							checked: value === true,
							disabled: !editable,
							onChange: (event) => { patchRow(index, column.key, event.target.checked); },
						}),
						t(column.labelKey));
				}
				if (column.type === 'select') {
					return h('div', { key: column.key, className: 'wcw-field' },
						h('label', { className: 'wcw-fieldNote' }, t(column.labelKey)),
						h('select', {
							className: 'wcw-select',
							value: value,
							disabled: !editable,
							onChange: (event) => { patchRow(index, column.key, event.target.value); },
						}, (Array.isArray(column.options) ? column.options : []).map((option) => h('option', { key: option, value: option }, t(OPTION_KEY[option])))));
				}
				// 任务列：选项来自**方案的任务拆分**（不是声明表里的静态枚举），
				// 所以它是唯一一种选项要在运行时才拿到的列。
				if (column.type === 'task') {
					const options = Array.isArray(taskOptions) ? taskOptions : [];
					return h('div', { key: column.key, className: 'wcw-field', style },
						h('label', { className: 'wcw-fieldNote' }, t(column.labelKey)),
						h('select', {
							className: 'wcw-select',
							value: typeof value === 'string' ? value : '',
							disabled: !editable,
							onChange: (event) => { patchRow(index, column.key, event.target.value); },
						}, [h('option', { key: '', value: '' }, t('col.taskNone'))].concat(
							options.map((option) => h('option', { key: option.id, value: option.id }, option.label)),
						)));
				}
				return h('div', { key: column.key, className: 'wcw-field', style },
					h('label', { className: 'wcw-fieldNote' }, t(column.labelKey)),
					h('input', {
						type: 'text',
						className: 'wcw-input',
						value: typeof value === 'string' ? value : '',
						disabled: !editable,
						placeholder: column.placeholderKey === undefined ? '' : t(column.placeholderKey),
						onChange: (event) => { patchRow(index, column.key, event.target.value); },
					}));
			}

			let body = null;
			if (spec.kind === 'markdown') {
				if (editable) {
					body = h('textarea', {
						className: 'wcw-textarea wcw-designEditor',
						value: buffer,
						onChange: (event) => { setBuffer(event.target.value); },
					});
				} else {
					body = buffer.trim() === ''
						? h('p', { className: 'wcw-empty' }, t('stage.empty'))
						: h('pre', { className: 'wcw-pre' }, buffer);
				}
			} else if (spec.kind === 'fields') {
				body = h('div', { className: 'wcw-btnRow' }, spec.fields.map((field) => h('div', { key: field.key, className: 'wcw-field' },
					h('label', { className: 'wcw-fieldNote' }, t(field.labelKey)),
					h('input', {
						type: field.type === 'date' ? 'date' : 'text',
						className: 'wcw-input',
						value: typeof buffer[field.key] === 'string' ? buffer[field.key] : '',
						disabled: !editable,
						placeholder: field.placeholderKey === undefined ? '' : t(field.placeholderKey),
						onChange: (event) => { patchField(field.key, event.target.value); },
					}))));
			} else if (buffer.length === 0) {
				body = h('p', { className: 'wcw-empty' }, t('stage.empty'));
			} else {
				body = h('div', { className: 'wcw-points' }, buffer.map((row, index) => h('div', {
					key: String(index),
					className: 'wcw-point',
				},
					spec.columns.map((column) => cell(column, row, index)),
					// 【执行】挨在【删除】前面：一行上"做这件事"和"删掉这行"是紧邻的两个动作，
					// 放在最右边、且执行在前 —— 删除是这一行唯一不可逆的动作，让它仍然在最后。
					canExecute ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						title: t(execute.titleKey, { name: labelOf(row, index) }),
						onClick: () => { setMessage(null); setExecIndex(index); },
					}, t('exec.run')) : null,
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { setBuffer(buffer.filter((other, at) => at !== index)); },
					}, t('stage.remove')) : null,
				)));
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t(spec.titleKey)),
					h('span', { className: 'wcw-pill', 'data-status': filled ? 'active' : undefined },
						spec.kind === 'rows' ? t('stage.rows', { count: buffer.length }) : (filled ? t('status.active') : t('status.pending'))),
					h('span', { className: 'wcw-qaSpacer' }),
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || !dirty,
						onClick: () => { void save(); },
					}, busy ? t('stage.saving') : (dirty ? t('stage.save') : t('stage.saved'))) : null,
				),
				message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
				body,
				editable && spec.kind === 'rows' ? h('div', { className: 'wcw-btnRow' },
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => {
							const blank = {};
							for (const column of spec.columns) {
								if (column.type === 'check') blank[column.key] = false;
								else if (column.type === 'select') blank[column.key] = Array.isArray(column.options) && column.options.length > 0 ? column.options[0] : '';
								else blank[column.key] = '';
							}
							setBuffer(buffer.concat([blank]));
						},
					}, t('stage.add')),
				) : null,
				execRow === null ? null : h(ExecuteDialog, {
					t,
					title: t(execute.titleKey, { name: labelOf(execRow, execIndex) }),
					note: t(execute.noteKey),
					writes: t(execute.writesKey),
					prompt: execPrompt,
					onSend: typeof sendPrompt === 'function' ? sendExecute : undefined,
					onClose: () => { setExecIndex(-1); },
				}),
			);
		}

		/**
		 * 汇总区里的一组名字。
		 *
		 * 组头是「叫什么 + 几个」，下面是**成组的小标签**（可换行、限高滚动）。
		 * 为什么不沿用一句「还没有开工的任务：A、B、C…」：33 个任务名连成一句话就是一堵墙，
		 * 读的人只会跳过它 —— 那块汇总就等于不存在。名字一个没少（名字本身就是状态的一部分），
		 * 变的只是"句子"到"清单"；限高是为了不让它把下面的产物区顶出屏幕。
		 */
		function TaskNameGroup(props) {
			const t = props.t;
			const names = Array.isArray(props.names) ? props.names : [];
			return h('div', { className: 'wcw-taskGroup', 'data-tone': typeof props.tone === 'string' ? props.tone : '' },
				h('div', { className: 'wcw-taskGroupHead' },
					h('span', { className: 'wcw-taskGroupLabel' }, t(props.labelKey)),
					h('span', { className: 'wcw-pill' }, t('mine.groupCount', { count: names.length })),
				),
				h('div', { className: 'wcw-taskGroupTags' },
					names.map((name, index) => h('span', {
						key: String(index) + '|' + name,
						className: 'wcw-taskTag',
						// 标签是截断显示的（长任务名 + 窄窗口），完整名字挂在 title 上。
						title: name,
					}, name === '' ? t('mine.untitled') : name))),
			);
		}

		/**
		 * 【执行】的弹窗：先把指令摆出来，人改完再送进对话。
		 *
		 * 开发页的每个任务、测试页的每条用例共用这一个 —— 两处不同的只是**指令怎么生成**
		 * （`taskExecutePrompt` / `testCaseExecutePrompt`）与上面那两句说明，所以说明由调用方
		 * 作为**已翻译的文本**传进来（`title` / `note` / `writes`），这里不认识任何阶段。
		 *
		 * 为什么**不**点一下就发：这条指令会让 AI 去动代码、去跑服务，发出去就收不回来 ——
		 * AI 已经开始动了。所以把不可逆的那一步留给人：先看一眼，顺手把
		 * 「先别动数据库」「只改这一个接口」这类话加进去，再发。
		 *
		 * 发送失败时弹窗**不关、指令也不清** —— 那正是最需要原文还在的时候。
		 */
		function ExecuteDialog(props) {
			const t = props.t;
			const fallback = typeof props.prompt === 'string' ? props.prompt : '';
			const draftState = react.useState(fallback);
			const draft = draftState[0];
			const setDraft = draftState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];
			/** 会话通道不可用时（空白会话、宿主半是旧版）按钮**置灰并说明**，而不是静默失效。 */
			const canSend = typeof props.onSend === 'function';

			async function send() {
				if (!canSend || busy) return;
				setBusy(true);
				setMessage(null);
				try {
					await props.onSend(draft);
				} catch (error) {
					const reason = String(error && error.message ? error.message : error);
					setMessage({ kind: 'error', text: t('exec.failed', { reason }) });
					setBusy(false);
				}
			}

			return h('div', { className: 'wcw-modal', role: 'dialog', 'aria-modal': 'true' },
				h('div', { className: 'wcw-modalPanel' },
					h('div', { className: 'wcw-modalHead' },
						h('h3', { className: 'wcw-modalTitle' }, props.title),
					),
					typeof props.note === 'string' && props.note !== '' ? h('p', { className: 'wcw-fieldNote' }, props.note) : null,
					typeof props.writes === 'string' && props.writes !== '' ? h('p', { className: 'wcw-fieldNote' }, props.writes) : null,
					h('p', { className: 'wcw-fieldNote' }, canSend ? t('exec.edit') : t('exec.manual')),
					h('textarea', {
						className: 'wcw-textarea wcw-execPrompt',
						value: draft,
						disabled: busy,
						onChange: (event) => { setDraft(event.target.value); },
					}),
					message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
					h('div', { className: 'wcw-btnRow' },
						h('button', {
							type: 'button',
							className: 'wcw-btn wcw-btnPrimary',
							disabled: busy || !canSend || draft.trim() === '',
							onClick: () => { void send(); },
						}, busy ? t('exec.sending') : t('exec.send')),
						h('button', {
							type: 'button',
							className: 'wcw-btn',
							disabled: busy || draft === fallback,
							onClick: () => { setDraft(fallback); setMessage(null); },
						}, t('exec.reset')),
						h('span', { className: 'wcw-qaSpacer' }),
						h('button', {
							type: 'button',
							className: 'wcw-btn',
							disabled: busy,
							onClick: () => { props.onClose(); },
						}, t('exec.close')),
					),
				),
			);
		}

		/**
		 * 我的任务：方案里分派给我的任务、每个任务的执行情况，以及每行的【执行】。
		 *
		 * 任务的**定义**仍然归方案页（那里生成、那里改），执行情况也**不另存一份状态** ——
		 * 它由「变更清单里挂在这个任务上的行」推出来（见 `taskProgress`）。
		 * 这一块多出来的只有一个**动作**：把这个任务的执行指令送进对话。
		 *
		 * 执行按钮只给能改这条管线的人（`editable`）：从别人的页面上发起执行，
		 * 等于用别人的名义去改代码，而那个人并不知道。
		 */
		function MyTasksSection(props) {
			const t = props.t;
			const requirement = props.requirement;
			const developer = props.developer;
			const tasks = Array.isArray(props.tasks) ? props.tasks : [];
			const changes = Array.isArray(props.changes) ? props.changes : [];
			const editable = props.editable === true;
			const sendPrompt = props.sendPrompt;
			const root = typeof props.root === 'string' ? props.root : '';

			const points = requirement !== null && requirement !== undefined && Array.isArray(requirement.featurePoints)
				? requirement.featurePoints
				: [];
			const rows = taskProgress(tasks, changes);
			const summary = progressSummary(rows);
			const gaps = taskGaps(points, developer, tasks);
			const untouched = rows.filter((row) => row.state === 'todo');
			const tagged = changes.filter((row) => row !== null && row !== undefined && typeof row.taskId === 'string' && row.taskId !== '').length;

			/** 正在「执行」的任务行；null = 弹窗关着。 */
			const execState = react.useState(null);
			const execRow = execState[0];
			const setExecRow = execState[1];
			const execMessageState = react.useState(null);
			const execMessage = execMessageState[0];
			const setExecMessage = execMessageState[1];

			const nameOf = (task) => taskName(task, points) || t('mine.untitled');

			/** 把「执行这一个任务」的指令送进对话；成功才关弹窗（失败由弹窗自己显示，指令不丢）。 */
			async function sendExecute(text) {
				if (typeof sendPrompt !== 'function') throw new Error(t('exec.manual'));
				await sendPrompt(text);
				setExecRow(null);
				setExecMessage({ kind: 'ok', text: t('exec.sent') });
			}

			const execPrompt = execRow === null ? '' : taskExecutePrompt({
				id: requirement.id,
				title: requirement.title,
				developer,
				root,
				task: execRow.task,
				points,
			});

			const taskRows = rows.map((row, index) => {
				const task = row.task === null || row.task === undefined ? {} : row.task;
				const point = points.find((candidate) => candidate !== null && candidate !== undefined && candidate.id === task.pointId);
				return h('div', { key: typeof task.id === 'string' && task.id !== '' ? task.id : String(index), className: 'wcw-docRow' },
					h('span', { className: 'wcw-docName' }, nameOf(task)),
					h('span', { className: 'wcw-pill', 'data-status': row.state === 'done' ? 'approved' : (row.state === 'doing' ? 'active' : undefined) },
						t(TASK_STATE_KEY[row.state])),
					h('span', { className: 'wcw-docMeta' },
						(point === undefined ? '' : t('mine.point') + '：' + point.name + ' · ')
						+ (row.task !== null && row.task !== undefined && typeof row.task.estimate === 'number' && row.task.estimate > 0
							? t('mine.estimate', { days: row.task.estimate }) + ' · ' : '')
						+ (row.changes.length === 0
							? t('mine.noChange')
							: t('mine.changes', { done: row.doneChanges, total: row.changes.length }))),
					// 每行一个【执行】：点开是**可以先改**的指令弹窗，确认后才发给 AI。
					editable ? h('span', { className: 'wcw-qaSpacer' }) : null,
					editable ? h('button', {
						type: 'button',
						className: 'wcw-btn',
						title: t('mine.execTitle', { name: nameOf(task) }),
						onClick: () => { setExecMessage(null); setExecRow(row); },
					}, t('exec.run')) : null,
				);
			});

			// 汇总区的两组：未开工的任务 / 一个任务都没有的功能点。
			// 顺序是刻意的：「还没做」在前（日常要看的是它），「压根没拆」在后（那是缺口，更严重但更少见）。
			const groups = [];
			if (untouched.length > 0) groups.push({
				key: 'todo', tone: 'todo', labelKey: 'mine.groupTodo',
				names: untouched.map((row) => nameOf(row.task)),
			});
			if (gaps.length > 0) groups.push({
				key: 'gap', tone: 'gap', labelKey: 'mine.groupGap',
				names: gaps.map((point) => point.name),
			});

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('mine.heading')),
					h('span', {
						className: 'wcw-pill',
						'data-status': summary.count > 0 && summary.done === summary.count ? 'approved' : (summary.count > 0 ? 'active' : undefined),
					}, t('mine.summary', { count: summary.count, todo: summary.todo, doing: summary.doing, done: summary.done })),
					h('span', { className: 'wcw-qaSpacer' }),
					h('span', { className: 'wcw-pill' }, t('mine.readonly')),
				),
				execMessage === null ? null : h('p', { className: execMessage.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, execMessage.text),
				tasks.length === 0
					? h('p', { className: 'wcw-empty' }, t('mine.empty'))
					: h('div', { className: 'wcw-docList' }, taskRows),
				// 「没有开工」和「压根没有任务」是两件事，分开说 —— 后者要去方案页补。
				groups.length === 0
					? (tasks.length === 0 ? null : h('p', { className: 'wcw-fieldNote' }, t('mine.noGaps')))
					: h('div', { className: 'wcw-taskGroups' },
						groups.map((group) => h(TaskNameGroup, {
							key: group.key, t, labelKey: group.labelKey, tone: group.tone, names: group.names,
						})),
						gaps.length > 0
							? h('p', { className: 'wcw-fieldNote' }, t('mine.groupHint'))
							: h('p', { className: 'wcw-fieldNote' }, t('mine.noGaps')),
					),
				tasks.length === 0 ? null : h('p', { className: 'wcw-fieldNote' },
					t('mine.hint') + (tagged === changes.length ? '' : ' ' + t('mine.untagged', { count: changes.length - tagged }))),
				execRow === null ? null : h(ExecuteDialog, {
					t,
					title: t('mine.execTitle', { name: nameOf(execRow.task) }),
					note: t('mine.execNote'),
					writes: t('mine.execWrites'),
					prompt: execPrompt,
					// 通道不可用时不给 onSend：按钮置灰，并改说「复制到对话里」。
					onSend: typeof sendPrompt === 'function' ? sendExecute : undefined,
					onClose: () => { setExecRow(null); },
				}),
			);
		}


		/**
		 * 阶段页：开发 / 测试 / 提版 共用。
		 *
		 * 三块产物、一个 AI 入口、一套只读门禁 —— 全部由 `STAGE_BLOCKS` 里那几行声明决定。
		 * 所以这个组件里没有任何一处提到具体的阶段名，加阶段不用改它。
		 */
		function StagePage(props) {
			const t = props.t;
			const requirement = props.requirement;
			const stageId = props.stageId;
			const developer = props.developer;
			const editable = props.editable === true;
			const running = props.running === true;
			const sendPrompt = props.sendPrompt;
			const root = typeof props.root === 'string' ? props.root : '';

			const nonceState = react.useState(0);
			const nonce = nonceState[0];
			const setNonce = nonceState[1];
			const reload = react.useCallback(() => { setNonce((value) => value + 1); }, []);

			const spec = stageBlocks(stageId);
			const perPerson = stageIsPerPerson(stageId);
			const id = requirement !== null && requirement !== undefined ? requirement.id : '';
			const dir = stageDir(stageId, developer);
			const filesKey = spec.map((block) => block.file).join(',');
			// 只要有「任务列」，这一页就需要方案里的任务清单来做选项与进度对照。
			// 判断依据是**声明**而不是阶段名，所以将来任何阶段加一个任务列都自动生效。
			const needsTasks = spec.some((block) => (Array.isArray(block.columns) ? block.columns : [])
				.some((column) => column.type === 'task'));

			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const messageState = react.useState(null);
			const message = messageState[0];
			const setMessage = messageState[1];
			const manualState = react.useState('');
			const manual = manualState[0];
			const setManual = manualState[1];

			const pair = useAsync(
				async () => {
					if (id === '' || dir === '') return { states: {}, tasks: [] };
					const design = designPaths(developer);
					const [values, tasksFile] = await Promise.all([
						Promise.all(spec.map((block) => {
							const path = stageBlockPath(stageId, developer, block.file);
							return block.kind === 'markdown'
								? readTextOrNull(id, path).then((text) => ({ text }))
								: readJsonOrNull(id, path).then((json) => ({ json }));
						})),
						// 方案里的任务清单：任务列的选项与「我的任务」都靠它。
						needsTasks ? readJsonOrNull(id, design.tasks) : Promise.resolve(null),
					]);
					const states = {};
					spec.forEach((block, index) => { states[block.file] = blockState(block, values[index]); });
					return {
						states,
						tasks: tasksFile !== null && Array.isArray(tasksFile.tasks) ? tasksFile.tasks : [],
					};
				},
				[id, dir, filesKey, needsTasks],
				nonce,
				'stage|' + id + '|' + stageId + '|' + developer,
			);
			const loaded = pair[0];

			// 会话从「执行中」回到「空闲」= AI 大概写完了，自动重读一次。
			const wasRunning = react.useRef(running);
			react.useEffect(() => {
				if (wasRunning.current && !running) reload();
				wasRunning.current = running;
			}, [running, reload]);

			/** 让对话里的 AI 写这一阶段。 */
			async function askAi() {
				setMessage(null);
				setManual('');
				const prompt = stagePrompt(stageId, {
					id: requirement.id,
					title: requirement.title,
					root,
					developer: perPerson ? developer : '',
				});
				if (typeof sendPrompt !== 'function') {
					setManual(prompt);
					setMessage({ kind: 'error', text: t('design.aiManual') });
					return;
				}
				setBusy(true);
				try {
					await sendPrompt(prompt);
					setMessage({ kind: 'ok', text: t('stage.aiSent') });
				} catch (error) {
					const reason = String(error && error.message ? error.message : error);
					setManual(prompt);
					setMessage({ kind: 'error', text: t('design.aiFailed', { reason }) });
				} finally {
					setBusy(false);
				}
			}

			const stage = stageOf(stageId);
			const title = stage === null ? stageId : t(stage.labelKey);
			const head = h('div', { className: 'wcw-sectionHead' },
				h('h3', { className: 'wcw-sectionTitle' },
					perPerson && developer !== '' ? title + ' \u00b7 ' + developer : title),
				h('span', { className: 'wcw-pill' }, perPerson ? t('dev.mine') : t('dev.shared')));

			if (spec.length === 0) return null;
			if (perPerson && developer === '') {
				return h('div', { className: 'wcw-section' }, head,
					h('p', { className: 'wcw-empty' }, t('dev.empty')));
			}
			if (loaded.status !== 'ready') {
				return h('div', { className: 'wcw-section' }, head,
					h('p', { className: loaded.status === 'error' ? 'wcw-error' : 'wcw-empty' },
						loaded.status === 'error' ? loaded.error : t('panel.loading')));
			}

			const states = loaded.data === null || loaded.data === undefined ? {} : loaded.data.states;
			const tasks = loaded.data === null || loaded.data === undefined ? [] : loaded.data.tasks;
			const points = requirement !== null && requirement !== undefined && Array.isArray(requirement.featurePoints)
				? requirement.featurePoints
				: [];
			// 任务列的选项：标签优先用任务标题，退回来源功能点，再退回 id。
			const taskOptions = tasks.map((task) => ({ id: task.id, label: taskName(task, points) }));
			const changes = blockRows(states, 'changes.json');
			let filled = 0;
			for (const block of spec) if (blockFilled(block, states[block.file])) filled += 1;

			return h(react.Fragment, null,
				h('div', { className: 'wcw-section' }, head,
					h('p', { className: 'wcw-fieldNote' },
						(perPerson ? t('stage.ownerHint') : t('stage.sharedHint')) + ' '
						+ t(STAGE_DONE_KEY[stageId])
						+ (stageId === 'test' ? ' ' + t('selftest.note') : '')),
					h('div', { className: 'wcw-btnRow' },
						h('span', { className: 'wcw-pill' },
							filled + ' / ' + spec.length),
						h('span', { className: 'wcw-qaSpacer' }),
						editable ? h('button', {
							type: 'button',
							className: 'wcw-btn wcw-btnPrimary',
							disabled: busy || typeof sendPrompt !== 'function',
							onClick: () => { void askAi(); },
						}, busy ? t('stage.aiWorking') : (filled === 0 ? t('stage.ai') : t('stage.aiRedo'))) : null,
					),
					message === null ? null : h('p', { className: message.kind === 'ok' ? 'wcw-ok' : 'wcw-error' }, message.text),
					editable ? null : h('p', { className: 'wcw-error' }, t('dev.viewing', { name: developer })),
					manual === '' ? null : h('div', { className: 'wcw-field' },
						h('p', { className: 'wcw-fieldNote' }, t('design.paste')),
						h('pre', { className: 'wcw-pre' }, manual)),
				),
				// 「我的任务」放在产物之前：先看清要做什么，再看已经做了什么。
				// editable / sendPrompt / root 是【执行】按钮要的东西：只给自己那条管线开这个口子。
				needsTasks ? h(MyTasksSection, { t, requirement, developer, tasks, changes, editable, sendPrompt, root }) : null,
				spec.map((block) => h(StageBlockSection, {
					key: block.file,
					t,
					requirement,
					stageId,
					developer,
					spec: block,
					state: states[block.file],
					editable,
					taskOptions,
					onChanged: reload,
					// 逐行【执行】要用的两样：送指令的通道、以及拼绝对路径的根。
					sendPrompt,
					root,
				})),
			);
		}

		/**
		 * 本机的逾期通知表（`$DSH_HOME/workbench/notices.json`，由宿主读写）。
		 *
		 * `supported: false` 表示宿主半还是旧版本、没有这几个 op —— 此时退回
		 * 「把计时写进共享的 requirement.json」的老行为。这个分支必须留着：
		 * 宿主半改动要重启，而客户端半是热替换，中间必然有新客户端配旧宿主的窗口。
		 */
		const noticeStore = { supported: false, map: {} };

		/** 读一次本机通知表；读不到就把 supported 置 false，退回共享字段。 */
		async function loadNoticeStore() {
			try {
				const value = await callWorkbench('readNotices', {});
				const raw = value !== null && value !== undefined ? value.notices : null;
				noticeStore.supported = true;
				noticeStore.map = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
			} catch (error) {
				noticeStore.supported = false;
				noticeStore.map = {};
			}
			return noticeStore;
		}

		/**
		 * 把「本机通知表」和「共享文件里的旧字段」合成纯函数认识的那个形状。
		 *
		 * 纯函数（isAutoArchiveDue / noticeVisible / daysUntilAutoArchive）刻意不动：
		 * 它们只认 overdueNoticeAt / overdueNoticeReadAt 两个字段，把这两个字段的来源
		 * 换掉，判定逻辑一行都不用改，已有的一堆断言也继续有效。
		 */
		function noticeView(meta, store) {
			const entry = store.map[meta.id];
			if (store.supported && entry !== null && entry !== undefined) {
				return Object.assign({}, meta, {
					overdueNoticeAt: typeof entry.raisedAt === 'string' ? entry.raisedAt : '',
					overdueNoticeReadAt: typeof entry.readAt === 'string' ? entry.readAt : '',
				});
			}
			// 旧宿主：继续用共享字段，否则升级窗口里所有提醒会一起消失。
			return Object.assign({}, meta, {
				overdueNoticeAt: typeof meta.overdueNoticeAt === 'string' ? meta.overdueNoticeAt : '',
				overdueNoticeReadAt: typeof meta.overdueNoticeReadAt === 'string' ? meta.overdueNoticeReadAt : '',
			});
		}

		/**
		 * 读需求列表，并顺带处理「已标记完成且已过上线日期」的需求。
		 *
		 * 这里是逾期通知与自动归档的**唯一驱动点**：工作台每被打开一次（或任何一次刷新）
		 * 就扫一遍。刻意不做后台定时器 —— 「三天后自动归档」的准确含义是
		 * 「三天后第一次打开工作台时归档」。
		 */
		async function loadBoard(sessionId) {
			const list = await callWorkbench('listRequirements', { sessionId, includeArchived: true });
			const requirements = Array.isArray(list.requirements) ? list.requirements : [];
			const store = await loadNoticeStore();
			const swept = await sweepOverdue(sessionId, requirements, store);
			if (!swept.changed) return { requirements, root: list.root, notices: swept.notices };
			// 有需求刚被自动归档：重新取一次，让归档标记立刻反映到列表上（目录不会动）。
			const after = await callWorkbench('listRequirements', { sessionId, includeArchived: true });
			return {
				requirements: Array.isArray(after.requirements) ? after.requirements : [],
				root: after.root,
				notices: swept.notices,
			};
		}

		/**
		 * 扫描逾期需求：首次发现时登记通知时间，登记满 3 天则自动归档。
		 *
		 * 登记与已读都写进**本机**通知表，不再写共享的 `requirement.json` ——
		 * 「谁先打开工作台」于是不再是共享状态，两个人同一天打开也不会改到同一处。
		 * 只有宿主还是旧版本时，才继续读写共享字段。
		 *
		 * 只对「已完成 + 已过上线日」的需求读完整元数据，通常 0～2 条，
		 * 所以不需要把通知字段塞进列表摘要里。
		 * @returns {Promise<{ notices: object[], changed: boolean }>}
		 */
		async function sweepOverdue(sessionId, requirements, store) {
			const now = new Date();
			const notices = [];
			let changed = false;

			for (const summary of requirements) {
				if (summary.archived) continue;
				if (summary.status !== 'done') continue;
				if (parseDay(summary.goLiveDate) === null) continue;

				const fresh = await callWorkbench('readRequirement', { sessionId, args: { id: summary.id } });
				const meta = fresh.requirement;
				if (!isOverdueDone(meta, now)) continue;

				if (store.supported) {
					const existing = store.map[summary.id];
					if (existing === null || existing === undefined) {
						// 首次登记。共享文件里若有升级前写下的旧计时，就继承它 ——
						// 3 天窗口必须跨用户一致，换个人打开不该把倒计时重置。
						const legacy = typeof meta.overdueNoticeAt === 'string' ? meta.overdueNoticeAt : '';
						const seed = legacy !== '' ? legacy : now.toISOString();
						const created = await callWorkbench('raiseNotice', { sessionId, args: { id: summary.id, raisedAt: seed } });
						const ok = created !== null && created !== undefined;
						store.map[summary.id] = {
							raisedAt: ok && typeof created.raisedAt === 'string' ? created.raisedAt : seed,
							readAt: ok && typeof created.readAt === 'string' ? created.readAt : '',
						};
					}
				} else if (typeof meta.overdueNoticeAt !== 'string' || meta.overdueNoticeAt === '') {
					// 旧宿主：沿用老行为，把计时写进共享文件。
					const raised = Object.assign({}, meta, { overdueNoticeAt: now.toISOString() });
					await callWorkbench('writeRequirement', { sessionId, args: { id: summary.id, requirement: raised } });
					meta.overdueNoticeAt = raised.overdueNoticeAt;
				}

				const view = noticeView(meta, store);
				if (isAutoArchiveDue(view, now)) {
					await callWorkbench('archiveRequirement', { sessionId, args: { id: summary.id } });
					changed = true;
					continue;
				}

				if (noticeVisible(view, now)) notices.push(view);
			}

			return { notices, changed };
		}

		/**
		 * 顶部栏右上角的提醒铃铛。
		 *
		 * 徽标数字 = 未读条数。点开即视为已读（由父组件写 overdueNoticeReadAt），
		 * 已读 3 天后这条提醒自己消失。
		 */
		function NoticeBell(props) {
			const t = props.t;
			const notices = props.notices;
			const open = props.open === true;
			const now = props.now;

			let unread = 0;
			for (const notice of notices) if (notice.overdueNoticeReadAt === '') unread += 1;

			const rows = notices.map((notice) => h('div', { key: notice.id, className: 'wcw-bellRow' },
				h('div', { className: 'wcw-chipMenuTitle' },
					notice.title === '' ? notice.id : notice.title,
					h('span', { className: 'wcw-chipId' }, '  ' + notice.id),
				),
				h('p', { className: 'wcw-bellHint' },
					t('notice.detail', { date: notice.goLiveDate, days: daysUntilAutoArchive(notice, now) })),
				h('div', { className: 'wcw-btnRow' },
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						onClick: () => { props.onArchive(notice.id); },
					}, t('req.archive')),
					h('button', { type: 'button', className: 'wcw-btn', onClick: props.onClose }, t('notice.later')),
				),
			));

			const panel = open ? h('div', { className: 'wcw-bellPanel' },
				rows.length === 0
					? h('p', { className: 'wcw-empty' }, t('notice.empty'))
					: h('div', { className: 'wcw-qa' }, rows),
				h('p', { className: 'wcw-bellHint' }, t('notice.readHint')),
			) : null;

			return h('div', { className: 'wcw-bell' },
				h('button', {
					type: 'button',
					className: 'wcw-bellButton',
					'aria-expanded': open,
					title: t('notice.title'),
					'aria-label': t('notice.title'),
					onClick: props.onToggle,
				},
					h('svg', {
						viewBox: '0 0 16 16',
						width: 15,
						height: 15,
						'aria-hidden': 'true',
						fill: 'none',
						stroke: 'currentColor',
						strokeWidth: 1.3,
						strokeLinecap: 'round',
						strokeLinejoin: 'round',
					},
						h('path', { d: 'M8 2.6a3.5 3.5 0 0 0-3.5 3.5v2.3L3.3 10.9h9.4l-1.2-2.5V6.1A3.5 3.5 0 0 0 8 2.6Z' }),
						h('path', { d: 'M6.7 12.2a1.3 1.3 0 0 0 2.6 0' }),
					),
					unread > 0 ? h('span', { className: 'wcw-bellBadge' }, String(unread)) : null,
				),
				panel,
			);
		}

		// 「我」是谁存在**用户数据目录**（`$DSH_HOME/workbench/identity.json`），
		// 不放在浏览器里也不放在项目里 —— 身份要跨项目跟着人走。
		// 读写都走宿主 op：readIdentity / writeIdentity。

		/**
		 * 「我在看谁的管线」是**本机视图状态**，绝不能写进需求文件夹 ——
		 * 那会让每个人的本地操作都去改同一个共享文件，协同开发必然冲突。
		 * 它放在浏览器本地，按需求编号记一份。
		 */
		const VIEW_KEY = 'dsh.workbench.view';

		/** 造一对「按需求编号存取」的本机映射读写函数；坏数据一律按空处理。 */
		function createLocalMap(storageKey) {
			return {
				read() {
					try {
						const raw = window.localStorage.getItem(storageKey);
						const parsed = raw === null ? null : JSON.parse(raw);
						return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
					} catch (error) {
						return {};
					}
				},
				write(map) {
					try {
						window.localStorage.setItem(storageKey, JSON.stringify(map));
					} catch (error) {
						// 隐私模式下写不进去；本次会话仍然生效。
					}
				},
			};
		}

		const viewStore = createLocalMap(VIEW_KEY);

		/** 读「每个需求我在看谁」的映射；坏数据按空处理。 */
		function readViewMap() {
			return viewStore.read();
		}

		/** 写回视图映射；隐私模式下忽略，本次会话仍然生效。 */
		function writeViewMap(map) {
			viewStore.write(map);
		}

		/**
		 * 首次打开工作台时问「你是谁」。
		 *
		 * 没有身份系统就没法区分「我的管线」和「别人的管线」，所以这一步是必须的；
		 * 之后可以从「开发人员」区右上角改。
		 */
		function IdentityDialog(props) {
			const t = props.t;
			const draftState = react.useState(props.identity === undefined ? '' : props.identity);
			const draft = draftState[0];
			const setDraft = draftState[1];

			function submit() {
				const name = draft.trim();
				if (name === '') return;
				props.onConfirm(name);
			}

			return h('div', { className: 'wcw-modal', role: 'dialog', 'aria-modal': 'true' },
				h('div', { className: 'wcw-modalPanel', style: { width: 'min(440px,92vw)' } },
					h('div', { className: 'wcw-modalHead' },
						h('h3', { className: 'wcw-modalTitle' },
							props.identity === '' ? t('me.welcome') : t('me.changeTitle')),
					),
					h('p', { className: 'wcw-mePrompt' }, t('me.prompt')),
					h('p', { className: 'wcw-fieldNote' }, t('me.hint')),
					h('input', {
						className: 'wcw-input wcw-meInput',
						value: draft,
						placeholder: t('me.placeholder'),
						autoFocus: true,
						onChange: (event) => { setDraft(event.target.value); },
						onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } },
					}),
					h('div', { className: 'wcw-btnRow' },
						h('button', {
							type: 'button',
							className: 'wcw-btn wcw-btnPrimary',
							disabled: draft.trim() === '',
							onClick: submit,
						}, props.identity === '' ? t('me.confirm') : t('me.save')),
					),
				),
			);
		}

		/** 详情弹框里的一行键值。 */
		function kvRow(key, value) {
			return h('div', { className: 'wcw-kvRow' },
				h('span', { className: 'wcw-kvKey' }, key),
				h('p', { className: 'wcw-kvValue' }, value),
			);
		}

		/**
		 * 顶部栏右侧的「历史需求」下拉框。
		 *
		 * 归档掉的需求不再占需求列表的位置，而是收进这里：可以搜索标题或编号，
		 * 每一项后面有一个 `▾`，展开后出现【详情】按钮，点开是**只读**的整条管线回显。
		 */
		function HistoryMenu(props) {
			const t = props.t;
			const items = props.items;
			const open = props.open === true;
			const expanded = props.expanded;
			const query = props.query;

			const needle = query.trim().toLowerCase();
			const matched = needle === '' ? items : items.filter((entry) => (
				(entry.title === '' ? '' : entry.title).toLowerCase().includes(needle)
				|| entry.id.toLowerCase().includes(needle)
			));

			const rows = matched.map((entry) => {
				const isOpen = expanded === entry.id;
				return h('div', { key: entry.id, className: 'wcw-histRow' },
					h('div', { className: 'wcw-histRowHead' },
						h('span', { className: 'wcw-histTitle' }, entry.title === '' ? entry.id : entry.title),
						h('span', { className: 'wcw-chipId' }, entry.id),
						h('button', {
							type: 'button',
							className: 'wcw-histArrow',
							'aria-expanded': isOpen,
							title: isOpen ? t('hist.collapse') : t('hist.expand'),
							'aria-label': isOpen ? t('hist.collapse') : t('hist.expand'),
							onClick: () => { props.onExpand(isOpen ? '' : entry.id); },
						}, isOpen ? '\u25b4' : '\u25be'),
					),
					isOpen ? h('div', { className: 'wcw-btnRow' },
						h('button', {
							type: 'button',
							className: 'wcw-btn wcw-btnPrimary',
							onClick: () => { props.onDetail(entry.id); },
						}, t('hist.detail')),
						h('button', {
							type: 'button',
							className: 'wcw-btn',
							title: t('hist.restoreHint'),
							onClick: () => { props.onRestore(entry); },
						}, t('hist.restore')),
					) : null,
				);
			});

			const panel = open ? h('div', { className: 'wcw-histPanel' },
				h('input', {
					className: 'wcw-histSearch',
					type: 'search',
					value: query,
					placeholder: t('hist.search'),
					onChange: (event) => { props.onQuery(event.target.value); },
				}),
				rows.length === 0
					? h('p', { className: 'wcw-empty' }, items.length === 0 ? t('req.historyEmpty') : t('hist.empty'))
					: h('div', { className: 'wcw-histList' }, rows),
			) : null;

			return h('div', { className: 'wcw-hist' },
				h('button', {
					type: 'button',
					className: 'wcw-histButton',
					'aria-expanded': open,
					onClick: props.onToggle,
				},
					t('req.history') + ' (' + items.length + ')',
					h('span', { className: 'wcw-histCaret', 'aria-hidden': 'true' }, '\u25be'),
				),
				panel,
			);
		}

		/**
		 * 历史需求的只读管线回显。
		 *
		 * 整个弹框**没有任何写入路径**：不提供上传、不提供改日期、不提供状态切换，
		 * 所有内容都是文本回显。这是刻意的 —— 归档后的需求是历史记录。
		 */
		function RequirementDetailDialog(props) {
			const t = props.t;
			const id = props.id;
			const now = props.now;

			const pair = useAsync(
				async () => {
					const value = await callWorkbench('readRequirement', { args: { id } });
					return value.requirement;
				},
				[id],
			);
			const state = pair[0];
			const meta = state.data;

			const textState = react.useState({ version: '', text: '' });
			const shown = textState[0];
			const setShown = textState[1];

			// 换需求时把上一份正文清掉。
			react.useEffect(() => { setShown({ version: '', text: '' }); }, [id]);

			async function toggleText(entry) {
				if (shown.version === entry.version) { setShown({ version: '', text: '' }); return; }
				try {
					// 历史回显也先看分析 —— 它比原文更能说明这条需求是什么。
					// 分析还没跑过（别人刚导入就归档了）时回落到解析出的原文。
					const analysis = await readTextOrNull(id, requirementAnalysisPath(entry.version));
					if (analysis.trim() !== '') { setShown({ version: entry.version, text: analysis }); return; }
					const value = await callWorkbench('readText', { args: { id, path: entry.textFile } });
					setShown({ version: entry.version, text: value.text });
				} catch (error) {
					setShown({ version: entry.version, text: String(error && error.message ? error.message : error) });
				}
			}

			const stageStatus = deriveStageStatus(meta);
			const hasMeta = meta !== null && meta !== undefined;
			const documents = hasMeta && Array.isArray(meta.documents) ? meta.documents : [];
			const clarifications = hasMeta && Array.isArray(meta.clarifications) ? meta.clarifications : [];

			const dateFields = [
				{ key: 'releaseDate', labelKey: 'dates.release' },
				{ key: 'testFreezeDate', labelKey: 'dates.testFreeze' },
				{ key: 'goLiveDate', labelKey: 'dates.goLive' },
			];

			let body = null;
			if (state.status === 'loading') {
				body = h('p', { className: 'wcw-empty' }, t('panel.loading'));
			} else if (state.status === 'error') {
				body = h('p', { className: 'wcw-error' }, state.error);
			} else if (!hasMeta) {
				body = h('p', { className: 'wcw-empty' }, t('req.none'));
			} else {
				body = h(react.Fragment, null,
					h('dl', { className: 'wcw-kv' },
						kvRow(t('detail.status'), meta.archivedAt !== '' ? t('req.archived')
							: (meta.status === 'done' ? t('req.doneTag')
								: (meta.status === 'paused' ? t('req.paused') : t('status.active')))),
						kvRow(t('detail.createdAt'), formatTime(meta.createdAt)),
						kvRow(t('detail.updatedAt'), formatTime(meta.updatedAt)),
						kvRow(t('detail.archivedAt'), meta.archivedAt === '' ? '\u2014' : formatTime(meta.archivedAt)),
					),

					h('div', { className: 'wcw-section' },
						h('h4', { className: 'wcw-sectionTitle' }, t('dates.heading')),
						h('div', { className: 'wcw-countdowns' }, dateFields.map((field) => {
							const value = meta[field.key] ?? '';
							const days = daysUntil(value, now);
							let tone = 'unset';
							let text = t('dates.unset');
							if (days !== null) {
								tone = days === 0 ? 'today' : days > 0 ? 'remaining' : 'overdue';
								text = days === 0 ? t('dates.today')
									: (days > 0 ? t('dates.remaining', { days }) : t('dates.overdue', { days: -days }));
							}
							return h('span', { key: field.key, className: 'wcw-countdown', 'data-state': tone },
								h('span', { className: 'wcw-countdownLabel' }, t(field.labelKey)),
								h('span', { className: 'wcw-countdownValue' }, (value === '' ? t('dates.unset') : value) + '  ' + text),
							);
						})),
					),

					h('div', { className: 'wcw-section' },
						h('h4', { className: 'wcw-sectionTitle' }, t('detail.pipeline')),
						h('div', { className: 'wcw-pipe' }, STAGES.map((stage, index) => h('div', {
							key: stage.id,
							className: 'wcw-stage',
						},
							h('span', { className: 'wcw-stageBadge', 'data-status': stageStatus[stage.id] }, String(index + 1)),
							h('span', { className: 'wcw-stageText' },
								h('span', { className: 'wcw-stageName' }, t(stage.labelKey)),
								h('span', {
									className: 'wcw-stageStatus',
									'data-status': stageStatus[stage.id],
								}, t(STATUS_KEY[stageStatus[stage.id]])),
							),
						))),
					),

					h('div', { className: 'wcw-section' },
						h('h4', { className: 'wcw-sectionTitle' }, t('detail.documents')),
						documents.length === 0
							? h('p', { className: 'wcw-empty' }, t('detail.noDocuments'))
							: h('div', { className: 'wcw-docList' }, documents.map((entry) => h('div', {
								key: entry.version,
								className: 'wcw-docRow',
							},
								h('span', { className: 'wcw-histTitle' }, entry.version),
								h('span', { className: 'wcw-docName' }, entry.sourceName ?? entry.file),
								h('span', { className: 'wcw-docMeta' },
									t('doc.chars', { count: entry.chars ?? 0 }) + ' \u00b7 ' + formatTime(entry.importedAt)),
								h('button', {
									type: 'button',
									className: 'wcw-btn',
									onClick: () => { void toggleText(entry); },
								}, shown.version === entry.version ? t('detail.hideText') : t('detail.viewText')),
							))),
						shown.version === '' ? null : h('pre', { className: 'wcw-pre' }, shown.text),
					),

					h('div', { className: 'wcw-section' },
						h('h4', { className: 'wcw-sectionTitle' }, t('detail.clarifications')),
						clarifications.length === 0
							? h('p', { className: 'wcw-empty' }, t('detail.noClarifications'))
							: h('div', { className: 'wcw-qa' }, clarifications.map((entry, index) => h('div', {
								key: entry.id,
								className: 'wcw-qaRow',
							},
								h('div', { className: 'wcw-qaHead' },
									h('span', { className: 'wcw-qaIndex' }, '#' + (index + 1)),
									h('span', {
										className: 'wcw-pill',
										'data-status': entry.answer === '' ? 'pending' : 'approved',
									}, entry.answer === '' ? t('qa.pending') : t('qa.answered')),
								),
								h('p', { className: 'wcw-kvValue' }, t('qa.question') + '\uff1a' + entry.question),
								h('p', { className: 'wcw-kvValue' },
									t('qa.answer') + '\uff1a' + (entry.answer === '' ? '\u2014' : entry.answer)),
							))),
					),
				);
			}

			return h('div', { className: 'wcw-modal', role: 'dialog', 'aria-modal': 'true' },
				h('div', { className: 'wcw-modalPanel' },
					h('div', { className: 'wcw-modalHead' },
						h('h3', { className: 'wcw-modalTitle' }, t('detail.title')),
						h('span', { className: 'wcw-pill' }, t('detail.readonly')),
						h('span', { className: 'wcw-qaSpacer' }),
						h('button', { type: 'button', className: 'wcw-btn', onClick: props.onClose }, t('detail.close')),
					),
					body,
				),
			);
		}

		/**
		 * 开发人员标签输入。
		 *
		 * 同一个需求支持多人协作：这里登记的人，在「方案 / 开发 / 测试」三段上
		 * 各自拥有一条独立管线；「需求」与「提版」是所有人共享的公共管线。
		 */
		function DevelopersEditor(props) {
			const t = props.t;
			const requirement = props.requirement;
			const onChanged = props.onChanged;

			const draftState = react.useState('');
			const draft = draftState[0];
			const setDraft = draftState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const errorState = react.useState('');
			const error = errorState[0];
			const setError = errorState[1];
			/** 主导者变更面板是否展开（两段式：先选、再确认）。 */
			const leadOpenState = react.useState(false);
			const leadOpen = leadOpenState[0];
			const setLeadOpen = leadOpenState[1];
			const leadDraftState = react.useState('');
			const leadDraft = leadDraftState[0];
			const setLeadDraft = leadDraftState[1];

			const developers = Array.isArray(requirement.developers) ? requirement.developers : [];
			// 「我」是谁由上层传入（浏览器本地保存）。
			// 不在这里回落到 developers[0]：身份不在名单里时不该冒充别人。
			const owner = typeof props.identity === 'string' ? props.identity : '';
			// 当前显示谁的管线由上层传入（本机视图状态，不进共享文件）。
			const current = typeof props.currentDeveloper === 'string' ? props.currentDeveloper : '';

			const lead = leadOf(requirement);
			// 「不能随便调整」：只有现任主导者能把位置交出去。
			const mayHandOver = canHandOverLead(owner, lead, developers);

			// 每次打开变更面板时，选择框默认落在现任主导者身上。
			react.useEffect(() => {
				if (!leadOpen) return;
				setLeadDraft(developers.includes(lead) ? lead : (developers.length > 0 ? developers[0] : ''));
			}, [leadOpen]);

			/** 交出主导者。调用点已经在两段式的第二段上，所以这里直接写。 */
			function handOver(name) {
				if (name === '' || name === lead) return;
				setLeadOpen(false);
				void write({ [LEAD_FIELD]: name });
			}

			/** 先重读再合并，只改传入的字段，避免覆盖并发改动。 */
			async function write(patch) {
				setBusy(true);
				setError('');
				try {
					const fresh = await callWorkbench('readRequirement', { args: { id: requirement.id } });
					await callWorkbench('writeRequirement', {
						args: { id: requirement.id, requirement: Object.assign({}, fresh.requirement, patch) },
					});
					await onChanged();
				} catch (failure) {
					setError(String(failure && failure.message ? failure.message : failure));
				} finally {
					setBusy(false);
				}
			}

			function add() {
				const name = draft.trim();
				if (name === '') return;
				for (const one of developers) if (one === name) { setDraft(''); return; }
				setDraft('');
				void write({ developers: developers.concat([name]) });
			}

			/**
			 * 移除开发人员时，顺手把分派给他的功能点收回「未分派」——
			 * 否则会留下指向一个已不存在的开发人员的悬空引用。
			 *
			 * 被移除的人正好是主导者时，把主导者字段一并清掉：`leadOf()` 本来就会
			 * 回落到名单里的第一个人，清掉只是不留一个指向陌生人的陈旧值。
			 */
			function remove(name) {
				void (async () => {
					setBusy(true);
					setError('');
					try {
						const fresh = await callWorkbench('readRequirement', { args: { id: requirement.id } });
						const current = Array.isArray(fresh.requirement.developers) ? fresh.requirement.developers : [];
						const points = Array.isArray(fresh.requirement.featurePoints) ? fresh.requirement.featurePoints : [];
						const next = Object.assign({}, fresh.requirement, {
							developers: current.filter((one) => one !== name),
							featurePoints: points.map((point) => (
								point.assignee === name ? Object.assign({}, point, { assignee: '' }) : point
							)),
						});
						if (next[LEAD_FIELD] === name) next[LEAD_FIELD] = '';
						await callWorkbench('writeRequirement', { args: { id: requirement.id, requirement: next } });
						await onChanged();
					} catch (failure) {
						setError(String(failure && failure.message ? failure.message : failure));
					} finally {
						setBusy(false);
					}
				})();
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('dev.heading')),
					h('span', { className: 'wcw-pill' }, String(developers.length)),
					h('span', { className: 'wcw-qaSpacer' }),
					// 「我」是谁：首次打开工作台时弹窗输入，这里可以改。
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						title: t('me.changeHint'),
						onClick: props.onChangeIdentity,
					}, props.identity === '' ? t('me.setName') : t('me.change', { name: props.identity })),
					// 当前开发人员：管线显示以它为准。
					developers.length === 0 ? null : h('select', {
						className: 'wcw-select',
						title: t('dev.current'),
						'aria-label': t('dev.current'),
						value: current,
						disabled: busy,
						onChange: (event) => { props.onSelectDeveloper(event.target.value); },
					},
						developers.map((name) => h('option', { key: name, value: name },
							name + (name === owner ? ' · ' + t('dev.mine') : ''))),
					),
				),
				h('p', { className: 'wcw-empty' }, t('dev.sharedHint')),
				// 主导者：唯一能编辑「方案汇总」的人，默认是名单里的第一个人。
				h('div', { className: 'wcw-btnRow' },
					h('span', { className: 'wcw-pill' },
						lead === '' ? t('lead.none') : t('lead.pill', { name: lead })),
					h('span', { className: 'wcw-fieldNote' }, t('lead.role') + t('lead.defaultHint')),
					h('span', { className: 'wcw-qaSpacer' }),
					developers.length === 0 ? null : h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy || !mayHandOver,
						title: mayHandOver ? t('lead.role') : t('lead.onlyLead', { name: lead }),
						onClick: () => { setLeadOpen(!leadOpen); },
					}, leadOpen ? t('lead.cancel') : t('lead.change')),
				),
				// 两段式：先选人，再确认。变更是一次权力移交，不该是一个下拉框随手一划。
				leadOpen && mayHandOver ? h('div', { className: 'wcw-overdue' },
					h('span', { className: 'wcw-overdueText' }, t('lead.confirmPrompt', { name: leadDraft })),
					h('select', {
						className: 'wcw-select',
						'aria-label': t('lead.pick'),
						value: leadDraft,
						disabled: busy,
						onChange: (event) => { setLeadDraft(event.target.value); },
					}, developers.map((name) => h('option', { key: name, value: name }, name))),
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || leadDraft === '' || leadDraft === lead,
						onClick: () => { handOver(leadDraft); },
					}, t('lead.confirm')),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { setLeadOpen(false); },
					}, t('lead.cancel')),
				) : null,
				developers.length === 0 ? h('p', { className: 'wcw-empty' }, t('dev.empty')) : null,
				h('div', { className: 'wcw-tags' },
					developers.map((name) => h('span', { key: name, className: 'wcw-tag' },
						name,
						h('button', {
							type: 'button',
							className: 'wcw-tagRemove',
							title: t('dev.remove', { name }),
							'aria-label': t('dev.remove', { name }),
							disabled: busy,
							onClick: () => { remove(name); },
						}, '\u00d7'),
					)),

				),
				h('div', { className: 'wcw-btnRow' },
					h('input', {
						className: 'wcw-input',
						style: { maxWidth: '220px' },
						value: draft,
						placeholder: t('dev.placeholder'),
						disabled: busy,
						onChange: (event) => { setDraft(event.target.value); },
						onKeyDown: (event) => {
							if (event.key === 'Enter') { event.preventDefault(); add(); }
						},
					}),
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || draft.trim() === '',
						onClick: add,
					}, t('dev.add')),
				),
				error === '' ? null : h('p', { className: 'wcw-error' }, error),
			);
		}

		/**
		 * 需求分析的功能点，以及每个功能点分派给谁。
		 *
		 * 分派是「按人管线」的入口：某人分到的功能点就是他那条管线的输入。
		 */
		/**
		 * 功能点：**按需求分块的两级树**。
		 *
		 * 为什么要有分块：一份 CRM 级别的需求会拆出上百个功能点，一屏平铺的列表里
		 * "客户合并"和"回款逾期冻结"挨在一起，读者没法判断自己看的是哪一块、有没有漏搬
		 * 某一整块。分块就是需求文档自己的模块结构，树形只是把它显示出来。
		 *
		 * 三条设计取舍：
		 *   - **分块名存在功能点上（`group` 字段），不另建分块注册表。** 两份数据就得同步，
		 *     而同步迟早不一致；改名就是把这一块所有点的字符串一起改，一次写盘。
		 *   - **没有 `group` 时从点名推**（`deriveGroupName`，且前缀要出现两次以上才算一块）。
		 *     老数据与 AI 漏写的情况都能兜住，否则「未分组」会把所有东西吞掉，树形就白做了。
		 *   - **分块可折叠、可改名、可在指定块下新增**。推导出来的分块一旦被人改名，
		 *     就落盘成 `group`，从此以写盘的为准。
		 */
		function FeaturePoints(props) {
			const t = props.t;
			const requirement = props.requirement;
			const onChanged = props.onChanged;

			const nameState = react.useState('');
			const name = nameState[0];
			const setName = nameState[1];
			const assigneeState = react.useState('');
			const assignee = assigneeState[0];
			const setAssignee = assigneeState[1];
			/** 新增功能点落进哪一块（'' = 未分组）。 */
			const groupState = react.useState('');
			const group = groupState[0];
			const setGroup = groupState[1];
			const busyState = react.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const errorState = react.useState('');
			const error = errorState[0];
			const setError = errorState[1];
			const filterState = react.useState('');
			const filter = filterState[0];
			const setFilter = filterState[1];
			/** 分派状态筛选：'' = 全部，'assigned' = 已分派，'unassigned' = 未分派。 */
			const assignFilterState = react.useState('');
			const assignFilter = assignFilterState[0];
			const setAssignFilter = assignFilterState[1];
			const closedState = react.useState({});
			const closed = closedState[0];
			const setClosed = closedState[1];
			/** 正在行内「加一条」的是哪一块（'' = 没有）。 */
			const addingState = react.useState('');
			const addingIn = addingState[0];
			const setAddingIn = addingState[1];
			const newRowState = react.useState({ group: '', name: '' });
			const newRow = newRowState[0];
			const setNewRow = newRowState[1];
			/**
			 * 「新分块」的取名输入。
			 *
			 * **不用 `window.prompt`**：它在受嵌环境里可能被禁（返回 null 而不报错），
			 * 于是用户选了「+ 新分块」却什么都没发生 —— 这正是"新分块添加不生效"的样子。
			 * 行内输入还有个好处：能取消、能看见自己正在建什么，而 prompt 是黑盒。
			 *
			 * 它只属于底部那一个新增区（功能点行上的下拉**只能选已有分块**），
			 * 位置就在分块下拉与分派人下拉之间 —— 紧挨着产生它的那个下拉。
			 * `open` 表示它现在是开着的；同一时刻只会有一个。
			 */
			const draftState = react.useState({ open: false, value: '' });
			const draft = draftState[0];
			const setDraft = draftState[1];
			/** 正在改名的是哪一块（'' = 没有）。 */
			const renamingState = react.useState({ name: '', value: '' });
			const renaming = renamingState[0];
			const setRenaming = renamingState[1];

			const developers = Array.isArray(requirement.developers) ? requirement.developers : [];
			const points = Array.isArray(requirement.featurePoints) ? requirement.featurePoints : [];
			const groups = pointTree(points);

			async function persist(next) {
				setBusy(true);
				setError('');
				try {
					const fresh = await callWorkbench('readRequirement', { args: { id: requirement.id } });
					await callWorkbench('writeRequirement', {
						args: { id: requirement.id, requirement: Object.assign({}, fresh.requirement, { featurePoints: next }) },
					});
					await onChanged();
				} catch (failure) {
					setError(String(failure && failure.message ? failure.message : failure));
				} finally {
					setBusy(false);
				}
			}

			/** 改一个功能点的若干字段。 */
			function patchPoint(id, fields) {
				return persist(points.map((one) => (one.id === id ? Object.assign({}, one, fields) : one)));
			}

			/** 添加一条；`into` 指定分块（'' = 未分组）。 */
			function addPoint(value, into) {
				const text = String(value).trim();
				if (text === '') { setError(t('point.needName')); return; }
				setError('');
				const next = { id: newId(), name: text, assignee: '', note: '' };
				if (normalizeGroupName(into) !== '') next.group = normalizeGroupName(into);
				void persist(points.concat([next]));
			}

			/**
			 * 新增区那个分块下拉的选择。
			 *
			 * 选到「+ 新分块」= 记下"要新建"，并在**分块下拉与分派人下拉之间**打开取名框；
			 * 下拉就停在这一项上，所以用户一眼能看出"那个文本框是从哪来的"。
			 * 选任何一个真分块（或放弃）都会把取名框收起来，避免留下一个没人管的空框。
			 */
			function chooseFormGroup(chosen) {
				if (chosen === NEW_GROUP) {
					setGroup(NEW_GROUP);
					setDraft({ open: true, value: '' });
					return;
				}
				setGroup(chosen);
				closeDraft();
			}

			function addFromForm() {
				const text = name.trim();
				if (text === '') { setError(t('point.needName')); return; }
				/**
				 * 新建分块这一步**就在这儿**：分块名躺在取名框里，只有点「新增」这一刻才读它。
				 *
				 * 这正是用户要的时序 —— 分块和功能点一起建出来。反过来（选中下拉就先把分块写盘）
				 * 会留下"建了块却没有点"的空块，而且用户中途放弃时还得再删一次。
				 */
				const into = groupForAdd(group, draft.value);
				// 选了新建却没起名字：**不要**默默落到未分组 —— 那等于把用户明确表达过的
				// 「我要新建一块」悄悄丢掉。这里挡住并告诉他怎么退出（Esc）。
				if (into === null) {
					setError(t('point.needGroupName'));
					return;
				}
				setError('');
				setName('');
				const next = { id: newId(), name: text, assignee, note: '' };
				// `NEW_GROUP` 到不了这里：上面已经拦住了；真分块名才写得进 group 字段。
				if (into !== '') next.group = into;
				setGroup('');
				closeDraft();
				void persist(points.concat([next]));
			}

			/**
			 * 给一整块改名。
			 *
			 * 两种起点都要处理：点上有 `group` 的直接改字符串；**推导出来**的分块
			 * （点上没有 group）要先"落盘"再改名 —— 否则改完这一块的点依然没有 group，
			 * 下次仍然按老名字推导，看起来像改名没生效。
			 */
			function renameGroup(from, to) {
				const wanted = normalizeGroupName(to);
				if (wanted === normalizeGroupName(from)) return;
				void persist(points.map((point) => {
					// 只认**写盘的**分块：推导出来的那一组没有 group 字段，
					// 靠名字前缀匹配会误伤别的同名前缀（而且改了也不落盘）。
					if (pointGroupOf(point) !== from) return point;
					if (wanted === '') {
						// 改成空 = 退回未分组：把 group 去掉（推导出的旧前缀仍在名字里，这是可接受的，
						// 名字是用户的，不该为了显示把它改掉）。
						const next = Object.assign({}, point);
						delete next.group;
						return next;
					}
					return Object.assign({}, point, { group: wanted });
				}));
			}

			function assigneeOptions(selected) {
				const options = [h('option', { key: '__none', value: '' }, t('point.unassigned'))];
				for (const person of developers) options.push(h('option', { key: person, value: person }, person));
				void selected;
				return options;
			}

			/**
			 * 分块下拉的选项。
			 *
			 * 两处的选项**故意不一样**：
			 *
			 *   - 功能点**行**上：只列**已经建好的分块**。那一行回答的是"把这条点归到哪一块"，
			 *     不是"新建一块" —— 在一行已有功能点上顺手造出一个新分块，等于让"归类"
			 *     和"造分类"混在同一个动作里，而新建分块要连着建功能点才有意义，
			 *     落点在底部的新增区（见 {@link addFromForm}）。
			 *   - **新增区**：多一项 `+ 新分块`。选中它就真的把 value 换成哨兵值 `NEW_GROUP`，
			 *     于是下拉框和分派人之间长出一个取名框（见 {@link newGroupInput}）。
			 *
			 * 「+ 新分块」**不能被当成"当前值"顶在下拉框里显示**：上一轮就是栽在这里 ——
			 * 下拉里只有这一项时，选中它不产生 value 变化（有的浏览器干脆不派发 change），
			 * 而选项文案还被当成当前值显示出来，看上去像"已经选中了新分块"，实际什么都没发生。
			 *
			 * 所以没选过任何分块时 value 是空串，而空串不在选项里，下拉就是空的 ——
			 * 那不是错，只是"还没分块"。
			 *
			 * @param withNew 是否把「+ 新分块」这一项放进去（只有新增区传 true）
			 */
			function groupOptions(withNew) {
				/**
				 * ★ 第一项是**空的占位项**，它是让这个下拉不说谎的关键。
				 *
				 * `<select>` 的 value 匹配不上任何一项时（刚建的需求一块都还没有、或者这条点
				 * 还没归类），浏览器会把**第一项当当前值显示出来**。截图里那一格显示着
				 * 「+ 新分块」就是这么来的 —— 而且这时点它**不产生 value 变化，`change` 根本不派发**，
				 * 人看到的是"选了但没反应"，两次报"新分块还是加不了"都是它。
				 *
				 * 有了这一项，value 永远对得上：显示的就是真实状态（空 = 还没分块）。
				 * 它同时 `hidden`（列表里不出现）—— 所以不会多出一个「未分组」选项，
				 * 那不是一块地，只是"还没归类"。
				 */
				const options = [h('option', { key: '__none', value: '', hidden: true }, '')];
				for (const entry of groups) {
					if (entry.ungrouped) continue;
					options.push(h('option', { key: entry.name, value: entry.name }, entry.name));
				}
				if (withNew === true) {
					options.push(h('option', { key: NEW_GROUP, value: NEW_GROUP }, '+ ' + t('point.newGroup')));
				}
				return options;
			}

			/** 收起取名框（连同下拉回到"没选分块"）。 */
			function closeDraft() {
				setDraft({ open: false, value: '' });
			}

			/**
			 * 新分块取名框（只出现在**新增区**，位置就在分块下拉与分派人下拉之间）。
			 *
			 * **没有确定/取消按钮**：一个输入框旁边再挂两个按钮，是"对话框"的做法，
			 * 而这里只是一格填空 —— 名字填好之后按「新增功能点」，分块和功能点一起建出来。
			 *
			 * **失焦不生效**，这是刻意的：点「新增功能点」的那一下会先触发失焦，
			 * 如果失焦就把名字写进 state，同一个事件里的 `addFromForm` 读到的还是旧值 ——
			 * 功能点会落进旧分块。所以这条路上只认「回车 = 直接新增」和「Esc = 放弃」。
			 */
			function newGroupInput() {
				return h('input', {
					className: 'wcw-input wcw-newGroup',
					style: { maxWidth: '150px' },
					value: draft.value,
					placeholder: t('point.groupPlaceholder'),
					disabled: busy,
					onChange: (event) => { setDraft({ open: true, value: event.target.value }); },
					onKeyDown: (event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							addFromForm();
							return;
						}
						if (event.key === 'Escape') {
							event.preventDefault();
							closeDraft();
							// 放弃新建分块 = 下拉也要弹回"没选分块"，否则它会一直停在
							// 「+ 新分块」上，而那个名字已经不打算建了。
							setGroup('');
						}
					},
				});
			}

			/** 一条功能点的整行（含分块下拉、分派人、删除）。 */
			function pointRow(point) {
				// 下拉显示的是**写盘**的分块（没有就显示未分组）—— 推导出来的分块只在树里显示，
				// 一旦在这里显示成"已归类"，用户会以为它已经落盘，改名却发现改不动。
				const currentGroup = pointGroupOf(point);
				return h('div', { key: point.id, className: 'wcw-point wcw-pointLeaf' },
					h('label', { className: 'wcw-field' },
						h('span', { className: 'wcw-fieldNote' }, t('point.name')),
						h('input', {
							className: 'wcw-input',
							defaultValue: point.name,
							disabled: busy,
							onBlur: (event) => {
								const value = event.target.value.trim();
								if (value === point.name || value === '') return;
								void patchPoint(point.id, { name: value });
							},
						}),
					),
					// 这一行的分块下拉**只列已经建好的分块**：它是"把这条点归到哪一块"，
					// 不是"新建一块"。新建分块要连着建功能点，入口在底部的新增区
					// （那里的下拉才多一项「+ 新分块」）—— 见 groupOptions 的说明。
					h('label', { className: 'wcw-field', style: { maxWidth: '170px' } },
						h('span', { className: 'wcw-fieldNote' }, t('point.group')),
						h('select', {
							className: 'wcw-select',
							value: currentGroup,
							disabled: busy,
							onChange: (event) => { void patchPoint(point.id, { group: event.target.value }); },
						}, groupOptions(false)),
					),
					h('label', { className: 'wcw-field', style: { maxWidth: '170px' } },
						h('span', { className: 'wcw-fieldNote' }, t('point.assignee')),
						h('select', {
							className: 'wcw-select',
							value: point.assignee ?? '',
							disabled: busy || developers.length === 0,
							onChange: (event) => { void patchPoint(point.id, { assignee: event.target.value }); },
						}, assigneeOptions(point.assignee)),
					),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						disabled: busy,
						onClick: () => { void persist(points.filter((one) => one.id !== point.id)); },
					}, t('point.delete')),
				);
			}

			/**
			 * 两个筛选条件**同时生效**，先分派状态、再名称/分块。
			 *
			 * 分派状态是"谁还没派活"这个问题的直接入口：一份 CRM 需求拆出上百个功能点，
			 * 没人派的部分光看名字是找不到的。名称筛选则用来收缩到某一块。
			 * 两个都作用在**功能点**上，而不是块：块名命中时整块留下（那时只有名称筛选在起作用）。
			 */
			function matchesAssign(point) {
				const assigned = typeof point.assignee === 'string' && point.assignee !== '';
				if (assignFilter === 'assigned') return assigned;
				if (assignFilter === 'unassigned') return !assigned;
				return true;
			}
			const wanted = filter.trim().toLowerCase();
			const visible = groups
				.map((entry) => {
					const kept = entry.points.filter(matchesAssign);
					if (wanted === '') return kept.length === 0 ? null : { name: entry.name, points: kept, ungrouped: entry.ungrouped };
					// 块名命中时留下的是"该块中通过分派过滤的那些"，而不是整块。
					// （未归类那一组没有块名可比，只能按功能点名匹配。）
					if (!entry.ungrouped && entry.name.toLowerCase().includes(wanted)) {
						return kept.length === 0 ? null : { name: entry.name, points: kept, ungrouped: false };
					}
					const hits = kept.filter((point) => String(point.name ?? '').toLowerCase().includes(wanted));
					return hits.length === 0 ? null : { name: entry.name, points: hits, ungrouped: entry.ungrouped };
				})
				.filter((entry) => entry !== null);

			/** 行内「加一条」：分块内和树根下共用同一段。 */
			function inlineAdd(groupName) {
				return h('div', { className: 'wcw-btnRow' },
					h('input', {
						className: 'wcw-input',
						value: newRow.name,
						placeholder: t('point.namePlaceholder'),
						disabled: busy,
						autoFocus: true,
						onChange: (event) => { setNewRow({ group: newRow.group, name: event.target.value }); },
						onKeyDown: (event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								addPoint(newRow.name, newRow.group);
								setAddingIn('');
								setNewRow({ group: '', name: '' });
							}
						},
					}),
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || newRow.name.trim() === '',
						onClick: () => {
							addPoint(newRow.name, newRow.group);
							setAddingIn('');
							setNewRow({ group: '', name: '' });
						},
					}, t('point.add')),
					h('button', {
						type: 'button',
						className: 'wcw-btn',
						onClick: () => { setAddingIn(''); },
					}, t('req.cancel')),
				);
			}

			/** 一块：块头（折叠 / 计数 / 改名 / 加一条）+ 块内的功能点。 */
			function groupNode(entry) {
				const key = entry.name;
				const isClosed = closed[key] === true;
				const assigned = entry.points.filter((point) => typeof point.assignee === 'string' && point.assignee !== '').length;
				return h('div', { key, className: 'wcw-group' },
					h('div', { className: 'wcw-groupHead' },
						h('button', {
							type: 'button',
							className: 'wcw-groupToggle',
							title: isClosed ? t('point.expand') : t('point.collapse'),
							'aria-expanded': isClosed ? 'false' : 'true',
							onClick: () => { setClosed(Object.assign({}, closed, { [key]: !isClosed })); },
						}, (isClosed ? '▸ ' : '▾ ') + entry.name),
						h('span', { className: 'wcw-pill' }, t('point.groupCount', { count: entry.points.length })),
						assigned === 0 ? null : h('span', { className: 'wcw-chipTag' }, t('point.assigned', { count: assigned })),
						h('span', { className: 'wcw-qaSpacer' }),
						renaming.name === entry.name
							? h('input', {
								className: 'wcw-input wcw-newGroup',
								style: { maxWidth: '160px' },
								value: renaming.value,
								// 标题里说明"块内功能点跟着换"，因为改名不是只改标签
								title: t('point.groupRenamePrompt', { name: entry.name, count: entry.points.length }),
								'aria-label': t('point.groupRename'),
								disabled: busy,
								autoFocus: true,
								onChange: (event) => { setRenaming({ name: entry.name, value: event.target.value }); },
								onKeyDown: (event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										renameGroup(entry.name, renaming.value);
										setRenaming({ name: '', value: '' });
									}
									if (event.key === 'Escape') { event.preventDefault(); setRenaming({ name: '', value: '' }); }
								},
								// 与"新分块"同一个道理：填完就该生效，不该再让人去找确定按钮
								onBlur: () => {
									if (renaming.value.trim() === '' || renaming.value.trim() === entry.name) {
										setRenaming({ name: '', value: '' });
										return;
									}
									renameGroup(entry.name, renaming.value);
									setRenaming({ name: '', value: '' });
								},
							})
							: h('button', {
								type: 'button',
								className: 'wcw-btn',
								disabled: busy,
								title: t('point.groupRenamePrompt', { name: entry.name, count: entry.points.length }),
								onClick: () => { setRenaming({ name: entry.name, value: entry.name }); },
							}, t('point.groupRename')),
						h('button', {
							type: 'button',
							className: 'wcw-btn',
							disabled: busy,
							onClick: () => {
								setAddingIn(addingIn === key ? '' : key);
								setNewRow({ group: entry.name, name: '' });
							},
						}, t('point.groupAdd')),
					),
					isClosed
						? null
						: h('div', { className: 'wcw-groupBody' },
							entry.points.length === 0 ? h('p', { className: 'wcw-empty' }, t('point.groupEmpty')) : null,
							entry.points.map(pointRow),
							addingIn !== key ? null : inlineAdd(entry.name),
						),
				);
			}

			const groupNodes = visible.filter((entry) => !entry.ungrouped).map(groupNode);
			// 未归类的点**不画块头**（「未分组」那一块去掉了），而是作为树根下的散条直接列出 ——
			// 它们仍然要看得见：界面看不见和不存在，对用户是同一件事，而数据其实还在。
			const loosePoints = [];
			for (const entry of visible) {
				if (entry.ungrouped) loosePoints.push(...entry.points);
			}
			if (loosePoints.length > 0) {
				groupNodes.push(h('div', { key: '__loose', className: 'wcw-points wcw-loosePoints' },
					loosePoints.map(pointRow),
					addingIn !== '__loose' ? null : inlineAdd(''),
				));
			}

			return h('div', { className: 'wcw-section' },
				h('div', { className: 'wcw-sectionHead' },
					h('h3', { className: 'wcw-sectionTitle' }, t('point.heading')),
					h('span', { className: 'wcw-pill' }, String(points.length)),
					// 块数只数**真的分块**：`pointTree` 里那个「未归类」条目不是一块地，
					// 把它算进去就会出现"1 个功能点、1 块"这种和下拉列表对不上的显示
					// （下拉里明明只有「+ 新分块」）。
					h('span', { className: 'wcw-pill' }, t('point.groups', { count: groups.filter((entry) => !entry.ungrouped).length })),
					h('span', { className: 'wcw-qaSpacer' }),
					// 分派状态筛选放在名称筛选**前面**：先按"谁还没派活"收缩，再按名字找具体条目，
					// 这个顺序和实际用法一致（先看缺口，再定位）。
					points.length === 0 ? null : h('select', {
						className: 'wcw-select',
						title: t('point.assignFilter'),
						'aria-label': t('point.assignFilter'),
						value: assignFilter,
						onChange: (event) => { setAssignFilter(event.target.value); },
					},
						h('option', { key: 'all', value: '' }, t('point.assignAll')),
						h('option', { key: 'assigned', value: 'assigned' }, t('point.assignAssigned')),
						h('option', { key: 'unassigned', value: 'unassigned' }, t('point.assignUnassigned')),
					),
					points.length === 0 ? null : h('input', {
						className: 'wcw-input',
						style: { maxWidth: '220px' },
						value: filter,
						placeholder: t('point.search'),
						onChange: (event) => { setFilter(event.target.value); },
					}),
				),
				points.length === 0
					? h('p', { className: 'wcw-empty' }, t('point.empty'))
					: (visible.length === 0
						? h('p', { className: 'wcw-empty' }, t('point.searchEmpty'))
						: h('div', { className: 'wcw-groupTree' }, groupNodes)),
				developers.length === 0 ? h('p', { className: 'wcw-empty' }, t('point.noDevelopers')) : null,
				h('div', { className: 'wcw-btnRow' },
					h('input', {
						className: 'wcw-input',
						value: name,
						placeholder: t('point.namePlaceholder'),
						disabled: busy,
						onChange: (event) => { setName(event.target.value); },
						onKeyDown: (event) => {
							if (event.key === 'Enter') { event.preventDefault(); addFromForm(); }
						},
					}),
					h('select', {
						className: 'wcw-select',
						// 选了「+ 新分块」就停在那一项上：右边（分派人之前）那个文本框正是它长出来的。
						// 放弃时（Esc / 改选别的）会弹回真分块，见 chooseFormGroup。
						value: draft.open ? NEW_GROUP : group,
						title: t('point.group'),
						'aria-label': t('point.group'),
						disabled: busy,
						onChange: (event) => { chooseFormGroup(event.target.value); },
					}, groupOptions(true)),
					// ★ 位置：**分块下拉与分派人下拉之间**。取名框紧挨着产生它的那个下拉，
					// 眼睛不用跨过"分派给谁"再回来找它。
					draft.open ? newGroupInput() : null,
					h('select', {
						className: 'wcw-select',
						value: assignee,
						disabled: busy || developers.length === 0,
						onChange: (event) => { setAssignee(event.target.value); },
					}, assigneeOptions(assignee)),
					h('button', {
						type: 'button',
						className: 'wcw-btn wcw-btnPrimary',
						disabled: busy || name.trim() === '',
						onClick: addFromForm,
					}, t('point.add')),
				),
				error === '' ? null : h('p', { className: 'wcw-error' }, error),
			);
		}

		// ────────────────────────────────────────────────────────────────────
		// 8. 页签组件
		// ────────────────────────────────────────────────────────────────────
		function WorkbenchView(props) {
			const t = props.t;
			const sessionId = props.sessionId;
			// 登记「当前工作台属于哪个会话」——碰工作区的 op 靠它补 sessionId。
			// 放在渲染期（不是 effect）是有意的：父组件先渲染，子组件随后发起请求时
			// 这个值一定已经就位；放进 useEffect 反而会因为「子 effect 先跑」而漏掉首次加载。
			activeSessionId = typeof sessionId === 'string' ? sessionId : '';
			const useSession = props.useSession;
			const useSessions = props.useSessions;
			const openView = props.openView;
			/** 把一段指令送进当前会话；由 apply() 里的 inject 面注入。 */
			const sendPrompt = props.sendPrompt;

			const running = useSession((s) => s.running);
			const openState = useSession((s) => s.openState);
			// 「排队中的消息」这个字段换过名字：
			//   DSH 0.1.5：会话快照里叫 `queue`（宿主队列投影）；
			//   DSH 0.2.0：改成 `pendingSubmissions`（见 dsh-api-session-controller 的 buildSnapshot）。
			// 直接写 `s.queue.length`，在 0.2.0 上就是 `undefined.length` —— 渲染期抛错，
			// 被平台的 slot 错误边界接住，表现是整个工作台页**完全空白**，而应用其他部分毫发无损
			// （桌面版内置 DSH 0.2.0，网页版是 0.1.5；同一份 bundle 只在桌面版白屏，就是这个原因）。
			// 两种形状都认，认不出按 0 算：这只是个计数，不该让整页消失。
			const queued = useSession((s) => {
				if (Array.isArray(s.queue)) return s.queue.length;
				if (Array.isArray(s.pendingSubmissions)) return s.pendingSubmissions.length;
				return 0;
			});
			const sessionTitle = useSessions((s) => {
				const row = s.current === undefined ? undefined : s.byId[s.current];
				return row === undefined || row.displayTitle === undefined ? '' : row.displayTitle;
			});
			const cwd = useSessions((s) => {
				const row = s.current === undefined ? undefined : s.byId[s.current];
				return row === undefined || row.cwd === undefined ? '' : row.cwd;
			});

			const nonceState = react.useState(0);
			const nonce = nonceState[0];
			const setNonce = nonceState[1];
			const reload = react.useCallback(() => { setNonce((value) => value + 1); }, []);

			const selectedState = react.useState('');
			const selectedId = selectedState[0];
			const setSelectedId = selectedState[1];
			const creatingState = react.useState(false);
			const creating = creatingState[0];
			const setCreating = creatingState[1];
			const stageState = react.useState('requirement');
			const stageId = stageState[0];
			const setStageId = stageState[1];
			/** 历史需求下拉框（顶部栏右侧）。 */
			const historyState = react.useState(false);
			const historyOpen = historyState[0];
			const setHistoryOpen = historyState[1];
			const historyQueryState = react.useState('');
			const historyQuery = historyQueryState[0];
			const setHistoryQuery = historyQueryState[1];
			const historyExpandedState = react.useState('');
			const historyExpanded = historyExpandedState[0];
			const setHistoryExpanded = historyExpandedState[1];
			/** 正在回显的需求编号；空串表示详情弹框关闭。 */
			const detailState = react.useState('');
			const detailId = detailState[0];
			const setDetailId = detailState[1];
			/** 「我」是谁：首次打开工作台时弹窗输入，存在浏览器本地。 */
			const identityState = react.useState('');
			const identity = identityState[0];
			const setIdentity = identityState[1];
			const identityOpenState = react.useState(false);
			const identityOpen = identityOpenState[0];
			const setIdentityOpen = identityOpenState[1];
			/** 「我在看谁的管线」，按需求编号记在本机。 */
			const viewMapState = react.useState(readViewMap());
			const viewMap = viewMapState[0];
			const setViewMap = viewMapState[1];
			const viewDeveloper = selectedId === '' || viewMap[selectedId] === undefined ? '' : viewMap[selectedId];
			const setViewDeveloper = (name) => {
				const next = Object.assign({}, viewMap);
				if (name === '') delete next[selectedId];
				else next[selectedId] = name;
				setViewMap(next);
				writeViewMap(next);
			};
			// 身份从宿主读一次；读失败（宿主旧版本）时按未设置处理，不阻塞页面。
			const identityPair = useAsync(
				async () => {
					try {
						return await callWorkbench('readIdentity');
					} catch (error) {
						return { name: '' };
					}
				},
				[],
			);
			const storedIdentity = identityPair[0];
			const identityReady = storedIdentity.status === 'ready';
			react.useEffect(() => {
				if (!identityReady) return;
				const data = storedIdentity.data;
				const name = data !== null && data !== undefined && typeof data.name === 'string' ? data.name : '';
				if (name !== '') setIdentity(name);
			}, [identityReady]);
			const menuState = react.useState('');
			const menuFor = menuState[0];
			const setMenuFor = menuState[1];
			const bellState = react.useState(false);
			const bellOpen = bellState[0];
			const setBellOpen = bellState[1];
			/** 已在内联提示上点了「稍后再说」的需求 id（仅本次会话有效）。 */
			const promptState = react.useState('');
			const promptDismissed = promptState[0];
			const setPromptDismissed = promptState[1];
			/** 每分钟重渲染一次，让顶部倒计时自己走。 */
			const now = useNow(60000);

			const listingPair = useAsync(
				() => loadBoard(sessionId),
				[sessionId],
				nonce,
				'board|' + sessionId,
			);
			const listing = listingPair[0];
			const requirements = listing.data && Array.isArray(listing.data.requirements) ? listing.data.requirements : [];
			const root = listing.data && listing.data.root ? listing.data.root : '';
			const notices = listing.data && Array.isArray(listing.data.notices) ? listing.data.notices : [];
			const archivedItems = requirements.filter((entry) => entry.archived);

			// 默认选中第一个**未归档**需求。
			react.useEffect(() => {
				if (requirements.length === 0) return;
				let known = false;
				for (const entry of requirements) if (entry.id === selectedId) known = true;
				if (known) return;
				let first;
				for (const entry of requirements) if (!entry.archived) { first = entry; break; }
				setSelectedId((first ?? requirements[0]).id);
			}, [listing.status, requirements.length, selectedId]);

			const detailPair = useAsync(
				async () => {
					if (selectedId === '') return null;
					const value = await callWorkbench('readRequirement', { sessionId, args: { id: selectedId } });
					return value.requirement;
				},
				[sessionId, selectedId],
				nonce,
				'requirement|' + selectedId,
			);
			const detail = detailPair[0];
			const requirement = detail.data;

			// 刻意**不给缓存键**：它是「下一条该用哪个编号」，必须在每次打开新建表单时现算，
			// 拿缓存里的旧编号会直接导致重号。就一次调用，省它没有意义。
			const suggestedPair = useAsync(
				async () => (creating ? (await callWorkbench('nextRequirementId', { sessionId })).id : ''),
				[sessionId, creating],
				nonce,
			);
			const suggestedId = suggestedPair[0].data === null || suggestedPair[0].data === undefined ? '' : suggestedPair[0].data;

			async function createRequirement(id, title) {
				await callWorkbench('createRequirement', { sessionId, args: { id, title } });
				setCreating(false);
				setSelectedId(id);
				setStageId('requirement');
				reload();
			}

			/** 暂停 / 恢复。归档与否看文件夹位置，不在这里改。 */
			async function setRequirementStatus(id, status) {
				setMenuFor('');
				const fresh = await callWorkbench('readRequirement', { sessionId, args: { id } });
				await callWorkbench('writeRequirement', {
					sessionId,
					args: { id, requirement: Object.assign({}, fresh.requirement, { status }) },
				});
				reload();
			}

			/** 归档一条需求：写 archivedAt，目录不动。 */
			async function archiveRequirement(id) {
				setMenuFor('');
				await callWorkbench('archiveRequirement', { sessionId, args: { id } });
				reload();
			}

			/** 取消归档：清掉 archivedAt，目录不动。 */
			async function restoreRequirement(id) {
				setMenuFor('');
				await callWorkbench('restoreRequirement', { sessionId, args: { id } });
				reload();
			}

			/**
			 * **彻底删除**一条需求：整个文件夹一起删（二次确认由 RequirementChips 负责）。
			 *
			 * 删除之后要收拾三处「指向它的状态」，少一处就会留下一条指向已删需求的引用：
			 *
			 *   1. `selectedId` —— 还选着它的话，页面会去读一个不存在的需求，报 not-found；
			 *   2. 详情弹框 `detailId` —— 那个弹框会继续显示刚刚被删掉的内容，
			 *      看起来像"删了还在"，而且刷不掉；
			 *   3. 本机通知表和「我在看谁」的映射 —— 都是按需求编号记的，留着不会报错，
			 *      但下一条同编号的需求（编号其实不会复用，纯粹是干净起见）会继承它。
			 *
			 * 失败时**必须往上抛**：确认框要把错误显示在原地（见 RequirementChips.runDelete）。
			 */
			async function deleteRequirement(id) {
				try {
					await callWorkbench('deleteRequirement', { sessionId, args: { id } });
				} catch (failure) {
					const text = String(failure && failure.message ? failure.message : failure);
					/**
					 * 宿主半边还是旧版本（没重启）时，报错是 `workbench/unknown-op`。
					 *
					 * 这条要单独翻译成人话：宿主半的 op 表是**开机时**注册的，改完插件不重启
					 * DSH 的话页面这边一切正常、只有这一个动作报"unknown op" ——
					 * 看起来完全像功能坏了，而其实只差一次重启。
					 */
					if (/unknown-op/.test(text)) throw new Error(t('req.deleteNeedsRestart'));
					throw failure;
				}
				// 通知表是本机状态，删不掉不该让整个删除看起来失败 —— 需求已经没了。
				if (noticeStore.supported) {
					await callWorkbench('clearNotice', { sessionId, args: { id } }).catch(() => {});
				}
				if (viewMap[id] !== undefined) {
					const next = Object.assign({}, viewMap);
					delete next[id];
					setViewMap(next);
					writeViewMap(next);
				}
				setMenuFor('');
				if (detailId === id) setDetailId('');
				if (selectedId === id) setSelectedId('');
				reload();
			}

			/**
			 * 恢复整条管线：先清掉 archivedAt，再把状态与通知复位。
			 *
			 * 为什么清完还要再写一次：宿主半边的 `restoreRequirement` 会把 `status`
			 * 强制成 `active`。所以这里补一次写回，保留归档前的状态
			 * （done / paused / active 不被抹掉）。
			 *
			 * 通知要清**两处**才干净：
			 *   - 本机通知表（`clearNotice`）—— 用户自己那份；
			 *   - 共享文件里的旧字段（`overdueNoticeAt` / `overdueNoticeReadAt`）——
			 *     它在下次扫描时会被当成「继承来的登记时间」重新种进本机通知表，
			 *     于是刚恢复的需求立刻又被判定到期、当场再次归档，用户会觉得
			 *     恢复按钮按下去没反应。所以这两行不能省。
			 */
			async function restorePipeline(entry) {
				setHistoryOpen(false);
				await callWorkbench('restoreRequirement', { sessionId, args: { id: entry.id } });
				if (noticeStore.supported) {
					await callWorkbench('clearNotice', { sessionId, args: { id: entry.id } });
				}
				const fresh = await callWorkbench('readRequirement', { sessionId, args: { id: entry.id } });
				await callWorkbench('writeRequirement', {
					sessionId,
					args: {
						id: entry.id,
						requirement: Object.assign({}, fresh.requirement, {
							status: entry.status === '' ? 'active' : entry.status,
							overdueNoticeAt: '',
							overdueNoticeReadAt: '',
						}),
					},
				});
				reload();
			}

			/**
			 * 切回「我的管线」。
			 *
			 * 如果「我」还不在这个需求的开发人员名单里，先把自己加进去 —— 否则点完
			 * 仍然是只读，用户会以为按钮坏了。
			 */
			async function backToMyPipeline() {
				if (identity === '') { setIdentityOpen(true); return; }
				const fresh = await callWorkbench('readRequirement', { sessionId, args: { id: selectedId } });
				const current = Array.isArray(fresh.requirement.developers) ? fresh.requirement.developers : [];
				await callWorkbench('writeRequirement', {
					sessionId,
					args: {
						id: selectedId,
						requirement: Object.assign({}, fresh.requirement, {
							developers: current.includes(identity) ? current : current.concat([identity]),
						}),
					},
				});
				setViewDeveloper(identity);
				reload();
			}

			/**
			 * 点开铃铛：把当前所有提醒标记为已读。
			 * 已读之后还会再显示 3 天，然后自动消失 —— 这样用户有时间处理，
			 * 又不会永远挂在角上。
			 */
			async function toggleBell() {
				const next = !bellOpen;
				setBellOpen(next);
				if (!next) return;
				for (const notice of notices) {
					if (notice.overdueNoticeReadAt !== '') continue;
					if (noticeStore.supported) {
						// 已读也只写本机那份 —— 别人打开工作台不该被我的已读状态影响。
						await callWorkbench('markNoticeRead', { sessionId, args: { id: notice.id, readAt: new Date().toISOString() } });
						continue;
					}
					const fresh = await callWorkbench('readRequirement', { sessionId, args: { id: notice.id } });
					await callWorkbench('writeRequirement', {
						sessionId,
						args: {
							id: notice.id,
							requirement: Object.assign({}, fresh.requirement, { overdueNoticeReadAt: new Date().toISOString() }),
						},
					});
				}
				reload();
			}

			let stage = STAGES[0];
			for (const candidate of STAGES) if (candidate.id === stageId) stage = candidate;

			const developers = requirement !== null && requirement !== undefined && Array.isArray(requirement.developers)
				? requirement.developers
				: [];
			// 管线显示以「开发人员」区右上角的下拉框为准；
			// 没选过（或选的人已不在名单里）就回落到「我」，我不在名单里则回落到第一个。
			const meInList = identity !== '' && developers.includes(identity);
			const fallbackDeveloper = meInList
				? identity
				: (developers.length > 0 ? developers[0] : '');
			const activeDeveloper = developers.includes(viewDeveloper) ? viewDeveloper : fallbackDeveloper;
			// 只有自己的管线能改，别人的一律只读；身份还没填时不拦。
			const canEdit = identity === '' || activeDeveloper === '' || activeDeveloper === identity;
			// 主导者与「方案汇总」的编辑权是**另一套规则**：
			// 汇总不属于任何一个人的管线，所以它不看 activeDeveloper，只看我是不是主导者。
			const lead = leadOf(requirement);
			const mayEditSummary = canEditSummary(identity, lead);

			/**
			 * 一条需求在某个人名下的全部阶段状态。
			 *
			 * 管线上的五个徽标要反映**真实**进度，所以工作台一打开就得知道各阶段有没有产物。
			 * 一次并行读完（十来个很小的文件）而不是按阶段懒加载 —— 否则徽标会随着你点开
			 * 哪个阶段而变来变去，那比多读几个文件更糟。
			 */
			async function loadStageStates(id, developer) {
				if (id === '') return null;
				const design = designPaths(developer);
				const designJobs = [
					readTextOrNull(id, design.draft),
					readJsonOrNull(id, design.impact),
					readJsonOrNull(id, design.tasks),
					readJsonOrNull(id, design.meta),
					// 两张清单也算「方案动过」：徽标要反映真实进度，见 hasDesignContent。
					readJsonOrNull(id, design.apis),
					readJsonOrNull(id, design.pages),
				];
				const plan = [];
				const stageJobs = [];
				for (const stageId of ['develop', 'test', 'release']) {
					for (const block of stageBlocks(stageId)) {
						const path = stageBlockPath(stageId, developer, block.file);
						plan.push({ stageId, block });
						stageJobs.push(block.kind === 'markdown'
							? readTextOrNull(id, path).then((text) => ({ text }))
							: readJsonOrNull(id, path).then((json) => ({ json })));
					}
				}
				const values = await Promise.all(designJobs.concat(stageJobs));
				const states = {
					design: designStageStatus(designState({
						draft: values[0], impact: values[1], tasks: values[2], meta: values[3],
						apis: values[4], pages: values[5],
					})),
				};
				const per = {};
				plan.forEach((entry, index) => {
					if (per[entry.stageId] === undefined) per[entry.stageId] = {};
					per[entry.stageId][entry.block.file] = blockState(entry.block, values[index + designJobs.length]);
				});
				for (const stageId of ['develop', 'test', 'release']) {
					states[stageId] = stageVerdict(stageId, per[stageId] === undefined ? {} : per[stageId]);
				}
				return states;
			}

			const stageStatePair = useAsync(
				() => loadStageStates(selectedId, activeDeveloper),
				[selectedId, activeDeveloper],
				nonce,
				'stages|' + selectedId + '|' + activeDeveloper,
			);
			// 还没读完（或读失败）时给 null —— 那时会回退到占位规则，而不是先显示成「未开始」。
			const stageStates = stageStatePair[0].status === 'ready' ? stageStatePair[0].data : null;

			const stageStatus = deriveStageStatus(requirement, activeDeveloper, stageStates);

			// 选中「已完成且已过上线日期」的需求时，就地提示是否归档。
			let overduePrompt = null;
			if (promptDismissed !== selectedId) {
				for (const notice of notices) {
					if (notice.id !== selectedId) continue;
					overduePrompt = {
						id: notice.id,
						goLiveDate: notice.goLiveDate,
						daysLeft: daysUntilAutoArchive(notice, now),
					};
				}
			}

			const meta = [];
			if (cwd !== '') meta.push(cwd);
			meta.push(t(OPEN_STATE_KEY[openState] || 'panel.state.open'));
			meta.push(running ? t('panel.running') : t('panel.idle'));
			meta.push(t('panel.queued', { count: queued }));

			const title = requirement && requirement.title
				? requirement.title
				: (sessionTitle === '' ? shortSessionId(sessionId) : sessionTitle);

			let stageBody = null;
			if (listing.status === 'loading' || (selectedId !== '' && detail.status === 'loading')) {
				stageBody = h('p', { className: 'wcw-empty' }, t('panel.loading'));
			} else if (detail.status === 'error') {
				stageBody = h('p', { className: 'wcw-error' }, detail.error);
			} else if (stage.id === 'requirement') {
				stageBody = requirement === null || requirement === undefined
					? h('p', { className: 'wcw-empty' }, t('req.none'))
					: h(react.Fragment, null,
						h(RequirementDates, { t, requirement, onChanged: reload }),
						h(DevelopersEditor, {
							t,
							requirement,
							identity,
							onChanged: reload,
							onChangeIdentity: () => { setIdentityOpen(true); },
							currentDeveloper: activeDeveloper,
							onSelectDeveloper: setViewDeveloper,
						}),						h(FeaturePoints, { t, requirement, onChanged: reload }),
						// 文档区需要「把指令送进对话」的通道和当前运行态：
						// 导入后自动让 AI 分析，并在会话跑完时自动把分析读回来。
						// scopeKey 让换需求/换会话时整块重新挂载 —— 否则上一刻读到的
						// 别人的分析会留在屏幕上，而它看起来完全正常。
						h(RequirementDocuments, {
							t,
							requirement,
							onChanged: reload,
							root,
							running,
							sendPrompt,
							scopeKey: sessionId + '|' + selectedId,
						}),
						h(RequirementClarifications, { t, requirement, onChanged: reload }),
					);
			} else if (stage.id === 'design') {
				// 「方案」是按人分开的管线，所以它需要三样需求层拿不到的东西：
				// 当前看的是谁（developer）、我能不能改（editable）、
				// 以及**把指令送进当前会话**的通道（sendPrompt）。
				stageBody = requirement === null || requirement === undefined
					? h('p', { className: 'wcw-empty' }, t('req.none'))
					: h(DesignStage, {
						t,
						requirement,
						developer: activeDeveloper,
						editable: canEdit,
						summaryEditable: mayEditSummary,
						lead,
						running,
						sendPrompt,
						root,
					});
			} else {
				// 开发 / 测试 / 提版 三个阶段共用一个页面组件：它们的差异全在
				// STAGE_BLOCKS 那张声明表里，控制器不需要知道具体是哪个阶段。
				stageBody = requirement === null || requirement === undefined
					? h('p', { className: 'wcw-empty' }, t('req.none'))
					: h(StagePage, {
						t,
						requirement,
						stageId: stage.id,
						developer: activeDeveloper,
						editable: canEdit,
						running,
						sendPrompt,
						root,
					});
			}

			return h('section', {
				className: 'wcw-root',
				'aria-label': t('panel.aria'),
				'data-conversation-composer-overlay': '',
			},
				h('div', { className: 'wcw-body' },
					h('div', { className: 'wcw-req' },
						h('div', { className: 'wcw-reqTop' },
							h('div', { className: 'wcw-reqMark', 'aria-hidden': 'true' }, '需'),
							h('div', { className: 'wcw-reqText' },
								h('h2', { className: 'wcw-reqTitle' }, title),
								h('p', { className: 'wcw-reqMeta' },
									(requirement && requirement.id ? requirement.id + ' · ' : '') + meta.join(' · ')),
							),
							h(NoticeBell, {
								t,
								notices,
								open: bellOpen,
								now,
								onToggle: () => { void toggleBell(); },
								onArchive: (id) => { setBellOpen(false); void archiveRequirement(id); },
								onClose: () => { setBellOpen(false); },
							}),
							h(HistoryMenu, {
								t,
								items: archivedItems,
								open: historyOpen,
								expanded: historyExpanded,
								query: historyQuery,
								onToggle: () => { setHistoryOpen(!historyOpen); },
								onQuery: setHistoryQuery,
								onExpand: setHistoryExpanded,
								onDetail: (id) => { setHistoryOpen(false); setDetailId(id); },
								onRestore: (entry) => { void restorePipeline(entry); },
							}),
							h('button', {
								type: 'button',
								className: 'wcw-reqAction',
								onClick: () => { openView('trajectory', ''); },
							}, t('panel.viewInTrajectory')),
						),
						h(RequirementChips, {
							t,
							requirements,
							selectedId,
							menuFor,
							onSelect: (id) => { setSelectedId(id); setCreating(false); setMenuFor(''); },							onNew: () => { setCreating(!creating); },
							onMenu: setMenuFor,
							onSetStatus: (id, status) => { void setRequirementStatus(id, status); },
							onArchive: (id) => { void archiveRequirement(id); },
							onRestore: (id) => { void restoreRequirement(id); },
							// 抛出去让确认框显示错误：这个 promise 由 RequirementChips 接住。
							onDelete: (id) => deleteRequirement(id),
						}),
						h(CountdownChips, { t, requirement, now }),
					canEdit ? null : h('div', { className: 'wcw-overdue' },
						h('span', { className: 'wcw-overdueText' },
							t('dev.viewing', { name: activeDeveloper })
							+ (meInList ? '' : ' ' + t('me.notInList', { name: identity }))),
						h('button', {
							type: 'button',
							className: 'wcw-btn',
							onClick: () => { void backToMyPipeline(); },
						}, t('dev.backToMine')),
					),
						overduePrompt === null ? null : h('div', { className: 'wcw-overdue' },
							h('span', { className: 'wcw-overdueText' },
								t('notice.prompt', { date: overduePrompt.goLiveDate, days: overduePrompt.daysLeft })),
							h('button', {
								type: 'button',
								className: 'wcw-btn wcw-btnPrimary',
								onClick: () => { void archiveRequirement(overduePrompt.id); },
							}, t('req.archive')),
							h('button', {
								type: 'button',
								className: 'wcw-btn',
								onClick: () => { setPromptDismissed(overduePrompt.id); },
							}, t('notice.later')),
						),
						listing.status === 'ready' && requirements.length === 0 && !creating
							? h('p', { className: 'wcw-empty' }, t('req.none') + (root === '' ? '' : '（' + root + '）'))
							: null,
						listing.status === 'error' ? h('p', { className: 'wcw-error' }, listing.error) : null,
					),


					h('div', { className: 'wcw-pipe', role: 'tablist', 'aria-label': t('panel.pipeline') },
						STAGES.map((candidate, index) => h('button', {
							key: candidate.id,
							type: 'button',
							role: 'tab',
							'aria-selected': candidate.id === stage.id,
							className: 'wcw-stage',
							onClick: () => { setStageId(candidate.id); },
						},
							h('span', { className: 'wcw-stageBadge', 'data-status': stageStatus[candidate.id] }, String(index + 1)),
							h('span', { className: 'wcw-stageText' },
								h('span', { className: 'wcw-stageName' },
									t(candidate.labelKey),
									developers.length > 0 && SHARED_STAGE_IDS.includes(candidate.id)
										? h('span', { className: 'wcw-pipeTag' }, t('dev.shared'))
										: null,
								),
								h('span', { className: 'wcw-stageStatus', 'data-status': stageStatus[candidate.id] },
									t(STATUS_KEY[stageStatus[candidate.id]])),
							),
						))),

					creating ? h(CreateRequirementForm, {
						t,
						suggestedId,
						onSubmit: createRequirement,
						onCancel: () => { setCreating(false); },
					}) : null,

					stageBody,
				),
				// 首次打开（或主动改）时问「你是谁」。
				identityReady && (identity === '' || identityOpen) ? h(IdentityDialog, {
					t,
					identity,
					onConfirm: (name) => {
						// 先落盘再更新界面；写失败也不挡使用（本次会话仍然生效）。
						setIdentity(name);
						setIdentityOpen(false);
						void callWorkbench('writeIdentity', { args: { name } }).catch(() => {});
					},
				}) : null,
				detailId === '' ? null : h(RequirementDetailDialog, {
					t,
					id: detailId,
					now,
					onClose: () => { setDetailId(''); },
				}),
			);
		}

		// ────────────────────────────────────────────────────────────────────
		// 9. 浏览器侧 cordis 插件体
		//
		// inject 里是 **cordis 服务名**（不是包名）：
		//   slots        ← @deepseek-ai/dsh-client-ui-renderer
		//   locale       ← @deepseek-ai/dsh-client-locale
		//   uiSession    ← @deepseek-ai/dsh-client-ui-session（提供 useSessions 等全局标准 props）
		//   sessions     ← @deepseek-ai/dsh-api-session-controller（`sessions.scope(id)` 取会话作用域 ctx）
		//   conversation ← @deepseek-ai/dsh-client-ui-conversation（在该 ctx 上 send() 一条 prompt）
		// 任一缺失 → apply 不执行 → entry pending → 整个 GUI 白屏。
		//
		// 后两个是为「让 AI 出方案」加的：插件自己不会写方案，它把一段指令送进
		// 当前会话，由对话里的 AI 用自己的文件工具去写。这是平台提供的通道
		// （`ctx.sessions.scope(id).get('conversation').send(text)`），不是私有后门。
		// 注意是 `get('conversation')`：在那个作用域上下文中直接写 `.conversation`
		// 会被 cordis 的注入闸门拒掉（`cannot get property "conversation" without inject`）。
		// ────────────────────────────────────────────────────────────────────
		const inject = ['slots', 'locale', 'uiSession', 'sessions', 'conversation'];

		function apply(ctx) {
			if (typeof document !== 'undefined') {
				const styleEl = document.createElement('style');
				styleEl.setAttribute('data-plugin', 'dsh-client-ui-workbench');
				styleEl.textContent = CSS;
				document.head.appendChild(styleEl);
				ctx.effect(() => () => {
					if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl);
				}, 'dsh-client-ui-workbench: styles');
			}

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-client-ui-workbench: dictionaries');
			const t = ctx.locale.bind(NS);

			ctx.slots.inject('conversation.view', () => ctx.slots.register({
				name: 'conversation.view',
				id: 'workbench',
				order: 20,
				locale: NS,
				label: () => t('view.workbench'),
				// 入口级 inject 面：按会话缓存，回调里拿到的就是当前会话的 id。
				// 返回的函数会作为 props 交给 WorkbenchView（平台机制，见
				// dsh-client-ui-plan 的 `inject: (sessionId) => ({ exitPlanMode })`）。
				inject: (sessionId) => ({
					sendPrompt: async (text) => {
						// 会话刚建出来时，宿主那边的会话绑定要过一两个微任务才落地：
						// `conversation.send` 内部 `binding(id)` 查不到就会抛
						// "resolved no binding"。所以这里等一小会儿再试一次 ——
						// 「刚建完就点分析」是这个功能最常见的用法，不该在这上面翻车。
						for (let attempt = 0; attempt < 3; attempt += 1) {
							if (attempt > 0) await new Promise((resolve) => { window.setTimeout(resolve, 300 * attempt); });
							const actx = ctx.sessions.scope(sessionId);
							// 空白会话还没有 Agent 作用域，此时送不了 —— 让调用方降级成
							// 「把指令摆出来自己粘贴」，而不是让按钮静默失效。
							if (actx === undefined || actx === null) {
								if (attempt < 2) continue;
								throw new Error('NO_SESSION_SCOPE');
							}
							// ★ 必须用 `actx.get('conversation')`，**不能**写 `actx.conversation`。
							//
							// 属性访问会被 cordis 的注入闸门挡下来：作用域上下文自己的 inject 表
							// 不含 conversation，于是抛
							//   `cannot get property "conversation" without inject`
							// —— 那句话听起来像插件没声明注入，其实是访问姿势不对。
							// 官方客户端代码取的也是这条路（dsh-client-ui-commands 的
							// `noticeFor`：`const conversation = actx.get("conversation")`），
							// 而且 get() 返回 undefined 比抛异常好处理：这里照样降级成可粘贴指令。
							const conversation = actx.get('conversation');
							if (conversation === undefined || conversation === null) {
								if (attempt < 2) continue;
								throw new Error('NO_CONVERSATION_SERVICE');
							}
							await conversation.send(text);
							return;
						}
					},
				}),
			}, WorkbenchView));
		}

		/**
		 * 纯函数出口，只给 tools/verify.mjs 用。
		 * 宿主只读 apply / inject，多余键没有影响；
		 * 但这些规则（尤其是日期先后）值得有真正的断言，而不是只靠肉眼看页面。
		 */
		exports.__internals = {
			parseDay, daysUntil, shiftDay, checkOrder, nextVersion, versionSlug, diffLines, diffStats,
			parseInstant, isOverdueDone, noticeVisible, daysUntilAutoArchive, deriveStageStatus, isAutoArchiveDue,
			SHARED_STAGE_IDS, PER_DEVELOPER_STAGE_IDS,
			OVERDUE_ARCHIVE_DAYS, NOTICE_LINGER_DAYS,
			designPaths, developerSlug, designState, designStageStatus, hasDesignContent, impactFilled,
			seedTasks, taskSummary, taskLabel, nextSnapshotIndex, snapshotList, designPrompt, impactToForm, sameImpact,
			designSummaryPath, designSummaryPrompt, rosterDays, rosterMissing, entryMtime, REQUIREMENT_FILE,
			// 文档生成：模板引擎、字段契约、方案清单与生成物
			DOC_TEMPLATE_STAGE, DOC_TEMPLATE_FILE, DOC_SOURCES, BUILTIN_DOCS, DOC_SCOPE_KEYS,
			renderTemplate, collectRefs, scopeKeys, tokenizeTemplate, buildTemplateTree,
			taskNo, parseDraftSections, minePoints, designDocScope, docHeader, designDocFile,
			renderDesignDoc, templateHint, readTemplateOrNull, writeBuiltinTemplate,
			DESIGN_LISTS, designListState, designListPayload, designListShapeText,
			DesignListSection, DesignDocSection,
			requirementAnalysisPath, requirementPointsPath, documentAnalysisPrompt, subagentDirective,
			ANALYSIS_SKILL_NAME,
			analysisDiffHeading, extractSection, joinPath,
			mergeExtractedPoints, normalizePointName, versionDistance, changeRatio, suspicionOf,
			normalizeGroupName, deriveGroupName, pointGroupOf, pointTree, groupByName, FeaturePoints, NEW_GROUP, groupForAdd,
			leadOf, canEditSummary, canHandOverLead, LEAD_FIELD,
			STAGE_BLOCKS, STAGE_INPUTS, STAGE_RULES, stageOf, stageIsPerPerson, stageDir, stageBlockPath, stageBlocks,
			normalizeRow, blockState, emptyBlock, blockFilled, blockRows, stageVerdict, blockShapeText, stagePrompt,
			blockPayload, valueOf, sameValue, statusOf, readState, createReadCache, READ_CACHE_MAX, WRITE_OPS,
			WORKSPACE_OPS,
			OPTION_KEY, STAGE_DONE_KEY, STAGES,
			taskProgress, progressSummary, taskGaps, taskName, TASK_STATE_KEY,
			taskExecutePrompt, testCaseExecutePrompt, rowLabel, BLOCK_EXECUTE,
			MyTasksSection, ExecuteDialog, TaskNameGroup,
			// 阶段页的组件也导出：主视图默认停在「需求」页，渲染冒烟走不到它们。
			StagePage, StageBlockSection,
			// 方案页的几个区块也导出：主视图默认停在「需求」页，渲染冒烟走不到它们，
			// 单独调一次才能把「组件体里的运行时错误」测出来。
			DesignStage, DesignDraftSection, DesignImpactSection, DesignTasksSection, DesignSummarySection,
			// 需求页的文档区同理：默认那一屏是「读取中…」，不单独调就冒烟不到
			// 「显示的是分析而不是原文」这条最要紧的分支。
			RequirementDocuments,
			DevelopersEditor,
			// 需求列表那一行（含「更多操作」菜单与删除的二次确认）：默认它渲染在
			// 「读取中…」那一屏后面，冒烟走不到菜单分支，单独调一次才能测到。
			RequirementChips,
		};

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
