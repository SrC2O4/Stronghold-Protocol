# 五阶、六阶甄选

在大厅、房间或开局确认阶段打开「干员调配」，切换到 V 或 VI 标签页，在干员列表上方点击甄选框。每阶两个名额，点击后展开头像候选列表，支持按名称搜索。候选来自官方角色表的可获得六星，默认全部拥有，并排除已经在固定卡池内的干员。选择后可配置技能与精锐模组；配置保存在浏览器并同步到服务器。点击框内的 × 移除该名额，点击头像框可以更换。恢复技能默认值不会清空甄选。

每阶最多两名，同一干员不能跨阶重复甄选；固定卡池干员不可再次甄选，旧版本保存的重复选择会自动清理。同盟内的所有选择汇入共享卡池，选择相同阶位、相同干员的队友共用其库存；五阶 8 张，六阶 5 张。势力禁用规则同样适用。确认本局信息后配置锁定，再修改只影响下一局。

普通干员为精二 1 级、技能 4 级；精锐为精二 60 级、技能 7 级，五阶模组等级 1、六阶等级 3，均复用原甄选占位的官方状态。甄选不附加固定棋子的活动特质，势力根据角色的国家／组织／队伍对应，无法对应时使用「协防干员」。

## 当前完成度

当前构建保留 137 名六星、两个阶位、普通与精锐，共 548 条数据记录。已有固定池中的 59 名（177 个技能）保留原项目手写技能，不再提供重复甄选；其余 78 名可选候选的 234 个技能已有专属适配入口，包含独立状态、天赋事件与召唤物控制。**专属入口覆盖不等于逐项完整复刻**：手动操作、复杂路径、模组细节和部分联动仍有简化或缺失，详细列于 [RECRUIT-MECHANICS.md](RECRUIT-MECHANICS.md)。

执行 `node tools/kit-coverage.mjs --recruits --tier 6 --missing` 查看缺失的专属技能入口。它统计注册状态，不判断效果保真度。`test/content/recruits.test.js` 覆盖 78 × 3 × 2 阶 × 2 精锐状态的施放、召唤物生命周期和若干核心效果断言；这些测试不证明每项原作机制都已实现。

## 从本地客户端提取

```powershell
py -3.12 -m venv .venv-extract
.\.venv-extract\Scripts\python.exe -m pip install -r tools/local-extract/requirements.txt
npm run extract-operators -- --game "E:\Hypergryph Launcher\games\Arknights Game\Arknights_Data\StreamingAssets\AB\Windows"
```

沿用 README 原提取流程的 UnityPy 和 LZ4AK 解码器。通过 Unity 引用关系读取 `chararts` 中的战斗组件、骨骼、图集和材质，区分正反面，并合并分离的透明通道；单骨骼角色只生成正面，渲染器自动复用。头像、小立绘从 spritepack 读取；技能图标从 `skill_icons_*.ab`，模组图标从 `ui_equip_small_img_hub_*.ab` 提取。召唤物尽可能从客户端的 token 资源组提取，非 Spine 或未匹配对象保留原素材／回退显示，失败报告不会把它们记为成功。

模型、头像和小立绘输出在 `public/assets/local/operators/`，图标输出在 `public/assets/local/skills/` 和 `public/assets/local/modules/`。`data/local-operators-assets.json` 是本机素材覆盖清单，后续下载会合并它；本地素材和覆盖清单均忽略 Git 提交。`.cache/local-operators-report.json` 记录模型解析数量及失败项，`.cache/local-operators.json` 的 `iconMissing` 列出缺失的图标。`--icons-only` 只提取图标，`--retry` 重试导出失败模型，`--manifest-only` 只重建清单，`--only char_003_kalts` 可单独诊断。

## 代码入口

- `tools/build-data.mjs`：从官方表生成候选数据，禁止手改生成的 JSON。
- `shared/protocol.js`：甄选数量、重复干员和技能／模组合法性校验。甄选的默认技能条目也保留，用它表示已选择。
- `server/match/pool.js`、`Match.js`：开局前合并甄选池，不重置普通卡池库存。
- `public/js/screens/loadout.js`：甄选入口，沿用调配的持久化与断线重连同步。
- `test/match/recruits.test.js`：覆盖选择上限、持久化、卡池、合成、阶段锁定与全体候选的基础模拟。
